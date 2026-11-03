/** Chave de uma mensagem do Baileys (só o que usamos). */
export interface WAKey {
  remoteJid?: string | null;
  id?: string | null;
  fromMe?: boolean | null;
  participant?: string | null;
  /** Conversa em LID (número escondido): o número de verdade, quando o WhatsApp manda. */
  senderPn?: string | null;
}

/** Mensagem do Baileys (só o que usamos). */
export interface WAMessageLike {
  key: WAKey;
  message?: Record<string, unknown> | null;
  pushName?: string | null;
  messageTimestamp?: number | { toNumber(): number } | null;
}

export type InboundKind =
  'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'contact' | 'other';

/** Mensagem de cliente que o gateway repassa para a API. */
export interface InboundMessage {
  tenantId: string;
  /** id da mensagem no WhatsApp (para marcar como lida ou reagir) */
  id: string;
  /** conversa: responda para este JID (pode ser @lid, sem o número) */
  jid: string;
  /** número do cliente só com dígitos, quando o WhatsApp informa */
  from: string | null;
  kind: InboundKind;
  /** texto, legenda da mídia ou a opção escolhida num botão/lista */
  text: string;
  pushName: string | null;
  /** ISO */
  timestamp: string;
}

/** Embrulhos que o WhatsApp põe em volta do conteúdo (temporária, ver uma vez, editada...). */
const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
];

type Content = Record<string, Record<string, unknown> | string | undefined>;

function unwrap(m: Record<string, unknown> | null | undefined): Content | null {
  let cur = m as Content | null | undefined;
  for (let i = 0; i < 5 && cur; i++) {
    const w = WRAPPERS.find((k) => cur![k]);
    if (!w) break;
    cur = (cur[w] as { message?: Content } | undefined)?.message;
  }
  return cur ?? null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

const PERSONAL = /^([0-9]{5,20})(?::[0-9]+)?@(s\.whatsapp\.net|lid)$/;

/**
 * Converte a mensagem do Baileys no formato da API. Só conversas individuais de clientes:
 * grupos, status, canais, mensagens da própria conta e avisos de protocolo (apagou, reagiu,
 * votou) ficam de fora (null).
 */
export function parseInbound(tenantId: string, raw: WAMessageLike): InboundMessage | null {
  const jid = raw.key?.remoteJid ?? '';
  const id = raw.key?.id ?? '';
  if (!id || raw.key.fromMe) return null;
  const pm = PERSONAL.exec(jid);
  if (!pm) return null;
  const c = unwrap(raw.message);
  if (!c) return null;
  let kind: InboundKind;
  let text = '';
  const sub = (k: string) => c[k] as Record<string, unknown> | undefined;
  if (typeof c.conversation === 'string') {
    kind = 'text';
    text = c.conversation;
  } else if (sub('extendedTextMessage')) {
    kind = 'text';
    text = str(sub('extendedTextMessage')!.text);
  } else if (sub('imageMessage')) {
    kind = 'image';
    text = str(sub('imageMessage')!.caption);
  } else if (sub('videoMessage')) {
    kind = 'video';
    text = str(sub('videoMessage')!.caption);
  } else if (sub('audioMessage')) kind = 'audio';
  else if (sub('documentMessage')) {
    kind = 'document';
    text = str(sub('documentMessage')!.caption) || str(sub('documentMessage')!.fileName);
  } else if (sub('stickerMessage')) kind = 'sticker';
  else if (sub('locationMessage') || sub('liveLocationMessage')) {
    kind = 'location';
    const l = (sub('locationMessage') ?? sub('liveLocationMessage'))!;
    text = [str(l.name), str(l.address)].filter(Boolean).join(' - ');
  } else if (sub('contactMessage') || sub('contactsArrayMessage')) {
    kind = 'contact';
    text = str(sub('contactMessage')?.displayName);
  } else if (sub('buttonsResponseMessage')) {
    kind = 'text';
    text = str(sub('buttonsResponseMessage')!.selectedDisplayText);
  } else if (sub('listResponseMessage')) {
    kind = 'text';
    text = str(sub('listResponseMessage')!.title);
  } else if (sub('templateButtonReplyMessage')) {
    kind = 'text';
    text = str(sub('templateButtonReplyMessage')!.selectedDisplayText);
  } else if (
    sub('protocolMessage') ||
    sub('reactionMessage') ||
    sub('pollUpdateMessage') ||
    Object.keys(c).every((k) => k === 'senderKeyDistributionMessage' || k === 'messageContextInfo')
  )
    return null;
  else kind = 'other';
  const pnFromKey = /^([0-9]{5,20})(?::[0-9]+)?@s\.whatsapp\.net$/.exec(raw.key.senderPn ?? '');
  const from = pm[2] === 's.whatsapp.net' ? pm[1] : (pnFromKey?.[1] ?? null);
  const ts = raw.messageTimestamp;
  const secs = typeof ts === 'number' ? ts : ts ? ts.toNumber() : 0;
  return {
    tenantId,
    id,
    jid: jid.replace(/:[0-9]+@/, '@'),
    from,
    kind,
    text: text.slice(0, 4000),
    pushName: raw.pushName?.slice(0, 100) || null,
    timestamp: new Date(secs ? secs * 1000 : Date.now()).toISOString(),
  };
}
