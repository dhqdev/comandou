import { api, ApiError, type Category, type Product } from '../../lib/api';
import { shrinkImage, uploadImage } from '../../lib/media';

/** Importar o cardápio com IA: status, leitura do arquivo e gravação dos itens conferidos. */

export interface ImportStatus {
  enabled: boolean;
  reason: 'platform' | 'tenant' | 'limit' | null;
  assistantName: string;
  /** Restaurante criado pelo site, nos primeiros dias: a IA sai por conta do Comandou. */
  creation?: boolean;
}
export interface ImportedItem {
  name: string;
  description: string | null;
  price: string | null;
  /** Primeiros passos: foto do item na página do link. */
  imageUrl?: string | null;
  /** Primeiros passos: onde está a foto do item na foto do cardápio (0–1000). */
  photoBox?: [number, number, number, number] | null;
  /** Estoque sugerido pela IA na criação pelo site (null = sem controle). */
  stock?: { qty: number; min: number } | null;
}
export interface ImportedCategory {
  name: string;
  items: ImportedItem[];
}
/** Linha da conferência: o que a IA leu, editável, com a caixinha de "salvar este". */
export interface DraftItem {
  key: string;
  /** Grupo da categoria na conferência: renomear não mistura grupos, mesmo com nome igual no meio da digitação. */
  group: string;
  category: string;
  name: string;
  description: string;
  /** Preço como a pessoa digita ("24,90"). */
  price: string;
  on: boolean;
  /** Já existe um item com este nome no cardápio (ou numa página lida antes): vem desmarcado. */
  dup?: 'menu' | 'import';
  /** Foto do item pronta para subir (recortada do cardápio ou criada pela IA). */
  photo?: File | null;
  /** Foto do item em outro site (link do cardápio): baixada na hora de salvar. */
  photoUrl?: string | null;
  /** Endereço para mostrar a miniatura na conferência. */
  thumb?: string | null;
  /**
   * Estoque para começar, como a pessoa digita (sugerido pela IA na criação pelo site). Vazio =
   * não controlar. Ausente = o item veio sem sugestão (a coluna não aparece).
   */
  stock?: string;
  /** Com quanto avisar para repor (vem junto da sugestão). */
  stockMin?: string;
}

export const importStatus = () => api<ImportStatus>('/menu-import');

export const WHY_OFF: Record<NonNullable<ImportStatus['reason']>, string> = {
  platform: 'A leitura por IA ainda não foi ligada pelo Comandou.',
  tenant: 'A IA está desligada para este restaurante.',
  limit: 'O limite de uso da IA neste mês acabou. Fale com o suporte do Comandou.',
};

const MAX_BYTES = 3 * 1024 * 1024;
/** Cardápio tem letra miúda: a foto vai maior que a foto de item (1600 px). */
const READ_SIDE = 2400;

export interface AnalyzeResult {
  categories: ImportedCategory[];
  /** Cardápio grande demais para uma leitura só: veio até onde deu. */
  partial: boolean;
}

/** Manda a foto (reduzida aqui mesmo) ou o PDF para a IA ler. */
export async function analyzeMenuFile(file: File): Promise<AnalyzeResult> {
  const r = await analyzeFile<AnalyzeResult>(file, false);
  return { categories: r.categories ?? [], partial: !!r.partial };
}

/**
 * A mesma leitura, com `store` (primeiros passos): a IA devolve também os dados da loja e onde
 * estão o logo e as fotos dos itens na imagem.
 */
export async function analyzeFile<T>(file: File, store: boolean): Promise<T> {
  const pdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  let body: Blob = file;
  let type = 'application/pdf';
  if (pdf) {
    if (file.size > MAX_BYTES)
      throw new Error('O PDF tem mais de 3 MB. Mande as páginas como fotos ou um PDF menor.');
  } else {
    let img = await shrinkImage(file, READ_SIDE);
    // Foto muito detalhada pode passar de 3 MB mesmo reduzida: tenta de novo no tamanho padrão.
    if (img.blob.size > MAX_BYTES) img = await shrinkImage(file);
    body = img.blob;
    type = img.blob.type;
  }
  let res: Response;
  try {
    res = await fetch(`/api/v1/menu-import/analyze${store ? '?loja=1' : ''}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': type, 'X-Comandou-Request': '1', Accept: 'application/json' },
      body,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor');
  }
  const json = (await res.json().catch(() => undefined)) as (T & { message?: string }) | undefined;
  if (!res.ok) {
    const msg =
      res.status === 413
        ? 'Arquivo grande demais. Mande um PDF menor ou fotos das páginas.'
        : (json?.message ?? `Erro ${res.status}`);
    throw new ApiError(res.status, msg);
  }
  return (json ?? {}) as T;
}

/** Nome para comparar: sem acento, caixa ou espaço extra ("X-Búrguer " = "x-burguer"). */
export const nameKey = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Nomes dos itens que já estão no cardápio, para não cadastrar de novo. */
export async function existingNames(): Promise<Set<string>> {
  try {
    const list = await api<Pick<Product, 'name'>[]>('/products');
    return new Set(list.map((p) => nameKey(p.name)));
  } catch {
    return new Set(); // sem a lista, a conferência segue sem o aviso de repetido
  }
}

let seq = 0;
const brPrice = (p: string | null) => (p ? p.replace('.', ',') : '');

/**
 * Itens lidos viram linhas da conferência. Categoria com o mesmo nome de uma já na conferência
 * (outra página do mesmo cardápio) entra no mesmo grupo. Item repetido vem desmarcado.
 */
export function toDrafts(
  cats: ImportedCategory[],
  current: DraftItem[] = [],
  inMenu: Set<string> = new Set(),
): DraftItem[] {
  const groups = new Map(current.map((d) => [nameKey(d.category), d.group]));
  const seen = new Set(current.map((d) => nameKey(d.name)));
  const out: DraftItem[] = [];
  for (const c of cats) {
    const gk = nameKey(c.name);
    let group = groups.get(gk);
    if (!group) {
      group = `g${++seq}`;
      groups.set(gk, group);
    }
    for (const i of c.items) {
      const k = nameKey(i.name);
      const dup = inMenu.has(k) ? 'menu' : seen.has(k) ? 'import' : undefined;
      seen.add(k);
      out.push({
        key: `d${++seq}`,
        group,
        category: c.name,
        name: i.name,
        description: i.description ?? '',
        price: brPrice(i.price),
        // Sem preço no cardápio: a pessoa digita o preço para o item entrar. Repetido: desmarcado.
        on: !!i.price && !dup,
        ...(dup ? { dup } : {}),
        ...(i.imageUrl ? { photoUrl: i.imageUrl, thumb: externalImage(i.imageUrl) } : {}),
        ...(i.stock !== undefined
          ? {
              stock: i.stock ? String(i.stock.qty) : '',
              stockMin: i.stock ? String(i.stock.min) : '',
            }
          : {}),
      });
    }
  }
  return out;
}

/** Foto de outro site passando pelo Comandou (o navegador não baixa direto por causa do CORS). */
export const externalImage = (url: string) =>
  `/api/v1/menu-import/image?url=${encodeURIComponent(url)}`;

/** Baixa a foto de outro site (pelo Comandou) como arquivo, para reduzir e guardar. */
export async function fetchExternal(url: string, name = 'foto'): Promise<File> {
  const res = await fetch(externalImage(url), {
    credentials: 'same-origin',
    headers: { 'X-Comandou-Request': '1' },
  });
  if (!res.ok) throw new ApiError(res.status, 'Não consegui baixar a foto');
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type });
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

/** "30" → "30"; vazio, zero ou inválido → null (não controlar o estoque deste item). */
export function draftStock(v: string | undefined): string | null {
  const s = (v ?? '').replace(/\D/g, '');
  if (!s) return null;
  const n = Number(s);
  return n > 0 && n <= 99_999 ? String(n) : null;
}

export const readyDrafts = (list: DraftItem[]) =>
  list.filter((d) => d.on && d.name.trim() && draftPrice(d.price) !== null);

export interface SaveResult {
  created: number;
  failed: { key: string; name: string; message: string }[];
  /** Parou antes do fim (limite do plano, sem permissão, sem conexão): o motivo. */
  stopped: string | null;
  /** Linhas que entraram no cardápio, para sair da conferência. */
  savedKeys: string[];
}

/** Erros que se repetiriam em todos os itens seguintes: para de tentar. */
const stopsAll = (e: unknown) =>
  e instanceof ApiError && (e.status === 0 || e.status === 401 || e.status === 403);

/**
 * Grava os itens marcados pelo cadastro normal do cardápio (mesmas regras e limites do plano).
 * Categoria com o mesmo nome é aproveitada. `photo` vira a foto do item quando veio um prato só.
 */
export async function saveDrafts(
  list: DraftItem[],
  photo: File | null,
  onProgress?: (done: number, total: number) => void,
): Promise<SaveResult> {
  const ready = readyDrafts(list);
  const existing = await api<Category[]>('/categories');
  const byName = new Map(existing.map((c) => [nameKey(c.name), c.id]));
  let imageId: string | null = null;
  if (photo && ready.length === 1) {
    try {
      imageId = (await uploadImage(photo)).id;
    } catch {
      imageId = null; // a foto é um extra: sem ela, o item entra do mesmo jeito
    }
  }
  const failed: SaveResult['failed'] = [];
  const savedKeys: string[] = [];
  let stopped: string | null = null;
  for (const d of ready) {
    // Foto do próprio item (recortada do cardápio, do link ou criada pela IA). Falhou: entra sem.
    let itemImage = imageId;
    if (d.photo || d.photoUrl) {
      try {
        const f = d.photo ?? (await fetchExternal(d.photoUrl!, d.name));
        itemImage = (await uploadImage(f)).id;
      } catch {
        itemImage = null;
      }
    }
    try {
      const catName = d.category.trim() || 'Cardápio';
      let categoryId = byName.get(nameKey(catName));
      if (!categoryId) {
        const c = await api<Category>('/categories', { method: 'POST', json: { name: catName } });
        categoryId = c.id;
        byName.set(nameKey(catName), c.id);
      }
      const product = await api<Pick<Product, 'id'>>('/products', {
        method: 'POST',
        json: {
          categoryId,
          name: d.name.trim(),
          description: d.description.trim() || undefined,
          price: draftPrice(d.price),
          ...(itemImage ? { imageId: itemImage } : {}),
        },
      });
      savedKeys.push(d.key);
      // Estoque sugerido na criação pelo site: um extra; se falhar, o item já entrou.
      const qty = draftStock(d.stock);
      if (qty && product?.id) {
        const min = draftStock(d.stockMin);
        await api(`/stock/products/${product.id}/quantity`, {
          method: 'PUT',
          json: { quantity: qty, ...(min ? { minQuantity: min } : {}) },
        }).catch(() => undefined);
      }
    } catch (e) {
      if (stopsAll(e)) {
        stopped = (e as Error).message;
        break;
      }
      failed.push({ key: d.key, name: d.name, message: (e as Error).message });
    }
    onProgress?.(savedKeys.length + failed.length, ready.length);
  }
  return { created: savedKeys.length, failed, stopped, savedKeys };
}
