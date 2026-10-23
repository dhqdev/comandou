import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { CLEANUP_TARGETS, CleanupTarget, HostAgent } from './agent';

const same = (a: string, b: string) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

function send(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > 4096) throw Object.assign(new Error('corpo grande demais'), { status: 413 });
    chunks.push(c);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON inválido'), { status: 400 });
  }
}

/**
 * HTTP do agente. Toda rota (menos /healthz) exige `Authorization: Bearer <AGENT_TOKEN>`.
 * Só existem as ações abaixo: não há execução de comando, terminal nem acesso a arquivos.
 */
export function agentServer(agent: HostAgent, token: string): Server {
  if (token.length < 24) throw new Error('AGENT_TOKEN precisa de pelo menos 24 caracteres');
  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://agente');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/healthz') return send(res, 200, { ok: true });
      const auth = req.headers.authorization ?? '';
      if (!auth.startsWith('Bearer ') || !same(auth.slice(7), token))
        return send(res, 401, { message: 'não autorizado' });

      if (req.method === 'GET' && path === '/v1/status')
        return send(res, 200, await agent.status());
      if (req.method === 'GET' && path === '/v1/disk')
        return send(res, 200, await agent.diskUsage());
      if (req.method === 'POST' && path === '/v1/cleanup') {
        const body = (await readJson(req)) as { targets?: unknown };
        const targets = Array.isArray(body.targets)
          ? body.targets.filter((t): t is CleanupTarget =>
              (CLEANUP_TARGETS as readonly string[]).includes(String(t)),
            )
          : [];
        if (!targets.length) return send(res, 400, { message: 'escolha o que limpar' });
        return send(res, 200, { results: await agent.cleanup(targets) });
      }
      if (path === '/v1/update') {
        if (req.method === 'GET') return send(res, 200, { job: agent.updater.current() });
        if (req.method === 'POST') {
          const body = (await readJson(req)) as { version?: unknown };
          try {
            return send(res, 202, { job: await agent.updater.start(String(body.version ?? '')) });
          } catch (e) {
            return send(res, 400, { message: (e as Error).message });
          }
        }
      }
      const m = /^\/v1\/services\/([^/]+)\/(restart|logs)$/.exec(path);
      if (m) {
        const name = decodeURIComponent(m[1]!);
        if (req.method === 'POST' && m[2] === 'restart')
          return send(res, 200, await agent.restartService(name));
        if (req.method === 'GET' && m[2] === 'logs')
          return send(
            res,
            200,
            await agent.serviceLogs(name, Number(url.searchParams.get('tail'))),
          );
      }
      send(res, 404, { message: 'rota não encontrada' });
    })().catch((e: Error & { status?: number }) => {
      if (!res.headersSent) send(res, e.status ?? 502, { message: e.message });
    });
  });
}
