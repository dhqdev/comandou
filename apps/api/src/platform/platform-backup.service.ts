import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { open, seal } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import {
  BackupSettingsRow,
  isConfigured,
  SECRET_CONTEXT,
  SETTINGS_SQL,
} from '../backup/backup-settings';
import { regionFor, S3Client } from '../backup/s3-client';
import type { Actor } from './platform.service';
import { PlatformDb, platformAudit } from './platform-db.service';
import type { BackupSettingsInput } from './platform.schemas';

/** Serviço de backup é considerado vivo se avisou nos últimos 2 minutos. */
const WORKER_ALIVE_MS = 120_000;

/**
 * Configuração do backup pelo painel: bucket do Backblaze B2 (API S3), horário, retenção e
 * pedidos de "fazer agora". A applicationKey é cifrada com a INTEGRATIONS_KEY e nunca volta
 * para o navegador nem entra na auditoria.
 */
@Injectable()
export class PlatformBackupService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
  ) {}

  private async row(): Promise<BackupSettingsRow> {
    const [r] = await this.db.query<BackupSettingsRow & { updated_at: Date }>(
      `${SETTINGS_SQL.replace('FROM', ', updated_at FROM')}`,
    );
    return r;
  }

  private view(r: BackupSettingsRow & { updated_at?: Date }) {
    const alive = !!r.worker_seen_at && Date.now() - r.worker_seen_at.getTime() < WORKER_ALIVE_MS;
    return {
      enabled: r.enabled,
      configured: isConfigured(r),
      endpoint: r.endpoint,
      region: r.region,
      resolvedRegion: r.endpoint ? regionFor(r.endpoint, r.region) : null,
      bucket: r.bucket,
      prefix: r.prefix,
      keyId: r.key_id,
      hasApplicationKey: !!r.secret_enc,
      runAt: r.run_at,
      retentionDays: r.retention_days,
      restoreTestWeekday: r.restore_test_weekday,
      backupRequestedAt: r.backup_requested_at,
      restoreRequestedAt: r.restore_requested_at,
      worker: { alive, lastSeenAt: r.worker_seen_at },
      keyConfigured: !!this.env.INTEGRATIONS_KEY,
      updatedAt: r.updated_at ?? null,
    };
  }

  async settings() {
    return this.view(await this.row());
  }

  /** Em produção só HTTPS (a chave viaja assinada, mas os backups não devem passar em claro). */
  private checkEndpoint(endpoint: string) {
    if (endpoint && this.env.NODE_ENV === 'production' && !endpoint.startsWith('https://'))
      throw new UnprocessableEntityException('Use o endereço com https://');
  }

  async save(b: BackupSettingsInput, a: Actor) {
    this.checkEndpoint(b.endpoint);
    const current = await this.row();
    let secretEnc: Buffer | null = current.secret_enc;
    if (b.applicationKey) {
      if (!this.env.INTEGRATIONS_KEY)
        throw new UnprocessableEntityException(
          'Servidor sem INTEGRATIONS_KEY: não é possível guardar a chave com segurança',
        );
      secretEnc = seal(this.env.INTEGRATIONS_KEY, b.applicationKey, SECRET_CONTEXT);
    }
    const next = {
      endpoint: b.endpoint.replace(/\/+$/, ''),
      bucket: b.bucket,
      key_id: b.keyId,
      secret_enc: secretEnc,
    };
    if (b.enabled && !isConfigured(next))
      throw new UnprocessableEntityException(
        'Para ligar o backup preencha endereço, bucket, keyID e applicationKey',
      );
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE platform_backup_settings SET enabled = $1, endpoint = $2, region = $3, bucket = $4,
                prefix = $5, key_id = $6, secret_enc = $7, run_at = $8, retention_days = $9,
                restore_test_weekday = $10, updated_at = now(), updated_by = $11
          WHERE id`,
        [
          b.enabled,
          next.endpoint,
          b.region,
          b.bucket,
          b.prefix,
          b.keyId,
          secretEnc,
          b.runAt,
          b.retentionDays,
          b.restoreTestWeekday,
          a.admin.id,
        ],
      );
      const { applicationKey: _k, keyId: _id, ...safe } = b;
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.backup_settings_updated',
        entity: 'backup',
        data: { ...safe, applicationKeyChanged: !!b.applicationKey },
        ip: a.ip,
      });
    });
    return this.settings();
  }

  /**
   * Testa o bucket com os dados do formulário (ou os salvos): grava um arquivo pequeno, confere,
   * lê a lista e apaga. Apagar sem permissão não é erro, só desliga a limpeza automática.
   */
  async test(b: BackupSettingsInput) {
    this.checkEndpoint(b.endpoint);
    const current = await this.row();
    if (!this.env.INTEGRATIONS_KEY && !b.applicationKey)
      throw new UnprocessableEntityException('Servidor sem INTEGRATIONS_KEY');
    const secret =
      b.applicationKey ||
      (current.secret_enc && this.env.INTEGRATIONS_KEY
        ? open(this.env.INTEGRATIONS_KEY, current.secret_enc, SECRET_CONTEXT)
        : '');
    if (!b.endpoint || !b.bucket || !b.keyId || !secret)
      throw new UnprocessableEntityException('Preencha endereço, bucket, keyID e applicationKey');
    const s3 = new S3Client({
      endpoint: b.endpoint,
      region: regionFor(b.endpoint, b.region),
      bucket: b.bucket,
      keyId: b.keyId,
      secret,
    });
    const key = `${b.prefix}/.teste-comandou-${randomBytes(6).toString('hex')}`;
    const steps: { step: string; ok: boolean; detail?: string }[] = [];
    try {
      await s3.putBuffer(
        key,
        Buffer.from(`teste de escrita do Comandou ${new Date().toISOString()}\n`),
      );
      steps.push({ step: 'Gravar um arquivo de teste', ok: true });
      const h = await s3.head(key);
      steps.push({ step: 'Conferir o arquivo', ok: !!h });
      await s3.list(`${b.prefix}/`);
      steps.push({ step: 'Listar a pasta', ok: true });
    } catch (e) {
      steps.push({
        step: steps.length ? 'Conferir e listar' : 'Gravar um arquivo de teste',
        ok: false,
        detail: (e as Error).message,
      });
      return { ok: false, canDelete: false, steps };
    }
    let canDelete = true;
    try {
      await s3.delete(key);
      steps.push({ step: 'Apagar o arquivo de teste', ok: true });
    } catch (e) {
      canDelete = false;
      steps.push({
        step: 'Apagar o arquivo de teste',
        ok: false,
        detail: `${(e as Error).message}. Sem permissão de apagar, a retenção não limpa backups velhos (use uma regra de ciclo de vida no bucket).`,
      });
    }
    return { ok: true, canDelete, steps };
  }

  async request(kind: 'backup' | 'restore_test', a: Actor) {
    const r = await this.row();
    if (!r.enabled || !isConfigured(r))
      throw new UnprocessableEntityException('Configure e ligue o backup antes');
    const col = kind === 'backup' ? 'backup_requested_at' : 'restore_requested_at';
    await this.db.tx(async (c) => {
      await c.query(`UPDATE platform_backup_settings SET ${col} = now() WHERE id`);
      await platformAudit(c, {
        adminId: a.admin.id,
        action: kind === 'backup' ? 'platform.backup_requested' : 'platform.restore_test_requested',
        entity: 'backup',
        ip: a.ip,
      });
    });
    return this.settings();
  }
}
