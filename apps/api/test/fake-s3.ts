import http from 'node:http';
import { AddressInfo } from 'node:net';
import { signV4 } from '../src/backup/s3-client';

/**
 * S3 falso em memória para os testes do backup. Confere a assinatura v4 de cada requisição
 * (recalcula com os mesmos cabeçalhos) e responde como o B2/S3: PUT, HEAD, GET, DELETE e
 * ListObjectsV2. Também roda sozinho: `node -r @swc-node/register test/fake-s3.ts 9000`.
 */
export interface FakeS3 {
  url: string;
  objects: Map<string, { body: Buffer; meta: Record<string, string>; modified: Date }>;
  requests: string[];
  close(): Promise<void>;
}

export async function startFakeS3(opts: {
  keyId: string;
  secret: string;
  bucket: string;
  region?: string;
  port?: number;
  denyDelete?: boolean;
}): Promise<FakeS3> {
  const objects: FakeS3['objects'] = new Map();
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? '/', 'http://x');
      const path = url.pathname;
      requests.push(`${req.method} ${path}${url.search}`);
      const fail = (status: number, code: string) => {
        res.writeHead(status, { 'content-type': 'application/xml' });
        res.end(`<Error><Code>${code}</Code><Message>${code}</Message></Error>`);
      };
      // Assinatura
      const auth = String(req.headers.authorization ?? '');
      const m =
        /Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=(\w+)/.exec(
          auth,
        );
      if (!m || m[1] !== opts.keyId) return fail(403, 'InvalidAccessKeyId');
      const signed = m[4].split(';');
      const headers: Record<string, string> = {};
      for (const h of signed)
        if (!['host', 'x-amz-date', 'x-amz-content-sha256'].includes(h))
          headers[h] = String(req.headers[h] ?? '');
      const amz = String(req.headers['x-amz-date']);
      const date = new Date(
        `${amz.slice(0, 4)}-${amz.slice(4, 6)}-${amz.slice(6, 8)}T${amz.slice(9, 11)}:${amz.slice(11, 13)}:${amz.slice(13, 15)}Z`,
      );
      const query: Record<string, string> = {};
      url.searchParams.forEach((v, k) => (query[k] = v));
      const expected = signV4({
        method: req.method!,
        host: String(req.headers.host),
        path: req.url!.split('?')[0],
        query,
        headers,
        payloadHash: String(req.headers['x-amz-content-sha256']),
        region: m[3],
        keyId: opts.keyId,
        secret: opts.secret,
        date,
      }).authorization;
      if (expected !== auth) return fail(403, 'SignatureDoesNotMatch');

      const [, bucket, ...rest] = path.split('/');
      if (decodeURIComponent(bucket) !== opts.bucket) return fail(404, 'NoSuchBucket');
      const key = decodeURIComponent(rest.join('/'));
      if (req.method === 'PUT') {
        const meta: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers))
          if (k.startsWith('x-amz-meta-')) meta[k.slice(11)] = String(v);
        objects.set(key, { body, meta, modified: new Date() });
        res.writeHead(200, { etag: '"x"' });
        return res.end();
      }
      if (req.method === 'GET' && !key) {
        const prefix = query.prefix ?? '';
        const list = [...objects.entries()].filter(([k]) => k.startsWith(prefix));
        res.writeHead(200, { 'content-type': 'application/xml' });
        return res.end(
          `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${list
            .map(
              ([k, o]) =>
                `<Contents><Key>${k}</Key><LastModified>${o.modified.toISOString()}</LastModified><Size>${o.body.length}</Size></Contents>`,
            )
            .join('')}</ListBucketResult>`,
        );
      }
      const o = objects.get(key);
      if (req.method === 'DELETE') {
        if (opts.denyDelete) return fail(403, 'AccessDenied');
        objects.delete(key);
        res.writeHead(204);
        return res.end();
      }
      if (!o) return fail(404, 'NoSuchKey');
      const h: Record<string, string> = { 'content-length': String(o.body.length) };
      for (const [k, v] of Object.entries(o.meta)) h[`x-amz-meta-${k}`] = v;
      res.writeHead(200, h);
      return res.end(req.method === 'HEAD' ? undefined : o.body);
    });
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    objects,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

if (require.main === module) {
  const port = Number(process.argv[2] ?? 9000);
  void startFakeS3({
    keyId: process.env.FAKE_S3_KEY_ID ?? 'chave-teste',
    secret: process.env.FAKE_S3_SECRET ?? 'segredo-teste',
    bucket: process.env.FAKE_S3_BUCKET ?? 'comandou-backups',
    port,
  }).then((s) => console.log(`S3 falso em ${s.url}`));
}
