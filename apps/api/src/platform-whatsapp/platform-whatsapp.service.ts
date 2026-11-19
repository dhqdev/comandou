import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { GatewayClient, GatewaySession } from '../messaging/gateway.client';
import { normalizePhone } from '../messaging/messaging.service';
import { WhatsAppUnavailableError } from '../messaging/whatsapp.client';
import {
  PLATFORM_WA_ID,
  WhatsAppInbound,
  WhatsAppInboundService,
} from '../messaging/whatsapp-inbound.service';
import { PlatformDb, platformAudit } from '../platform/platform-db.service';

export interface PlatformWaChat {
  jid: string;
  phone: string | null;
  name: string | null;
  lastAt: string;
  lastPreview: string;
  lastDir: 'in' | 'out' | null;
  unread: number;
  /** restaurante cujo cadastro tem este telefone */
  tenant: { id: string; name: string; slug: string } | null;
}

export interface PlatformWaMessage {
  id: string;
  direction: 'in' | 'out';
  kind: string;
  body: string;
  status: 'received' | 'sent' | 'failed';
  error: string | null;
  authorName: string | null;
  createdAt: string;
}

const PAGE = 60;

/** O que aparece na lista quando a mensagem não é texto. */
const KIND_LABEL: Record<string, string> = {
  image: 'Foto',
  audio: 'Áudio',
  video: 'Vídeo',
  document: 'Documento',
  sticker: 'Figurinha',
  location: 'Localização',
  contact: 'Contato',
  other: 'Mensagem',
};
const preview = (kind: string, body: string) =>
  (body.trim() ? body.trim() : (KIND_LABEL[kind] ?? 'Mensagem')).replace(/\s+/g, ' ').slice(0, 200);

/**
 * Telefone sem país e com só os 8 últimos dígitos depois do DDD: o WhatsApp às vezes guarda o
 * número antigo sem o 9, e o cadastro pode vir com ou sem 55.
 */
const KEY_SQL = (col: string) =>
  `(CASE WHEN length(${col}) >= 12 AND left(${col}, 2) = '55' THEN substr(${col}, 3, 2)
         ELSE left(${col}, 2) END) || right(${col}, 8)`;

const CHAT_COLS = `c.jid, c.phone, c.name, c.last_at AS "lastAt", c.last_preview AS "lastPreview",
  c.last_dir AS "lastDir", c.unread,
  (SELECT json_build_object('id', t.id, 'name', t.name, 'slug', t.slug)
     FROM tenant_profiles p JOIN tenants t ON t.id = p.tenant_id
    WHERE c.phone IS NOT NULL AND p.phone IS NOT NULL
      AND ${KEY_SQL('p.phone')} = ${KEY_SQL('c.phone')}
    ORDER BY t.created_at LIMIT 1) AS tenant`;

const MSG_COLS = `m.id, m.direction, m.kind, m.body, m.status, m.error,
  a.name AS "authorName", m.created_at AS "createdAt"`;

/**
 * Super Admin › WhatsApp: o número do próprio Comandou, conectado pelo QR Code no mesmo gateway
 * Baileys dos restaurantes (sessão reservada PLATFORM_WA_ID). Guarda as conversas no banco
 * central (platform_wa_*) e responde pelo painel. Nada aqui passa pela IA dos restaurantes.
 */
@Injectable()
export class PlatformWhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PlatformWhatsApp');
  private off?: () => void;

  constructor(
    private readonly pdb: PlatformDb,
    private readonly gateway: GatewayClient,
    private readonly inbound: WhatsAppInboundService,
  ) {}

  onModuleInit() {
    this.off = this.inbound.onPlatformMessage((m) => this.receive(m));
  }
  onModuleDestroy() {
    this.off?.();
  }

  private need() {
    if (!this.pdb.enabled)
      throw new ServiceUnavailableException('O painel não está disponível neste servidor');
  }

  /* ------------------------------------------------------------------ conexão */

  async session(): Promise<GatewaySession & { configured: boolean }> {
    if (!this.gateway.configured) return { configured: false, status: 'disconnected' };
    const s = await this.gateway
      .session(PLATFORM_WA_ID)
      .catch((e: Error): GatewaySession => ({ status: 'disconnected', error: e.message }));
    return { configured: true, ...s };
  }

  async connect(adminId: string, ip: string | null) {
    this.need();
    const s = await this.gateway.start(PLATFORM_WA_ID).catch((e: Error) => {
      throw new ServiceUnavailableException(e.message);
    });
    await this.pdb.tx((c) =>
      platformAudit(c, { adminId, action: 'whatsapp.connect', entity: 'whatsapp', ip }),
    );
    return { configured: true, ...s };
  }

  async disconnect(adminId: string, ip: string | null) {
    this.need();
    const s = await this.gateway.logout(PLATFORM_WA_ID).catch((e: Error) => {
      throw new ServiceUnavailableException(e.message);
    });
    await this.pdb.tx((c) =>
      platformAudit(c, { adminId, action: 'whatsapp.disconnect', entity: 'whatsapp', ip }),
    );
    return { configured: true, ...s };
  }

  /* ------------------------------------------------------------------ conversas */

  async list(q?: string): Promise<PlatformWaChat[]> {
    this.need();
    const term = q?.trim();
    const digits = term?.replace(/\D/g, '') ?? '';
    return this.pdb.query<PlatformWaChat>(
      `SELECT ${CHAT_COLS} FROM platform_wa_chats c
        WHERE $1::text IS NULL OR c.name ILIKE '%' || $1 || '%'
           OR ($2 <> '' AND c.phone LIKE '%' || $2 || '%')
        ORDER BY c.last_at DESC LIMIT 200`,
      [term ? term.replace(/[%_\\]/g, (x) => `\\${x}`) : null, digits],
    );
  }

  async unread() {
    if (!this.pdb.enabled) return { chats: 0, messages: 0 };
    const [r] = await this.pdb.query<{ chats: number; messages: number }>(
      `SELECT count(*) FILTER (WHERE unread > 0)::int AS chats,
              coalesce(sum(unread), 0)::int AS messages FROM platform_wa_chats`,
    );
    return r;
  }

  async detail(jid: string) {
    this.need();
    const [chat] = await this.pdb.query<PlatformWaChat>(
      `SELECT ${CHAT_COLS} FROM platform_wa_chats c WHERE c.jid = $1`,
      [jid],
    );
    if (!chat) throw new NotFoundException('Conversa não encontrada');
    const page = await this.messages(jid);
    return { chat, ...page };
  }

  async messages(jid: string, before?: string) {
    this.need();
    const rows = await this.pdb.query<PlatformWaMessage>(
      `SELECT ${MSG_COLS} FROM platform_wa_messages m
         LEFT JOIN platform_admins a ON a.id = m.admin_id
        WHERE m.jid = $1 AND ($2::timestamptz IS NULL OR m.created_at < $2)
        ORDER BY m.created_at DESC, m.id DESC LIMIT ${PAGE + 1}`,
      [jid, before ?? null],
    );
    return { messages: rows.slice(0, PAGE).reverse(), hasMore: rows.length > PAGE };
  }

  /** Abriu a conversa no painel: zera as não lidas e marca a última recebida como lida (azul). */
  async read(jid: string) {
    this.need();
    const [r] = await this.pdb.query<{ waId: string | null }>(
      `UPDATE platform_wa_chats c SET unread = 0 WHERE c.jid = $1 AND c.unread > 0
       RETURNING (SELECT m.wa_id FROM platform_wa_messages m
                   WHERE m.jid = c.jid AND m.direction = 'in' AND m.wa_id IS NOT NULL
                   ORDER BY m.created_at DESC LIMIT 1) AS "waId"`,
      [jid],
    );
    if (r?.waId && this.gateway.configured)
      void this.gateway
        .markRead(PLATFORM_WA_ID, jid, r.waId)
        .catch((e: Error) => this.logger.warn(`marcar como lida: ${e.message}`));
    return { ok: true };
  }

  /**
   * Envia texto. `jid` = conversa que já existe; `phone` = começar com um número novo (o gateway
   * acha a conversa certa, com ou sem o 9). Falha do WhatsApp fica gravada como "falhou".
   */
  async send(
    admin: { id: string; name: string },
    to: { jid?: string; phone?: string },
    text: string,
  ): Promise<{ chat: PlatformWaChat; message: PlatformWaMessage }> {
    this.need();
    const body = text.trim();
    if (!body) throw new BadRequestException('Escreva a mensagem');
    let dest: string;
    let phone: string | null = null;
    if (to.jid) {
      const [c] = await this.pdb.query<{ jid: string }>(
        `SELECT jid FROM platform_wa_chats WHERE jid = $1`,
        [to.jid],
      );
      if (!c) throw new NotFoundException('Conversa não encontrada');
      dest = c.jid;
    } else {
      phone = normalizePhone(to.phone);
      if (!phone)
        throw new UnprocessableEntityException(
          'Telefone inválido: use DDD e número, ex.: 11 91234-5678',
        );
      dest = phone;
    }
    let jid = to.jid ?? null;
    let status: 'sent' | 'failed' = 'sent';
    let error: string | null = null;
    let waId: string | null = null;
    try {
      const r = await this.gateway.send(PLATFORM_WA_ID, dest, body);
      if (r.ok) {
        waId = r.messageId ?? null;
        if (!jid) jid = r.jid ?? `${phone}@s.whatsapp.net`;
      } else {
        status = 'failed';
        error = r.error;
      }
    } catch (e) {
      if (!(e instanceof WhatsAppUnavailableError) && !(e instanceof ServiceUnavailableException))
        throw e;
      status = 'failed';
      error =
        e instanceof ServiceUnavailableException
          ? 'Serviço de WhatsApp não configurado no servidor'
          : 'WhatsApp do painel desconectado';
    }
    // Número novo que não deu certo: não cria conversa vazia, só avisa.
    if (!jid) throw new UnprocessableEntityException(error ?? 'Não foi possível enviar');
    const jidPhone = /^([0-9]{5,20})@s\.whatsapp\.net$/.exec(jid)?.[1] ?? phone;
    const message = await this.pdb.tx(async (c) => {
      await c.query(
        `INSERT INTO platform_wa_chats (jid, phone, last_at, last_preview, last_dir)
         VALUES ($1, $2, now(), $3, 'out')
         ON CONFLICT (jid) DO UPDATE SET last_at = now(), last_preview = $3, last_dir = 'out',
           phone = coalesce(platform_wa_chats.phone, EXCLUDED.phone)`,
        [jid, jidPhone, preview('text', body)],
      );
      const {
        rows: [m],
      } = await c.query<{ id: string }>(
        `INSERT INTO platform_wa_messages (jid, direction, kind, body, wa_id, admin_id, status, error)
         VALUES ($1, 'out', 'text', $2, $3, $4, $5, $6) RETURNING id`,
        [jid, body.slice(0, 4000), waId, admin.id, status, error?.slice(0, 300) ?? null],
      );
      const {
        rows: [row],
      } = await c.query<PlatformWaMessage>(
        `SELECT ${MSG_COLS} FROM platform_wa_messages m
           LEFT JOIN platform_admins a ON a.id = m.admin_id WHERE m.id = $1`,
        [m.id],
      );
      return row;
    });
    const [chat] = await this.pdb.query<PlatformWaChat>(
      `SELECT ${CHAT_COLS} FROM platform_wa_chats c WHERE c.jid = $1`,
      [jid],
    );
    return { chat, message };
  }

  /* ------------------------------------------------------------------ recebidas */

  /**
   * Mensagem que chegou no número do painel. Mesma pessoa escrevendo por um JID novo (@lid) cai
   * na conversa que já existe com o mesmo telefone. A mesma mensagem não entra duas vezes.
   */
  async receive(m: WhatsAppInbound) {
    if (!this.pdb.enabled) return;
    await this.pdb.tx(async (c) => {
      const phone = m.from;
      const {
        rows: [hit],
      } = await c.query<{ jid: string }>(
        `SELECT jid FROM platform_wa_chats
          WHERE jid = $1 OR ($2::text IS NOT NULL AND phone = $2)
          ORDER BY (jid = $1) DESC, last_at DESC LIMIT 1`,
        [m.jid, phone],
      );
      const jid = hit?.jid ?? m.jid;
      const text = m.text.slice(0, 4000);
      await c.query(
        `INSERT INTO platform_wa_chats (jid, phone, name, last_at, last_preview, last_dir)
         VALUES ($1, $2, $3, $4, $5, 'in')
         ON CONFLICT (jid) DO UPDATE SET
           phone = coalesce(platform_wa_chats.phone, EXCLUDED.phone),
           name = coalesce(EXCLUDED.name, platform_wa_chats.name)`,
        [jid, phone, m.pushName, m.timestamp, preview(m.kind, text)],
      );
      const { rowCount } = await c.query(
        `INSERT INTO platform_wa_messages (jid, direction, kind, body, wa_id, status, created_at)
         VALUES ($1, 'in', $2, $3, $4, 'received', $5)
         ON CONFLICT (jid, wa_id) WHERE direction = 'in' AND wa_id IS NOT NULL DO NOTHING`,
        [jid, m.kind, text, m.id, m.timestamp],
      );
      if (!rowCount) return;
      await c.query(
        `UPDATE platform_wa_chats SET unread = unread + 1,
           last_at = greatest(last_at, $2), last_preview = $3, last_dir = 'in'
         WHERE jid = $1`,
        [jid, m.timestamp, preview(m.kind, text)],
      );
    });
  }
}
