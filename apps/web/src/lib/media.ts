import { ApiError } from './api';

/** URL pública de uma foto guardada no Comandou (ou null). */
export const mediaUrl = (id: string | null | undefined) => (id ? `/api/v1/media/${id}` : null);

const MAX_SIDE = 1600;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Reduz a foto no próprio navegador (lado maior até 1600 px, WebP ~85%) e envia para a API.
 * Fotos de celular de 5–10 MB viram ~150–400 KB, carregam rápido no cardápio e ocupam pouco banco.
 * Navegadores sem WebP no canvas caem para JPEG.
 */
export async function uploadImage(file: File): Promise<{ id: string; url: string }> {
  if (!file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem');
  if (file.size > MAX_INPUT_BYTES) throw new Error('Imagem muito grande (máximo 25 MB)');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Não foi possível ler esta imagem. Tente uma foto JPG, PNG ou WebP.');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Seu navegador não conseguiu processar a imagem');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  let blob = await toBlob(canvas, 'image/webp', 0.85);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.86);
  if (!blob) throw new Error('Não foi possível preparar a imagem');

  let res: Response;
  try {
    res = await fetch(`/api/v1/media?w=${w}&h=${h}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': blob.type, 'X-Comandou-Request': '1', Accept: 'application/json' },
      body: blob,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor');
  }
  const body = await res.json().catch(() => undefined);
  if (!res.ok)
    throw new ApiError(
      res.status,
      (body as { message?: string } | undefined)?.message ?? `Erro ${res.status}`,
    );
  return body as { id: string; url: string };
}
