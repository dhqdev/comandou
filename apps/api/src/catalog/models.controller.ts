import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
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

@Controller({ version: '1' })
export class ProductModelsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  @Get('products/:id/model')
  @RequirePermission('catalog:read')
  async info(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const m = await this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      one<ModelInfo>(tx, INFO, [id]),
    );
    return present(id, m);
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
