import { request } from 'node:http';

/**
 * Cliente mínimo da API do Docker pelo socket. Só as chamadas que o painel usa: listar,
 * limpar (contêineres parados, imagens, cache de build), reiniciar serviço e ler logs.
 * Nada de criar contêiner, executar comando ou mexer em volumes.
 */
export class DockerClient {
  constructor(readonly socketPath = process.env.DOCKER_SOCKET ?? '/var/run/docker.sock') {}

  call<T = unknown>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    opts: { raw?: boolean; timeoutMs?: number } = {},
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        {
          socketPath: this.socketPath,
          path: `/v1.43${path}`,
          method,
          headers: data
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
            : {},
          timeout: opts.timeoutMs ?? 60_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            if ((res.statusCode ?? 500) >= 400) {
              let msg = buf.toString('utf8').slice(0, 300);
              try {
                msg = (JSON.parse(msg) as { message?: string }).message ?? msg;
              } catch {
                /* texto puro */
              }
              return reject(new Error(`Docker ${res.statusCode}: ${msg}`));
            }
            if (opts.raw) return resolve(buf as T);
            resolve((buf.length ? JSON.parse(buf.toString('utf8')) : null) as T);
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('Docker não respondeu a tempo')));
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }
}

/**
 * Logs sem TTY vêm em quadros: 8 bytes de cabeçalho (fluxo, 0, 0, 0, tamanho big-endian) e o
 * conteúdo. Junta tudo em texto; se não houver cabeçalho válido, devolve o texto como veio.
 */
export function demuxLogs(buf: Buffer): string {
  const out: string[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const stream = buf[i]!;
    if (stream > 2 || buf[i + 1] !== 0 || buf[i + 2] !== 0 || buf[i + 3] !== 0)
      return buf.toString('utf8');
    const size = buf.readUInt32BE(i + 4);
    out.push(buf.subarray(i + 8, i + 8 + size).toString('utf8'));
    i += 8 + size;
  }
  return out.join('');
}
