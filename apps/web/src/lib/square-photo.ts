/**
 * Foto de perfil (cliente no cardápio e equipe em Conta › Meus dados): recorte quadrado no meio
 * e redução no navegador antes de enviar.
 */

/** Lado da foto do perfil enviada: 320 px, quadrada (recorte no meio). */
const SIDE = 320;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Recorta o meio da foto em quadrado e reduz para 320 px (WebP; JPEG se o navegador não tiver).
 * Foto de celular de 5 MB vira ~25 KB.
 */
export async function squarePhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Escolha uma foto (JPG, PNG ou WebP)');
  if (file.size > MAX_INPUT_BYTES) throw new Error('Foto muito grande (máximo 25 MB)');
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Não deu para ler esta foto. Tente outra em JPG ou PNG.');
  }
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(SIDE, side);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Seu navegador não conseguiu preparar a foto');
  g.imageSmoothingQuality = 'high';
  g.drawImage(
    bmp,
    (bmp.width - side) / 2,
    (bmp.height - side) / 2,
    side,
    side,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  bmp.close();
  let blob = await toBlob(canvas, 'image/webp', 0.85);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.86);
  if (!blob) throw new Error('Não deu para preparar a foto');
  return blob;
}
