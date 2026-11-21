import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { clientStatus, type TicketState } from '@comandou/shared';
import type { PoolClient } from 'pg';
import { PlatformDb } from '../platform/platform-db.service';
import { tenantIcon, tenantIcons } from '../platform/tenant-icons';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * Conversa de cada restaurante com a Comandou (suporte). O dono ou gerente escreve pela aba
 * "Suporte" do chat do sistema; o Super Admin responde em "Conversas". Fica no banco central.
 */

export type SupportSide = 'tenant' | 'admin';
export type SupportSender = SupportSide | 'system';
type FileKind = 'image' | 'video';

/** Espaço das fotos e vídeos da conversa de um restaurante (os mais antigos saem primeiro). */
export const SUPPORT_FILES_QUOTA = 256 * 1024 * 1024;
const PAGE = 50;

export interface SupportMessage {
  id: string;
  sender: SupportSender;
  authorName: string | null;
  body: string;
  file: {
    id: string;
    kind: FileKind;
    url: string;
    width: number | null;
    height: number | null;
    size: number;
  } | null;
  fileGone: FileKind | null;
  /** Chamado de que a mensagem fala (cartão clicável na conversa). */
  ticket: { id: string; code: string; title: string; statusLabel: string; done: boolean } | null;
  createdAt: string;
}

export interface SupportAuthor {
  userId?: string | null;
  adminId?: string | null;
  name: string;
}

interface MessageRow {
  id: string;
  sender: SupportSender;
  authorName: string | null;
  body: string;
  fileId: string | null;
  fileKind: FileKind | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  ticketId: string | null;
  ticketNumber: number | null;
  ticketTitle: string | null;
  ticketStage: string | null;
  ticketState: TicketState | null;
  createdAt: Date;
}

interface ChatRow {
  status: 'open' | 'closed';
  tenantReadAt: Date;
  adminReadAt: Date;
}

const MSG_SELECT = `SELECT m.id, m.sender, m.author_name AS "authorName", m.body,
    m.file_id AS "fileId", m.file_kind AS "fileKind", f.size AS "fileSize", f.width, f.height,
    tk.id AS "ticketId", tk.number AS "ticketNumber", tk.title AS "ticketTitle",
    tk.stage AS "ticketStage", tk.state AS "ticketState",
    m.created_at AS "createdAt"
  FROM platform_support_messages m
  LEFT JOIN platform_support_files f ON f.id = m.file_id
  LEFT JOIN platform_tickets tk ON tk.id = m.ticket_id`;

const ticketCode = (n: number) => `#CH-${String(n).padStart(4, '0')}`;

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

/** Texto curto da última mensagem, para a lista de conversas. */
function preview(body: string, kind: FileKind | null) {
  const t = body.replace(/\s+/g, ' ').trim();
  if (t) return t.slice(0, 140);
  if (kind === 'image') return 'Foto';
  if (kind === 'video') return 'Vídeo';
  return '';
}

/** Lado que NÃO é quem vê (para a contagem de não lidas e os risquinhos). */
const other = (side: SupportSide): SupportSide => (side === 'tenant' ? 'admin' : 'tenant');

@Injectable()
export class SupportDeskService {
  constructor(
    private readonly pdb: PlatformDb,
    private readonly realtime: RealtimeService,
  ) {}

  private need() {
    if (!this.pdb.enabled)
      throw new ServiceUnavailableException('O suporte não está disponível neste servidor');
  }

  private fileUrl(side: SupportSide, id: string) {
    return side === 'tenant'
      ? `/api/v1/help/chat/files/${id}`
      : `/api/v1/platform/support/files/${id}`;
  }

  private toMessage(side: SupportSide, r: MessageRow): SupportMessage {
    return {
      id: r.id,
      sender: r.sender,
      authorName: r.sender === 'system' ? null : r.authorName,
      body: r.body,
      file:
        r.fileId && r.fileKind
          ? {
              id: r.fileId,
              kind: r.fileKind,
              url: this.fileUrl(side, r.fileId),
              width: r.width,
              height: r.height,
              size: r.fileSize ?? 0,
            }
          : null,
      fileGone: !r.fileId && r.fileKind ? r.fileKind : null,
      ticket:
        r.ticketId && r.ticketNumber != null && r.ticketState
          ? {
              id: r.ticketId,
              code: ticketCode(r.ticketNumber),
              title: r.ticketTitle ?? '',
              statusLabel: clientStatus(r.ticketStage ?? 'inicio', r.ticketState).label,
              done: ['done', 'rejected', 'cancelled'].includes(r.ticketState),
            }
          : null,
      createdAt: iso(r.createdAt)!,
    };
  }

  private async chatOf(c: PoolClient | null, tenantId: string): Promise<ChatRow | null> {
    const sql = `SELECT status, tenant_read_at AS "tenantReadAt", admin_read_at AS "adminReadAt"
                   FROM platform_support_chats WHERE tenant_id = $1`;
    const rows = c
      ? (await c.query<ChatRow>(sql, [tenantId])).rows
      : await this.pdb.query<ChatRow>(sql, [tenantId]);
    return rows[0] ?? null;
  }

  private async ensureChat(c: PoolClient, tenantId: string) {
    await c.query(
      `INSERT INTO platform_support_chats (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId],
    );
  }

  private async messages(side: SupportSide, tenantId: string, before?: string) {
    const rows = await this.pdb.query<MessageRow>(
      `${MSG_SELECT}
        WHERE m.tenant_id = $1 AND ($2::timestamptz IS NULL OR m.created_at < $2)
        ORDER BY m.created_at DESC, m.id DESC LIMIT ${PAGE + 1}`,
      [tenantId, before ?? null],
    );
    return {
      messages: rows
        .slice(0, PAGE)
        .reverse()
        .map((r) => this.toMessage(side, r)),
      hasMore: rows.length > PAGE,
    };
  }

  private async unreadOf(side: SupportSide, tenantId: string, readAt: Date | null) {
    if (!readAt) return 0;
    const [r] = await this.pdb.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_support_messages
        WHERE tenant_id = $1 AND sender = $2 AND created_at > $3`,
      [tenantId, other(side), readAt],
    );
    return r?.n ?? 0;
  }

  /** Conversa vista por um dos lados: mensagens, até onde o outro leu e não lidas. */
  async state(side: SupportSide, tenantId: string) {
    this.need();
    const chat = await this.chatOf(null, tenantId);
    const page = chat ? await this.messages(side, tenantId) : { messages: [], hasMore: false };
    return {
      status: chat?.status ?? 'open',
      ...page,
      otherReadAt: chat ? iso(side === 'tenant' ? chat.adminReadAt : chat.tenantReadAt) : null,
      unread: chat
        ? await this.unreadOf(
            side,
            tenantId,
            side === 'tenant' ? chat.tenantReadAt : chat.adminReadAt,
          )
        : 0,
    };
  }

  async older(side: SupportSide, tenantId: string, before: string) {
    this.need();
    return this.messages(side, tenantId, before);
  }

  /** Não lidas do restaurante (bolinha da aba Suporte). */
  async tenantUnread(tenantId: string) {
    if (!this.pdb.enabled) return { available: false, unread: 0 };
    const chat = await this.chatOf(null, tenantId);
    return {
      available: true,
      unread: chat ? await this.unreadOf('tenant', tenantId, chat.tenantReadAt) : 0,
      adminReadAt: chat ? iso(chat.adminReadAt) : null,
    };
  }

  async send(
    side: SupportSide,
    tenantId: string,
    author: SupportAuthor,
    input: { body: string; fileId?: string | null; ticketId?: string | null },
  ): Promise<SupportMessage> {
    this.need();
    let body = input.body.trim();
    const id = await this.pdb.tx(async (c) => {
      await this.ensureChat(c, tenantId);
      let kind: FileKind | null = null;
      if (input.fileId) {
        const f = (
          await c.query<{ kind: FileKind; tenantId: string; used: boolean }>(
            `SELECT kind, tenant_id AS "tenantId",
                    EXISTS (SELECT 1 FROM platform_support_messages m WHERE m.file_id = f.id) AS used
               FROM platform_support_files f WHERE id = $1`,
            [input.fileId],
          )
        ).rows[0];
        if (!f || f.tenantId !== tenantId || f.used)
          throw new UnprocessableEntityException('Arquivo não encontrado; envie de novo');
        kind = f.kind;
      }
      // Chamado junto: só um chamado deste restaurante. Sem texto, a mensagem diz de qual é.
      if (input.ticketId) {
        const tk = (
          await c.query<{ number: number }>(
            `SELECT number FROM platform_tickets WHERE id = $1 AND tenant_id = $2`,
            [input.ticketId, tenantId],
          )
        ).rows[0];
        if (!tk) throw new UnprocessableEntityException('Chamado não encontrado');
        if (!body) body = `Sobre o chamado ${ticketCode(tk.number)}`;
      }
      if (!body && !kind) throw new UnprocessableEntityException('Mensagem vazia');
      const m = (
        await c.query<{ id: string; createdAt: Date }>(
          `INSERT INTO platform_support_messages
             (tenant_id, sender, author_user_id, admin_id, author_name, body, file_id, file_kind,
              ticket_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at AS "createdAt"`,
          [
            tenantId,
            side,
            author.userId ?? null,
            author.adminId ?? null,
            author.name.slice(0, 120),
            body,
            input.fileId ?? null,
            kind,
            input.ticketId ?? null,
          ],
        )
      ).rows[0]!;
      // Quem escreve já leu tudo; mensagem do restaurante reabre a conversa encerrada.
      await c.query(
        `UPDATE platform_support_chats
            SET last_message_at = $2, last_preview = $3, last_sender = $4,
                ${side === 'tenant' ? `tenant_read_at = $2, status = 'open'` : `admin_read_at = $2`}
          WHERE tenant_id = $1`,
        [tenantId, m.createdAt, preview(body, kind), side],
      );
      return m.id;
    });
    this.realtime.publish(tenantId, { type: 'help.message', messageId: id, sender: side });
    const [row] = await this.pdb.query<MessageRow>(`${MSG_SELECT} WHERE m.id = $1`, [id]);
    return this.toMessage(side, row!);
  }

  /** Guarda a foto/vídeo antes da mensagem. Passou do espaço: os mais antigos saem. */
  async upload(
    side: SupportSide,
    tenantId: string,
    file: { mime: string; bytes: Buffer; width?: number; height?: number },
  ) {
    this.need();
    const kind: FileKind = file.mime.startsWith('video/') ? 'video' : 'image';
    return this.pdb.tx(async (c) => {
      await this.ensureChat(c, tenantId);
      // Trava a conversa: dois envios ao mesmo tempo não passam juntos do limite.
      await c.query(`SELECT 1 FROM platform_support_chats WHERE tenant_id = $1 FOR UPDATE`, [
        tenantId,
      ]);
      // Arquivo enviado e nunca usado numa mensagem some depois de um dia.
      await c.query(
        `DELETE FROM platform_support_files f
          WHERE f.tenant_id = $1 AND f.created_at < now() - interval '1 day'
            AND NOT EXISTS (SELECT 1 FROM platform_support_messages m WHERE m.file_id = f.id)`,
        [tenantId],
      );
      const files = (
        await c.query<{ id: string; size: number }>(
          `SELECT id, size FROM platform_support_files WHERE tenant_id = $1 ORDER BY created_at`,
          [tenantId],
        )
      ).rows;
      let used = files.reduce((s, f) => s + f.size, 0);
      const drop: string[] = [];
      for (const f of files) {
        if (used + file.bytes.length <= SUPPORT_FILES_QUOTA) break;
        drop.push(f.id);
        used -= f.size;
      }
      if (drop.length)
        await c.query(`DELETE FROM platform_support_files WHERE id = ANY($1::uuid[])`, [drop]);
      const r = (
        await c.query<{ id: string }>(
          `INSERT INTO platform_support_files
             (tenant_id, kind, content_type, bytes, size, width, height, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            tenantId,
            kind,
            file.mime,
            file.bytes,
            file.bytes.length,
            file.width ?? null,
            file.height ?? null,
            side,
          ],
        )
      ).rows[0]!;
      return { id: r.id, kind };
    });
  }

  /** Arquivo da conversa. O restaurante só abre os da conversa dele. */
  async file(tenantId: string | null, id: string) {
    this.need();
    const [f] = await this.pdb.query<{ contentType: string; bytes: Buffer }>(
      `SELECT content_type AS "contentType", bytes FROM platform_support_files
        WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2)`,
      [id, tenantId],
    );
    if (!f) throw new NotFoundException('Arquivo não encontrado');
    return f;
  }

  async read(side: SupportSide, tenantId: string) {
    this.need();
    await this.pdb.query(
      `UPDATE platform_support_chats SET ${side === 'tenant' ? 'tenant_read_at' : 'admin_read_at'} = now()
        WHERE tenant_id = $1`,
      [tenantId],
    );
    // Os risquinhos azuis do restaurante mudam quando a Comandou lê.
    if (side === 'admin') this.realtime.publish(tenantId, { type: 'help.read' });
    return { ok: true };
  }

  // ------------------------------------------------------------------ painel

  /** Conversas do painel: as com mensagem nova primeiro, depois as mais recentes. */
  async list(opts: { status: 'open' | 'closed' | 'all'; q?: string }) {
    this.need();
    const term = opts.q?.trim();
    const rows = await this.pdb.query<{ tenantId: string }>(
      `SELECT c.tenant_id AS "tenantId", t.name, t.slug, t.status AS "tenantStatus",
              p.name AS "planName", s.status AS "subscriptionStatus",
              c.status, c.last_message_at AS "lastMessageAt", c.last_preview AS "lastPreview",
              c.last_sender AS "lastSender", c.tenant_read_at AS "tenantReadAt",
              (SELECT count(*)::int FROM platform_support_messages m
                WHERE m.tenant_id = c.tenant_id AND m.sender = 'tenant'
                  AND m.created_at > c.admin_read_at) AS unread
         FROM platform_support_chats c
         JOIN tenants t ON t.id = c.tenant_id
         LEFT JOIN LATERAL (
           SELECT plan_id, status FROM subscriptions
            WHERE tenant_id = c.tenant_id AND status <> 'cancelled'
            ORDER BY created_at DESC LIMIT 1) s ON true
         LEFT JOIN plans p ON p.id = s.plan_id
        WHERE c.last_message_at IS NOT NULL
          AND ($1 = 'all' OR c.status = $1)
          AND ($2::text IS NULL OR t.name ILIKE '%' || $2 || '%' OR t.slug ILIKE '%' || $2 || '%')
        ORDER BY (SELECT count(*) FROM platform_support_messages m
                   WHERE m.tenant_id = c.tenant_id AND m.sender = 'tenant'
                     AND m.created_at > c.admin_read_at) > 0 DESC,
                 c.last_message_at DESC NULLS LAST
        LIMIT 200`,
      [opts.status, term ? term.replace(/[%_\\]/g, (x) => `\\${x}`) : null],
    );
    const icons = rows.length ? await tenantIcons(this.pdb, 15_000) : new Map<string, string>();
    return rows.map((r) => ({ ...r, iconUrl: icons.get(r.tenantId) ?? null }));
  }

  /** Conversas com mensagem nova do restaurante (bolinha do menu do painel). */
  async adminUnread() {
    if (!this.pdb.enabled) return { chats: 0, messages: 0 };
    const [r] = await this.pdb.query<{ chats: number; messages: number }>(
      `SELECT count(DISTINCT c.tenant_id)::int AS chats, count(m.id)::int AS messages
         FROM platform_support_chats c
         JOIN platform_support_messages m ON m.tenant_id = c.tenant_id
          AND m.sender = 'tenant' AND m.created_at > c.admin_read_at`,
    );
    return r ?? { chats: 0, messages: 0 };
  }

  async assertTenant(tenantId: string) {
    this.need();
    const r = await this.pdb.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenantId]);
    if (!r.length) throw new NotFoundException('Restaurante não encontrado');
  }

  /** Conversa no painel, com o restaurante (dá para começar uma conversa ainda vazia). */
  async detail(tenantId: string) {
    this.need();
    // Plano e assinatura vão junto para a coluna de detalhes ao lado da conversa.
    const [tenant] = await this.pdb.query<{
      id: string;
      name: string;
      slug: string;
      status: string;
      createdAt: string;
      planName: string | null;
      subscriptionStatus: string | null;
      trialEndsAt: string | null;
    }>(
      `SELECT t.id, t.name, t.slug, t.status, t.created_at AS "createdAt",
              p.name AS "planName", s.status AS "subscriptionStatus",
              s.trial_ends_at AS "trialEndsAt"
         FROM tenants t
         LEFT JOIN LATERAL (
           SELECT plan_id, status, trial_ends_at FROM subscriptions
            WHERE tenant_id = t.id AND status <> 'cancelled'
            ORDER BY created_at DESC LIMIT 1) s ON true
         LEFT JOIN plans p ON p.id = s.plan_id
        WHERE t.id = $1`,
      [tenantId],
    );
    if (!tenant) throw new NotFoundException('Restaurante não encontrado');
    const iconUrl = await tenantIcon(this.pdb, tenantId);
    return { tenant: { ...tenant, iconUrl }, ...(await this.state('admin', tenantId)) };
  }

  async setStatus(tenantId: string, status: 'open' | 'closed') {
    this.need();
    const r = await this.pdb.query(
      `UPDATE platform_support_chats SET status = $2 WHERE tenant_id = $1 RETURNING tenant_id`,
      [tenantId, status],
    );
    if (!r.length) throw new NotFoundException('Conversa não encontrada');
    return { status };
  }
}
