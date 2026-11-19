/**
 * Peças dos e-mails do Comandou: a moldura (cabeçalho com a marca, cartão, assinatura e rodapé) e
 * os blocos de dentro (botão, código, comanda de dados, números, passos, aviso).
 *
 * Desenho (0.179): papel de trabalho, sóbrio. Cartão branco com linha fina, texto alinhado à
 * esquerda, um botão laranja só, dados no jeito de uma comanda (rótulo à esquerda, valor à
 * direita, separados por tracejado) e o panda pequeno na assinatura, como quem assina o recado.
 * Nada de faixa colorida, caixa alta espaçada ou ilustração grande no topo.
 *
 * HTML de e-mail: tabelas, estilo na própria tag e fonte em propriedades separadas (o Outlook do
 * Windows ignora o atalho `font:`). O modo escuro vem de um `<style>` com `prefers-color-scheme`
 * (Apple Mail, iOS, Outlook.com com `[data-ogsc]`); onde ele não existe, o cliente escurece sozinho
 * e as cores claras continuam legíveis. Sem imagem, o e-mail continua inteiro: o ícone e o panda
 * têm tamanho fixo e texto alternativo vazio.
 */

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]!);

export const firstName = (n: string | null | undefined) => (n ?? '').trim().split(/\s+/)[0] ?? '';

export const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif`;
export const MONO = `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace`;

/** Fonte em propriedades separadas (o Outlook do Windows não lê `font:`). */
const f = (weight: number, size: number, line: number, family: string = FONT) =>
  `font-family:${family};font-size:${size}px;line-height:${line}px;font-weight:${weight};`;

/** Cores claras (o modo escuro troca pelas classes `em-*`, no azul-ardósia do app). */
export const C = {
  page: '#F5F4F2',
  card: '#FFFFFF',
  line: '#E8E5E1',
  dash: '#D9D4CE',
  ink: '#1C1917',
  muted: '#57534E',
  faint: '#8C8781',
  brand: '#E23A00',
  button: '#D63400',
  box: '#F7F6F4',
  warn: '#D97706',
  ok: '#16A34A',
  danger: '#DC2626',
  info: '#A8A29E',
} as const;

/** Poses do panda (apps/web/public/email/panda-<pose>.png), usado na assinatura. */
export type PandaPose = 'ola' | 'codigo' | 'relogio' | 'dormindo' | 'festa' | 'alerta' | 'contrato';

export interface Shell {
  /** Título da aba / do e-mail (não aparece no corpo). */
  title: string;
  /**
   * Linha que aparece ao lado do assunto na caixa de entrada e na notificação do celular. Para o
   * código, vai o próprio código: dá para copiar sem abrir o e-mail.
   */
  preheader: string;
  /** Site do Comandou (https://comandou.com): de onde vêm as imagens. */
  assets: string;
  /** Panda da assinatura (cada assunto tem o seu). */
  panda?: PandaPose;
  /** Marca no topo: o Comandou (padrão) ou o nome do restaurante (e-mail para o cliente dele). */
  brand?: { name: string } | null;
  /** Assunto curto no canto do cabeçalho ("Segurança da conta", "Mensalidade"). */
  topic?: string;
  heading: string;
  lead?: string;
  /** Blocos já montados (p, button, codeBox, rows...). */
  body: string[];
  /** Rodapé pequeno: por que a pessoa recebeu. */
  footer?: string;
}

/** Espaço invisível depois do preheader: o resto do corpo não vaza para a prévia. */
const PREHEADER_PAD = '&#847;&zwnj;&nbsp;'.repeat(90);

const DARK = {
  page: '#1B2230',
  card: '#222A37',
  box: '#283141',
  line: '#354052',
  ink: '#F1F3F6',
  muted: '#B4BCC8',
  faint: '#8591A3',
  brand: '#FF7A45',
};

const DARK_RULES = (pre: string) => `
${pre}.em-page { background:${DARK.page} !important; }
${pre}.em-card { background:${DARK.card} !important; border-color:${DARK.line} !important; }
${pre}.em-box { background:${DARK.box} !important; border-color:${DARK.line} !important; }
${pre}.em-line { border-color:${DARK.line} !important; }
${pre}.em-ink, ${pre}.em-ink a { color:${DARK.ink} !important; }
${pre}.em-muted, ${pre}.em-muted a { color:${DARK.muted} !important; }
${pre}.em-faint, ${pre}.em-faint a { color:${DARK.faint} !important; }
${pre}.em-brand, ${pre}.em-brand a { color:${DARK.brand} !important; }
${pre}.em-step { border-color:${DARK.line} !important; color:${DARK.ink} !important; }`;

const CSS = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body, table, td { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
table { border-collapse: separate; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
img { -ms-interpolation-mode: bicubic; }
a { text-decoration: none; }
.em-code { -webkit-user-select: all; user-select: all; }
@media (max-width: 520px) {
  .em-pad { padding-left: 24px !important; padding-right: 24px !important; }
  .em-out { padding-left: 4px !important; padding-right: 4px !important; }
  .em-h1 { font-size: 22px !important; line-height: 29px !important; }
  .em-codebig { font-size: 32px !important; letter-spacing: 6px !important; }
  .em-topic { display: none !important; }
  .em-rl { display: block !important; width: auto !important; padding: 13px 0 1px !important; border-bottom: 0 !important; }
  .em-rv { display: block !important; width: auto !important; text-align: left !important; padding: 0 0 13px !important; border-top: 0 !important; }
  .em-fig { display: block !important; width: 100% !important; border-left: 0 !important; padding: 12px 0 !important; }
}
@media (prefers-color-scheme: dark) {${DARK_RULES('')}
}
${DARK_RULES('[data-ogsc] ')}
`;

/** A moldura de todo e-mail. */
export function shell(s: Shell): string {
  const assets = s.assets.replace(/\/+$/, '');
  const site = assets.replace(/^https?:\/\//, '');
  const brand = s.brand
    ? `<td class="em-ink" style="${f(700, 17, 24)}color:${C.ink};letter-spacing:-0.2px;">${esc(s.brand.name)}</td>`
    : `<td style="padding-right:9px;" valign="middle"><img src="${esc(assets)}/icons/icon-192.png" width="26" height="26" alt="" style="display:block;border:0;border-radius:7px;width:26px;height:26px;"></td>
          <td class="em-ink" valign="middle" style="${f(700, 17, 24)}color:${C.ink};letter-spacing:-0.3px;">comandou</td>`;

  // Assinatura: o panda pequeno do assunto ao lado de quem manda.
  const signoff = s.brand
    ? `<tr><td class="em-pad em-line" style="padding:22px 40px 26px;border-top:1px solid ${C.line};">
    <div class="em-ink" style="${f(600, 14, 20)}color:${C.ink};">${esc(s.brand.name)}</div>
    <div class="em-faint" style="${f(400, 13, 19)}color:${C.faint};">Cardápio online</div>
  </td></tr>`
    : `<tr><td class="em-pad em-line" style="padding:20px 40px 24px;border-top:1px solid ${C.line};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      ${s.panda ? `<td valign="middle" style="padding-right:12px;"><img src="${esc(assets)}/email/panda-${s.panda}.png" width="44" height="44" alt="" style="display:block;border:0;width:44px;height:44px;"></td>` : ''}
      <td valign="middle">
        <div class="em-ink" style="${f(600, 14, 20)}color:${C.ink};">Equipe Comandou</div>
        <div class="em-faint" style="${f(400, 13, 19)}color:${C.faint};">Sistema para restaurantes</div>
      </td>
    </tr></table>
  </td></tr>`;

  const credit = s.brand
    ? `Enviado por ${esc(s.brand.name)} com o <a href="${esc(assets)}" class="em-faint" style="color:${C.faint};text-decoration:underline;">Comandou</a>.`
    : `<a href="${esc(assets)}" class="em-faint" style="color:${C.faint};text-decoration:none;">${esc(site)}</a>`;

  return `<!doctype html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<title>${esc(s.title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>${CSS}</style>
</head>
<body class="em-page" style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};">${esc(s.preheader)}${PREHEADER_PAD}</div>
<table role="presentation" class="em-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page};">
<tr><td align="center" style="padding:32px 12px 40px;">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

<tr><td>
<table role="presentation" class="em-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:14px;">

<tr><td class="em-pad em-line" style="padding:22px 40px 20px;border-bottom:1px solid ${C.line};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td valign="middle"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          ${brand}
    </tr></table></td>
    ${s.topic ? `<td class="em-topic em-faint" align="right" valign="middle" style="${f(500, 13, 18)}color:${C.faint};white-space:nowrap;">${esc(s.topic)}</td>` : ''}
  </tr></table>
</td></tr>

<tr><td class="em-pad" style="padding:36px 40px 18px;">
  <h1 class="em-ink em-h1" style="margin:0 0 12px;${f(700, 25, 32)}color:${C.ink};letter-spacing:-0.5px;">${s.heading}</h1>
  ${s.lead ? `<p class="em-muted" style="margin:0 0 26px;${f(400, 15, 24)}color:${C.muted};">${s.lead}</p>` : ''}
  ${s.body.join('\n  ')}
</td></tr>

${signoff}

</table>
</td></tr>

<tr><td class="em-out em-faint" style="padding:22px 41px 0;${f(400, 12, 19)}color:${C.faint};">
  ${s.footer ? `${s.footer}<br>` : ''}${credit}
</td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

// ------------------------------------------------------------------ blocos

export const p = (html: string, opts: { small?: boolean } = {}) =>
  `<p class="em-muted" style="margin:0 0 18px;${opts.small ? f(400, 13, 20) : f(400, 15, 24)}color:${C.muted};">${html}</p>`;

export const strong = (s: string) =>
  `<strong class="em-ink" style="color:${C.ink};font-weight:600;">${esc(s)}</strong>`;

/** Botão "à prova de Outlook" (tabela com fundo; o link ocupa o botão inteiro). */
export function button(label: string, url: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 24px;">
  <tr><td align="center" bgcolor="${C.button}" style="background:${C.button};border-radius:9px;mso-padding-alt:13px 24px;">
    <a href="${esc(url)}" target="_blank" style="display:inline-block;padding:13px 24px;${f(600, 15, 20)}color:#FFFFFF;text-decoration:none;border-radius:9px;">${esc(label)}</a>
  </td></tr>
</table>`;
}

/** Link em texto embaixo do botão (quando o botão não abre). */
export const fallbackLink = (url: string) =>
  `<p class="em-faint" style="margin:-12px 0 22px;${f(400, 12, 18)}color:${C.faint};word-break:break-all;">Se o botão não abrir, copie o endereço: <a href="${esc(url)}" class="em-muted" style="color:${C.muted};text-decoration:underline;">${esc(url)}</a></p>`;

/** Bolinha de cor (estado), no padrão do app. */
const dot = (color: string) =>
  `<span style="display:inline-block;width:7px;height:7px;border-radius:4px;background:${color};vertical-align:middle;margin:0 8px 2px 0;"></span>`;

/**
 * O código grande, numa caixa só, sem espaço no meio: dois toques (ou tocar e segurar) seleciona
 * os 6 números de uma vez para copiar. Embaixo, a validade com a bolinha laranja.
 */
export function codeBox(code: string, caption: string) {
  return `<table role="presentation" class="em-box" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.box}" style="margin:0 0 24px;background:${C.box};border:1px solid ${C.line};border-radius:12px;">
  <tr><td style="padding:22px 24px 4px;">
    <div class="em-ink em-code em-codebig" style="${f(700, 38, 46, MONO)}letter-spacing:9px;color:${C.ink};">${esc(code)}</div>
  </td></tr>
  <tr><td class="em-muted" style="padding:6px 24px 20px;${f(400, 13, 19)}color:${C.muted};">${dot(C.brand)}${caption}</td></tr>
</table>`;
}

/**
 * Dados no jeito de uma comanda: rótulo à esquerda, valor à direita, linhas separadas por
 * tracejado, entre duas linhas finas.
 */
export function rows(items: { label: string; value: string; mono?: boolean }[]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px;border-collapse:collapse;">
${items
  .map((r, i) => {
    const edge = i === 0 ? `border-top:1px solid ${C.ink};` : `border-top:1px dashed ${C.dash};`;
    const last = i === items.length - 1 ? `border-bottom:1px solid ${C.ink};` : '';
    return `  <tr>
    <td class="em-line em-muted em-rl" valign="top" style="padding:13px 16px 13px 0;${edge}${last}${f(400, 14, 21)}color:${C.muted};white-space:nowrap;">${esc(r.label)}</td>
    <td class="em-line em-ink em-rv" valign="top" align="right" style="padding:13px 0;${edge}${last}${r.mono ? f(600, 15, 21, MONO) : f(600, 14, 21)}color:${C.ink};word-break:break-word;overflow-wrap:anywhere;">${r.value}</td>
  </tr>`;
  })
  .join('\n')}
</table>`;
}

/** Passos numerados: número numa bolinha de linha fina, título e texto ao lado. */
export function steps(items: { title: string; text: string }[], heading?: string) {
  return `${heading ? `<div class="em-ink" style="${f(600, 15, 22)}color:${C.ink};margin:4px 0 16px;">${esc(heading)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;">
${items
  .map(
    (s, i) => `  <tr>
    <td width="38" valign="top" style="padding:0 0 18px;">
      <div class="em-step" style="width:24px;height:24px;border:1px solid ${C.dash};border-radius:13px;${f(600, 12, 24)}color:${C.ink};text-align:center;">${i + 1}</div>
    </td>
    <td valign="top" style="padding:2px 0 18px;">
      <div class="em-ink" style="${f(600, 14, 21)}color:${C.ink};">${esc(s.title)}</div>
      <div class="em-muted" style="${f(400, 14, 21)}color:${C.muted};">${esc(s.text)}</div>
    </td>
  </tr>`,
  )
  .join('\n')}
</table>`;
}

/** Aviso (prazo, segurança, sucesso): caixa cinza clara com a bolinha da cor do estado. */
export function note(html: string, tone: 'warn' | 'ok' | 'danger' | 'info' = 'info') {
  const color = { warn: C.warn, ok: C.ok, danger: C.danger, info: C.info }[tone];
  return `<table role="presentation" class="em-box" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.box}" style="margin:0 0 20px;background:${C.box};border:1px solid ${C.line};border-radius:10px;">
  <tr>
    <td width="15" valign="top" style="padding:20px 0 0 18px;font-size:0;line-height:0;">${dot(color)}</td>
    <td class="em-muted" style="padding:14px 18px 14px 4px;${f(400, 14, 21)}color:${C.muted};">${html}</td>
  </tr>
</table>`;
}

export const divider = () =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="em-line" style="border-top:1px solid ${C.line};padding:0 0 26px;font-size:0;line-height:0;">&nbsp;</td></tr></table>`;

/** Valores grandes lado a lado (mensalidade, vencimento), separados por linha fina. */
export function bigFigures(items: { label: string; value: string }[]) {
  const w = Math.floor(100 / items.length);
  return `<table role="presentation" class="em-line" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px;border-top:1px solid ${C.ink};border-bottom:1px solid ${C.ink};">
  <tr>${items
    .map(
      (
        it,
        i,
      ) => `<td class="em-fig em-line" width="${w}%" valign="top" style="padding:16px ${i < items.length - 1 ? '16px' : '0'} 16px ${i ? '16px' : '0'};${i ? `border-left:1px dashed ${C.dash};` : ''}">
    <div class="em-muted" style="${f(400, 13, 18)}color:${C.muted};">${esc(it.label)}</div>
    <div class="em-ink" style="${f(700, 22, 30)}color:${C.ink};letter-spacing:-0.4px;white-space:nowrap;">${esc(it.value)}</div>
  </td>`,
    )
    .join('')}</tr>
</table>`;
}

/** Data por extenso no horário de Brasília: "quarta-feira, 18 de novembro". */
export function longDate(d: Date, withTime = false): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(d);
}

/** Data curta: 18/11/2026 (aceita AAAA-MM-DD sem mudar o dia pelo fuso). */
export function shortDate(d: Date | string): string {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
    return d.split('-').reverse().join('/');
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date(d));
}

/** Texto puro: junta as linhas e tira linhas em branco repetidas. */
export const plain = (lines: (string | false | null | undefined)[]) =>
  lines
    .filter((l): l is string => typeof l === 'string')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
