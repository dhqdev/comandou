import { BRAND_EVENT } from '../../design-system';
import { api, ApiError } from '../../lib/api';
import type { StoreHour, StoreSettings } from '../../lib/types';
import { uploadImage } from '../../lib/media';
import { maskPhone } from '../CustomerPicker';
import {
  analyzeFile,
  existingNames,
  fetchExternal,
  saveDrafts,
  toDrafts,
  type DraftItem,
  type ImportedCategory,
  type SaveResult,
} from '../menu-import/menu-import';

/**
 * Primeiros passos pelo cardápio: a pessoa manda o link ou as fotos do cardápio e a IA devolve
 * itens, preços, fotos, cores, logo, contato, endereço e horário. Aqui junta o que veio de
 * várias páginas, recorta as fotos, tira a cor do logo e aplica tudo na loja de uma vez.
 */

export type Box = [number, number, number, number];

export interface ImportedStore {
  name: string | null;
  about: string | null;
  whatsapp: string | null;
  address: string | null;
  cep: string | null;
  city: string | null;
  state: string | null;
  hours: StoreHour[];
  brandColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  logoBox: Box | null;
  coverUrl: string | null;
  faviconUrl: string | null;
}

export const EMPTY_STORE: ImportedStore = {
  name: null,
  about: null,
  whatsapp: null,
  address: null,
  cep: null,
  city: null,
  state: null,
  hours: [],
  brandColor: null,
  accentColor: null,
  logoUrl: null,
  logoBox: null,
  coverUrl: null,
  faviconUrl: null,
};

interface ReadResult {
  store?: ImportedStore;
  categories?: ImportedCategory[];
  partial?: boolean;
}

/** Dados do cadastro do restaurante (feito pelo Comandou na contratação). */
export interface Signup {
  name: string | null;
  legalName: string | null;
  document: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
}

export const loadSignup = () => api<Signup>('/menu-import/signup').catch(() => null);

/** O que vale a pena mostrar e aplicar: o que a IA leu, editável pela pessoa. */
export interface StoreDraft {
  about: string;
  whatsapp: string;
  address: string;
  city: string;
  state: string;
  hours: StoreHour[];
  /** Ligar o horário automático (a loja abre e fecha sozinha). */
  useHours: boolean;
  brandColor: string | null;
  accentColor: string | null;
  /** Usar as cores também no sistema da equipe (não só na loja online). */
  brandStaff: boolean;
  logo: File | null;
  logoPreview: string | null;
  cover: File | null;
  coverPreview: string | null;
  /** Ícone do site (favicon): gerado do logo quando não vier um bom do link. */
  favicon: File | null;
}

/** Junta duas leituras (páginas do mesmo cardápio): o primeiro valor achado fica. */
export function mergeStore(a: ImportedStore, b: ImportedStore): ImportedStore {
  const pick = <K extends keyof ImportedStore>(k: K) => a[k] ?? b[k];
  return {
    name: pick('name'),
    about: pick('about'),
    whatsapp: pick('whatsapp'),
    address: pick('address'),
    cep: pick('cep'),
    city: pick('city'),
    state: pick('state'),
    hours: a.hours.length ? a.hours : b.hours,
    brandColor: pick('brandColor'),
    accentColor: pick('accentColor'),
    logoUrl: pick('logoUrl'),
    logoBox: pick('logoBox'),
    coverUrl: pick('coverUrl'),
    faviconUrl: pick('faviconUrl'),
  };
}

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** "Seg a Sex 18:00–23:00 · Sáb e Dom 18:00–00:00" (dias seguidos com o mesmo horário juntos). */
export function hoursLabel(hours: StoreHour[]): string {
  if (!hours.length) return '';
  const byDay = new Map<number, string>();
  for (const h of hours) {
    const t = `${h.open}–${h.close}`;
    byDay.set(h.day, byDay.has(h.day) ? `${byDay.get(h.day)}, ${t}` : t);
  }
  // Segunda primeiro, domingo no fim (como o restaurante fala).
  const order = [1, 2, 3, 4, 5, 6, 0];
  const runs: { from: number; to: number; t: string }[] = [];
  for (const d of order) {
    const t = byDay.get(d);
    if (!t) continue;
    const last = runs[runs.length - 1];
    const prev = order[order.indexOf(d) - 1];
    if (last && last.t === t && last.to === prev) last.to = d;
    else runs.push({ from: d, to: d, t });
  }
  return runs
    .map((r) => {
      const span =
        r.from === r.to
          ? DAYS[r.from]
          : order.indexOf(r.to) - order.indexOf(r.from) === 1
            ? `${DAYS[r.from]} e ${DAYS[r.to]}`
            : `${DAYS[r.from]} a ${DAYS[r.to]}`;
      return `${span} ${r.t}`;
    })
    .join(' · ');
}

// --------------------------------------------------------------------------- imagens

async function bitmapOf(file: Blob) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
}

function canvasFile(canvas: HTMLCanvasElement, name: string, type = 'image/webp') {
  return new Promise<File | null>((resolve) =>
    canvas.toBlob(
      (b) => resolve(b ? new File([b], name, { type: b.type }) : null),
      type,
      type === 'image/png' ? undefined : 0.88,
    ),
  );
}

/**
 * Recorta a foto do item da foto do cardápio. A caixa vem da IA em 0–1000; ganha uma folga de
 * 1% e fica quadrada (miniatura do cardápio), sem sair da foto.
 */
export async function cropBox(file: File, box: Box, name: string): Promise<File | null> {
  const bmp = await bitmapOf(file);
  if (!bmp) return null;
  const W = bmp.width;
  const H = bmp.height;
  const pad = 0.01;
  let top = (box[0] / 1000 - pad) * H;
  let left = (box[1] / 1000 - pad) * W;
  let bottom = (box[2] / 1000 + pad) * H;
  let right = (box[3] / 1000 + pad) * W;
  // Quadrado em volta do centro da caixa.
  const side = Math.min(Math.max(bottom - top, right - left), W, H);
  const cy = (top + bottom) / 2;
  const cx = (left + right) / 2;
  top = Math.min(Math.max(0, cy - side / 2), H - side);
  left = Math.min(Math.max(0, cx - side / 2), W - side);
  bottom = top + side;
  right = left + side;
  if (side < 48) {
    bmp.close();
    return null;
  }
  const out = Math.min(1200, Math.round(side));
  const c = document.createElement('canvas');
  c.width = out;
  c.height = out;
  const g = c.getContext('2d');
  if (!g) return null;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, left, top, side, side, 0, 0, out, out);
  bmp.close();
  return canvasFile(c, name);
}

/** Recorte do logo sem forçar quadrado (o logo pode ser largo). */
export async function cropRect(file: File, box: Box, name: string): Promise<File | null> {
  const bmp = await bitmapOf(file);
  if (!bmp) return null;
  const pad = 0.01;
  const x = Math.max(0, (box[1] / 1000 - pad) * bmp.width);
  const y = Math.max(0, (box[0] / 1000 - pad) * bmp.height);
  const w = Math.min(bmp.width - x, ((box[3] - box[1]) / 1000 + pad * 2) * bmp.width);
  const h = Math.min(bmp.height - y, ((box[2] - box[0]) / 1000 + pad * 2) * bmp.height);
  if (w < 24 || h < 24) {
    bmp.close();
    return null;
  }
  const scale = Math.min(1, 1200 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const g = c.getContext('2d');
  if (!g) return null;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, x, y, w, h, 0, 0, c.width, c.height);
  bmp.close();
  return canvasFile(c, name);
}

/**
 * Ícone do site (favicon e ícone do app): o logo inteiro no centro de um quadrado de 512 px,
 * com o fundo da cor do canto do logo (logo com fundo próprio continua igual).
 */
export async function squareIcon(file: Blob): Promise<File | null> {
  const bmp = await bitmapOf(file);
  if (!bmp) return null;
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  // Cor do canto do logo vira o fundo (transparente fica branco).
  const probe = document.createElement('canvas');
  probe.width = 4;
  probe.height = 4;
  const pg = probe.getContext('2d');
  pg?.drawImage(bmp, 0, 0, 4, 4);
  const px = pg?.getImageData(0, 0, 1, 1).data;
  g.fillStyle = px && px[3]! > 200 ? `rgb(${px[0]}, ${px[1]}, ${px[2]})` : '#ffffff';
  g.fillRect(0, 0, S, S);
  const fit = Math.min((S * 0.86) / bmp.width, (S * 0.86) / bmp.height);
  const w = bmp.width * fit;
  const h = bmp.height * fit;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, (S - w) / 2, (S - h) / 2, w, h);
  bmp.close();
  return canvasFile(c, 'icone.png', 'image/png');
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;

function hsl(r: number, g: number, b: number) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  let h = 0;
  if (max !== min) {
    const [R, G, B] = [r / 255, g / 255, b / 255];
    const d = max - min;
    h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

/**
 * Cores da marca tiradas de uma imagem (o logo): agrupa os pixels por tom, deixa de fora
 * branco, preto e cinza, e devolve a cor que mais aparece e uma segunda de outro tom.
 */
export async function imageColors(file: Blob): Promise<string[]> {
  const bmp = await bitmapOf(file);
  if (!bmp) return [];
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return [];
  g.drawImage(bmp, 0, 0, S, S);
  bmp.close();
  const data = g.getImageData(0, 0, S, S).data;
  const bins = new Map<number, { n: number; r: number; g: number; b: number; h: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const [r, gg, b, a] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
    if (a < 200) continue;
    const { h, s, l } = hsl(r, gg, b);
    if (s < 0.28 || l < 0.12 || l > 0.9) continue;
    const key = Math.round(h / 20) % 18;
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0, h };
    bin.n++;
    bin.r += r;
    bin.g += gg;
    bin.b += b;
    bins.set(key, bin);
  }
  const ranked = [...bins.values()]
    .filter((b) => b.n >= 12)
    .sort((a, b) => b.n - a.n)
    .map((b) => ({ hex: toHex(b.r / b.n, b.g / b.n, b.b / b.n), h: b.h }));
  const out: string[] = [];
  for (const r of ranked) {
    if (out.length === 2) break;
    const first = ranked[0]!;
    if (out.length === 1 && Math.min(Math.abs(r.h - first.h), 360 - Math.abs(r.h - first.h)) < 30)
      continue;
    out.push(r.hex);
  }
  return out;
}

// --------------------------------------------------------------------------- leitura

export interface Reading {
  store: ImportedStore;
  drafts: DraftItem[];
  partial: boolean;
}

/** Lê o link do cardápio. */
export async function readLink(url: string, current: Reading | null): Promise<Reading> {
  const [r, inMenu] = await Promise.all([
    api<ReadResult>('/menu-import/link', { method: 'POST', json: { url } }),
    existingNames(),
  ]);
  return combine(current, r, inMenu, null);
}

/** Lê uma foto (ou PDF) do cardápio e recorta as fotos dos itens que estiverem nela. */
export async function readFile(file: File, current: Reading | null): Promise<Reading> {
  const [r, inMenu] = await Promise.all([analyzeFile<ReadResult>(file, true), existingNames()]);
  const isImage = file.type.startsWith('image/');
  return combine(current, r, inMenu, isImage ? file : null);
}

async function combine(
  current: Reading | null,
  r: ReadResult,
  inMenu: Set<string>,
  source: File | null,
): Promise<Reading> {
  const cats = r.categories ?? [];
  const drafts = toDrafts(cats, current?.drafts ?? [], inMenu);
  if (source) {
    // A ordem das linhas é a mesma dos itens: cada item com caixa vira uma miniatura recortada.
    const items = cats.flatMap((c) => c.items);
    await Promise.all(
      drafts.map(async (d, i) => {
        const box = items[i]?.photoBox;
        if (!box) return;
        const f = await cropBox(source, box, d.name).catch(() => null);
        if (f) {
          d.photo = f;
          d.thumb = URL.createObjectURL(f);
        }
      }),
    );
  }
  const store = r.store ?? EMPTY_STORE;
  return {
    store: current ? mergeStore(current.store, store) : store,
    drafts: [...(current?.drafts ?? []), ...drafts],
    partial: (current?.partial ?? false) || !!r.partial,
  };
}

/**
 * Monta o rascunho da loja: baixa ou recorta o logo e a capa, tira as cores do logo quando a
 * IA não achou, e completa com o cadastro (telefone, cidade e UF).
 */
export async function storeDraft(
  s: ImportedStore,
  sources: File[],
  signup: Signup | null,
): Promise<StoreDraft> {
  let logo: File | null = null;
  if (s.logoUrl) logo = await fetchExternal(s.logoUrl, 'logo').catch(() => null);
  if (!logo && s.logoBox && sources[0])
    logo = await cropRect(sources[0], s.logoBox, 'logo').catch(() => null);
  let cover: File | null = null;
  if (s.coverUrl && s.coverUrl !== s.logoUrl)
    cover = await fetchExternal(s.coverUrl, 'capa').catch(() => null);
  let { brandColor, accentColor } = s;
  if (logo && (!brandColor || !accentColor)) {
    const [a, b] = await imageColors(logo).catch(() => [] as string[]);
    brandColor = brandColor ?? a ?? null;
    accentColor = accentColor ?? (b && b !== brandColor ? b : null);
  }
  // O ícone do site sai do logo (quadrado, nítido); sem logo, o ícone que o site já tinha.
  let favicon: File | null = logo ? await squareIcon(logo).catch(() => null) : null;
  if (!favicon && s.faviconUrl)
    favicon = await fetchExternal(s.faviconUrl, 'icone')
      .then((f) => squareIcon(f))
      .catch(() => null);
  const phone = s.whatsapp ?? signup?.phone ?? '';
  return {
    about: s.about ?? '',
    whatsapp: phone ? maskPhone(phone) : '',
    address: s.address ?? '',
    city: s.city ?? signup?.city ?? '',
    state: s.state ?? signup?.state ?? '',
    hours: s.hours,
    useHours: s.hours.length > 0,
    brandColor,
    accentColor,
    brandStaff: !!brandColor,
    logo,
    logoPreview: logo ? URL.createObjectURL(logo) : null,
    cover,
    coverPreview: cover ? URL.createObjectURL(cover) : null,
    favicon,
  };
}

// --------------------------------------------------------------------------- fotos pela IA

/** Foto ilustrativa criada pela IA para um item sem foto. */
export async function aiPhoto(d: DraftItem): Promise<File> {
  let res: Response;
  try {
    res = await fetch('/api/v1/menu-import/photo', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Comandou-Request': '1' },
      body: JSON.stringify({
        name: d.name.trim(),
        description: d.description.trim() || null,
        category: d.category.trim() || null,
      }),
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor');
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new ApiError(res.status, j?.message ?? 'A IA não conseguiu criar a foto');
  }
  const blob = await res.blob();
  return new File([blob], d.name, { type: blob.type });
}

// --------------------------------------------------------------------------- aplicar

export interface ApplyResult extends SaveResult {
  /** O que entrou na loja (para a conversa não perguntar de novo). */
  saved: { whatsapp: boolean; address: boolean; identity: boolean; location: boolean };
  warnings: string[];
}

const upload = async (f: File | null) => (f ? (await uploadImage(f)).id : null);

/**
 * Aplica a loja (identidade, contato, endereço, ponto no mapa, horário) e depois os itens, pelo
 * mesmo cadastro das telas (mesmas regras e limites do plano).
 */
export async function applyAll(
  d: StoreDraft,
  drafts: DraftItem[],
  onStep: (label: string, done?: number, total?: number) => void,
): Promise<ApplyResult> {
  const warnings: string[] = [];
  const patch: Omit<Partial<StoreSettings>, 'storeLat' | 'storeLng'> & {
    storeLat?: number;
    storeLng?: number;
  } = {};

  onStep('Guardando o logo e as cores');
  const [logoId, coverId, iconId] = await Promise.all([
    upload(d.logo).catch(() => null),
    upload(d.cover).catch(() => null),
    upload(d.favicon).catch(() => null),
  ]);
  if (d.logo && !logoId) warnings.push('Não consegui guardar o logo. Coloque em Loja online.');
  if (logoId) patch.logoImageId = logoId;
  if (coverId) patch.coverImageId = coverId;
  if (iconId) patch.faviconImageId = iconId;
  if (d.brandColor) {
    patch.brandColor = d.brandColor;
    patch.accentColor = d.accentColor;
    patch.brandStaffApp = d.brandStaff;
  }
  if (d.about.trim()) patch.about = d.about.trim().slice(0, 500);
  const phone = d.whatsapp.replace(/\D/g, '');
  if (phone.length >= 10) patch.whatsapp = maskPhone(phone);
  if (d.address.trim()) patch.address = d.address.trim().slice(0, 300);
  if (d.city.trim()) patch.city = d.city.trim().slice(0, 80);
  if (/^[A-Za-z]{2}$/.test(d.state.trim())) patch.state = d.state.trim().toUpperCase();
  if (d.useHours && d.hours.length) {
    patch.hours = d.hours;
    patch.hoursEnabled = true;
  }

  // Ponto da loja no mapa: entregas (taxa por distância) e o QR da mesa usam.
  let location = false;
  if (patch.address) {
    onStep('Achando a loja no mapa');
    const q = [patch.address, patch.city, patch.state].filter(Boolean).join(', ');
    const hit = await api<{ lat: number; lng: number }[]>(`/geocode?q=${encodeURIComponent(q)}`)
      .then((r) => r[0] ?? null)
      .catch(() => null);
    if (hit) {
      patch.storeLat = hit.lat;
      patch.storeLng = hit.lng;
      location = true;
    } else warnings.push('Não achei o endereço no mapa. Marque a loja em Entregas › Áreas.');
  }

  onStep('Salvando os dados da loja');
  try {
    await api('/store/settings', { method: 'PATCH', json: patch });
    // O sistema todo (ícone da aba, cores, logo do menu) veste a marca na hora.
    window.dispatchEvent(new CustomEvent(BRAND_EVENT));
  } catch (e) {
    warnings.push(`Os dados da loja não foram salvos: ${(e as Error).message}`);
  }

  onStep('Cadastrando os itens', 0, drafts.filter((x) => x.on).length);
  const r = await saveDrafts(drafts, null, (done, total) =>
    onStep('Cadastrando os itens', done, total),
  );
  return {
    ...r,
    warnings,
    saved: {
      whatsapp: !!patch.whatsapp,
      address: !!patch.address,
      identity: !!(patch.logoImageId || patch.brandColor),
      location,
    },
  };
}
