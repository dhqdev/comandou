import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OutgoingAttachment } from './providers';

/**
 * Imagens do próprio Comandou (a capa de cada assunto e o ícone) vão **dentro** do e-mail, como
 * anexo embutido do Resend (`content_id`, referenciado no HTML por `cid:`). Assim a logo aparece
 * sem depender do site no ar nem do cliente liberar imagens de fora (o Outlook bloqueia as de
 * link, não as embutidas).
 *
 * O HTML guardado na fila e a prévia do Super Admin continuam com o link do site: a troca é feita
 * só na hora de entregar. Os arquivos ficam em apps/api/assets/email (cópia dos de
 * apps/web/public, gerados por tools/email-pandas/render.mjs).
 */
export const INLINE_DIR = join(__dirname, '..', '..', 'assets', 'email');

/** `src` de imagem nossa: qualquer endereço do site + um dos caminhos conhecidos. */
const OURS = /src="https?:\/\/[^"\s]+?\/(icons\/icon-192\.png|email\/hero-[a-z]+\.jpg)"/g;

const cache = new Map<string, Buffer | null>();

function file(name: string, dir: string): Buffer | null {
  const key = join(dir, name);
  if (!cache.has(key)) cache.set(key, existsSync(key) ? readFileSync(key) : null);
  return cache.get(key)!;
}

export function inlineImages(
  html: string,
  dir: string = INLINE_DIR,
): { html: string; attachments: OutgoingAttachment[] } {
  const attachments = new Map<string, OutgoingAttachment>();
  const out = html.replace(OURS, (whole, path: string) => {
    const name = path.split('/').pop()!;
    const data = file(name, dir);
    // Arquivo ausente (instalação antiga): fica o link do site, como antes.
    if (!data) return whole;
    const cid = `${name.replace(/\.[a-z]+$/, '')}@comandou`;
    if (!attachments.has(cid))
      attachments.set(cid, {
        filename: name,
        contentType: name.endsWith('.png') ? 'image/png' : 'image/jpeg',
        contentId: cid,
        data,
      });
    return `src="cid:${cid}"`;
  });
  return { html: out, attachments: [...attachments.values()] };
}
