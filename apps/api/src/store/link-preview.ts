/**
 * Prévia do link do cardápio (WhatsApp, Instagram, Telegram, iMessage...). Esses robôs não rodam
 * JavaScript: leem só as tags do HTML. O Nginx manda o robô para cá (só ele; a pessoa abre o
 * cardápio normal), e esta página leva o nome, a descrição e a foto da loja, e não as do Comandou.
 */

export interface LinkPreview {
  title: string;
  description: string;
  /** Endereço absoluto da imagem (logo da loja, capa ou foto do produto). */
  image: string | null;
  imageType: string | null;
  /** Onde a pessoa que abrir esta página deve cair (o cardápio). */
  target: string;
  siteName: string;
}

/** Caminhos aceitos: o cardápio e as telas dele. Qualquer outra coisa vira o início do cardápio. */
const PATH_RE = /^\/pedir(\/[A-Za-z0-9/_-]{0,120})?$/;
export const PRODUCT_PATH_RE =
  /^\/pedir\/produto\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

export function previewPath(raw: unknown): string {
  return typeof raw === 'string' && PATH_RE.test(raw) ? raw : '/pedir';
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Uma linha só, sem espaços sobrando, no tamanho que os apps mostram. */
export function oneLine(s: string | null | undefined, max = 200): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function linkPreviewHtml(p: LinkPreview): string {
  const t = esc(p.title);
  const d = esc(p.description);
  const img = p.image ? esc(p.image) : null;
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(p.siteName)}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:locale" content="pt_BR" />`,
    ...(img
      ? [
          `<meta property="og:image" content="${img}" />`,
          `<meta property="og:image:secure_url" content="${img}" />`,
          ...(p.imageType
            ? [`<meta property="og:image:type" content="${esc(p.imageType)}" />`]
            : []),
          `<meta property="og:image:alt" content="${t}" />`,
          `<meta name="twitter:image" content="${img}" />`,
          `<link rel="icon" href="${img}" />`,
          `<link rel="apple-touch-icon" href="${img}" />`,
        ]
      : []),
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
  ];
  const target = esc(p.target);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${t}</title>
<meta name="description" content="${d}" />
<meta name="robots" content="noindex" />
${tags.join('\n')}
<script>location.replace(${JSON.stringify(p.target).replace(/</g, '\\u003c')});</script>
</head>
<body>
<p><a href="${target}">${t}</a></p>
<p>${d}</p>
</body>
</html>
`;
}
