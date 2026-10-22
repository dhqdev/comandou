import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { NotConnectedError, SessionManager } from './sessions.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROUTE = new RegExp(`^/v1/sessions/(${UUID})(?:/(start|logout|messages))?$`, 'i');

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * API interna (só a API do PedeMais chama, na rede interna, com token). O restaurante vem da URL
 * que a API monta a partir do Host resolvido — nunca do navegador.
 */
export function createGatewayServer(sessions: SessionManager, token: string) {
  const expected = digest(`Bearer ${token}`);
  return createServer(
    (req, res) => void handle(req, res).catch(() => send(res, 500, { error: 'erro interno' })),
  );

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
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
    if (req.method === 'POST' && action === 'messages') {
      const body = await readJson(req);
      const to = typeof body?.to === 'string' ? body.to : '';
      const text = typeof body?.text === 'string' ? body.text : '';
      if (!/^[0-9]{10,15}$/.test(to) || !text.trim() || text.length > 4000)
        return send(res, 422, { error: 'destino ou texto inválido' });
      try {
        return send(res, 200, await sessions.send(tenantId, to, text));
      } catch (e) {
        if (e instanceof NotConnectedError) return send(res, 409, { error: e.message });
        return send(res, 502, { error: (e as Error).message.slice(0, 200) });
      }
    }
    send(res, 405, { error: 'método não permitido' });
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 16_384) return null;
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
