import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClientBase } from 'pg';
import type { DemoCatalog } from './types';

/**
 * Demonstração que já está no ar: troca as fotos e a logo que ainda forem de uma versão antiga
 * (o sha256 do arquivo está em <imagesDir>/previous.json) pelas atuais. Foto trocada por alguém na tela não bate com nenhuma versão antiga e fica como está.
 * Roda a cada subida e não faz nada quando já está tudo atualizado.
 */
export async function refreshDemoAssets(
  c: ClientBase,
  tenantId: string,
  catalog: DemoCatalog,
): Promise<{ photos: number }> {
  const prevPath = join(catalog.imagesDir, 'previous.json');
  const previous: Record<string, string> = existsSync(prevPath)
    ? JSON.parse(readFileSync(prevPath, 'utf8'))
    : {};
  const manifest = JSON.parse(
    readFileSync(join(catalog.imagesDir, 'manifest.json'), 'utf8'),
  ) as Record<string, { width: number; height: number }>;
  let photos = 0;
  const hashes = Object.keys(previous);
  if (hashes.length) {
    const { rows } = await c.query<{ id: string; hash: string }>(
      `SELECT id, encode(sha256(bytes), 'hex') AS hash FROM media
        WHERE tenant_id = $1 AND encode(sha256(bytes), 'hex') = ANY($2::text[])`,
      [tenantId, hashes],
    );
    // As fotos são servidas com cache "imutável" pelo id: a foto nova entra com outro id e as
    // referências (item, categoria, logo, banner, galeria…) passam para ela; a antiga sai.
    const refs = rows.length ? await mediaReferences(c) : [];
    for (const r of rows) {
      const name = previous[r.hash]!;
      const m = manifest[name];
      const file = join(catalog.imagesDir, `${name}.webp`);
      if (!m || !existsSync(file)) continue;
      const bytes = readFileSync(file);
      if (createHash('sha256').update(bytes).digest('hex') === r.hash) continue;
      const { rows: created } = await c.query<{ id: string }>(
        `INSERT INTO media (tenant_id, content_type, bytes, size, width, height, created_by, created_at)
         SELECT tenant_id, 'image/webp', $2, $3, $4, $5, created_by, created_at FROM media WHERE id = $1
         RETURNING id`,
        [r.id, bytes, bytes.length, m.width, m.height],
      );
      const id = created[0]!.id;
      for (const ref of refs)
        await c.query(
          `UPDATE ${ref.table} SET ${ref.column} = $3 WHERE tenant_id = $1 AND ${ref.column} = $2`,
          [tenantId, r.id, id],
        );
      await c.query(`DELETE FROM media WHERE id = $1`, [r.id]);
      photos++;
    }
  }
  return { photos };
}

/** Colunas que apontam para uma foto (chaves estrangeiras para media), lidas do próprio banco. */
async function mediaReferences(c: ClientBase): Promise<{ table: string; column: string }[]> {
  const { rows } = await c.query<{ table: string; column: string }>(
    `SELECT format('%I.%I', n.nspname, t.relname) AS "table", quote_ident(a.attname) AS "column"
       FROM pg_constraint k
       JOIN pg_class t ON t.oid = k.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN LATERAL unnest(k.conkey) AS col(num) ON true
       JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = col.num
      WHERE k.contype = 'f' AND k.confrelid = 'media'::regclass AND a.attname <> 'tenant_id'`,
  );
  return rows;
}
