import { ApiError } from '../../lib/api';

/** Tipos e tamanhos aceitos na conversa (a API confere de novo). */
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const MAX_INPUT_IMAGE = 30 * 1024 * 1024;
const MAX_SIDE = 1600;

export type Sender = 'customer' | 'staff' | 'system';

export interface ChatFile {
  id: string;
  kind: 'image' | 'video';
  url: string;
  width: number | null;
  height: number | null;
  size: number;
}

export interface ChatTicket {
  id: string;
  /** #CH-0004 */
  code: string;
  title: string;
  statusLabel?: string;
  done?: boolean;
}

export interface ChatMessage {
  id: string;
  sender: Sender;
  authorName: string | null;
  body: string;
  file: ChatFile | null;
  fileGone: 'image' | 'video' | null;
  orderNumber: number | null;
  orderId: string | null;
  /** Chamado de que a mensagem fala (só na conversa com a Comandou). */
  ticket?: ChatTicket | null;
  createdAt: string;
  /** Só na tela: mensagem ainda indo (ou que falhou). */
  pending?: 'sending' | 'failed';
  localUrl?: string;
}

/** Arquivo pronto para subir: a foto já reduzida (WebP) ou o vídeo como veio. */
export interface Prepared {
  kind: 'image' | 'video';
  blob: Blob;
  previewUrl: string;
  width?: number;
  height?: number;
  name: string;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/** iPhone às vezes manda o vídeo sem tipo; o nome resolve. */
function videoType(file: File): string | null {
  if (VIDEO_TYPES.includes(file.type)) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'mp4' || ext === 'm4v') return 'video/mp4';
  if (ext === 'webm') return 'video/webm';
  return null;
}

/**
 * Prepara foto ou vídeo para a conversa. A foto é reduzida no próprio aparelho (lado maior até
 * 1600 px, WebP), então uma foto de 8 MB vira ~300 KB. O vídeo vai como foi gravado (até 20 MB).
 */
export async function prepareFile(file: File): Promise<Prepared> {
  const vt = file.type.startsWith('video/') || !file.type ? videoType(file) : null;
  if (vt) {
    if (file.size > MAX_VIDEO_BYTES)
      throw new Error(
        `Vídeo de ${(file.size / 1024 / 1024).toFixed(0)} MB: o máximo é 20 MB (uns 30 segundos). Grave um mais curto.`,
      );
    const blob = file.type === vt ? file : new Blob([file], { type: vt });
    return { kind: 'video', blob, previewUrl: URL.createObjectURL(blob), name: file.name };
  }
  if (file.type.startsWith('video/'))
    throw new Error('Formato de vídeo não aceito. Use MP4 ou MOV (o do celular).');
  if (!file.type.startsWith('image/')) throw new Error('Escolha uma foto ou um vídeo');
  if (file.size > MAX_INPUT_IMAGE) throw new Error('Foto muito grande (máximo 30 MB)');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Não foi possível ler esta foto. Tente JPG, PNG ou WebP.');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Seu navegador não conseguiu preparar a foto');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  let blob = await toBlob(canvas, 'image/webp', 0.84);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.86);
  if (!blob) throw new Error('Não foi possível preparar a foto');
  return {
    kind: 'image',
    blob,
    previewUrl: URL.createObjectURL(blob),
    width: w,
    height: h,
    name: file.name,
  };
}

/** Sobe o arquivo mostrando o progresso (vídeo grande demora no 4G). */
export function uploadFile(
  path: string,
  p: Prepared,
  onProgress?: (fraction: number) => void,
): Promise<{ id: string; kind: 'image' | 'video' }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const qs = p.width && p.height ? `?w=${p.width}&h=${p.height}` : '';
    xhr.open('POST', `/api/v1${path}${qs}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', p.blob.type);
    xhr.setRequestHeader('X-Comandou-Request', '1');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, 'Sem conexão. Tente de novo.'));
    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as { id: string; kind: 'image' });
      else
        reject(
          new ApiError(
            xhr.status,
            xhr.status === 413
              ? 'Arquivo grande demais'
              : ((body as { message?: string } | undefined)?.message ?? `Erro ${xhr.status}`),
          ),
        );
    };
    xhr.send(p.blob);
  });
}

/** Arquivos colados ou arrastados: só fotos e vídeos. */
export function mediaFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return [];
  const out: File[] = [];
  for (const it of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const f = it instanceof File ? it : it.kind === 'file' ? it.getAsFile() : null;
    if (f && (f.type.startsWith('image/') || f.type.startsWith('video/') || videoType(f)))
      out.push(f);
  }
  return out;
}
