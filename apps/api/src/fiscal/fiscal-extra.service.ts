import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { COMMON_NCMS, explainFiscalError } from '@comandou/shared';
import { AuditService } from '../audit/audit.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { FiscalService } from './fiscal.service';
import { FiscalKind, FocusClient, FocusReceived, FocusResponse } from './focus.client';

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Situação de manifestação aceita pela SEFAZ. */
export type ManifestType = 'ciencia' | 'confirmacao' | 'desconhecimento' | 'nao_realizada';

/**
 * Inutilização de numeração, notas recebidas (NF-e de fornecedores, com manifestação) e busca de
 * NCM. Tudo pela Focus NFe, com o token do ambiente atual do restaurante.
 */
@Injectable()
export class FiscalExtraService {
  constructor(
    private readonly db: DatabaseService,
    private readonly focus: FocusClient,
    private readonly fiscal: FiscalService,
    private readonly audit: AuditService,
  ) {}

  private async creds(ctx: Ctx) {
    const s = await this.db.withTenant(ctx, (tx) => this.fiscal.settingsRow(tx));
    if (!s?.cnpj) throw new UnprocessableEntityException('Configure o CNPJ em Fiscal > Configuração');
    const token = this.fiscal.token(ctx.tenantId, s, s.environment);
    if (!token)
      throw new UnprocessableEntityException(
        'Sem token da Focus NFe para o ambiente atual: configure em Fiscal > Configuração',
      );
    return { s, token, env: s.environment, cnpj: s.cnpj };
  }

  // ------------------------------------------------------------------ inutilização
  listVoids(ctx: Ctx) {
    return this.db.withTenant(ctx, (tx) =>
      q(
        tx,
        `SELECT v.id, v.kind, v.environment, v.series, v.number_from AS "numberFrom", v.number_to AS "numberTo",
                v.reason, v.status, v.sefaz_status AS "sefazStatus", v.sefaz_message AS "sefazMessage",
                v.protocol, v.xml_path AS "xmlPath", v.created_at AS "createdAt", u.name AS "createdByName"
           FROM fiscal_voids v LEFT JOIN users u ON u.id = v.created_by
          ORDER BY v.created_at DESC LIMIT 500`,
      ),
    );
  }

  /**
   * Números pulados: entre o menor e o maior número usado de cada série, os que não têm nota
   * autorizada/cancelada nem inutilização. São os candidatos a inutilizar.
   */
  gaps(ctx: Ctx) {
    return this.db.withTenant(ctx, async (tx) => {
      const env = (await this.fiscal.settingsRow(tx))?.environment ?? 'homologacao';
      return q<{ kind: FiscalKind; series: number; number: number }>(
        tx,
        `WITH used AS (
           SELECT kind, series::int AS series, number::int AS n FROM fiscal_documents
            WHERE environment = $1 AND number ~ '^[0-9]{1,9}$' AND series ~ '^[0-9]{1,3}$'
              AND status IN ('authorized','cancelling','cancelled')
         ), bounds AS (
           SELECT kind, series, min(n) AS lo, max(n) AS hi FROM used GROUP BY kind, series
         )
         SELECT b.kind, b.series, g AS number
           FROM bounds b, generate_series(b.lo, b.hi) g
          WHERE b.hi - b.lo < 20000
            AND NOT EXISTS (SELECT 1 FROM used u WHERE u.kind = b.kind AND u.series = b.series AND u.n = g)
            AND NOT EXISTS (SELECT 1 FROM fiscal_voids v WHERE v.kind = b.kind AND v.series = b.series
                              AND v.environment = $1 AND v.status = 'authorized' AND g BETWEEN v.number_from AND v.number_to)
          ORDER BY b.kind, b.series, g LIMIT 300`,
        [env],
      );
    });
  }

  async createVoid(
    ctx: Ctx,
    b: { kind: FiscalKind; series: number; from: number; to: number; reason: string },
  ) {
    if (b.to < b.from) throw new UnprocessableEntityException('O número final é menor que o inicial');
    const { token, env, cnpj } = await this.creds(ctx);
    const used = await this.db.withTenant(ctx, (tx) =>
      one<{ number: string }>(
        tx,
        `SELECT number FROM fiscal_documents
          WHERE kind = $1 AND environment = $2 AND series = $3::text AND number ~ '^[0-9]+$'
            AND number::int BETWEEN $4 AND $5 AND status IN ('authorized','cancelling','cancelled','processing')
          LIMIT 1`,
        [b.kind, env, String(b.series), b.from, b.to],
      ),
    );
    if (used)
      throw new ConflictException(
        `O número ${used.number} já é de uma nota emitida: só números que nunca viraram nota podem ser inutilizados`,
      );
    let res: FocusResponse;
    try {
      res = await this.focus.voidRange(env, token, b.kind, {
        cnpj,
        serie: String(b.series),
        numero_inicial: String(b.from),
        numero_final: String(b.to),
        justificativa: b.reason,
      });
    } catch (err) {
      throw new ServiceUnavailableException((err as Error).message);
    }
    const r = res.body;
    const status =
      r.status === 'autorizado' ? 'authorized' : r.status === 'erro_autorizacao' ? 'rejected' : 'error';
    const msg =
      r.mensagem_sefaz ??
      ([r.mensagem, ...(r.erros ?? []).map((e) => e.mensagem)].filter(Boolean).join('; ') ||
        `HTTP ${res.http}`);
    const row = await this.db.withTenant(ctx, async (tx) => {
      const v = await one(
        tx,
        `INSERT INTO fiscal_voids (tenant_id, kind, environment, series, number_from, number_to, reason, status,
            sefaz_status, sefaz_message, protocol, xml_path, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [
          ctx.tenantId,
          b.kind,
          env,
          b.series,
          b.from,
          b.to,
          b.reason,
          status,
          r.status_sefaz != null ? String(r.status_sefaz) : null,
          msg,
          r.protocolo_sefaz != null ? String(r.protocolo_sefaz) : (r.protocolo ?? null),
          r.caminho_xml ?? null,
          ctx.userId,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: status === 'authorized' ? 'fiscal.numbers_voided' : 'fiscal.void_rejected',
        entity: 'fiscal_void',
        entityId: v!.id as string,
        data: { ...b, environment: env, message: msg },
        ip: ctx.ip,
      });
      return v!;
    });
    if (status !== 'authorized') {
      const why = explainFiscalError(r.status_sefaz != null ? String(r.status_sefaz) : null, msg);
      throw new UnprocessableEntityException(`Inutilização recusada: ${why.title}. ${msg}`);
    }
    return { id: row.id, status };
  }

  // ------------------------------------------------------------------ notas recebidas
  listReceived(ctx: Ctx) {
    return this.db.withTenant(ctx, async (tx) => {
      const rows = await q(
        tx,
        `SELECT id, access_key AS "accessKey", issuer_name AS "issuerName", issuer_document AS "issuerDocument",
                total::text, issued_at AS "issuedAt", situation, manifestation, manifested_at AS "manifestedAt",
                manifest_reason AS "manifestReason", complete, correction_text AS "correctionText",
                cancelled_at AS "cancelledAt", cancel_reason AS "cancelReason", created_at AS "createdAt"
           FROM fiscal_received ORDER BY issued_at DESC NULLS LAST LIMIT 1000`,
      );
      const s = await this.fiscal.settingsRow(tx);
      return { rows, syncedAt: s?.received_synced_at ?? null, environment: s?.environment ?? null };
    });
  }

  /** Busca na Focus as NF-e novas emitidas contra o CNPJ (de 100 em 100, a partir da última versão). */
  async syncReceived(ctx: Ctx) {
    const { s, token, env, cnpj } = await this.creds(ctx);
    let version = Number(s.received_version ?? 0);
    let fetched = 0;
    for (let page = 0; page < 20; page++) {
      let r: Awaited<ReturnType<FocusClient['received']>>;
      try {
        r = await this.focus.received(env, token, cnpj, version);
      } catch (err) {
        throw new ServiceUnavailableException((err as Error).message);
      }
      if (r.http === 401 || r.http === 403)
        throw new UnprocessableEntityException(
          'A Focus NFe recusou o token: a consulta de notas recebidas precisa estar habilitada para a empresa',
        );
      if (r.http >= 400)
        throw new UnprocessableEntityException(
          `A Focus NFe recusou a consulta: ${r.error?.mensagem ?? `HTTP ${r.http}`}`,
        );
      if (!r.rows.length) break;
      await this.db.withTenant(ctx, async (tx) => {
        for (const n of r.rows) await this.upsertReceived(tx, ctx.tenantId, n);
      });
      fetched += r.rows.length;
      const max = r.maxVersion || Math.max(...r.rows.map((n) => n.versao ?? 0));
      if (!max || max <= version) break;
      version = max;
      if (r.rows.length < 100) break;
    }
    await this.db.withTenant(ctx, (tx) =>
      tx.$client.query(
        `UPDATE tenant_fiscal_settings SET received_version = $1, received_synced_at = now()`,
        [version],
      ),
    );
    return { fetched, version };
  }

  private async upsertReceived(
    tx: Tx,
    tenantId: string,
    n: FocusReceived,
  ) {
    if (!/^[0-9]{44}$/.test(n.chave_nfe ?? '')) return;
    const situation = ['autorizada', 'cancelada', 'denegada'].includes(n.situacao ?? '')
      ? n.situacao
      : 'autorizada';
    const manif = ['ciencia', 'confirmacao', 'desconhecimento', 'nao_realizada'].includes(
      n.manifestacao_destinatario ?? '',
    )
      ? n.manifestacao_destinatario
      : null;
    await tx.$client.query(
      `INSERT INTO fiscal_received (tenant_id, access_key, issuer_name, issuer_document, total, issued_at, situation,
          manifestation, complete, version, nfe_type, correction_text, cancelled_at, cancel_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (tenant_id, access_key) DO UPDATE SET
          issuer_name = EXCLUDED.issuer_name, issuer_document = EXCLUDED.issuer_document,
          total = EXCLUDED.total, issued_at = EXCLUDED.issued_at, situation = EXCLUDED.situation,
          manifestation = coalesce(EXCLUDED.manifestation, fiscal_received.manifestation),
          complete = EXCLUDED.complete, version = EXCLUDED.version, nfe_type = EXCLUDED.nfe_type,
          correction_text = EXCLUDED.correction_text, cancelled_at = EXCLUDED.cancelled_at,
          cancel_reason = EXCLUDED.cancel_reason`,
      [
        tenantId,
        n.chave_nfe,
        n.nome_emitente ?? null,
        n.documento_emitente ?? null,
        n.valor_total ?? null,
        n.data_emissao ?? null,
        situation,
        manif,
        n.nfe_completa === true || n.nfe_completa === 'true',
        n.versao ?? 0,
        n.tipo_nfe ?? null,
        n.carta_correcao ?? null,
        n.data_cancelamento ?? null,
        n.justificativa_cancelamento ?? null,
      ],
    );
  }

  async manifest(ctx: Ctx, id: string, tipo: ManifestType, reason: string | null) {
    if (tipo === 'nao_realizada' && (!reason || reason.length < 15))
      throw new UnprocessableEntityException(
        'Para "operação não realizada" escreva a justificativa (15 caracteres ou mais)',
      );
    const n = await this.db.withTenant(ctx, (tx) =>
      one<{ access_key: string }>(tx, `SELECT access_key FROM fiscal_received WHERE id = $1`, [id]),
    );
    if (!n) throw new NotFoundException('Nota recebida não encontrada');
    const { token, env } = await this.creds(ctx);
    let res: FocusResponse;
    try {
      res = await this.focus.manifest(env, token, n.access_key, tipo, reason ?? undefined);
    } catch (err) {
      throw new ServiceUnavailableException((err as Error).message);
    }
    const msg = res.body.mensagem_sefaz ?? res.body.mensagem ?? '';
    const ok = res.http < 300 && (res.body.status === 'evento_registrado' || res.body.status_sefaz == 135 || /registrad|duplicidade/i.test(msg) || !res.body.status);
    if (!ok)
      throw new UnprocessableEntityException(
        `Manifestação recusada: ${msg || res.body.mensagem || `HTTP ${res.http}`}`,
      );
    await this.db.withTenant(ctx, async (tx) => {
      await tx.$client.query(
        `UPDATE fiscal_received SET manifestation = $2, manifested_at = now(), manifest_reason = $3 WHERE id = $1`,
        [id, tipo, reason],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'fiscal.received_manifested',
        entity: 'fiscal_received',
        entityId: id,
        data: { tipo, reason },
        ip: ctx.ip,
      });
    });
    return { ok: true, manifestation: tipo };
  }

  /** XML ou DANFE (PDF) de uma nota recebida, baixado da Focus com o token do restaurante. */
  async receivedFile(ctx: Ctx, id: string, ext: 'xml' | 'pdf') {
    const n = await this.db.withTenant(ctx, (tx) =>
      one<{ access_key: string }>(tx, `SELECT access_key FROM fiscal_received WHERE id = $1`, [id]),
    );
    if (!n) throw new NotFoundException('Nota recebida não encontrada');
    const { token, env } = await this.creds(ctx);
    const f = await this.focus.receivedFile(env, token, n.access_key, ext).catch(() => null);
    if (!f)
      throw new NotFoundException(
        'Arquivo ainda não disponível: dê "ciência" na nota para a SEFAZ liberar o XML completo',
      );
    return { ...f, name: `${n.access_key}.${ext}` };
  }

  // ------------------------------------------------------------------ NCM
  /** NCMs comuns do cardápio e, se houver token, a tabela completa da Focus. */
  async ncms(ctx: Ctx, query: string) {
    const term = fold(query.trim());
    const local = COMMON_NCMS.filter(
      ([c, l]) => !term || c.startsWith(term.replace(/\D/g, '') || '#') || fold(l).includes(term),
    ).map(([code, label]) => ({ code, description: label.split(' · ')[1] ?? label }));
    if (term.length < 3) return local;
    try {
      const s = await this.db.withTenant(ctx, (tx) => this.fiscal.settingsRow(tx));
      const token = s ? this.fiscal.token(ctx.tenantId, s, s.environment) : null;
      if (!token || !s) return local;
      const remote = await this.focus.ncms(s.environment, token, query.trim());
      const seen = new Set(local.map((l) => l.code));
      return [
        ...local,
        ...remote
          .filter((r) => r.codigo && /^[0-9]{8}$/.test(r.codigo) && !seen.has(r.codigo))
          .slice(0, 40)
          .map((r) => ({ code: r.codigo!, description: r.descricao_completa ?? r.descricao ?? '' })),
      ];
    } catch {
      return local;
    }
  }
}
