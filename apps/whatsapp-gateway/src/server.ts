import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import {
  MAX_DOCUMENT_BYTES,
  MAX_TYPING_MS,
  NotConnectedError,
  NotOnWhatsAppError,
  SendUncertainError,
  SessionManager,
  TooManyMessagesError,
  type OutgoingFile,
  type Target,
} from './sessions.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROUTE = new RegExp(
  `^/v1/sessions/(${UUID})(?:/(start|logout|messages|document|typing|read|react|presence))?$`,
  'i',
);
/** Conversa individual: número (@s.whatsapp.net) ou número escondido (@lid). */
const JID = /^[0-9]{5,20}@(s\.whatsapp\.net|lid)$/;
const PHONE = /^[0-9]{10,15}$/;
const MSG_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Nome do arquivo enviado: letras, números, espaço, ponto, traço e sublinhado; .pdf, .jpg ou .png. */
const FILE_NAME = /^[\p{L}\p{N} ._-]{1,80}\.(pdf|jpe?g|png)$/iu;
/** Corpo JSON comum (texto, presença) e o do PDF (base64 deixa ~4/3 maior). */
const BODY_MAX = 16_384;
const DOC_BODY_MAX = Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 8_192;

const PDF_MAGIC = Buffer.from('%PDF-');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Tipo do arquivo pela assinatura dos primeiros bytes. */
function fileType(b: Buffer): OutgoingFile['mimetype'] | null {
  if (b.subarray(0, 5).equals(PDF_MAGIC)) return 'application/pdf';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  return null;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

class BadRequest extends Error {}

/** Destino do corpo: `jid` de uma conversa que chegou, ou `to` (número só com dígitos). */
function targetOf(body: Record<string, unknown> | null): Target {
  if (typeof body?.jid === 'string') {
    if (!JID.test(body.jid)) throw new BadRequest('destino inválido');
    return { jid: body.jid };
  }
  const to = typeof body?.to === 'string' ? body.to : '';
  if (!PHONE.test(to)) throw new BadRequest('destino inválido');
  return { to };
}

function jidAndId(body: Record<string, unknown> | null) {
  const jid = typeof body?.jid === 'string' ? body.jid : '';
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!JID.test(jid) || !MSG_ID.test(id)) throw new BadRequest('conversa ou mensagem inválida');
  return { jid, id };
}

const num = (v: unknown, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), max) : 0;

/**
 * API interna (só a API do Comandou chama, na rede interna, com token). O restaurante vem da URL
 * que a API monta a partir do Host resolvido — nunca do navegador.
 */
export function createGatewayServer(
  sessions: SessionManager,
  token: string,
  /** números extras do /health (ex.: fila de mensagens recebidas) */
  extraStats: () => Record<string, unknown> = () => ({}),
) {
  const expected = digest(`Bearer ${token}`);
  return createServer(
    (req, res) => void handle(req, res).catch(() => send(res, 500, { error: 'erro interno' })),
  );

  async function handle(req: IncomingMessage, res: ServerResponse) {
    // Só contagens (nada de restaurante ou número): serve para monitorar a carga.
    if (req.method === 'GET' && req.url === '/health')
      return send(res, 200, {
        ok: true,
        sessions: sessions.stats(),
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
        ...extraStats(),
      });
    if (!timingSafeEqual(digest(req.headers.authorization ?? ''), expected))
      return send(res, 401, { error: 'não autorizado' });
    const m = ROUTE.exec(req.url ?? '');
    if (!m) return send(res, 404, { error: 'rota desconhecida' });
    const tenantId = m[1].toLowerCase();
    const action = m[2];
    if (req.method === 'GET' && !action) return send(res, 200, sessions.status(tenantId));
    if (req.method === 'POST' && action === 'start')
      return send(res, 200, await sessions.start(tenantId));
    if (req.method === 'POST' && action === 'logout')
      return send(res, 200, await sessions.logout(tenantId));
    if (req.method !== 'POST' || !action) return send(res, 405, { error: 'método não permitido' });
    const body = await readJson(req, action === 'document' ? DOC_BODY_MAX : BODY_MAX);
    try {
      if (action === 'document') {
        const dest = targetOf(body);
        const fileName = typeof body?.fileName === 'string' ? body.fileName : '';
        const caption = typeof body?.caption === 'string' ? body.caption : '';
        const b64 = typeof body?.data === 'string' ? body.data : '';
        if (!FILE_NAME.test(fileName) || caption.length > 1000)
          throw new BadRequest('nome do arquivo ou legenda inválidos');
        const data = Buffer.from(b64, 'base64');
        // O tipo sai do conteúdo (PDF, JPEG ou PNG de verdade), nunca do que veio no pedido.
        const mimetype = fileType(data);
        if (!data.length || data.length > MAX_DOCUMENT_BYTES || !mimetype)
          throw new BadRequest('arquivo inválido (só PDF, JPEG ou PNG até 10 MB)');
        return send(
          res,
          200,
          await sessions.sendDocument(tenantId, dest, {
            data,
            fileName,
            mimetype,
            caption: caption.trim() || undefined,
          }),
        );
      }
      if (action === 'messages') {
        const dest = targetOf(body);
        const text = typeof body?.text === 'string' ? body.text : '';
        if (!text.trim() || text.length > 4000) throw new BadRequest('destino ou texto inválido');
        const r = await sessions.send(tenantId, dest, text, num(body?.typingMs, 8000));
        return send(res, 200, r);
      }
      if (action === 'typing') {
        const kind = body?.kind === 'recording' ? 'recording' : 'typing';
        const ms = num(body?.ms, MAX_TYPING_MS) || 5000;
        return send(res, 200, await sessions.typing(tenantId, targetOf(body), ms, kind));
      }
      if (action === 'read') {
        const { jid, id } = jidAndId(body);
        return send(res, 200, await sessions.markRead(tenantId, jid, id));
      }
      if (action === 'react') {
        const { jid, id } = jidAndId(body);
        const emoji = typeof body?.emoji === 'string' ? body.emoji : '';
        if (emoji.length > 16) throw new BadRequest('emoji inválido');
        return send(res, 200, await sessions.react(tenantId, jid, id, emoji));
      }
      // presence
      const state = body?.state;
      if (state !== 'available' && state !== 'unavailable')
        throw new BadRequest('presença inválida (available ou unavailable)');
      const ms = num(body?.ms, 3_600_000) || undefined;
      return send(res, 200, await sessions.presence(tenantId, state, ms));
    } catch (e) {
      if (e instanceof BadRequest) return send(res, 422, { error: e.message });
      if (e instanceof NotConnectedError) return send(res, 409, { error: e.message });
      if (e instanceof TooManyMessagesError) return send(res, 429, { error: e.message });
      if (e instanceof NotOnWhatsAppError) return send(res, 422, { error: e.message });
      // 504 + uncertain: pode ter saído; a API marca como falha sem tentar de novo sozinha.
      if (e instanceof SendUncertainError)
        return send(res, 504, { error: e.message, uncertain: true });
      return send(res, 502, { error: (e as Error).message.slice(0, 200) });
    }
  }
}

async function readJson(
  req: IncomingMessage,
  max: number,
): Promise<Record<string, unknown> | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) return null;
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
