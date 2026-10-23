import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeS3, startFakeS3 } from '../../test/fake-s3';
import { regionFor, S3Client, signV4 } from './s3-client';

const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const AWS = {
  keyId: 'AKIAIOSFODNN7EXAMPLE',
  secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  host: 'examplebucket.s3.amazonaws.com',
  date: new Date('2013-05-24T00:00:00Z'),
};

describe('assinatura v4 (exemplos da documentação da AWS)', () => {
  it('GET de objeto com Range', () => {
    const h = signV4({
      ...AWS,
      method: 'GET',
      path: '/test.txt',
      headers: { Range: 'bytes=0-9' },
      payloadHash: EMPTY,
    });
    expect(h.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('listagem com parâmetros na URL', () => {
    const h = signV4({
      ...AWS,
      method: 'GET',
      path: '/',
      query: { prefix: 'J', 'max-keys': '2' },
      headers: {},
      payloadHash: EMPTY,
    });
    expect(h.authorization).toContain(
      'Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7',
    );
  });

  it('região do B2 sai do endereço', () => {
    expect(regionFor('https://s3.us-west-004.backblazeb2.com')).toBe('us-west-004');
    expect(regionFor('https://s3.eu-central-003.backblazeb2.com/', '')).toBe('eu-central-003');
    expect(regionFor('https://minio.local', 'sa-east-1')).toBe('sa-east-1');
    expect(regionFor('https://minio.local')).toBe('us-east-1');
  });
});

describe('cliente S3 contra um bucket falso', () => {
  let s3: FakeS3;
  let dir: string;
  const cfg = { keyId: 'k1', secret: 's3gr3do', bucket: 'meu-bucket' };
  beforeAll(async () => {
    s3 = await startFakeS3(cfg);
    dir = await mkdtemp(join(tmpdir(), 'cm-s3-'));
  });
  afterAll(() => s3.close());
  const client = (over: Partial<typeof cfg> = {}) =>
    new S3Client({ endpoint: s3.url, region: 'us-west-004', ...cfg, ...over });

  it('envia, confere, baixa, lista e apaga (chaves com espaço e acento)', async () => {
    const file = join(dir, 'a.bin');
    await writeFile(file, Buffer.alloc(200_000, 7));
    const c = client();
    const key = 'comandou/2026/10/pão de queijo+1.bin';
    await c.putFile(key, file, { sha256: 'abc' });
    expect(await c.head(key)).toEqual({ size: 200_000, meta: { sha256: 'abc' } });
    expect(await c.head('nao/existe')).toBeNull();
    await c.getToFile(key, join(dir, 'b.bin'));
    expect((await readFile(join(dir, 'b.bin'))).equals(await readFile(file))).toBe(true);
    const list = await c.list('comandou/');
    expect(list.map((o) => o.key)).toEqual([key]);
    await c.delete(key);
    expect(await c.list('comandou/')).toEqual([]);
  });

  it('erros em português, sem a chave', async () => {
    await expect(client({ secret: 'errado' }).putBuffer('x', Buffer.from('1'))).rejects.toThrow(
      /Chave recusada/,
    );
    await expect(client({ bucket: 'outro' }).putBuffer('x', Buffer.from('1'))).rejects.toThrow(
      /Bucket não encontrado/,
    );
    await expect(
      new S3Client({ ...cfg, endpoint: 'http://127.0.0.1:1', region: 'x' }).head('x'),
    ).rejects.toThrow(/Não foi possível falar com o bucket/);
  });
});
