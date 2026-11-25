import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hashToken } from '../auth/session.service';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { Customer } from '../store/customers.service';

export type Sender = 'customer' | 'staff' | 'system';
export type FileKind = 'image' | 'video';

/** Espaço total das fotos e vídeos das conversas de um restaurante. */
export const CHAT_FILES_QUOTA = 512 * 1024 * 1024;
/** Quanto um cliente pode enviar por dia na conversa dele (evita encher o espaço da loja). */
export const CUSTOMER_DAILY_BYTES = 80 * 1024 * 1024;
/** Tudo o que os clientes de um restaurante mandam num dia, somando todas as conversas. */
export const CUSTOMERS_DAILY_BYTES = 160 * 1024 * 1024;
export const MAX_CHAT_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_CHAT_VIDEO_BYTES = 20 * 1024 * 1024;
export const CHAT_IMAGE_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);
export const CHAT_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const PAGE = 50;
export const GUEST_COOKIE = 'cm_chat';
export const GUEST_DAYS = 180;

/** Confere a assinatura do vídeo (MP4/MOV: "ftyp" no byte 4; WebM: EBML). */
export function sniffVideo(b: Buffer): string | null {
  if (b.length > 12 && b.toString('ascii', 4, 8) === 'ftyp') {
    const brand = b.toString('ascii', 8, 12);
    return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  if (b.length > 4 && b.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm';
  return null;
}

export interface ChatFile {
  id: string;
  kind: FileKind;
  url: string;
  width: number | null;
  height: number | null;
  size: number;
}

export interface ChatMessage {
  id: string;
  sender: Sender;
  authorName: string | null;
  body: string;
  file: ChatFile | null;
  /** A mensagem tinha arquivo, mas ele saiu para liberar espaço. */
  fileGone: FileKind | null;
  orderNumber: number | null;
  orderId: string | null;
  createdAt: string;
}

export interface ChatSummary {
  id: string;
  name: string;
  phone: string | null;
  customerId: string | null;
  status: 'open' | 'closed';
  lastMessageAt: string | null;
  lastPreview: string | null;
  lastSender: Sender | null;
  unread: number;
  customerReadAt: string;
  staffReadAt: string;
  createdAt: string;
}

interface MessageRow {
  id: string;
  sender: Sender;
  authorName: string | null;
  body: string;
  fileId: string | null;
  fileKind: FileKind | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  orderNumber: number | null;
  orderId: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

const MSG_SELECT = `SELECT m.id, m.sender, split_part(u.name, ' ', 1) AS "authorName", m.body,
    m.file_id AS "fileId", m.file_kind AS "fileKind", f.size AS "fileSize", f.width, f.height,
    m.order_number AS "orderNumber", m.order_id AS "orderId", m.created_at AS "createdAt",
    m.deleted_at AS "deletedAt"
  FROM store_chat_messages m
  LEFT JOIN store_chat_files f ON f.id = m.file_id
  LEFT JOIN users u ON u.id = m.author_id`;

const SUMMARY_COLS = `c.id, c.name, c.phone, c.customer_id AS "customerId", c.status,
  c.last_message_at AS "lastMessageAt", c.last_preview AS "lastPreview",
  c.last_sender AS "lastSender", c.customer_read_at AS "customerReadAt",
  c.staff_read_at AS "staffReadAt", c.created_at AS "createdAt"`;

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

/** Texto curto da última mensagem, para a lista de conversas. */
function preview(body: string, kind: FileKind | null, orderNumber: number | null) {
  const t = body.replace(/\s+/g, ' ').trim();
  if (t) return t.slice(0, 140);
  if (kind === 'image') return '📷 Foto';
  if (kind === 'video') return '🎬 Vídeo';
  if (orderNumber) return `Pedido #${orderNumber}`;
  return '';
}

export interface ChatIdentity {
  customer: Customer | null;
  guestToken: string | undefined;
}

/** Sala do tempo real de uma conversa (o aparelho do cliente entra nela). */
export const chatRoom = (tenantId: string, chatId: string) => `sc:${tenantId}:${chatId}`;

/**
 * Acha a conversa do cliente pelo cookie da conta ou pelo cookie de visitante. Usada também pelo
 * tempo real (o socket do cliente só entra na sala da própria conversa).
 */
export async function findChatId(
  tx: Tx,
  customerId: string | null,
  guestToken: string | undefined,
): Promise<string | null> {
  if (customerId) {
    const r = await one<{ id: string }>(tx, `SELECT id FROM store_chats WHERE customer_id = $1`, [
      customerId,
    ]);
    if (r) return r.id;
  }
  if (guestToken && guestToken.length <= 100) {
    const r = await one<{ id: string; customerId: string | null }>(
      tx,
      `SELECT id, customer_id AS "customerId" FROM store_chats WHERE guest_token_hash = $1`,
      [hashToken(guestToken)],
    );
    // A conversa de visitante que já virou de uma conta só vale para essa conta.
    if (r && (!r.customerId || r.customerId === customerId)) return r.id;
  }
  return null;
}

/**
 * Conversa do cliente com o restaurante pelo cardápio online. O cliente fala com "a loja" (não
 * com uma pessoa); qualquer pessoa da equipe com acesso aos pedidos responde pelo painel.
 */
@Injectable()
export class StoreChatService {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService,
  ) {}

  // ------------------------------------------------------------------ comum

  private fileUrl(side: 'customer' | 'staff', id: string) {
    return side === 'customer'
      ? `/api/v1/store/chat/files/${id}`
      : `/api/v1/support/chats/files/${id}`;
  }

  private toMessage(side: 'customer' | 'staff', r: MessageRow): ChatMessage {
    const deleted = !!r.deletedAt;
    return {
      id: r.id,
      sender: r.sender,
      authorName: r.sender === 'staff' ? r.authorName : null,
      body: deleted ? '' : r.body,
      file:
        !deleted && r.fileId && r.fileKind
          ? {
              id: r.fileId,
              kind: r.fileKind,
              url: this.fileUrl(side, r.fileId),
              width: r.width,
              height: r.height,
              size: r.fileSize ?? 0,
            }
          : null,
      fileGone: !deleted && !r.fileId && r.fileKind ? r.fileKind : null,
      // O cliente vê só o número; o id do pedido é da equipe.
      orderNumber: r.orderNumber,
      orderId: side === 'staff' ? r.orderId : null,
      createdAt: iso(r.createdAt)!,
    };
  }

  private async messagesOf(
    tx: Tx,
    side: 'customer' | 'staff',
    chatId: string,
    before?: string,
  ): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
    const rows = await q<MessageRow>(
      tx,
      `${MSG_SELECT}
        WHERE m.chat_id = $1 AND ($2::timestamptz IS NULL OR m.created_at < $2)
        ORDER BY m.created_at DESC, m.id DESC LIMIT ${PAGE + 1}`,
      [chatId, before ?? null],
    );
    const hasMore = rows.length > PAGE;
    return {
      messages: rows
        .slice(0, PAGE)
        .reverse()
        .map((r) => this.toMessage(side, r)),
      hasMore,
    };
  }

  private async messageById(tx: Tx, side: 'customer' | 'staff', id: string) {
    const r = await one<MessageRow>(tx, `${MSG_SELECT} WHERE m.id = $1`, [id]);
    return this.toMessage(side, r!);
  }

  /** Acha o pedido citado pelo número (o mais recente; o do próprio cliente, se tiver conta). */
  private async orderRef(tx: Tx, customerId: string | null, n: number | null | undefined) {
    if (!n) return null;
    const r = await one<{ id: string; number: number }>(
      tx,
      `SELECT id, number FROM orders WHERE number = $1
        ORDER BY (customer_id IS NOT DISTINCT FROM $2::uuid) DESC, created_at DESC LIMIT 1`,
      [n, customerId],
    );
    if (!r) throw new UnprocessableEntityException(`Pedido #${n} não encontrado`);
    return r;
  }

  private async insertMessage(
    tx: Tx,
    tenantId: string,
    chatId: string,
    input: {
      sender: Sender;
      authorId?: string | null;
      body: string;
      fileId?: string | null;
      orderNumber?: number | null;
      customerId?: string | null;
    },
  ) {
    const body = input.body.trim();
    let kind: FileKind | null = null;
    if (input.fileId) {
      const f = await one<{ kind: FileKind; chatId: string; used: boolean }>(
        tx,
        `SELECT kind, chat_id AS "chatId",
                EXISTS (SELECT 1 FROM store_chat_messages m WHERE m.file_id = f.id) AS used
           FROM store_chat_files f WHERE id = $1`,
        [input.fileId],
      );
      if (!f || f.chatId !== chatId || f.used)
        throw new UnprocessableEntityException('Arquivo não encontrado; envie de novo');
      kind = f.kind;
    }
    const order = await this.orderRef(tx, input.customerId ?? null, input.orderNumber);
    if (!body && !kind && !order) throw new UnprocessableEntityException('Mensagem vazia');
    const m = await one<{ id: string; createdAt: Date }>(
      tx,
      `INSERT INTO store_chat_messages
         (tenant_id, chat_id, sender, author_id, body, file_id, file_kind, order_id, order_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at AS "createdAt"`,
      [
        tenantId,
        chatId,
        input.sender,
        input.authorId ?? null,
        body,
        input.fileId ?? null,
        kind,
        order?.id ?? null,
        order?.number ?? null,
      ],
    );
    // Quem escreve já leu tudo até aqui; mensagem do cliente reabre a conversa encerrada.
    await q(
      tx,
      `UPDATE store_chats SET last_message_at = $2, last_preview = $3, last_sender = $4,
              ${input.sender === 'customer' ? `customer_read_at = $2, status = 'open'` : `staff_read_at = $2`}
        WHERE id = $1`,
      [chatId, m!.createdAt, preview(body, kind, order?.number ?? null), input.sender],
    );
    return m!.id;
  }

  /** Avisa os dois lados: a sala da conversa (cliente) e a equipe (só ids; ela busca pela API). */
  private notify(tenantId: string, chatId: string, messageId: string, sender: Sender) {
    this.realtime.publishToRoom(chatRoom(tenantId, chatId), {
      type: 'support.message',
      chatId,
      messageId,
      sender,
    });
    this.realtime.publish(tenantId, { type: 'support.message', chatId, messageId, sender });
  }

  private async saveFile(
    tx: Tx,
    tenantId: string,
    chatId: string,
    by: 'customer' | 'staff',
    file: { mime: string; bytes: Buffer; width?: number; height?: number },
  ) {
    const kind: FileKind = file.mime.startsWith('video/') ? 'video' : 'image';
    // Um envio de cada vez por restaurante: a conta do limite abaixo não erra com dois juntos.
    await q(tx, `SELECT pg_advisory_xact_lock(hashtext('store_chat_files:' || $1::text))`, [
      tenantId,
    ]);
    if (by === 'customer') {
      const used = await one<{ n: string }>(
        tx,
        `SELECT coalesce(sum(size), 0)::text AS n FROM store_chat_files
          WHERE chat_id = $1 AND uploaded_by = 'customer' AND created_at > now() - interval '1 day'`,
        [chatId],
      );
      if (Number(used!.n) + file.bytes.length > CUSTOMER_DAILY_BYTES)
        throw new UnprocessableEntityException(
          'Você já enviou muitos arquivos hoje. Mande por texto ou tente amanhã.',
        );
      // Somando todas as conversas de clientes (quem abre conversa nova a cada envio não passa do
      // limite do restaurante) e sem nunca apagar o arquivo de outra pessoa para caber o seu.
      // Para caber, o envio do cliente só tira arquivos com mais de 30 dias (os recentes ficam).
      await q(
        tx,
        `DELETE FROM store_chat_files WHERE id IN (
           SELECT id FROM (
             SELECT id, created_at, sum(size) OVER (ORDER BY created_at DESC, id) AS acc
               FROM store_chat_files
           ) s WHERE s.acc > $1 AND s.created_at < now() - interval '30 days')`,
        [CHAT_FILES_QUOTA - file.bytes.length],
      );
      const all = await one<{ day: string; total: string }>(
        tx,
        `SELECT coalesce(sum(size) FILTER (WHERE uploaded_by = 'customer'
                  AND created_at > now() - interval '1 day'), 0)::text AS day,
                coalesce(sum(size), 0)::text AS total
           FROM store_chat_files`,
      );
      if (
        Number(all!.day) + file.bytes.length > CUSTOMERS_DAILY_BYTES ||
        Number(all!.total) + file.bytes.length > CHAT_FILES_QUOTA
      )
        throw new UnprocessableEntityException(
          'A loja recebeu muitos arquivos hoje. Mande por texto ou tente mais tarde.',
        );
    }
    // Arquivo enviado e nunca usado numa mensagem some depois de um dia.
    await q(
      tx,
      `DELETE FROM store_chat_files f WHERE f.created_at < now() - interval '1 day'
          AND NOT EXISTS (SELECT 1 FROM store_chat_messages m WHERE m.file_id = f.id)`,
    );
    // Limite do restaurante: os mais antigos saem até caber o novo (só no envio da equipe; o do
    // cliente já foi recusado acima se não coubesse).
    await q(
      tx,
      `DELETE FROM store_chat_files WHERE id IN (
         SELECT id FROM (
           SELECT id, sum(size) OVER (ORDER BY created_at DESC, id) AS acc FROM store_chat_files
         ) s WHERE s.acc > $1)`,
      [CHAT_FILES_QUOTA - file.bytes.length],
    );
    const r = await one<{ id: string }>(
      tx,
      `INSERT INTO store_chat_files
         (tenant_id, chat_id, kind, content_type, bytes, size, width, height, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        tenantId,
        chatId,
        kind,
        file.mime,
        file.bytes,
        file.bytes.length,
        file.width ?? null,
        file.height ?? null,
        by,
      ],
    );
    return { id: r!.id, kind };
  }

  private async readFile(tx: Tx, id: string) {
    return one<{ chatId: string; contentType: string; bytes: Buffer }>(
      tx,
      `SELECT chat_id AS "chatId", content_type AS "contentType", bytes
         FROM store_chat_files WHERE id = $1`,
      [id],
    );
  }

  private async chatEnabled(tx: Tx) {
    const s = await one<{ enabled: boolean; greeting: string | null; isOpen: boolean }>(
      tx,
      `SELECT chat_enabled AND enabled AS enabled, chat_greeting AS greeting, is_open AS "isOpen"
         FROM tenant_store_settings`,
    );
    return s ?? { enabled: true, greeting: null, isOpen: true };
  }

  // ------------------------------------------------------------------ cliente

  private async customerChat(tx: Tx, who: ChatIdentity) {
    const id = await findChatId(tx, who.customer?.id ?? null, who.guestToken);
    if (id && who.customer) {
      // Conversa começada como visitante passa para a conta quando ele entra.
      await q(
        tx,
        `UPDATE store_chats SET customer_id = $2, name = $3, phone = $4
          WHERE id = $1 AND customer_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM store_chats WHERE customer_id = $2)`,
        [id, who.customer.id, who.customer.name, who.customer.phone],
      );
    }
    return id;
  }

  private async summary(tx: Tx, id: string): Promise<ChatSummary> {
    const r = await one<ChatSummary & { lastMessageAt: Date; customerReadAt: Date }>(
      tx,
      `SELECT ${SUMMARY_COLS},
              (SELECT count(*)::int FROM store_chat_messages m
                WHERE m.chat_id = c.id AND m.sender = 'customer' AND m.created_at > c.staff_read_at
                  AND m.deleted_at IS NULL) AS unread
         FROM store_chats c WHERE c.id = $1`,
      [id],
    );
    if (!r) throw new NotFoundException('Conversa não encontrada');
    return {
      ...r,
      lastMessageAt: iso(r.lastMessageAt),
      customerReadAt: iso(r.customerReadAt)!,
      staffReadAt: iso(r.staffReadAt)!,
      createdAt: iso(r.createdAt)!,
    };
  }

  /** O que o cardápio precisa para abrir a conversa (ou o convite para começar). */
  async customerState(tenantId: string, who: ChatIdentity) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const s = await this.chatEnabled(tx);
      const id = s.enabled ? await this.customerChat(tx, who) : null;
      if (!id)
        return {
          enabled: s.enabled,
          greeting: s.greeting,
          storeOpen: s.isOpen,
          chat: null,
          messages: [],
          hasMore: false,
          unread: 0,
        };
      const c = await this.summary(tx, id);
      const { messages, hasMore } = await this.messagesOf(tx, 'customer', id);
      const unread = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM store_chat_messages
          WHERE chat_id = $1 AND sender <> 'customer' AND created_at > $2 AND deleted_at IS NULL`,
        [id, c.customerReadAt],
      );
      return {
        enabled: true,
        greeting: s.greeting,
        storeOpen: s.isOpen,
        chat: { id, name: c.name, status: c.status, staffReadAt: c.staffReadAt },
        messages,
        hasMore,
        unread: unread!.n,
      };
    });
  }

  /** Só o número de respostas não lidas (o cardápio mostra a bolinha na aba). */
  async customerUnread(tenantId: string, who: ChatIdentity) {
    if (!who.customer && !who.guestToken) return { unread: 0, hasChat: false };
    return this.db.withTenant({ tenantId }, async (tx) => {
      const id = await findChatId(tx, who.customer?.id ?? null, who.guestToken);
      if (!id) return { unread: 0, hasChat: false };
      const r = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM store_chat_messages m JOIN store_chats c ON c.id = m.chat_id
          WHERE c.id = $1 AND m.sender <> 'customer' AND m.created_at > c.customer_read_at
            AND m.deleted_at IS NULL`,
        [id],
      );
      return { unread: r!.n, hasChat: true };
    });
  }

  async customerOlder(tenantId: string, who: ChatIdentity, before: string) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const id = await findChatId(tx, who.customer?.id ?? null, who.guestToken);
      if (!id) return { messages: [], hasMore: false };
      return this.messagesOf(tx, 'customer', id, before);
    });
  }

  /**
   * Começa a conversa. Com conta, usa o nome e o celular dela; sem conta, o que o cliente informou
   * (e devolve o token do cookie de visitante).
   */
  async start(
    tenantId: string,
    who: ChatIdentity,
    guest?: { name: string; phone: string },
  ): Promise<{ id: string; guestToken?: string }> {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const s = await this.chatEnabled(tx);
      if (!s.enabled) throw new ForbiddenException('A conversa com a loja está desligada');
      const existing = await this.customerChat(tx, who);
      if (existing) return { id: existing };
      if (who.customer) {
        const r = await one<{ id: string }>(
          tx,
          `INSERT INTO store_chats (tenant_id, customer_id, name, phone) VALUES ($1,$2,$3,$4)
           ON CONFLICT (tenant_id, customer_id) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [tenantId, who.customer.id, who.customer.name, who.customer.phone],
        );
        return { id: r!.id };
      }
      if (!guest) throw new UnprocessableEntityException('Informe seu nome e celular');
      const token = randomBytes(32).toString('base64url');
      const r = await one<{ id: string }>(
        tx,
        `INSERT INTO store_chats (tenant_id, guest_token_hash, name, phone)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [tenantId, hashToken(token), guest.name, guest.phone],
      );
      return { id: r!.id, guestToken: token };
    });
  }

  private async requireCustomerChat(tx: Tx, who: ChatIdentity) {
    const id = await findChatId(tx, who.customer?.id ?? null, who.guestToken);
    if (!id) throw new NotFoundException('Comece a conversa primeiro');
    return id;
  }

  async customerSend(
    tenantId: string,
    who: ChatIdentity,
    input: { body: string; fileId?: string | null; orderNumber?: number | null },
  ) {
    // Quem tem conta não precisa "começar": a primeira mensagem já abre a conversa.
    if (who.customer) await this.start(tenantId, who);
    const out = await this.db.withTenant({ tenantId }, async (tx) => {
      const s = await this.chatEnabled(tx);
      if (!s.enabled) throw new ForbiddenException('A conversa com a loja está desligada');
      const chatId = await this.requireCustomerChat(tx, who);
      const id = await this.insertMessage(tx, tenantId, chatId, {
        sender: 'customer',
        body: input.body,
        fileId: input.fileId,
        orderNumber: input.orderNumber,
        customerId: who.customer?.id ?? null,
      });
      return { chatId, message: await this.messageById(tx, 'customer', id) };
    });
    this.notify(tenantId, out.chatId, out.message.id, 'customer');
    return out.message;
  }

  async customerUpload(
    tenantId: string,
    who: ChatIdentity,
    file: { mime: string; bytes: Buffer; width?: number; height?: number },
  ) {
    // Com conta, a foto pode ser a primeira coisa enviada: abre a conversa antes.
    if (who.customer) await this.start(tenantId, who);
    return this.db.withTenant({ tenantId }, async (tx) => {
      const chatId = await this.requireCustomerChat(tx, who);
      return this.saveFile(tx, tenantId, chatId, 'customer', file);
    });
  }

  async customerFile(tenantId: string, who: ChatIdentity, fileId: string) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const chatId = await findChatId(tx, who.customer?.id ?? null, who.guestToken);
      const f = chatId ? await this.readFile(tx, fileId) : undefined;
      if (!f || f.chatId !== chatId) throw new NotFoundException('Arquivo não encontrado');
      return f;
    });
  }

  async customerRead(tenantId: string, who: ChatIdentity) {
    const chatId = await this.db.withTenant({ tenantId }, async (tx) => {
      const id = await findChatId(tx, who.customer?.id ?? null, who.guestToken);
      if (id) await q(tx, `UPDATE store_chats SET customer_read_at = now() WHERE id = $1`, [id]);
      return id;
    });
    if (chatId) this.realtime.publish(tenantId, { type: 'support.read', chatId, by: 'customer' });
    return { ok: true };
  }

  async customerTyping(tenantId: string, who: ChatIdentity) {
    const chatId = await this.db.withTenant({ tenantId }, (tx) =>
      findChatId(tx, who.customer?.id ?? null, who.guestToken),
    );
    if (chatId) this.realtime.publish(tenantId, { type: 'support.typing', chatId, by: 'customer' });
    return { ok: true };
  }

  // ------------------------------------------------------------------ equipe

  async list(
    tenantId: string,
    userId: string,
    filter: { status: 'open' | 'closed' | 'all'; q?: string },
  ) {
    return this.db.withTenant({ tenantId, userId }, async (tx) => {
      const like = filter.q ? `%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
      const rows = await q<ChatSummary & { lastMessageAt: Date }>(
        tx,
        `SELECT ${SUMMARY_COLS},
                (SELECT count(*)::int FROM store_chat_messages m
                  WHERE m.chat_id = c.id AND m.sender = 'customer'
                    AND m.created_at > c.staff_read_at AND m.deleted_at IS NULL) AS unread
           FROM store_chats c
          WHERE c.last_message_at IS NOT NULL
            AND ($1 = 'all' OR c.status = $1)
            AND ($2::text IS NULL OR c.name ILIKE $2 OR c.phone ILIKE $2)
          ORDER BY c.last_message_at DESC LIMIT 200`,
        [filter.status, like],
      );
      return rows.map((r) => ({
        ...r,
        lastMessageAt: iso(r.lastMessageAt),
        customerReadAt: iso(r.customerReadAt)!,
        staffReadAt: iso(r.staffReadAt)!,
        createdAt: iso(r.createdAt)!,
      }));
    });
  }

  /** Para o selo e o aviso do PDV: conversas esperando resposta e a mais recente delas. */
  async unread(tenantId: string, userId: string) {
    return this.db.withTenant({ tenantId, userId }, async (tx) => {
      const rows = await q<{
        id: string;
        name: string;
        unread: number;
        lastPreview: string | null;
        lastMessageAt: Date;
      }>(
        tx,
        `SELECT c.id, c.name, c.last_preview AS "lastPreview", c.last_message_at AS "lastMessageAt",
                (SELECT count(*)::int FROM store_chat_messages m
                  WHERE m.chat_id = c.id AND m.sender = 'customer'
                    AND m.created_at > c.staff_read_at AND m.deleted_at IS NULL) AS unread
           FROM store_chats c
          WHERE c.last_sender = 'customer' AND c.last_message_at > c.staff_read_at
          ORDER BY c.last_message_at DESC LIMIT 50`,
      );
      const waiting = rows.filter((r) => r.unread > 0);
      return {
        chats: waiting.length,
        messages: waiting.reduce((n, r) => n + r.unread, 0),
        latest: waiting.slice(0, 5).map((r) => ({
          id: r.id,
          name: r.name,
          preview: r.lastPreview,
          unread: r.unread,
          at: iso(r.lastMessageAt)!,
        })),
      };
    });
  }

  async detail(tenantId: string, userId: string, chatId: string) {
    return this.db.withTenant({ tenantId, userId }, async (tx) => {
      const chat = await this.summary(tx, chatId);
      const { messages, hasMore } = await this.messagesOf(tx, 'staff', chatId);
      const stats = await one<{
        orders: number;
        lastOrderId: string | null;
        lastOrderNumber: number | null;
      }>(
        tx,
        `SELECT count(*)::int AS orders,
                (array_agg(id ORDER BY created_at DESC))[1] AS "lastOrderId",
                (array_agg(number ORDER BY created_at DESC))[1] AS "lastOrderNumber"
           FROM orders WHERE customer_id = $1`,
        [chat.customerId],
      );
      return {
        chat,
        messages,
        hasMore,
        customer: chat.customerId
          ? {
              orders: stats?.orders ?? 0,
              lastOrderId: stats?.lastOrderId ?? null,
              lastOrderNumber: stats?.lastOrderNumber ?? null,
            }
          : null,
      };
    });
  }

  async older(tenantId: string, userId: string, chatId: string, before: string) {
    return this.db.withTenant({ tenantId, userId }, async (tx) => {
      await this.summary(tx, chatId);
      return this.messagesOf(tx, 'staff', chatId, before);
    });
  }

  async staffSend(
    tenantId: string,
    userId: string,
    chatId: string,
    input: { body: string; fileId?: string | null; orderNumber?: number | null },
  ) {
    const message = await this.db.withTenant({ tenantId, userId }, async (tx) => {
      const c = await this.summary(tx, chatId);
      const id = await this.insertMessage(tx, tenantId, chatId, {
        sender: 'staff',
        authorId: userId,
        body: input.body,
        fileId: input.fileId,
        orderNumber: input.orderNumber,
        customerId: c.customerId,
      });
      return this.messageById(tx, 'staff', id);
    });
    this.notify(tenantId, chatId, message.id, 'staff');
    return message;
  }

  async staffUpload(
    tenantId: string,
    userId: string,
    chatId: string,
    file: { mime: string; bytes: Buffer; width?: number; height?: number },
  ) {
    return this.db.withTenant({ tenantId, userId }, async (tx) => {
      await this.summary(tx, chatId);
      return this.saveFile(tx, tenantId, chatId, 'staff', file);
    });
  }

  async staffFile(tenantId: string, userId: string, fileId: string) {
    const f = await this.db.withTenant({ tenantId, userId }, (tx) => this.readFile(tx, fileId));
    if (!f) throw new NotFoundException('Arquivo não encontrado');
    return f;
  }

  async staffRead(tenantId: string, userId: string, chatId: string) {
    await this.db.withTenant({ tenantId, userId }, (tx) =>
      q(tx, `UPDATE store_chats SET staff_read_at = now() WHERE id = $1`, [chatId]),
    );
    this.realtime.publishToRoom(chatRoom(tenantId, chatId), {
      type: 'support.read',
      chatId,
      by: 'staff',
    });
    this.realtime.publish(tenantId, { type: 'support.read', chatId, by: 'staff' });
    return { ok: true };
  }

  async staffTyping(tenantId: string, chatId: string, name: string) {
    this.realtime.publishToRoom(chatRoom(tenantId, chatId), {
      type: 'support.typing',
      chatId,
      by: 'staff',
      name: name.split(' ')[0],
    });
    return { ok: true };
  }

  async setStatus(tenantId: string, userId: string, chatId: string, status: 'open' | 'closed') {
    await this.db.withTenant({ tenantId, userId }, async (tx) => {
      const r = await q(
        tx,
        `UPDATE store_chats SET status = $2,
                staff_read_at = CASE WHEN $2 = 'closed' THEN now() ELSE staff_read_at END
          WHERE id = $1 RETURNING id`,
        [chatId, status],
      );
      if (!r.length) throw new NotFoundException('Conversa não encontrada');
    });
    this.realtime.publish(tenantId, { type: 'support.read', chatId, by: 'staff' });
    return { ok: true };
  }
}

/**
 * Conversa do aparelho do cliente, pelo cookie da conta e/ou de visitante (para o tempo real,
 * que não passa pelos controllers). null = sem conversa: o socket é recusado.
 */
export async function chatForCookies(
  db: DatabaseService,
  tenantId: string,
  accountToken: string | undefined,
  guestToken: string | undefined,
): Promise<string | null> {
  if (!accountToken && !guestToken) return null;
  return db.withTenant({ tenantId }, async (tx) => {
    let customerId: string | null = null;
    if (accountToken && accountToken.length <= 100) {
      const r = await one<{ id: string }>(
        tx,
        `SELECT c.id FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
          WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
            AND c.blocked_at IS NULL`,
        [hashToken(accountToken)],
      );
      customerId = r?.id ?? null;
    }
    return findChatId(tx, customerId, guestToken);
  });
}
