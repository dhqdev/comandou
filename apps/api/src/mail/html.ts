/**
 * Texto ⇄ HTML dos e-mails. O que se escreve no painel é texto simples: aqui ele vira um HTML
 * de e-mail (parágrafos, links e a citação da mensagem respondida). O HTML que CHEGA de fora
 * nunca é confiado: a tela o mostra numa moldura isolada (sandbox, sem scripts e sem origem),
 * com a política de conteúdo de `frameDocument`.
 */

export const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

/** Texto simples → HTML: escapa tudo, liga os endereços http(s) e mantém as quebras de linha. */
export function textToHtml(text: string): string {
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  return paragraphs
    .map((p) => {
      let out = '';
      let last = 0;
      for (const m of p.matchAll(URL_RE)) {
        out += esc(p.slice(last, m.index));
        out += `<a href="${esc(m[0])}">${esc(m[0])}</a>`;
        last = m.index + m[0].length;
      }
      out += esc(p.slice(last));
      return `<p style="margin:0 0 14px">${out.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** HTML → texto corrido (para o resumo da lista, a busca e a citação). Não é um sanitizador. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n: string) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => safeChar(Number.parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeChar(n: number): string {
  return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}

export const snippetOf = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 200);

/** Corpo de um e-mail escrito no painel: texto + assinatura (+ a mensagem respondida citada). */
export function composeHtml(
  text: string,
  signature: string,
  quoted?: { header: string; html: string; text: string },
): string {
  const sig = signature.trim()
    ? `<p style="margin:18px 0 0;color:#5d5d65;white-space:pre-line">${esc(signature.trim())}</p>`
    : '';
  const quote = quoted
    ? `<p style="margin:22px 0 6px;color:#5d5d65;font-size:13px">${esc(quoted.header)}</p>
<blockquote style="margin:0;padding:0 0 0 12px;border-left:2px solid #d4d4d8;color:#3f3f46">${
        quoted.html ? stripDocument(quoted.html) : textToHtml(quoted.text)
      }</blockquote>`
    : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body style="margin:0;padding:16px;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
${textToHtml(text)}${sig}${quote}
</body></html>`;
}

export function composeText(
  text: string,
  signature: string,
  quoted?: { header: string; text: string },
): string {
  const parts = [text.trim()];
  if (signature.trim()) parts.push(signature.trim());
  if (quoted)
    parts.push(
      `${quoted.header}\n${quoted.text
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')}`,
    );
  return parts.filter(Boolean).join('\n\n');
}

/** Só o miolo do <body> de um HTML completo (para citar dentro de outro e-mail). */
export function stripDocument(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html);
  return (body ? body[1]! : html)
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\/?(html|head|body)\b[^>]*>/gi, '')
    .replace(
      /<(script|style|title|meta|link|base|iframe|object|embed|form)\b[\s\S]*?<\/\1\s*>/gi,
      '',
    )
    .replace(/<(script|meta|link|base|iframe|object|embed|form|input)\b[^>]*>/gi, '');
}

/**
 * Documento que a tela põe na moldura isolada. A política de conteúdo vem PRIMEIRO no <head> e
 * vale para tudo o que vier depois: nada de script, moldura, formulário, fonte ou rede. Imagem
 * de fora só carrega quando quem lê pede (`remoteImages`): é assim que o remetente saberia que
 * o e-mail foi aberto. Imagens anexadas (cid:) viram data: e sempre aparecem.
 */
export function frameDocument(
  html: string,
  opts: { remoteImages: boolean; inline?: Map<string, string> },
): string {
  let body = stripDocument(html);
  if (opts.inline?.size)
    body = body.replace(/(["'(])cid:([^"')\s>]+)/gi, (m, q: string, id: string) => {
      const data = opts.inline!.get(id.toLowerCase());
      return data ? `${q}${data}` : m;
    });
  const img = opts.remoteImages ? 'data: https:' : 'data:';
  const csp = `default-src 'none'; img-src ${img}; style-src 'unsafe-inline'; font-src data:`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>html{color-scheme:light}body{margin:0;padding:16px;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;color:#18181b;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a{color:#b02a00}blockquote{margin:0;padding-left:12px;border-left:2px solid #d4d4d8}</style></head><body>${body}</body></html>`;
}

/** O HTML pede imagens de fora? (para mostrar o botão "Mostrar imagens"). */
export const hasRemoteImages = (html: string) =>
  /<img\b[^>]*\ssrc\s*=\s*["']?\s*https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html);
