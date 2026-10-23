import { createHash, createHmac } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

/**
 * Cliente S3 mínimo (assinatura AWS v4, endereço no estilo caminho: <endpoint>/<bucket>/<chave>).
 * Feito para o Backblaze B2 (API compatível com S3), mas serve para MinIO e AWS.
 * Sem SDK: só o que o backup usa (enviar, conferir, baixar, listar e apagar).
 */
export interface S3Config {
  endpoint: string; // https://s3.us-west-004.backblazeb2.com
  region: string;
  bucket: string;
  keyId: string;
  secret: string;
}

export class S3Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Região a partir do endereço do B2 (s3.<região>.backblazeb2.com); senão a informada. */
export function regionFor(endpoint: string, region?: string | null): string {
  const m = /s3\.([a-z0-9-]+)\.backblazeb2\.com/i.exec(endpoint);
  if (m) return m[1].toLowerCase();
  const aws = /s3[.-]([a-z0-9-]+)\.amazonaws\.com/i.exec(endpoint);
  if (aws) return aws[1].toLowerCase();
  return region?.trim() || 'us-east-1';
}

const sha256Hex = (d: string | Buffer) => createHash('sha256').update(d).digest('hex');
const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d).digest();

/** Codificação do URI exigida pela assinatura v4 (RFC 3986; "/" preservada no caminho). */
export function uriEncode(s: string, keepSlash = false): string {
  return Array.from(new TextEncoder().encode(s))
    .map((b) => {
      const c = String.fromCharCode(b);
      if (/[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === '/')) return c;
      return '%' + b.toString(16).toUpperCase().padStart(2, '0');
    })
    .join('');
}

export interface SignInput {
  method: string;
  host: string;
  path: string; // já codificado
  query?: Record<string, string>;
  headers: Record<string, string>; // sem host
  payloadHash: string;
  region: string;
  keyId: string;
  secret: string;
  date: Date;
}

/** Assina a requisição (AWS Signature Version 4). Devolve os cabeçalhos a enviar. */
export function signV4(i: SignInput): Record<string, string> {
  const amzDate = i.date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(i.headers).map(([k, v]) => [k.toLowerCase(), v.trim()])),
    host: i.host,
    'x-amz-content-sha256': i.payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonicalQuery = Object.entries(i.query ?? {})
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonical = [
    i.method,
    i.path,
    canonicalQuery,
    names.map((n) => `${n}:${headers[n]}\n`).join(''),
    names.join(';'),
    i.payloadHash,
  ].join('\n');
  const scope = `${day}/${i.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
  const kDate = hmac(`AWS4${i.secret}`, day);
  const kSigning = hmac(hmac(hmac(kDate, i.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  const { host: _host, ...rest } = headers;
  return {
    ...rest,
    authorization: `AWS4-HMAC-SHA256 Credential=${i.keyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}

interface Raw {
  status: number;
  headers: http.IncomingHttpHeaders;
  stream: http.IncomingMessage;
}

const TIMEOUT_MS = 120_000;

function xmlTag(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? decodeXml(m[1]) : undefined;
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

async function readAll(s: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** Mensagens em português para os erros mais comuns do B2/S3. Nunca inclui a chave. */
function friendly(status: number, code: string, msg: string): string {
  if (code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch' || status === 401)
    return 'Chave recusada pelo bucket: confira o keyID e a applicationKey';
  if (code === 'AccessDenied' || status === 403)
    return 'Sem permissão no bucket: a chave precisa de acesso de leitura e escrita a este bucket';
  if (code === 'NoSuchBucket')
    return 'Bucket não encontrado: confira o nome e o endereço (endpoint)';
  return `Bucket respondeu ${status}${code ? ` (${code})` : ''}${msg ? `: ${msg}` : ''}`;
}

export class S3Client {
  private readonly base: URL;
  readonly region: string;

  constructor(private readonly cfg: S3Config) {
    this.base = new URL(cfg.endpoint.replace(/\/+$/, ''));
    if (!/^https?:$/.test(this.base.protocol)) throw new Error('Endereço do bucket inválido');
    this.region = cfg.region;
  }

  private path(key?: string) {
    const prefix = this.base.pathname.replace(/\/+$/, '');
    return `${prefix}/${uriEncode(this.cfg.bucket)}${key !== undefined ? `/${uriEncode(key, true)}` : ''}`;
  }

  private request(
    method: string,
    key: string | undefined,
    opts: {
      query?: Record<string, string>;
      headers?: Record<string, string>;
      body?: Buffer | (() => Readable);
      payloadHash?: string;
      contentLength?: number;
    } = {},
  ): Promise<Raw> {
    const path = this.path(key);
    const body = opts.body;
    const payloadHash =
      opts.payloadHash ?? sha256Hex(Buffer.isBuffer(body) ? body : Buffer.alloc(0));
    const headers = signV4({
      method,
      host: this.base.host,
      path,
      query: opts.query,
      headers: opts.headers ?? {},
      payloadHash,
      region: this.region,
      keyId: this.cfg.keyId,
      secret: this.cfg.secret,
      date: new Date(),
    });
    const len = Buffer.isBuffer(body) ? body.length : (opts.contentLength ?? 0);
    if (body !== undefined || method === 'PUT') headers['content-length'] = String(len);
    const qs = Object.entries(opts.query ?? {})
      .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
      .join('&');
    const lib = this.base.protocol === 'https:' ? https : http;
    return new Promise<Raw>((resolve, reject) => {
      const req = lib.request(
        {
          method,
          hostname: this.base.hostname,
          port: this.base.port || undefined,
          path: path + (qs ? `?${qs}` : ''),
          headers,
          timeout: TIMEOUT_MS,
        },
        (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, stream: res }),
      );
      req.on('timeout', () => req.destroy(new Error('Tempo esgotado falando com o bucket')));
      req.on('error', (e) =>
        reject(new Error(`Não foi possível falar com o bucket (${(e as Error).message})`)),
      );
      if (Buffer.isBuffer(body)) req.end(body);
      else if (body) {
        pipeline(body(), req).catch(reject);
      } else req.end();
    });
  }

  private async check(r: Raw, okStatus: number[] = [200]) {
    if (okStatus.includes(r.status)) return;
    const text = await readAll(r.stream).catch(() => '');
    const code = xmlTag(text, 'Code') ?? '';
    const msg = xmlTag(text, 'Message') ?? '';
    throw new S3Error(r.status, code, friendly(r.status, code, msg));
  }

  /** Envia um arquivo do disco (até 5 GB, limite de um envio único no S3/B2). */
  async putFile(key: string, file: string, meta: Record<string, string> = {}) {
    const { size } = await stat(file);
    if (size > 5 * 1024 ** 3) throw new Error('Arquivo maior que 5 GB: envio único não suportado');
    const hash = createHash('sha256');
    await pipeline(createReadStream(file), hash);
    const headers: Record<string, string> = { 'content-type': 'application/octet-stream' };
    for (const [k, v] of Object.entries(meta)) headers[`x-amz-meta-${k}`] = v;
    const r = await this.request('PUT', key, {
      headers,
      body: () => createReadStream(file),
      payloadHash: hash.digest('hex'),
      contentLength: size,
    });
    await this.check(r);
    r.stream.resume();
  }

  async putBuffer(key: string, data: Buffer) {
    const r = await this.request('PUT', key, { body: data });
    await this.check(r);
    r.stream.resume();
  }

  /** Tamanho do objeto, ou null se não existe. */
  async head(key: string): Promise<{ size: number; meta: Record<string, string> } | null> {
    const r = await this.request('HEAD', key);
    r.stream.resume();
    if (r.status === 404) return null;
    if (r.status !== 200) throw new S3Error(r.status, '', friendly(r.status, '', ''));
    const meta: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.headers))
      if (k.startsWith('x-amz-meta-') && typeof v === 'string') meta[k.slice(11)] = v;
    return { size: Number(r.headers['content-length'] ?? 0), meta };
  }

  async getToFile(key: string, file: string) {
    const r = await this.request('GET', key);
    await this.check(r);
    await pipeline(r.stream, createWriteStream(file, { mode: 0o600 }));
  }

  async delete(key: string) {
    const r = await this.request('DELETE', key);
    await this.check(r, [200, 204]);
    r.stream.resume();
  }

  /** Lista os objetos sob o prefixo (todas as páginas). */
  async list(prefix: string): Promise<{ key: string; size: number; lastModified: Date }[]> {
    const out: { key: string; size: number; lastModified: Date }[] = [];
    let token: string | undefined;
    for (let page = 0; page < 1000; page++) {
      const query: Record<string, string> = { 'list-type': '2', prefix, 'max-keys': '1000' };
      if (token) query['continuation-token'] = token;
      const r = await this.request('GET', undefined, { query });
      await this.check(r);
      const xml = await readAll(r.stream);
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        out.push({
          key: xmlTag(m[1], 'Key') ?? '',
          size: Number(xmlTag(m[1], 'Size') ?? 0),
          lastModified: new Date(xmlTag(m[1], 'LastModified') ?? 0),
        });
      }
      if (xmlTag(xml, 'IsTruncated') !== 'true') break;
      token = xmlTag(xml, 'NextContinuationToken');
      if (!token) break;
    }
    return out;
  }
}
