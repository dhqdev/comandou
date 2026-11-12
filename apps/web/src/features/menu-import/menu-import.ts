import { api, ApiError, type Category } from '../../lib/api';
import { shrinkImage, uploadImage } from '../../lib/media';

/** Importar o cardápio com IA: status, leitura do arquivo e gravação dos itens conferidos. */

export interface ImportStatus {
  enabled: boolean;
  reason: 'platform' | 'tenant' | 'limit' | null;
  assistantName: string;
}
export interface ImportedItem {
  name: string;
  description: string | null;
  price: string | null;
}
export interface ImportedCategory {
  name: string;
  items: ImportedItem[];
}
/** Linha da conferência: o que a IA leu, editável, com a caixinha de "salvar este". */
export interface DraftItem {
  key: string;
  category: string;
  name: string;
  description: string;
  /** Preço como a pessoa digita ("24,90"). */
  price: string;
  on: boolean;
}

export const importStatus = () => api<ImportStatus>('/menu-import');

export const WHY_OFF: Record<NonNullable<ImportStatus['reason']>, string> = {
  platform: 'A leitura por IA ainda não foi ligada pelo Comandou.',
  tenant: 'A IA está desligada para este restaurante.',
  limit: 'O limite de uso da IA neste mês acabou. Fale com o suporte do Comandou.',
};

const MAX_PDF = 3 * 1024 * 1024;

/** Manda a foto (reduzida aqui mesmo) ou o PDF para a IA ler. */
export async function analyzeMenuFile(file: File): Promise<ImportedCategory[]> {
  const pdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  let body: Blob = file;
  let type = 'application/pdf';
  if (pdf) {
    if (file.size > MAX_PDF)
      throw new Error('O PDF tem mais de 3 MB. Mande as páginas como fotos ou um PDF menor.');
  } else {
    const img = await shrinkImage(file);
    body = img.blob;
    type = img.blob.type;
  }
  let res: Response;
  try {
    res = await fetch('/api/v1/menu-import/analyze', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': type, 'X-Comandou-Request': '1', Accept: 'application/json' },
      body,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor');
  }
  const json = (await res.json().catch(() => undefined)) as
    { categories?: ImportedCategory[]; message?: string } | undefined;
  if (!res.ok) throw new ApiError(res.status, json?.message ?? `Erro ${res.status}`);
  return json?.categories ?? [];
}

let seq = 0;
const brPrice = (p: string | null) => (p ? p.replace('.', ',') : '');

export function toDrafts(cats: ImportedCategory[]): DraftItem[] {
  return cats.flatMap((c) =>
    c.items.map((i) => ({
      key: `d${++seq}`,
      category: c.name,
      name: i.name,
      description: i.description ?? '',
      price: brPrice(i.price),
      // Sem preço no cardápio: a pessoa digita o preço para o item entrar.
      on: !!i.price,
    })),
  );
}

/** "24,90" → "24.90"; vazio ou inválido → null. */
export function draftPrice(v: string): string | null {
  const s = v
    .replace(/[^\d,.]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n < 100_000 ? n.toFixed(2) : null;
}

export const readyDrafts = (list: DraftItem[]) =>
  list.filter((d) => d.on && d.name.trim() && draftPrice(d.price) !== null);

/**
 * Grava os itens marcados pelo cadastro normal do cardápio (mesmas regras e limites do plano).
 * Categoria com o mesmo nome é aproveitada. `photo` vira a foto do item quando veio um prato só.
 */
export async function saveDrafts(
  list: DraftItem[],
  photo: File | null,
  onProgress?: (done: number, total: number) => void,
): Promise<{ created: number; failed: { name: string; message: string }[] }> {
  const ready = readyDrafts(list);
  const existing = await api<Category[]>('/categories');
  const byName = new Map(existing.map((c) => [c.name.trim().toLowerCase(), c.id]));
  let imageId: string | null = null;
  if (photo && ready.length === 1) {
    try {
      imageId = (await uploadImage(photo)).id;
    } catch {
      imageId = null; // a foto é um extra: sem ela, o item entra do mesmo jeito
    }
  }
  let created = 0;
  const failed: { name: string; message: string }[] = [];
  for (const d of ready) {
    try {
      const catName = d.category.trim() || 'Cardápio';
      let categoryId = byName.get(catName.toLowerCase());
      if (!categoryId) {
        const c = await api<Category>('/categories', { method: 'POST', json: { name: catName } });
        categoryId = c.id;
        byName.set(catName.toLowerCase(), c.id);
      }
      await api('/products', {
        method: 'POST',
        json: {
          categoryId,
          name: d.name.trim(),
          description: d.description.trim() || undefined,
          price: draftPrice(d.price),
          ...(imageId ? { imageId } : {}),
        },
      });
      created++;
    } catch (e) {
      failed.push({ name: d.name, message: (e as Error).message });
    }
    onProgress?.(created + failed.length, ready.length);
  }
  return { created, failed };
}
