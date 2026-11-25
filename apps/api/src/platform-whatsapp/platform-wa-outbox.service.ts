import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { GatewayClient } from '../messaging/gateway.client';
import { WhatsAppUnavailableError } from '../messaging/whatsapp.client';
import { PLATFORM_WA_ID } from '../messaging/whatsapp-inbound.service';
import { PlatformDb } from '../platform/platform-db.service';

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
export const preview = (kind: string, body: string) =>
  (body.trim() ? body.trim() : (KIND_LABEL[kind] ?? 'Mensagem')).replace(/\s+/g, ' ').slice(0, 200);

export interface Delivered {
  /** conversa gravada (null = número novo que não deu certo, nada foi gravado) */
  jid: string | null;
  messageId: string | null;
  status: 'sent' | 'failed';
  error: string | null;
}

/**
 * Envio pelo número do painel e registro na conversa (platform_wa_*). Usado pela tela
 * Super Admin › WhatsApp (adminId = quem escreveu) e pelo menu e avisos automáticos
 * (adminId = null, aparece como "Menu do admin" na conversa).
 */
@Injectable()
export class PlatformWaOutbox {
  constructor(
    private readonly pdb: PlatformDb,
    private readonly gateway: GatewayClient,
  ) {}

  /**
   * `dest`: JID de conversa que já existe ou número (dígitos). `knownJid`: a conversa, quando já
   * se sabe (senão vem do gateway). Falha do WhatsApp fica gravada como "falhou".
   */
  async deliver(
    dest: string,
    body: string,
    adminId: string | null,
    knownJid: string | null,
    phone: string | null,
  ): Promise<Delivered> {
    let jid = knownJid;
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
    if (!jid) return { jid: null, messageId: null, status, error };
    const jidPhone = /^([0-9]{5,20})@s\.whatsapp\.net$/.exec(jid)?.[1] ?? phone;
    const messageId = await this.pdb.tx(async (c) => {
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
        [jid, body.slice(0, 4000), waId, adminId, status, error?.slice(0, 300) ?? null],
      );
      return m.id;
    });
    return { jid, messageId, status, error };
  }
}
