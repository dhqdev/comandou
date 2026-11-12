import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { MONTH_START } from '../chat/ai-quota';
import { ZodPipe } from '../common/zod.pipe';
import { ENV, Env } from '../config/env';
import { Model3dService } from '../model3d/model3d.service';
import type { Tx } from '../database/database.service';
import { CurrentTenant, CurrentUser, Public, RequirePermission } from '../common/decorators';
import { one, q } from '../common/sql';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

/**
 * Modelo 3D do item do cardápio. O restaurante escaneia o prato com um aplicativo de celular
 * (Polycam, Luma, Scaniverse, Reality Composer…) e envia o arquivo aqui: GLB serve o Android e o
 * navegador; USDZ serve o iPhone. No cardápio online o cliente gira o prato na tela e, com a
 * câmera, vê ele em cima da mesa em tamanho real. Leitura pública, como as fotos.
 */

export const MODEL_TYPES = { glb: 'model/gltf-binary', usdz: 'model/vnd.usdz+zip' } as const;
export type ModelFormat = keyof typeof MODEL_TYPES;
export const MAX_MODEL_BYTES = 12 * 1024 * 1024;
/** Arquivo bruto do escaneamento (GLB ou .zip com .gltf), antes de o servidor otimizar. */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
/** Tipo com que a tela envia o arquivo bruto (o parser de 40 MB vale só para ele e para .zip). */
export const SOURCE_TYPES = [
  'application/vnd.comandou.model-source',
  'application/zip',
  'application/x-zip-compressed',
];
/** Trabalho parado além disso (serviço model3d fora do ar) aparece como falha. */
const STALE_MINUTES = 40;

/** Confere a assinatura do arquivo: GLB começa com "glTF" versão 2; USDZ é um zip sem compressão. */
export function modelFormatOf(b: Buffer): ModelFormat | null {
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'glTF' && b.readUInt32LE(4) === 2)
    return 'glb';
  if (b.length >= 30 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04)
    return 'usdz';
  return null;
}

export const modelUrls = (productId: string, v: string | number | null, usdz: boolean) =>
  v === null
    ? null
    : {
        glb: `/api/v1/store/models/${productId}/modelo.glb?v=${v}`,
        usdz: usdz ? `/api/v1/store/models/${productId}/modelo.usdz?v=${v}` : null,
      };

interface ModelInfo {
  glbSize: number | null;
  usdzSize: number | null;
  v: string;
}
const INFO = `SELECT octet_length(glb) AS "glbSize", octet_length(usdz) AS "usdzSize",
                     floor(extract(epoch FROM updated_at))::bigint::text AS v
                FROM product_models WHERE product_id = $1`;

function present(productId: string, m: ModelInfo | undefined) {
  if (!m) return { glb: null, usdz: null };
  const file = (f: ModelFormat, size: number | null) =>
    size ? { size, url: `/api/v1/store/models/${productId}/modelo.${f}?v=${m.v}` } : null;
  return { glb: file('glb', m.glbSize), usdz: file('usdz', m.usdzSize) };
}

interface JobView {
  id: string;
  kind: 'generate' | 'optimize';
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: number;
  provider: string | null;
  error: string | null;
  stats: unknown;
  createdAt: string;
  finishedAt: string | null;
}
const LAST_JOB = `SELECT id, kind, status, progress, provider, error, stats,
                         created_at AS "createdAt", finished_at AS "finishedAt"
                    FROM product_model_jobs WHERE product_id = $1
                   ORDER BY created_at DESC LIMIT 1`;

const GenerateBody = z.object({
  mediaIds: z.array(z.string().uuid()).min(1).max(4),
  sizeCm: z.number().int().min(3).max(200).nullish(),
});
const SizeQuery = z.coerce.number().int().min(3).max(200).optional();

/** Trabalho parado demais (serviço fora do ar) vira falha: o restaurante pode tentar de novo. */
async function expireStale(tx: Tx, productId: string) {
  await q(
    tx,
    `UPDATE product_model_jobs
        SET status = 'failed', finished_at = now(),
            error = 'O servidor não terminou a tempo. Tente de novo.'
      WHERE product_id = $1 AND status IN ('queued', 'running')
        AND created_at < now() - interval '${STALE_MINUTES} minutes'`,
    [productId],
  );
  await q(
    tx,
    `DELETE FROM product_model_job_files f USING product_model_jobs j
      WHERE j.id = f.job_id AND j.product_id = $1 AND j.status = 'failed'`,
    [productId],
  );
}

@Controller({ version: '1' })
export class ProductModelsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly studio: Model3dService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Criados por foto neste mês (falhas não contam). */
  private async used(tx: Tx) {
    const r = await one<{ n: number }>(
      tx,
      `SELECT count(*)::int AS n FROM product_model_jobs
        WHERE kind = 'generate' AND status <> 'failed' AND created_at >= ${MONTH_START}`,
    );
    return r!.n;
  }

  @Get('products/:id/model')
  @RequirePermission('catalog:read')
  async info(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const { m, job, used } = await this.db.withTenant(
      { tenantId: t.id, userId: u.id },
      async (tx) => {
        await expireStale(tx, id);
        return {
          m: await one<ModelInfo>(tx, INFO, [id]),
          job: (await one<JobView>(tx, LAST_JOB, [id])) ?? null,
          used: await this.used(tx),
        };
      },
    );
    return {
      ...present(id, m),
      job,
      studio: {
        optimize: true,
        generate: this.studio.provider !== null,
        provider: this.studio.provider?.name ?? null,
        used,
        limit: this.env.MODEL3D_MONTHLY_GENERATIONS,
      },
    };
  }

  /** Cria o registro do trabalho com os arquivos e põe na fila (depois do COMMIT). */
  private async createJob(
    t: ResolvedTenant,
    u: AuthenticatedUser,
    req: Request,
    productId: string,
    kind: 'generate' | 'optimize',
    sizeCm: number | null,
    files: (tx: Tx) => Promise<{ type: string; bytes: Buffer }[]>,
  ) {
    const job = await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const p = await one<{ id: string }>(tx, `SELECT id FROM products WHERE id = $1`, [productId]);
      if (!p) throw new NotFoundException('Produto não encontrado');
      await expireStale(tx, productId);
      if (kind === 'generate') {
        if (!this.studio.provider)
          throw new UnprocessableEntityException(
            'Criar 3D por foto não está ligado neste servidor',
          );
        const limit = this.env.MODEL3D_MONTHLY_GENERATIONS;
        if ((await this.used(tx)) >= limit)
          throw new UnprocessableEntityException(
            `Este mês já foram criados ${limit} modelos por foto, o limite do plano. Envie um arquivo escaneado ou espere o próximo mês.`,
          );
      }
      const list = await files(tx);
      const row = await one<{ id: string }>(
        tx,
        `INSERT INTO product_model_jobs (tenant_id, product_id, kind, size_cm, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (product_id) WHERE status IN ('queued', 'running') DO NOTHING
         RETURNING id`,
        [t.id, productId, kind, sizeCm, u.id],
      );
      if (!row)
        throw new ConflictException(
          'Já tem um modelo sendo criado para este item. Espere terminar.',
        );
      for (const [i, f] of list.entries())
        await q(
          tx,
          `INSERT INTO product_model_job_files (tenant_id, job_id, position, content_type, bytes)
           VALUES ($1, $2, $3, $4, $5)`,
          [t.id, row.id, i, f.type, f.bytes],
        );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: kind === 'generate' ? 'product.model_generate' : 'product.model_optimize',
        entity: 'product',
        entityId: productId,
        data: { files: list.length, bytes: list.reduce((n, f) => n + f.bytes.length, 0) },
        ip: req.ip,
      });
      return (await one<JobView>(tx, LAST_JOB, [productId]))!;
    });
    await this.studio.enqueue(t.id, job.id);
    return job;
  }

  /**
   * Cria o 3D a partir de 1 a 4 fotos do prato (já enviadas em /media: a do item ou outras,
   * de ângulos diferentes). Quem cria é o gerador configurado no servidor (o nosso ou o Meshy).
   */
  @Post('products/:id/model/generate')
  @HttpCode(202)
  @RequirePermission('catalog:write')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async generate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(GenerateBody)) body: z.infer<typeof GenerateBody>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const ids = [...new Set(body.mediaIds)];
    return this.createJob(t, u, req, id, 'generate', body.sizeCm ?? null, async (tx) => {
      const rows = await q<{ id: string; content_type: string; bytes: Buffer }>(
        tx,
        `SELECT id, content_type, bytes FROM media WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      if (rows.length !== ids.length) throw new NotFoundException('Foto não encontrada');
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids.map((m) => ({ type: byId.get(m)!.content_type, bytes: byId.get(m)!.bytes }));
    });
  }

  /**
   * Envia o arquivo do escaneamento como saiu do aplicativo (GLB ou .zip com .gltf, até 40 MB).
   * O servidor reduz a malha e as texturas, comprime e acerta o tamanho antes de publicar.
   */
  @Put('products/:id/model/source')
  @HttpCode(202)
  @RequirePermission('catalog:write')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async source(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @Query('sizeCm', new ZodPipe(SizeQuery)) sizeCm: number | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const mime = (type ?? '').split(';')[0]!.trim().toLowerCase();
    if (!SOURCE_TYPES.includes(mime) || !Buffer.isBuffer(body) || body.length === 0)
      throw new UnprocessableEntityException('Envie o arquivo .glb ou o .zip com o .gltf');
    if (body.length > MAX_SOURCE_BYTES)
      throw new UnprocessableEntityException('Arquivo maior que 40 MB: exporte com menos detalhe');
    const zip = body[0] === 0x50 && body[1] === 0x4b && body[2] === 0x03 && body[3] === 0x04;
    if (!zip && modelFormatOf(body) !== 'glb')
      throw new UnprocessableEntityException('O arquivo não é um .glb nem um .zip');
    return this.createJob(t, u, req, id, 'optimize', sizeCm ?? null, async () => [
      { type: zip ? 'application/zip' : MODEL_TYPES.glb, bytes: body },
    ]);
  }

  /** Envia (ou troca) o arquivo de um dos formatos. O corpo é o próprio arquivo. */
  @Put('products/:id/model/:format')
  @RequirePermission('catalog:write')
  async upload(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('format') format: string,
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    if (format !== 'glb' && format !== 'usdz')
      throw new NotFoundException('Formato não encontrado');
    const mime = (type ?? '').split(';')[0]!.trim().toLowerCase();
    if (mime !== MODEL_TYPES[format] || !Buffer.isBuffer(body) || body.length === 0)
      throw new UnprocessableEntityException(
        format === 'glb' ? 'Envie um arquivo .glb' : 'Envie um arquivo .usdz',
      );
    if (body.length > MAX_MODEL_BYTES)
      throw new UnprocessableEntityException('Arquivo maior que 12 MB');
    if (modelFormatOf(body) !== format)
      throw new UnprocessableEntityException(
        format === 'glb'
          ? 'O arquivo não é um modelo GLB válido'
          : 'O arquivo não é um modelo USDZ válido',
      );
    const m = await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const p = await one<{ id: string }>(tx, `SELECT id FROM products WHERE id = $1`, [id]);
      // Produto de outro restaurante é indistinguível de inexistente (404, não 403).
      if (!p) throw new NotFoundException('Produto não encontrado');
      await q(
        tx,
        `INSERT INTO product_models (tenant_id, product_id, ${format}, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id) DO UPDATE SET ${format} = EXCLUDED.${format}, updated_at = now()`,
        [t.id, id, body, u.id],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'product.model_uploaded',
        entity: 'product',
        entityId: id,
        data: { format, size: body.length },
        ip: req.ip,
      });
      return one<ModelInfo>(tx, INFO, [id]);
    });
    return present(id, m);
  }

  @Delete('products/:id/model')
  @RequirePermission('catalog:write')
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const gone = await one<{ product_id: string }>(
        tx,
        `DELETE FROM product_models WHERE product_id = $1 RETURNING product_id`,
        [id],
      );
      if (gone)
        await this.audit.record(tx, {
          tenantId: t.id,
          actorUserId: u.id,
          action: 'product.model_removed',
          entity: 'product',
          entityId: id,
          ip: req.ip,
        });
    });
    return present(id, undefined);
  }

  /** Arquivo do modelo para o cardápio (o endereço termina em .glb/.usdz: o iPhone exige). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get('store/models/:id/:file')
  async file(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('file') file: string,
    @CurrentTenant() t: ResolvedTenant,
    @Res() res: Response,
  ) {
    const format = file === 'modelo.glb' ? 'glb' : file === 'modelo.usdz' ? 'usdz' : null;
    if (!format) throw new NotFoundException('Modelo não encontrado');
    const m = await this.db.withTenant({ tenantId: t.id }, (tx) =>
      one<{ bytes: Buffer | null }>(
        tx,
        `SELECT m.${format} AS bytes FROM product_models m JOIN products p ON p.id = m.product_id
          WHERE m.product_id = $1 AND p.active`,
        [id],
      ),
    );
    if (!m?.bytes) throw new NotFoundException('Modelo não encontrado');
    res.setHeader('Content-Type', MODEL_TYPES[format]);
    res.setHeader('Content-Disposition', `inline; filename="${file}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Length', String(m.bytes.length));
    res.end(m.bytes);
  }
}
