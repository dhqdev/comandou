import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import PostalMime from 'postal-mime';
import type { PoolClient } from 'pg';
import { seal } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import { PlatformDb, platformAudit } from '../platform/platform-db.service';
import type { Actor } from '../platform/platform.service';
import {
  Address,
  cleanHeader,
  domainOf,
  isEmail,
  normalizeMessageId,
  parseAddressList,
  uniqueAddresses,
} from './address';
import { CalendarService } from './calendar.service';
import {
  composeHtml,
  frameDocument,
  hasRemoteImages,
  htmlToText,
  snippetOf,
  textToHtml,
} from './html';
import { authSummary, firstMatch, Rule, shouldAutoReply } from './inbound';
import {
  ContactInput,
  DraftInput,
  FlagsInput,
  Folder,
  FOLDERS,
  MailboxPatchInput,
  MailSettingsInput,
  RuleInput,
} from './mail.schemas';
import { MAIL_SECRET, MailService, MAX_ATTACHMENTS_BYTES, SettingsRow } from './mail.service';

const PAGE = 40;
/** Imagem dentro do corpo (cid:) maior que isto não é embutida na leitura. */
const MAX_INLINE_BYTES = 2 * 1024 * 1024;

interface MailboxRow {
  id: string;
  domain_id: string;
  address: string;
  display_name: string;
  signature: string;
  catch_all: boolean;
  auto_reply: boolean;
  auto_reply_subject: string;
  auto_reply_body: string;
  forward_to: string;
  archived_at: Date | null;
}

const MAILBOX_COLS = `id, domain_id, address::text AS address, display_name, signature, catch_all,
  auto_reply, auto_reply_subject, auto_reply_body, forward_to::text AS forward_to, archived_at`;
/** As mesmas colunas com o apelido `m.` (consulta que junta o domínio). */
const MAILBOX_COLS_M = `m.id, m.domain_id, m.address::text AS address, m.display_name, m.signature,
  m.catch_all, m.auto_reply, m.auto_reply_subject, m.auto_reply_body,
  m.forward_to::text AS forward_to, m.archived_at`;

interface MessageRow {
  id: string;
  mailbox_id: string;
  thread_id: string;
  direction: 'in' | 'out';
  folder: Folder;
  send_status: string | null;
  send_error: string | null;
  rfc_id: string | null;
  in_reply_to: string | null;
  refs: string | null;
  from_address: string;
  from_name: string;
  to_list: Address[];
  cc_list: Address[];
  bcc_list: Address[];
  reply_to: string;
  subject: string;
  snippet: string;
  body_text: string;
  body_html: string;
  auth_results: string;
  is_read: boolean;
  is_starred: boolean;
  has_attachments: boolean;
  sent_at: Date;
}

const MESSAGE_COLS = `id, mailbox_id, thread_id, direction, folder, send_status, send_error, rfc_id,
  in_reply_to, refs, from_address::text AS from_address, from_name, to_list, cc_list, bcc_list,
  reply_to, subject, snippet, body_text, body_html, auth_results, is_read, is_starred,
  has_attachments, sent_at`;

export interface InboundDecision {
  action: 'store' | 'reject';
  reason?: string;
  /** O Worker encaminha uma cópia (o destino precisa estar verificado na Cloudflare). */
  forwardTo?: string;
}

const mailboxView = (m: MailboxRow) => ({
  id: m.id,
  domainId: m.domain_id,
  address: m.address,
  displayName: m.display_name,
  signature: m.signature,
  catchAll: m.catch_all,
  autoReply: m.auto_reply,
  autoReplySubject: m.auto_reply_subject,
  autoReplyBody: m.auto_reply_body,
  forwardTo: m.forward_to,
  archived: !!m.archived_at,
});

/**
 * Caixas de e-mail do domínio no Super Admin: configuração do envio, domínios, caixas, ler,
 * escrever, responder, anexos, regras, contatos e o que chega pelo Worker da Cloudflare.
 */
@Injectable()
export class MailboxService {
  private readonly logger = new Logger('Mailbox');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
    private readonly mail: MailService,
    private readonly calendar: CalendarService,
  ) {}

  // ------------------------------------------------------------------ configuração
  private settingsView(s: SettingsRow) {
    return {
      provider: s.provider,
      fromAddress: s.from_address,
      fromName: s.from_name,
      replyTo: s.reply_to,
      cfAccountId: s.cf_account_id,
      cfTokenSet: !!s.cf_token_enc,
      resendKeySet: !!s.resend_key_enc,
      smtpHost: s.smtp_host,
      smtpPort: s.smtp_port,
      smtpSecure: s.smtp_secure,
      smtpUser: s.smtp_user,
      smtpPassSet: !!s.smtp_pass_enc,
      inboundSecretSet: !!s.inbound_secret_enc,
      /** Envio pronto: provedor com chave e remetente. */
      ready: !!s.from_address && !!this.mail.providerOf(s),
      /** Sem a INTEGRATIONS_KEY não dá para guardar chave nenhuma. */
      canStoreSecrets: !!this.env.INTEGRATIONS_KEY,
      updatedAt: s.updated_at,
    };
  }

  async settings() {
    return this.settingsView(await this.mail.settingsRow());
  }

  async saveSettings(b: MailSettingsInput, a: Actor) {
    const key = this.env.INTEGRATIONS_KEY;
    if ((b.cfToken || b.resendKey || b.smtpPass) && !key)
      throw new UnprocessableEntityException('Defina a INTEGRATIONS_KEY para guardar a chave');
    if (b.provider !== 'none' && !b.fromAddress)
      throw new UnprocessableEntityException('Informe o e-mail remetente');
    // Ausente: mantém ($n NULL e apagar = false). Vazio: apaga. Texto: troca.
    const sec = (v: string | undefined, ctx: string) =>
      [v === '', v && key ? seal(key, v, ctx) : null] as const;
    const [cfClear, cfEnc] = sec(b.cfToken, MAIL_SECRET.cloudflare);
    const [rsClear, rsEnc] = sec(b.resendKey, MAIL_SECRET.resend);
    const [smClear, smEnc] = sec(b.smtpPass, MAIL_SECRET.smtp);
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE mail_settings
            SET provider = $1, from_address = $2, from_name = $3, reply_to = $4, cf_account_id = $5,
                cf_token_enc = CASE WHEN $6::boolean THEN NULL
                                    WHEN $7::bytea IS NOT NULL THEN $7 ELSE cf_token_enc END,
                resend_key_enc = CASE WHEN $8::boolean THEN NULL
                                      WHEN $9::bytea IS NOT NULL THEN $9 ELSE resend_key_enc END,
                smtp_host = $10, smtp_port = $11, smtp_secure = $12, smtp_user = $13,
                smtp_pass_enc = CASE WHEN $14::boolean THEN NULL
                                     WHEN $15::bytea IS NOT NULL THEN $15 ELSE smtp_pass_enc END,
                updated_at = now(), updated_by = $16
          WHERE id`,
        [
          b.provider,
          b.fromAddress,
          b.fromName || 'Comandou',
          b.replyTo,
          b.cfAccountId,
          cfClear,
          cfEnc,
          rsClear,
          rsEnc,
          b.smtpHost,
          b.smtpPort,
          b.smtpSecure,
          b.smtpUser,
          smClear,
          smEnc,
          a.admin.id,
        ],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'mail.settings_saved',
        entity: 'mail',
        data: {
          provider: b.provider,
          fromAddress: b.fromAddress,
          keyChanged:
            b.cfToken !== undefined || b.resendKey !== undefined || b.smtpPass !== undefined,
        },
        ip: a.ip,
      });
    });
    return this.settings();
  }

  /**
   * Cria (ou troca) o segredo do Worker de recebimento e o mostra UMA vez, para colar no
   * `wrangler secret put INBOUND_SECRET`. Trocar invalida o anterior na hora.
   */
  async rotateInboundSecret(origin: string, a: Actor) {
    if (!this.env.INTEGRATIONS_KEY)
      throw new UnprocessableEntityException('Defina a INTEGRATIONS_KEY para guardar o segredo');
    const secret = randomBytes(32).toString('base64url');
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE mail_settings SET inbound_secret_enc = $1, updated_at = now() WHERE id`,
        [seal(this.env.INTEGRATIONS_KEY!, secret, MAIL_SECRET.inbound)],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'mail.inbound_secret_rotated',
        entity: 'mail',
        ip: a.ip,
      });
    });
    return { secret, url: `${origin}/api/v1/platform/mail/inbound` };
  }

  /** E-mail de teste pelo provedor salvo: sai na hora e devolve o erro do provedor, se houver. */
  async testSend(to: string, a: Actor) {
    if (!(await this.mail.ready()))
      throw new UnprocessableEntityException(
        'Salve o provedor, a chave e o remetente antes de testar',
      );
    const r = await this.mail.send({
      kind: 'test',
      to: [{ email: to }],
      subject: 'Teste do e-mail do Comandou',
      html: composeHtml(
        'Este é um e-mail de teste enviado pelo painel do Comandou.\n\nSe ele chegou, o envio está funcionando: boas-vindas do teste, código de nova senha dos clientes, contratos e convites da agenda saem por aqui.',
        '',
      ),
      text: 'Teste do e-mail do Comandou: se este e-mail chegou, o envio está funcionando.',
    });
    await this.db.tx((c) =>
      platformAudit(c, {
        adminId: a.admin.id,
        action: 'mail.test_sent',
        entity: 'mail',
        data: { to, ok: r.ok },
        ip: a.ip,
      }),
    );
    if (!r.ok) throw new UnprocessableEntityException(r.error ?? 'O envio falhou');
    return { ok: true, to };
  }

  // ------------------------------------------------------------------ domínios
  async domains() {
    return this.db.query<{ id: string; domain: string; mailboxes: number }>(
      `SELECT d.id, d.domain::text AS domain,
              (SELECT count(*)::int FROM mail_mailboxes m
                WHERE m.domain_id = d.id AND m.archived_at IS NULL) AS mailboxes
         FROM mail_domains d ORDER BY d.domain`,
    );
  }

  async addDomain(domain: string, a: Actor) {
    return this.db.tx(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO mail_domains (domain) VALUES ($1) ON CONFLICT (domain) DO NOTHING RETURNING id`,
        [domain],
      );
      if (!rows[0]) throw new ConflictException('Este domínio já está cadastrado');
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'mail.domain_added',
        entity: 'mail_domain',
        entityId: rows[0].id,
        data: { domain },
        ip: a.ip,
      });
      return { id: rows[0].id, domain, mailboxes: 0 };
    });
  }

  async removeDomain(id: string, a: Actor) {
    await this.db.tx(async (c) => {
      const used = await c.query(`SELECT 1 FROM mail_mailboxes WHERE domain_id = $1 LIMIT 1`, [id]);
      if (used.rowCount)
        throw new ConflictException(
          'O domínio tem caixas de e-mail. Arquive as caixas e fale com o suporte para removê-lo',
        );
      const { rows } = await c.query<{ domain: string }>(
        `DELETE FROM mail_domains WHERE id = $1 RETURNING domain::text AS domain`,
        [id],
      );
      if (!rows[0]) throw new NotFoundException('Domínio não encontrado');
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'mail.domain_removed',
        entity: 'mail_domain',
        entityId: id,
        data: { domain: rows[0].domain },
        ip: a.ip,
      });
    });
    return { ok: true };
  }

  /**
   * Confere os registros do domínio no DNS público: quem recebe (MX), quem pode enviar (SPF) e
   * a política (DMARC). É só leitura, para a tela dizer o que falta configurar na Cloudflare.
   */
  async checkDns(id: string) {
    const [d] = await this.db.query<{ domain: string }>(
      `SELECT domain::text AS domain FROM mail_domains WHERE id = $1`,
      [id],
    );
    if (!d) throw new NotFoundException('Domínio não encontrado');
    const r = new Resolver({ timeout: 4000, tries: 1 });
    r.setServers(['1.1.1.1', '8.8.8.8']);
    const txt = async (name: string) =>
      (await r.resolveTxt(name).catch(() => [] as string[][])).map((p) => p.join(''));
    const [mx, root, dmarc] = await Promise.all([
      r.resolveMx(d.domain).catch(() => []),
      txt(d.domain),
      txt(`_dmarc.${d.domain}`),
    ]);
    const mxHosts = mx.sort((x, y) => x.priority - y.priority).map((m) => m.exchange.toLowerCase());
    const spf = root.find((t) => /^v=spf1\b/i.test(t)) ?? '';
    const dmarcRec = dmarc.find((t) => /^v=DMARC1\b/i.test(t)) ?? '';
    return {
      domain: d.domain,
      mx: {
        ok: mxHosts.some((h) => h.endsWith('.mx.cloudflare.net')),
        found: mxHosts,
        hint: 'O Email Routing da Cloudflare cria os registros MX (route1/2/3.mx.cloudflare.net) quando o domínio é ativado.',
      },
      spf: {
        ok: !!spf,
        found: spf,
        hint: 'Um registro TXT que começa com v=spf1 e inclui o provedor de envio (a Cloudflare e o Resend mostram o valor ao ativar o domínio).',
      },
      dmarc: {
        ok: !!dmarcRec,
        found: dmarcRec,
        hint:
          'TXT em _dmarc com, por exemplo: v=DMARC1; p=quarantine; rua=mailto:dmarc@' + d.domain,
      },
    };
  }

  // ------------------------------------------------------------------ caixas
  private async mailbox(id: string, c?: PoolClient): Promise<MailboxRow> {
    const sql = `SELECT ${MAILBOX_COLS} FROM mail_mailboxes WHERE id = $1`;
    const rows = c
      ? (await c.query<MailboxRow>(sql, [id])).rows
      : await this.db.query<MailboxRow>(sql, [id]);
    if (!rows[0]) throw new NotFoundException('Caixa de e-mail não encontrada');
    return rows[0];
  }

  /** Caixas com a contagem de cada pasta (não lidas na entrada e no spam; total nas demais). */
  async overview() {
    const [boxes, counts, settings, domains] = await Promise.all([
      this.db.query<MailboxRow>(
        `SELECT ${MAILBOX_COLS} FROM mail_mailboxes ORDER BY archived_at IS NOT NULL, address`,
      ),
      this.db.query<{ mailbox_id: string; folder: Folder; unread: number; total: number }>(
        `SELECT mailbox_id, folder, count(*) FILTER (WHERE NOT is_read)::int AS unread,
                count(*)::int AS total
           FROM mail_messages GROUP BY mailbox_id, folder`,
      ),
      this.settings(),
      this.domains(),
    ]);
    return {
      settings,
      domains,
      mailboxes: boxes.map((m) => ({
        ...mailboxView(m),
        folders: Object.fromEntries(
          FOLDERS.map((f) => {
            const c = counts.find((x) => x.mailbox_id === m.id && x.folder === f);
            return [f, { unread: c?.unread ?? 0, total: c?.total ?? 0 }];
          }),
        ),
      })),
    };
  }

  /** Mensagens não lidas na entrada de todas as caixas ativas (bolinha do menu). */
  async unread() {
    const [r] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM mail_messages m JOIN mail_mailboxes b ON b.id = m.mailbox_id
        WHERE m.folder = 'inbox' AND NOT m.is_read AND b.archived_at IS NULL`,
    );
    return { unread: r?.n ?? 0 };
  }

  async createMailbox(b: { domainId: string; local: string; displayName: string }, a: Actor) {
    return this.db.tx(async (c) => {
      const d = await c.query<{ domain: string }>(
        `SELECT domain::text AS domain FROM mail_domains WHERE id = $1`,
        [b.domainId],
      );
      if (!d.rows[0]) throw new NotFoundException('Domínio não encontrado');
      const address = `${b.local}@${d.rows[0].domain}`;
      if (!isEmail(address)) throw new UnprocessableEntityException('Endereço inválido');
      const { rows } = await c.query<MailboxRow>(
        `INSERT INTO mail_mailboxes (domain_id, address, display_name) VALUES ($1,$2,$3)
         ON CONFLICT (address) DO NOTHING RETURNING ${MAILBOX_COLS}`,
        [b.domainId, address, b.displayName],
      );
      if (!rows[0]) throw new ConflictException('Já existe uma caixa com este endereço');
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'mail.mailbox_created',
        entity: 'mail_mailbox',
        entityId: rows[0].id,
        data: { address },
        ip: a.ip,
      });
      return mailboxView(rows[0]);
    });
  }

  async updateMailbox(id: string, b: MailboxPatchInput, a: Actor) {
    return this.db.tx(async (c) => {
      const cur = await this.mailbox(id, c);
      if (b.catchAll && !cur.catch_all)
        await c.query(
          `UPDATE mail_mailboxes SET catch_all = false WHERE domain_id = $1 AND catch_all`,
          [cur.domain_id],
        );
      const { rows } = await c.query<MailboxRow>(
        `UPDATE mail_mailboxes
            SET display_name = COALESCE($2, display_name), signature = COALESCE($3, signature),
                catch_all = COALESCE($4, catch_all), auto_reply = COALESCE($5, auto_reply),
                auto_reply_subject = COALESCE($6, auto_reply_subject),
                auto_reply_body = COALESCE($7, auto_reply_body),
                forward_to = COALESCE($8, forward_to),
                archived_at = CASE WHEN $9::boolean IS NULL THEN archived_at
                                   WHEN $9 THEN COALESCE(archived_at, now()) ELSE NULL END
          WHERE id = $1 RETURNING ${MAILBOX_COLS}`,
        [
          id,
          b.displayName ?? null,
          b.signature ?? null,
          b.catchAll ?? null,
          b.autoReply ?? null,
          b.autoReplySubject ?? null,
          b.autoReplyBody ?? null,
          b.forwardTo ?? null,
          b.archived ?? null,
        ],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'mail.mailbox_updated',
        entity: 'mail_mailbox',
        entityId: id,
        data: { address: cur.address, fields: Object.keys(b) },
        ip: a.ip,
      });
      return mailboxView(rows[0]!);
    });
  }

  // ------------------------------------------------------------------ ler
  /** Conversas de uma pasta (a mensagem mais nova de cada), com busca. `starred`: as marcadas. */
  async threads(
    mailboxId: string,
    folder: Folder | 'starred',
    opts: { q?: string; page?: number },
  ) {
    await this.mailbox(mailboxId);
    const page = Math.max(0, Math.min(opts.page ?? 0, 500));
    const q = (opts.q ?? '').trim().slice(0, 120);
    const p: unknown[] = [mailboxId];
    let where = `m.mailbox_id = $1`;
    if (folder === 'starred') where += ` AND m.is_starred AND m.folder NOT IN ('trash', 'spam')`;
    else {
      p.push(folder);
      where += ` AND m.folder = $${p.length}`;
    }
    if (q) {
      p.push(q, `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
      where += ` AND (m.search @@ websearch_to_tsquery('simple', $${p.length - 1})
                      OR m.subject ILIKE $${p.length} OR m.from_address::text ILIKE $${p.length})`;
    }
    p.push(PAGE + 1, page * PAGE);
    const rows = await this.db.query<{
      id: string;
      thread_id: string;
      direction: string;
      folder: Folder;
      send_status: string | null;
      from_address: string;
      from_name: string;
      to_list: Address[];
      subject: string;
      snippet: string;
      sent_at: Date;
      has_attachments: boolean;
      n: number;
      unread: boolean;
      starred: boolean;
    }>(
      `SELECT * FROM (
         SELECT DISTINCT ON (m.thread_id) m.id, m.thread_id, m.direction, m.folder, m.send_status,
                m.from_address::text AS from_address, m.from_name, m.to_list, m.subject, m.snippet,
                m.sent_at, bool_or(m.has_attachments) OVER w AS has_attachments,
                count(*) OVER w AS n, bool_or(NOT m.is_read) OVER w AS unread,
                bool_or(m.is_starred) OVER w AS starred
           FROM mail_messages m WHERE ${where}
         WINDOW w AS (PARTITION BY m.thread_id)
          ORDER BY m.thread_id, m.sent_at DESC
       ) t ORDER BY sent_at DESC, id LIMIT $${p.length - 1} OFFSET $${p.length}`,
      p,
    );
    return {
      page,
      more: rows.length > PAGE,
      threads: rows.slice(0, PAGE).map((r) => ({
        id: r.id,
        threadId: r.thread_id,
        direction: r.direction,
        folder: r.folder,
        sendStatus: r.send_status,
        from: { email: r.from_address, name: r.from_name },
        to: r.to_list,
        subject: r.subject,
        snippet: r.snippet,
        at: r.sent_at,
        attachments: r.has_attachments,
        count: Number(r.n),
        unread: r.unread,
        starred: r.starred,
      })),
    };
  }

  /** Mensagens de uma conversa (a lixeira só aparece quando se abre a partir dela). */
  async thread(mailboxId: string, threadId: string, includeTrash: boolean) {
    const rows = await this.db.query<MessageRow>(
      `SELECT ${MESSAGE_COLS} FROM mail_messages
        WHERE mailbox_id = $1 AND thread_id = $2 AND (folder <> 'trash' OR $3::boolean)
        ORDER BY sent_at, created_at`,
      [mailboxId, threadId, includeTrash],
    );
    if (!rows.length) throw new NotFoundException('Conversa não encontrada');
    const atts = await this.db.query<{
      id: string;
      message_id: string;
      filename: string;
      content_type: string;
      content_id: string | null;
      size_bytes: number;
    }>(
      `SELECT id, message_id, filename, content_type, content_id, size_bytes FROM mail_attachments
        WHERE message_id = ANY($1::uuid[]) ORDER BY created_at, id`,
      [rows.map((r) => r.id)],
    );
    // Abrir a conversa marca como lido o que chegou.
    await this.db.query(
      `UPDATE mail_messages SET is_read = true
        WHERE mailbox_id = $1 AND thread_id = $2 AND NOT is_read AND direction = 'in'`,
      [mailboxId, threadId],
    );
    return {
      threadId,
      subject: rows[rows.length - 1]!.subject,
      messages: rows.map((r) => ({
        id: r.id,
        direction: r.direction,
        folder: r.folder,
        sendStatus: r.send_status,
        sendError: r.send_error,
        from: { email: r.from_address, name: r.from_name },
        to: r.to_list,
        cc: r.cc_list,
        bcc: r.bcc_list,
        replyTo: r.reply_to,
        subject: r.subject,
        text: r.body_text,
        hasHtml: !!r.body_html,
        remoteImages: !!r.body_html && hasRemoteImages(r.body_html),
        auth: r.direction === 'in' ? authSummary(r.auth_results) : null,
        starred: r.is_starred,
        at: r.sent_at,
        attachments: atts
          .filter((x) => x.message_id === r.id)
          .map((x) => ({
            id: x.id,
            filename: x.filename,
            type: x.content_type,
            size: x.size_bytes,
            inline: !!x.content_id,
          })),
      })),
    };
  }

  /** Documento da mensagem para a moldura isolada da tela (ver html.ts › frameDocument). */
  async messageHtml(id: string, remoteImages: boolean) {
    const [m] = await this.db.query<{ body_html: string; body_text: string }>(
      `SELECT body_html, body_text FROM mail_messages WHERE id = $1`,
      [id],
    );
    if (!m) throw new NotFoundException('Mensagem não encontrada');
    const inline = new Map<string, string>();
    if (m.body_html.includes('cid:')) {
      const rows = await this.db.query<{ content_id: string; content_type: string; data: Buffer }>(
        `SELECT content_id, content_type, data FROM mail_attachments
          WHERE message_id = $1 AND content_id IS NOT NULL AND size_bytes <= $2
            AND content_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')`,
        [id, MAX_INLINE_BYTES],
      );
      for (const r of rows)
        inline.set(
          r.content_id.replace(/^<|>$/g, '').toLowerCase(),
          `data:${r.content_type};base64,${r.data.toString('base64')}`,
        );
    }
    return {
      html: frameDocument(m.body_html || textToHtml(m.body_text), { remoteImages, inline }),
    };
  }

  async attachment(id: string) {
    const [a] = await this.db.query<{ filename: string; content_type: string; data: Buffer }>(
      `SELECT filename, content_type, data FROM mail_attachments
        WHERE id = $1 AND message_id IS NOT NULL`,
      [id],
    );
    if (!a) throw new NotFoundException('Anexo não encontrado');
    return a;
  }

  /** Lida/não lida, estrela e mover de pasta (por padrão, a conversa inteira). */
  async flag(b: FlagsInput) {
    const scope = b.thread
      ? `(mailbox_id, thread_id) IN (SELECT mailbox_id, thread_id FROM mail_messages WHERE id = ANY($1::uuid[]))`
      : `id = ANY($1::uuid[])`;
    const sets: string[] = [];
    const p: unknown[] = [b.ids];
    if (b.read !== undefined) {
      p.push(b.read);
      sets.push(`is_read = $${p.length}`);
    }
    if (b.starred !== undefined) {
      p.push(b.starred);
      sets.push(`is_starred = $${p.length}`);
    }
    let folderRule = '';
    if (b.folder) {
      p.push(b.folder);
      // Rascunho e e-mail na fila não mudam de pasta; "voltar para a entrada" devolve o enviado a Enviados.
      sets.push(
        `folder = CASE WHEN $${p.length} = 'inbox' AND direction = 'out' THEN 'sent' ELSE $${p.length} END`,
      );
      folderRule = ` AND folder <> 'drafts' AND COALESCE(send_status, 'sent') IN ('sent', 'failed')`;
    }
    const rows = await this.db.query(
      `UPDATE mail_messages SET ${sets.join(', ')} WHERE ${scope}${folderRule} RETURNING id`,
      p,
    );
    return { changed: rows.length };
  }

  /** Apaga de vez: só o que está na lixeira ou é rascunho. */
  async destroy(ids: string[], a: Actor) {
    return this.db.tx(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `DELETE FROM mail_messages
          WHERE id = ANY($1::uuid[]) AND (folder = 'trash' OR folder = 'drafts') RETURNING id`,
        [ids],
      );
      if (rows.length)
        await platformAudit(c, {
          adminId: a.admin.id,
          action: 'mail.messages_deleted',
          entity: 'mail_message',
          data: { count: rows.length },
          ip: a.ip,
        });
      return { deleted: rows.length };
    });
  }

  // ------------------------------------------------------------------ escrever
  private draftView(m: MessageRow, attachments: { id: string; filename: string; size: number }[]) {
    const list = (l: Address[]) =>
      l.map((x) => (x.name ? `${x.name} <${x.email}>` : x.email)).join(', ');
    return {
      id: m.id,
      mailboxId: m.mailbox_id,
      threadId: m.thread_id,
      to: list(m.to_list),
      cc: list(m.cc_list),
      bcc: list(m.bcc_list),
      subject: m.subject,
      text: m.body_text,
      attachments,
    };
  }

  private async draftRow(id: string, c: PoolClient, lock = false): Promise<MessageRow> {
    const { rows } = await c.query<MessageRow>(
      `SELECT ${MESSAGE_COLS} FROM mail_messages
        WHERE id = $1 AND folder = 'drafts' AND direction = 'out'${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    if (!rows[0])
      throw new NotFoundException('Rascunho não encontrado (talvez já tenha sido enviado)');
    return rows[0];
  }

  private async draftAttachments(id: string, c: PoolClient) {
    const { rows } = await c.query<{ id: string; filename: string; size: number }>(
      `SELECT id, filename, size_bytes AS size FROM mail_attachments WHERE message_id = $1
        ORDER BY created_at, id`,
      [id],
    );
    return rows;
  }

  async draft(id: string) {
    return this.db.tx(async (c) =>
      this.draftView(await this.draftRow(id, c), await this.draftAttachments(id, c)),
    );
  }

  /** Cria (id nulo) ou atualiza um rascunho. Resposta herda a conversa; encaminhar copia os anexos. */
  async saveDraft(id: string | null, b: DraftInput, a: Actor) {
    const to = parseAddressList(b.to);
    const cc = uniqueAddresses(
      parseAddressList(b.cc),
      to.map((x) => x.email),
    );
    const bcc = uniqueAddresses(
      parseAddressList(b.bcc),
      [...to, ...cc].map((x) => x.email),
    );
    const subject = cleanHeader(b.subject).slice(0, 300);
    return this.db.tx(async (c) => {
      const box = await this.mailbox(b.mailboxId, c);
      if (box.archived_at) throw new ConflictException('Esta caixa está arquivada');
      if (id) {
        await this.draftRow(id, c, true);
        const { rows } = await c.query<MessageRow>(
          `UPDATE mail_messages
              SET to_list = $2, cc_list = $3, bcc_list = $4, subject = $5, body_text = $6,
                  snippet = $7, sent_at = now()
            WHERE id = $1 RETURNING ${MESSAGE_COLS}`,
          [
            id,
            JSON.stringify(to),
            JSON.stringify(cc),
            JSON.stringify(bcc),
            subject,
            b.text,
            snippetOf(b.text),
          ],
        );
        return this.draftView(rows[0]!, await this.draftAttachments(id, c));
      }
      // Rascunho novo: de uma resposta, de um encaminhamento ou em branco.
      let threadId: string = randomUUID();
      let inReplyTo: string | null = null;
      let refs: string | null = null;
      const sourceId = b.replyTo ?? b.forwardOf;
      if (sourceId) {
        const src = await c.query<MessageRow>(
          `SELECT ${MESSAGE_COLS} FROM mail_messages WHERE id = $1 AND mailbox_id = $2`,
          [sourceId, b.mailboxId],
        );
        if (!src.rows[0]) throw new NotFoundException('Mensagem original não encontrada');
        if (b.replyTo) {
          threadId = src.rows[0].thread_id;
          inReplyTo = src.rows[0].rfc_id;
          refs =
            [src.rows[0].refs, src.rows[0].rfc_id].filter(Boolean).join(' ').slice(-7900) || null;
        }
      }
      const { rows } = await c.query<MessageRow>(
        `INSERT INTO mail_messages (mailbox_id, thread_id, direction, folder, send_status, in_reply_to,
                                    refs, from_address, from_name, to_list, cc_list, bcc_list, subject,
                                    snippet, body_text, is_read, created_by)
         VALUES ($1,$2,'out','drafts','draft',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13)
         RETURNING ${MESSAGE_COLS}`,
        [
          b.mailboxId,
          threadId,
          inReplyTo,
          refs,
          box.address,
          box.display_name,
          JSON.stringify(to),
          JSON.stringify(cc),
          JSON.stringify(bcc),
          subject,
          snippetOf(b.text),
          b.text,
          a.admin.id,
        ],
      );
      const draft = rows[0]!;
      if (b.forwardOf) {
        await c.query(
          `INSERT INTO mail_attachments (message_id, filename, content_type, size_bytes, data)
           SELECT $1, filename, content_type, size_bytes, data FROM mail_attachments
            WHERE message_id = $2 AND content_id IS NULL`,
          [draft.id, b.forwardOf],
        );
        await c.query(
          `UPDATE mail_messages SET has_attachments = EXISTS
             (SELECT 1 FROM mail_attachments WHERE message_id = $1) WHERE id = $1`,
          [draft.id],
        );
      }
      return this.draftView(draft, await this.draftAttachments(draft.id, c));
    });
  }

  async addAttachment(draftId: string, f: { filename: string; contentType: string; data: Buffer }) {
    if (!f.data.length) throw new UnprocessableEntityException('Arquivo vazio');
    return this.db.tx(async (c) => {
      await this.draftRow(draftId, c, true);
      const sum = await c.query<{ total: string; n: number }>(
        `SELECT COALESCE(sum(size_bytes), 0) AS total, count(*)::int AS n FROM mail_attachments
          WHERE message_id = $1`,
        [draftId],
      );
      if (sum.rows[0]!.n >= 20) throw new UnprocessableEntityException('No máximo 20 anexos');
      if (Number(sum.rows[0]!.total) + f.data.length > MAX_ATTACHMENTS_BYTES)
        throw new UnprocessableEntityException('Os anexos passam de 15 MB');
      const filename =
        cleanHeader(f.filename)
          .replace(/[\\/:*?"<>|]/g, '_')
          .slice(0, 200) || 'anexo';
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO mail_attachments (message_id, filename, content_type, size_bytes, data)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [draftId, filename, f.contentType.slice(0, 200), f.data.length, f.data],
      );
      await c.query(`UPDATE mail_messages SET has_attachments = true WHERE id = $1`, [draftId]);
      return { id: rows[0]!.id, filename, size: f.data.length };
    });
  }

  async removeAttachment(draftId: string, attachmentId: string) {
    await this.db.tx(async (c) => {
      await this.draftRow(draftId, c, true);
      await c.query(`DELETE FROM mail_attachments WHERE id = $1 AND message_id = $2`, [
        attachmentId,
        draftId,
      ]);
      await c.query(
        `UPDATE mail_messages SET has_attachments = EXISTS
           (SELECT 1 FROM mail_attachments WHERE message_id = $1) WHERE id = $1`,
        [draftId],
      );
    });
    return { ok: true };
  }

  /**
   * Envia o rascunho: ele vai para Enviados e entra na fila na mesma transação; a entrega é
   * tentada na hora e, se o provedor estiver fora, de novo sozinha (a tela mostra "na fila").
   */
  async sendDraft(id: string, a: Actor) {
    if (!(await this.mail.ready()))
      throw new UnprocessableEntityException(
        'Configure o envio em E-mail › Configurar antes de enviar',
      );
    const outboxId = await this.db.tx(async (c) => {
      const m = await this.draftRow(id, c, true);
      const box = await this.mailbox(m.mailbox_id, c);
      if (box.archived_at) throw new ConflictException('Esta caixa está arquivada');
      if (!m.to_list.length && !m.cc_list.length && !m.bcc_list.length)
        throw new UnprocessableEntityException('Informe pelo menos um destinatário');
      const subject = m.subject || '(sem assunto)';
      const html = composeHtml(m.body_text, '');
      const rfcId = `<${randomUUID()}@${domainOf(box.address)}>`;
      await c.query(
        `UPDATE mail_messages
            SET folder = 'sent', send_status = 'queued', send_error = NULL, subject = $2,
                body_html = $3, rfc_id = $4, from_address = $5, from_name = $6, sent_at = now(),
                is_read = true
          WHERE id = $1`,
        [id, subject, html, rfcId, box.address, box.display_name],
      );
      const headers: Record<string, string> = {};
      if (m.in_reply_to) headers['In-Reply-To'] = m.in_reply_to;
      if (m.refs) headers.References = m.refs;
      const out = await this.mail.enqueue(c, {
        kind: 'mailbox',
        messageId: id,
        from: { address: box.address, name: box.display_name },
        to: m.to_list,
        cc: m.cc_list,
        bcc: m.bcc_list,
        subject,
        html,
        text: m.body_text,
        rfcId,
        headers,
      });
      await this.touchContacts(c, [...m.to_list, ...m.cc_list, ...m.bcc_list]);
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'mail.message_sent',
        entity: 'mail_message',
        entityId: id,
        data: {
          from: box.address,
          recipients: m.to_list.length + m.cc_list.length + m.bcc_list.length,
        },
        ip: a.ip,
      });
      return out;
    });
    const r = await this.mail.deliver(outboxId);
    return { id, sent: r.ok, error: r.ok ? null : (r.error ?? null) };
  }

  /** Tenta de novo um e-mail da caixa que falhou. */
  async retryMessage(id: string) {
    const [o] = await this.db.query<{ id: string }>(
      `UPDATE mail_outbox SET status = 'queued', attempts = 0, next_attempt_at = now(), last_error = NULL
        WHERE message_id = $1 AND status = 'failed' RETURNING id`,
      [id],
    );
    if (!o) throw new ConflictException('Este e-mail não está com falha');
    await this.db.query(
      `UPDATE mail_messages SET send_status = 'queued', send_error = NULL WHERE id = $1`,
      [id],
    );
    const r = await this.mail.deliver(o.id);
    return { id, sent: r.ok, error: r.ok ? null : (r.error ?? null) };
  }

  // ------------------------------------------------------------------ o que chega
  /**
   * Guarda um e-mail que chegou pelo Worker. `to` é o endereço para o qual a Cloudflare entregou
   * (o do envelope, não o do cabeçalho). Sem caixa para o endereço, a resposta manda recusar.
   */
  async receive(raw: Buffer, envelope: { from: string; to: string }): Promise<InboundDecision> {
    const rcpt = envelope.to.trim().toLowerCase();
    if (!isEmail(rcpt)) return { action: 'reject', reason: 'Endereço inválido' };
    const [box] = await this.db.query<MailboxRow>(
      `SELECT ${MAILBOX_COLS_M}
         FROM mail_mailboxes m JOIN mail_domains d ON d.id = m.domain_id
        WHERE m.archived_at IS NULL
          AND (m.address = $1 OR (m.catch_all AND d.domain = $2))
        ORDER BY (m.address = $1) DESC LIMIT 1`,
      [rcpt, domainOf(rcpt)],
    );
    if (!box) return { action: 'reject', reason: 'Esta caixa de e-mail não existe' };

    const mail = await PostalMime.parse(raw, { maxNestingDepth: 30 });
    const headers = new Map(mail.headers.map((h) => [h.key.toLowerCase(), h.value]));
    const fromBox = mail.from && 'address' in mail.from && mail.from.address ? mail.from : null;
    const fromEmail = (fromBox?.address ?? envelope.from ?? '').trim().toLowerCase();
    const from = isEmail(fromEmail) ? fromEmail : 'desconhecido@invalid.invalid';
    const flat = (l: typeof mail.to) =>
      (l ?? [])
        .flatMap((x) => ('group' in x && x.group ? x.group : [x]))
        .filter((x) => x.address && isEmail(x.address))
        .map((x) => ({ email: x.address!.toLowerCase(), name: (x.name ?? '').slice(0, 120) }))
        .slice(0, 100);
    const toList = flat(mail.to);
    const subject = cleanHeader(mail.subject ?? '').slice(0, 990);
    const html = mail.html ?? '';
    const text = (mail.text ?? '').trim() || htmlToText(html);

    const rules = await this.db.query<Rule & { id: string }>(
      `SELECT id, mailbox_id, field, op, value, action FROM mail_rules
        WHERE enabled ORDER BY position, created_at`,
    );
    const rule = firstMatch(rules, box.id, {
      from,
      to: [rcpt, ...toList.map((x) => x.email)],
      subject,
    });
    if (rule?.action === 'reject')
      return { action: 'reject', reason: 'Mensagem recusada pelo destinatário' };

    const rfcId = normalizeMessageId(mail.messageId);
    const inReplyTo = normalizeMessageId(mail.inReplyTo);
    const refList = (mail.references ?? '')
      .split(/\s+/)
      .map((r) => normalizeMessageId(r))
      .filter((r): r is string => !!r)
      .slice(-30);
    const folder: Folder =
      rule?.action === 'archive'
        ? 'archive'
        : rule?.action === 'spam'
          ? 'spam'
          : rule?.action === 'trash'
            ? 'trash'
            : 'inbox';
    const attachments = mail.attachments
      .map((x) => ({
        filename: cleanHeader(x.filename ?? '').slice(0, 200) || 'anexo',
        contentType: (x.mimeType || 'application/octet-stream').slice(0, 200),
        contentId: x.contentId ? x.contentId.slice(0, 250) : null,
        data:
          typeof x.content === 'string'
            ? Buffer.from(x.content, x.encoding === 'base64' ? 'base64' : 'utf8')
            : Buffer.from(x.content as ArrayBuffer),
      }))
      .filter((x) => x.data.length > 0)
      .slice(0, 40);

    const stored = await this.db.tx(async (c) => {
      // Entrega repetida do mesmo e-mail (o Worker tenta de novo se a resposta se perder).
      if (rfcId) {
        const dup = await c.query(
          `SELECT 1 FROM mail_messages WHERE mailbox_id = $1 AND rfc_id = $2 AND direction = 'in'`,
          [box.id, rfcId],
        );
        if (dup.rowCount) return false;
      }
      const related = [inReplyTo, ...refList].filter((r): r is string => !!r);
      const thread = related.length
        ? await c.query<{ thread_id: string }>(
            `SELECT thread_id FROM mail_messages
              WHERE mailbox_id = $1 AND rfc_id = ANY($2::text[]) ORDER BY sent_at DESC LIMIT 1`,
            [box.id, related],
          )
        : null;
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO mail_messages (mailbox_id, thread_id, direction, folder, rfc_id, in_reply_to, refs,
                                    from_address, from_name, to_list, cc_list, reply_to, subject,
                                    snippet, body_text, body_html, auth_results, is_read, is_starred,
                                    has_attachments, size_bytes)
         VALUES ($1,$2,'in',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING id`,
        [
          box.id,
          thread?.rows[0]?.thread_id ?? randomUUID(),
          folder,
          rfcId,
          inReplyTo,
          refList.join(' ') || null,
          from,
          cleanHeader(fromBox?.name ?? '').slice(0, 200),
          JSON.stringify(toList),
          JSON.stringify(flat(mail.cc)),
          (mail.replyTo?.find((x) => x.address && isEmail(x.address))?.address ?? '').slice(0, 254),
          subject,
          snippetOf(text),
          text.slice(0, 500_000),
          html.slice(0, 2_000_000),
          (headers.get('authentication-results') ?? '').slice(0, 2000),
          rule?.action === 'read' || folder === 'trash',
          rule?.action === 'star',
          attachments.some((x) => !x.contentId),
          raw.length,
        ],
      );
      for (const x of attachments)
        await c.query(
          `INSERT INTO mail_attachments (message_id, filename, content_type, content_id, size_bytes, data)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [rows[0]!.id, x.filename, x.contentType, x.contentId, x.data.length, x.data],
        );
      if (folder === 'inbox' || folder === 'archive')
        await this.touchContacts(c, [{ email: from, name: fromBox?.name ?? '' }]);
      return true;
    });
    if (!stored) return { action: 'store' };

    // Resposta de um convite da agenda ("Aceito" / "Recuso").
    const reply = mail.attachments.find(
      (x) => /^text\/calendar/i.test(x.mimeType) && (x.method ?? 'REPLY').toUpperCase() === 'REPLY',
    );
    if (reply)
      await this.calendar
        .applyReply(
          typeof reply.content === 'string'
            ? reply.content
            : Buffer.from(reply.content as ArrayBuffer).toString('utf8'),
        )
        .catch(() => undefined);

    if (
      box.auto_reply &&
      box.auto_reply_body.trim() &&
      folder === 'inbox' &&
      shouldAutoReply(headers, from)
    )
      await this.autoReply(box, from, subject, rfcId).catch((e: Error) =>
        this.logger.warn(`resposta automática de ${box.address} falhou: ${e.message}`),
      );
    return box.forward_to ? { action: 'store', forwardTo: box.forward_to } : { action: 'store' };
  }

  /** Uma resposta automática por remetente a cada 24 horas. */
  private async autoReply(box: MailboxRow, to: string, subject: string, rfcId: string | null) {
    if (!(await this.mail.ready())) return;
    const recent = await this.db.query(
      `SELECT 1 FROM mail_outbox
        WHERE kind = 'mailbox.auto_reply' AND from_address = $1
          AND recipients->'to'->0->>'email' = $2 AND created_at > now() - interval '1 day' LIMIT 1`,
      [box.address, to],
    );
    if (recent.length) return;
    const headers: Record<string, string> = { 'Auto-Submitted': 'auto-replied' };
    if (rfcId) {
      headers['In-Reply-To'] = rfcId;
      headers.References = rfcId;
    }
    const id = await this.mail.enqueue(null, {
      kind: 'mailbox.auto_reply',
      from: { address: box.address, name: box.display_name },
      to: [{ email: to }],
      subject: box.auto_reply_subject || `Re: ${subject || 'sua mensagem'}`,
      html: composeHtml(box.auto_reply_body, box.signature),
      text: box.auto_reply_body,
      headers,
    });
    void this.mail.deliver(id).catch(() => undefined);
  }

  // ------------------------------------------------------------------ regras
  rules() {
    return this.db.query(
      `SELECT id, mailbox_id AS "mailboxId", name, enabled, field, op, value, action, position
         FROM mail_rules ORDER BY position, created_at`,
    );
  }

  async saveRule(id: string | null, b: RuleInput, a: Actor) {
    return this.db.tx(async (c) => {
      const p = [b.mailboxId, b.name, b.enabled, b.field, b.op, b.value, b.action];
      const { rows } = id
        ? await c.query<{ id: string }>(
            `UPDATE mail_rules SET mailbox_id = $1, name = $2, enabled = $3, field = $4, op = $5,
                    value = $6, action = $7 WHERE id = $8 RETURNING id`,
            [...p, id],
          )
        : await c.query<{ id: string }>(
            `INSERT INTO mail_rules (mailbox_id, name, enabled, field, op, value, action, position)
             VALUES ($1,$2,$3,$4,$5,$6,$7, (SELECT COALESCE(max(position), 0) + 1 FROM mail_rules))
             RETURNING id`,
            p,
          );
      if (!rows[0]) throw new NotFoundException('Regra não encontrada');
      await platformAudit(c, {
        adminId: a.admin.id,
        action: id ? 'mail.rule_updated' : 'mail.rule_created',
        entity: 'mail_rule',
        entityId: rows[0].id,
        data: { name: b.name, action: b.action },
        ip: a.ip,
      });
      return { id: rows[0].id };
    });
  }

  async deleteRule(id: string, a: Actor) {
    await this.db.tx(async (c) => {
      const r = await c.query(`DELETE FROM mail_rules WHERE id = $1`, [id]);
      if (!r.rowCount) throw new NotFoundException('Regra não encontrada');
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'mail.rule_deleted',
        entity: 'mail_rule',
        entityId: id,
        ip: a.ip,
      });
    });
    return { ok: true };
  }

  // ------------------------------------------------------------------ contatos
  private async touchContacts(c: PoolClient, list: Address[]) {
    for (const x of uniqueAddresses(list.filter((y) => isEmail(y.email))).slice(0, 60))
      await c.query(
        `INSERT INTO mail_contacts (email, name) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE
           SET last_used_at = now(),
               name = CASE WHEN mail_contacts.name = '' THEN EXCLUDED.name ELSE mail_contacts.name END`,
        [x.email.toLowerCase(), cleanHeader(x.name ?? '').slice(0, 120)],
      );
  }

  contacts(q: string, limit = 200) {
    const like = `%${q
      .trim()
      .slice(0, 80)
      .replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    return this.db.query(
      `SELECT id, email::text AS email, name, company, phone, notes, auto,
              last_used_at AS "lastUsedAt"
         FROM mail_contacts
        WHERE email::text ILIKE $1 OR name ILIKE $1 OR company ILIKE $1
        ORDER BY last_used_at DESC LIMIT $2`,
      [like, Math.min(Math.max(limit, 1), 500)],
    );
  }

  async saveContact(id: string | null, b: ContactInput) {
    try {
      const rows = id
        ? await this.db.query<{ id: string }>(
            `UPDATE mail_contacts SET email = $1, name = $2, company = $3, phone = $4, notes = $5,
                    auto = false WHERE id = $6 RETURNING id`,
            [b.email, b.name, b.company, b.phone, b.notes, id],
          )
        : await this.db.query<{ id: string }>(
            `INSERT INTO mail_contacts (email, name, company, phone, notes, auto)
             VALUES ($1,$2,$3,$4,$5,false)
             ON CONFLICT (email) DO UPDATE
               SET name = EXCLUDED.name, company = EXCLUDED.company, phone = EXCLUDED.phone,
                   notes = EXCLUDED.notes, auto = false
             RETURNING id`,
            [b.email, b.name, b.company, b.phone, b.notes],
          );
      if (!rows[0]) throw new NotFoundException('Contato não encontrado');
      return { id: rows[0].id };
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException('Já existe um contato com este e-mail');
      throw e;
    }
  }

  async deleteContact(id: string) {
    await this.db.query(`DELETE FROM mail_contacts WHERE id = $1`, [id]);
    return { ok: true };
  }

  // ------------------------------------------------------------------ envios do sistema
  /** Fila de saída: o que o sistema mandou (ou tentou), sem o conteúdo. */
  async outbox(status?: string) {
    const ok = ['queued', 'sending', 'sent', 'failed', 'cancelled'].includes(status ?? '');
    const rows = await this.db.query(
      `SELECT o.id, o.kind, o.subject, o.recipients->'to' AS "to", o.status, o.attempts,
              o.last_error AS "lastError", o.provider, o.created_at AS "createdAt",
              o.sent_at AS "sentAt", o.next_attempt_at AS "nextAttemptAt", t.name AS tenant,
              COALESCE(NULLIF(o.from_address::text, ''), '') AS "fromAddress"
         FROM mail_outbox o LEFT JOIN tenants t ON t.id = o.tenant_id
        ${ok ? 'WHERE o.status = $1' : ''}
        ORDER BY o.created_at DESC LIMIT 200`,
      ok ? [status] : [],
    );
    const [c] = await this.db.query<{ queued: number; failed: number; sent_day: number }>(
      `SELECT count(*) FILTER (WHERE status IN ('queued', 'sending'))::int AS queued,
              count(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '7 days')::int AS failed,
              count(*) FILTER (WHERE status = 'sent' AND sent_at > now() - interval '1 day')::int AS sent_day
         FROM mail_outbox`,
    );
    return { rows, queued: c?.queued ?? 0, failed: c?.failed ?? 0, sentDay: c?.sent_day ?? 0 };
  }

  /** Tenta de novo um envio que falhou. E-mail com senha ou código já foi apagado e não volta. */
  async retryOutbox(id: string) {
    const [o] = await this.db.query<{ id: string; message_id: string | null }>(
      `UPDATE mail_outbox SET status = 'queued', attempts = 0, next_attempt_at = now(), last_error = NULL
        WHERE id = $1 AND status = 'failed'
          AND (html IS NOT NULL OR body_text IS NOT NULL OR body_enc IS NOT NULL)
        RETURNING id, message_id`,
      [id],
    );
    if (!o)
      throw new ConflictException(
        'Não dá para reenviar: o envio não falhou ou o conteúdo (com senha ou código) já foi apagado',
      );
    const r = await this.mail.deliver(o.id);
    return { id, sent: r.ok, error: r.ok ? null : (r.error ?? null) };
  }

  async cancelOutbox(id: string) {
    const rows = await this.db.query(
      `UPDATE mail_outbox SET status = 'cancelled', body_enc = NULL,
              html = CASE WHEN sensitive THEN NULL ELSE html END,
              body_text = CASE WHEN sensitive THEN NULL ELSE body_text END
        WHERE id = $1 AND status = 'queued' RETURNING id`,
      [id],
    );
    if (!rows.length) throw new ConflictException('Este envio não está na fila');
    return { ok: true };
  }
}
