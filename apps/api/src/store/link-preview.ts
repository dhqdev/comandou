/**
 * Prévia do link do cardápio (WhatsApp, Instagram, Telegram, iMessage...). Esses robôs não rodam
 * JavaScript: leem só as tags do HTML. O Nginx manda o robô para cá (só ele; a pessoa abre o
 * cardápio normal), e esta página leva o nome, a descrição e a foto da loja, e não as do Comandou.
 */
import { createHash } from 'node:crypto';

export interface LinkPreview {
  title: string;
  description: string;
  /** Endereço absoluto da imagem (capa da loja, senão a logo; no produto, a foto dele). */
  image: string | null;
  imageType: string | null;
  /** Tamanho da imagem em px: o WhatsApp e o Facebook montam o cartão sem esperar a foto. */
  imageWidth?: number | null;
  imageHeight?: number | null;
  /** Ícone da aba (favicon, senão a logo). Sem o campo, vale a própria imagem. */
  icon?: string | null;
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

/** O único script da prévia: leva a pessoa para o cardápio. */
export function previewScript(target: string): string {
  return `location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')});`;
}

/** CSP da prévia: só o script acima (pelo hash), sem nada de fora. */
export function previewCsp(target: string): string {
  const hash = createHash('sha256').update(previewScript(target)).digest('base64');
  return `default-src 'none'; script-src 'sha256-${hash}'; img-src https: data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
}

export function linkPreviewHtml(p: LinkPreview): string {
  const t = esc(p.title);
  const d = esc(p.description);
  const img = p.image ? esc(p.image) : null;
  const icon = p.icon === undefined ? img : p.icon ? esc(p.icon) : null;
  const w = p.imageWidth && p.imageWidth > 0 ? Math.round(p.imageWidth) : null;
  const h = p.imageHeight && p.imageHeight > 0 ? Math.round(p.imageHeight) : null;
  // Foto deitada (a capa) vira o cartão grande; quadrada fica no resumo com a imagem ao lado.
  const wide = !!(img && w && h && w / h >= 1.5);
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
          ...(w && h
            ? [
                `<meta property="og:image:width" content="${w}" />`,
                `<meta property="og:image:height" content="${h}" />`,
              ]
            : []),
          `<meta property="og:image:alt" content="${t}" />`,
          `<meta name="twitter:image" content="${img}" />`,
        ]
      : []),
    ...(icon
      ? [`<link rel="icon" href="${icon}" />`, `<link rel="apple-touch-icon" href="${icon}" />`]
      : []),
    `<meta name="twitter:card" content="${wide ? 'summary_large_image' : 'summary'}" />`,
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
<script>${previewScript(p.target)}</script>
</head>
<body>
<p><a href="${target}">${t}</a></p>
<p>${d}</p>
</body>
</html>
`;
}
