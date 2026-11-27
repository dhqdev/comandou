import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { mediaUrl } from '../lib/media';

/**
 * IA nas fotos e no 3D dos itens do cardápio (API em apps/api/src/catalog/item-ai.*): a foto vai
 * reduzida em JPEG e volta a sugestão de retoque (feito aqui no navegador), a foto com fundo
 * limpo ou o modelo 3D montado pelo servidor.
 */

export interface CatalogAiStatus {
  photo: boolean;
  model3d: boolean;
  reason: string | null;
}

export interface PhotoAdjust {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
}
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface PhotoTips {
  score: number;
  summary: string;
  tips: string[];
  adjust: PhotoAdjust;
  crop: Box | null;
  background: 'ok' | 'busy' | 'dark';
  cleanWorth: boolean;
}

export type DishKind = 'plate' | 'bowl' | 'glass' | 'cup' | 'stack' | 'slice' | 'box' | 'other';
export interface DishShape {
  kind: DishKind;
  view: 'top' | 'angle' | 'side';
  box: Box;
  food: Box | null;
  diameterCm: number;
  heightCm: number;
  foodHeightCm: number;
  profile: [number, number][] | null;
}
export interface Generated3D {
  shape: DishShape;
  byAi: boolean;
  /** O lanche foi recortado da foto: o 3D segue o contorno dele, sem o fundo. */
  cutout?: boolean;
  size: { widthCm: number; heightCm: number };
  bytes: number;
  glb: string;
}

let statusCache: Promise<CatalogAiStatus> | null = null;

/** Se a IA das fotos e do 3D está liberada (uma consulta por abertura do app). */
export function useCatalogAi(enabled = true): CatalogAiStatus | null {
  const [s, setS] = useState<CatalogAiStatus | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    statusCache ??= api<CatalogAiStatus>('/catalog-ai').catch(() => {
      statusCache = null;
      return { photo: false, model3d: false, reason: null };
    });
    void statusCache.then((v) => alive && setS(v));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return s;
}

/** Abre a foto (arquivo escolhido ou a já salva no Comandou) para desenhar no canvas. */
export async function loadBitmap(src: Blob | string): Promise<ImageBitmap> {
  let blob: Blob;
  if (typeof src === 'string') {
    const url = mediaUrl(src);
    if (!url) throw new Error('O item não tem foto');
    const res = await fetch(url, { credentials: 'same-origin' }).catch(() => null);
    if (!res?.ok) throw new Error('Não deu para abrir a foto do item');
    blob = await res.blob();
  } else blob = src;
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Não foi possível ler esta foto. Tente uma JPG, PNG ou WebP.');
  }
}

/** A foto em JPEG, com o lado maior em até `maxSide` px (e o corte, se houver). */
export function canvasOf(
  img: ImageBitmap,
  maxSide: number,
  crop: Box | null = null,
): HTMLCanvasElement {
  const sx = crop ? crop.x0 * img.width : 0;
  const sy = crop ? crop.y0 * img.height : 0;
  const sw = crop ? (crop.x1 - crop.x0) * img.width : img.width;
  const sh = crop ? (crop.y1 - crop.y0) * img.height : img.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const g = c.getContext('2d');
  if (!g) throw new Error('Seu navegador não conseguiu preparar a foto');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

export function jpegOf(c: HTMLCanvasElement, quality = 0.88): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Não foi possível preparar a foto'))),
      'image/jpeg',
      quality,
    ),
  );
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Retoque leve, pixel a pixel (sem `ctx.filter`, que o Safari não tem): luz por curva (sem
 * estourar o branco), contraste em volta do meio, saturação pela luminância e temperatura
 * puxando vermelho × azul. `strength` escala tudo (0 = foto original).
 */
export function tunePixels(d: Uint8ClampedArray, a: PhotoAdjust, strength = 1): void {
  const b = a.brightness * strength;
  const c = a.contrast * strength;
  const s = a.saturation * strength;
  const w = a.warmth * strength;
  if (!b && !c && !s && !w) return;
  // Curva de luz + contraste num quadro de 256 valores.
  const gamma = 1 / Math.max(0.4, 1 + 1.6 * b);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    let x = Math.pow(i / 255, gamma);
    x = (x - 0.5) * (1 + c) + 0.5;
    lut[i] = clamp01(x);
  }
  const warmR = 1 + 0.12 * w;
  const warmB = 1 - 0.12 * w;
  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]!]!;
    let g = lut[d[i + 1]!]!;
    let bl = lut[d[i + 2]!]!;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    r = lum + (r - lum) * (1 + s);
    g = lum + (g - lum) * (1 + s);
    bl = lum + (bl - lum) * (1 + s);
    d[i] = clamp01(r * warmR) * 255;
    d[i + 1] = clamp01(g) * 255;
    d[i + 2] = clamp01(bl * warmB) * 255;
  }
}

/** A foto com o retoque aplicado (e o corte), pronta para mostrar ou salvar. */
export function tuned(
  img: ImageBitmap,
  a: PhotoAdjust,
  opts: { strength?: number; crop?: Box | null; maxSide?: number } = {},
): HTMLCanvasElement {
  const c = canvasOf(img, opts.maxSide ?? 1600, opts.crop ?? null);
  const g = c.getContext('2d')!;
  const data = g.getImageData(0, 0, c.width, c.height);
  tunePixels(data.data, a, opts.strength ?? 1);
  g.putImageData(data, 0, 0);
  return c;
}

/** Manda a foto (corpo = o arquivo) e lê a resposta: JSON ou a foto que voltou. */
async function sendPhoto(path: string, photo: Blob, as: 'json' | 'blob') {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': photo.type || 'image/jpeg',
        'X-Comandou-Request': '1',
        Accept: as === 'json' ? 'application/json' : 'image/*',
      },
      body: photo,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new ApiError(res.status, body?.message ?? `Erro ${res.status}`, body);
  }
  return as === 'json' ? res.json() : res.blob();
}

export const photoTips = (photo: Blob, item: string) =>
  sendPhoto(
    `/catalog-ai/photo/tips?item=${encodeURIComponent(item)}`,
    photo,
    'json',
  ) as Promise<PhotoTips>;

export const photoClean = (photo: Blob, item: string) =>
  sendPhoto(
    `/catalog-ai/photo/clean?item=${encodeURIComponent(item)}`,
    photo,
    'blob',
  ) as Promise<Blob>;

/** Monta o 3D pela foto. Com `shape`, monta de novo sem IA (não gasta tokens). */
export const generate3D = (productId: string, photo: Blob, shape?: DishShape) =>
  sendPhoto(
    `/products/${productId}/model/generate${
      shape ? `?forma=${encodeURIComponent(JSON.stringify(shape))}` : ''
    }`,
    photo,
    'json',
  ) as Promise<Generated3D>;

export function glbBlob(base64: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'model/gltf-binary' });
}

/** Foto do item criada do zero pela IA, pelo nome e pela descrição (volta a foto). */
export async function photoCreate(name: string, description?: string | null): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch('/api/v1/catalog-ai/photo/create', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Comandou-Request': '1',
        Accept: 'image/*',
      },
      body: JSON.stringify({
        name: name.trim().slice(0, 120),
        ...(description?.trim() ? { description: description.trim().slice(0, 500) } : {}),
      }),
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new ApiError(res.status, body?.message ?? `Erro ${res.status}`, body);
  }
  return res.blob();
}
