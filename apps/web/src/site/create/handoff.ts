/**
 * O que a pessoa escreveu e anexou no campo da página inicial vai para a conversa em /criar sem
 * recarregar (os arquivos não cabem no endereço nem no armazenamento do navegador).
 */
export interface Handoff {
  text: string;
  files: File[];
}

let pending: Handoff | null = null;

export function handOff(h: Handoff) {
  pending = h.text.trim() || h.files.length ? h : null;
}

/** Pega (uma vez só) o que veio da página inicial. */
export function takeHandoff(): Handoff | null {
  const h = pending;
  pending = null;
  return h;
}
