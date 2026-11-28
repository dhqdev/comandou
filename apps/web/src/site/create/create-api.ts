import { shrinkImage } from '../../lib/media';

/**
 * Chamadas e formatos da criação do restaurante pelo site (campo único na página inicial e a
 * conversa em /criar). A IA lê cada parte (texto, links, fotos, PDF) e soma num rascunho que fica
 * no servidor; o navegador só guarda o token dele (`claim`).
 */

export interface MenuItemOut {
  name: string;
  description: string | null;
  price: string | null;
  imageUrl?: string | null;
  /** undefined = ainda sem sugestão; null = sem controle (peso, rodízio, adicional). */
  stock?: { qty: number; min: number } | null;
}

/** Resposta de cada parte do campo único (texto ou arquivo). */
export interface Composed {
  claim: string;
  kind: string | null;
  site: {
    name: string | null;
    tagline: string | null;
    about: string | null;
    brandColor: string | null;
    accentColor: string | null;
    logoUrl: string | null;
    coverUrl: string | null;
    suggested: boolean;
    items: number;
  };
  menu: {
    items: number;
    suggested: boolean;
    stockPending: boolean;
    categories: { name: string; items: MenuItemOut[] }[];
  };
  legal: { document: string | null; legalName: string | null };
  store: {
    address: string | null;
    city: string | null;
    state: string | null;
    cep: string | null;
    whatsapp: string | null;
    hours: number;
  };
  parts: number;
  files: string[];
}

export interface Created {
  token: string;
  entry: string;
  slug: string;
  url: string;
  email: string;
  password: string;
  trialDays: number;
  trialEndsAt: string;
  emailOn: boolean;
}

export interface ContractState {
  url: string | null;
  signed: boolean;
  reason: string | null;
  loading: boolean;
}

const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'X-Comandou-Request': '1',
};

export async function answer<T>(r: Response): Promise<T> {
  const data = (await r.json().catch(() => ({}))) as { message?: string | string[] };
  if (!r.ok) {
    const m = Array.isArray(data.message) ? data.message[0] : data.message;
    throw new Error(
      r.status === 429
        ? 'Muitas tentativas agora. Espere um pouco e tente de novo.'
        : r.status === 413
          ? 'Arquivo grande demais. Mande uma foto ou um PDF menor.'
          : (m ?? 'Não deu certo agora. Tente de novo.'),
    );
  }
  return data as T;
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  return answer<T>(
    await fetch(`/api/v1/public/site/${path}`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
    }),
  );
}

/** Esta visita ao site: junta as partes e o cardápio ao restaurante criado no fim. */
const SESSION_KEY = 'cm:site-session';
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function siteSession(): string {
  const fresh = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => ID_CHARS[b & 63]).join('');
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved && /^[A-Za-z0-9_-]{16,64}$/.test(saved)) return saved;
    const id = fresh();
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return fresh();
  }
}

/** Foto ou PDF até 3 MB (o limite da API). Logo em PNG pequeno vai como está (transparência). */
export const FILE_MAX = 3 * 1024 * 1024;
export const MAX_FILES = 8;
export const FILE_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf,.pdf';
export const isPdf = (f: File) =>
  f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
export async function fileBody(file: File): Promise<{ body: Blob; type: string }> {
  if (isPdf(file)) {
    if (file.size > FILE_MAX)
      throw new Error('O PDF tem mais de 3 MB. Mande as páginas como fotos ou um PDF menor.');
    return { body: file, type: 'application/pdf' };
  }
  if (file.type === 'image/png' && file.size <= 500 * 1024)
    return { body: file, type: 'image/png' };
  let img = await shrinkImage(file, 2000);
  if (img.blob.size > FILE_MAX) img = await shrinkImage(file);
  return { body: img.blob, type: img.blob.type };
}

/** Manda um arquivo do campo único (foto ou PDF) e devolve o rascunho somado. */
export async function composeFile(
  file: File,
  o: { session: string; claim?: string },
): Promise<Composed> {
  const { body, type } = await fileBody(file);
  const q = new URLSearchParams({ sessao: o.session, nome: file.name.slice(0, 100) });
  if (o.claim) q.set('rascunho', o.claim);
  return answer<Composed>(
    await fetch(`/api/v1/public/site/compose/file?${q}`, {
      method: 'POST',
      headers: { 'Content-Type': type, Accept: 'application/json', 'X-Comandou-Request': '1' },
      body,
    }),
  );
}

/** Links escritos no campo (para mostrar o que a IA vai abrir). */
export const LINK_RE =
  /\b((?:https?:\/\/|www\.)[^\s<>"']+|[a-z0-9][a-z0-9-]{1,62}\.(?:com\.br|com|net\.br|net|app|site|menu|food|delivery)(?:\/[^\s<>"']*)?)/gi;
export function linksOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(LINK_RE)) {
    const u = m[1]!.replace(/[),.;!?]+$/, '');
    if (!out.includes(u)) out.push(u);
  }
  return out.slice(0, 3);
}
export const shortLink = (u: string) =>
  u
    .replace(/^https?:\/\/(www\.)?/i, '')
    .replace(/\/$/, '')
    .slice(0, 34);

/** "12345678000190" → "12.345.678/0001-90"; "12345678901" → "123.456.789-01". */
export function maskDocument(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11)
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

/** "11987654321" → "(11) 98765-4321". */
export function maskPhone(v: string) {
  const d = v
    .replace(/\D/g, '')
    .replace(/^55(?=\d{10,11}$)/, '')
    .slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** "24.90" → "24,90" (como a pessoa digita) e de volta. */
export const toBr = (p: string | null | undefined) => (p ? p.replace('.', ',') : '');
export function fromBr(v: string): string | null {
  const t = v
    .replace(/[^\d,.]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 999_999) return null;
  return n.toFixed(2);
}

/** Logo trocado na conversa: quadrado pequeno em WebP (vai junto da criação, sem passar de ~60 KB). */
export async function smallLogo(file: File): Promise<string> {
  const { blob } = await shrinkImage(file, 320);
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Não consegui abrir a imagem'));
    r.readAsDataURL(blob);
  });
}

/** Duas cores que aparecem no logo (para sugerir as cores da loja). */
export async function logoColors(src: string): Promise<string[]> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  const s = 48;
  c.width = s;
  c.height = s;
  const g = c.getContext('2d');
  if (!g) return [];
  g.drawImage(img, 0, 0, s, s);
  const px = g.getImageData(0, 0, s, s).data;
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < px.length; i += 4) {
    const [r, gg, b, a] = [px[i]!, px[i + 1]!, px[i + 2]!, px[i + 3]!];
    if (a < 200) continue;
    const max = Math.max(r, gg, b);
    const min = Math.min(r, gg, b);
    // Sem branco, preto e cinza: a cor da marca.
    if (max < 40 || min > 215 || max - min < 40) continue;
    const k = `${r >> 5}-${gg >> 5}-${b >> 5}`;
    const cur = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    buckets.set(k, { n: cur.n + 1, r: cur.r + r, g: cur.g + gg, b: cur.b + b });
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return [...buckets.values()]
    .sort((a, z) => z.n - a.n)
    .slice(0, 2)
    .map((x) => `#${hex(x.r / x.n)}${hex(x.g / x.n)}${hex(x.b / x.n)}`);
}
