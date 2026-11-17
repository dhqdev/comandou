/**
 * Peças dos e-mails do Comandou: a moldura (logo, panda, cartão e rodapé) e os blocos de dentro
 * (botão, código, tabela de dados, passos, aviso). HTML de e-mail: tabelas, estilo na própria tag
 * e só o que Gmail, Outlook, Apple Mail e os apps de celular mostram igual. O modo escuro vem de
 * um `<style>` com `prefers-color-scheme` (Apple Mail, iOS, Outlook.com com `[data-ogsc]`); onde
 * ele não existe, o cliente escurece sozinho e as cores claras continuam legíveis.
 *
 * Imagens: o panda de cada assunto (PNG em apps/web/public/email, desenhado por
 * tools/email-pandas/render.mjs) e o ícone do app, servidos pelo site do Comandou. Se o cliente
 * bloquear imagens, o e-mail continua inteiro (o panda tem texto alternativo vazio e altura fixa).
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

export const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif`;
export const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace`;

/** Cores claras (o modo escuro troca pelas classes `em-*`). */
export const C = {
  page: '#F4F1EE',
  card: '#FFFFFF',
  line: '#ECE7E2',
  ink: '#1C1917',
  muted: '#5F5A55',
  faint: '#8A847E',
  brand: '#E23A00',
  button: '#D63400',
  soft: '#FFF4EE',
  softLine: '#FFD9C7',
  warnBg: '#FFF7E0',
  warnInk: '#6B4500',
  okBg: '#EAF7EF',
  okInk: '#14532D',
  dangerBg: '#FDECEA',
  dangerInk: '#8A1C10',
} as const;

/** Poses do panda (apps/web/public/email/panda-<pose>.png). */
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
  panda?: PandaPose;
  /** Marca no topo: o Comandou (padrão) ou o nome do restaurante (e-mail para o cliente dele). */
  brand?: { name: string } | null;
  heading: string;
  lead?: string;
  /** Blocos já montados (p, button, codeBox, rows...). */
  body: string[];
  /** Rodapé pequeno: por que a pessoa recebeu. */
  footer?: string;
}

/** Espaço invisível depois do preheader: o resto do corpo não vaza para a prévia. */
const PREHEADER_PAD = '&#847;&zwnj;&nbsp;'.repeat(90);

const DARK_CSS = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body, table, td { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
a { text-decoration: none; }
.em-code { -webkit-user-select: all; user-select: all; }
@media (max-width: 520px) {
  .em-pad { padding-left: 22px !important; padding-right: 22px !important; }
  .em-h1 { font-size: 24px !important; line-height: 30px !important; }
  .em-codebig { font-size: 34px !important; letter-spacing: 6px !important; }
}
@media (prefers-color-scheme: dark) {
  .em-page { background: #121110 !important; }
  .em-card { background: #1E1C1A !important; border-color: #34302C !important; }
  .em-hero { background: #2A211C !important; }
  .em-ink, .em-ink a { color: #F4F1EE !important; }
  .em-muted { color: #B8B1AA !important; }
  .em-faint, .em-faint a { color: #8F8780 !important; }
  .em-line { border-color: #34302C !important; }
  .em-box { background: #26231F !important; border-color: #3A3530 !important; }
  .em-soft { background: #2E221B !important; border-color: #5A3524 !important; }
  .em-warn { background: #33280F !important; } .em-warn td, .em-warn div { color: #F3D58A !important; }
  .em-ok { background: #12301F !important; } .em-ok td, .em-ok div { color: #A7E3BD !important; }
  .em-danger { background: #3A1612 !important; } .em-danger td, .em-danger div { color: #F5B4AA !important; }
  .em-brand { color: #FF7A45 !important; }
}
[data-ogsc] .em-page { background: #121110 !important; }
[data-ogsc] .em-card { background: #1E1C1A !important; border-color: #34302C !important; }
[data-ogsc] .em-hero { background: #2A211C !important; }
[data-ogsc] .em-ink { color: #F4F1EE !important; }
[data-ogsc] .em-muted { color: #B8B1AA !important; }
[data-ogsc] .em-box { background: #26231F !important; border-color: #3A3530 !important; }
[data-ogsc] .em-soft { background: #2E221B !important; }
`;

/** A moldura de todo e-mail. */
export function shell(s: Shell): string {
  const assets = s.assets.replace(/\/+$/, '');
  const brand = s.brand
    ? `<td class="em-ink" style="font:700 19px/26px ${FONT};color:${C.ink};letter-spacing:-0.2px;">${esc(s.brand.name)}</td>`
    : `<td style="padding-right:10px;"><img src="${esc(assets)}/icons/icon-192.png" width="34" height="34" alt="" style="display:block;border:0;border-radius:9px;"></td>
       <td class="em-ink" style="font:800 20px/26px ${FONT};color:${C.ink};letter-spacing:-0.4px;">comandou</td>`;
  const panda = s.panda
    ? `<tr><td class="em-hero" align="center" style="background:${C.soft};border-radius:20px 20px 0 0;padding:28px 24px 6px;">
  <img src="${esc(assets)}/email/panda-${s.panda}.png" width="120" height="120" alt="" style="display:block;border:0;width:120px;height:120px;">
</td></tr>`
    : '';
  const top = s.panda ? '0 0 20px 20px' : '20px';
  return `<!doctype html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<title>${esc(s.title)}</title>
<style>${DARK_CSS}</style>
</head>
<body class="em-page" style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};">${esc(s.preheader)}${PREHEADER_PAD}</div>
<table role="presentation" class="em-page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
<tr><td align="center" style="padding:28px 12px 36px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

<tr><td align="center" style="padding:0 0 18px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${brand}</tr></table>
</td></tr>

<tr><td>
<table role="presentation" class="em-card" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.card};border:1px solid ${C.line};border-radius:20px;">
${panda}
<tr><td class="em-pad" style="padding:${s.panda ? '22px' : '34px'} 36px 34px;border-radius:${top};">
  <h1 class="em-ink em-h1" style="margin:0 0 10px;font:800 27px/34px ${FONT};color:${C.ink};letter-spacing:-0.5px;${s.panda ? 'text-align:center;' : ''}">${s.heading}</h1>
  ${s.lead ? `<p class="em-muted" style="margin:0 0 24px;font:400 16px/25px ${FONT};color:${C.muted};${s.panda ? 'text-align:center;' : ''}">${s.lead}</p>` : ''}
  ${s.body.join('\n  ')}
</td></tr>
</table>
</td></tr>

<tr><td class="em-faint" align="center" style="padding:22px 18px 0;font:400 12px/19px ${FONT};color:${C.faint};">
  ${s.footer ? `${s.footer}<br>` : ''}
  ${s.brand ? `Enviado por ${esc(s.brand.name)} com o <a href="${esc(assets)}" style="color:${C.faint};text-decoration:underline;">Comandou</a>.` : `<a href="${esc(assets)}" style="color:${C.faint};text-decoration:none;font-weight:600;">Comandou</a> · sistema para restaurantes`}
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ------------------------------------------------------------------ blocos

export const p = (html: string, opts: { center?: boolean; small?: boolean } = {}) =>
  `<p class="em-muted" style="margin:0 0 16px;font:400 ${opts.small ? '14px/21px' : '16px/25px'} ${FONT};color:${C.muted};${opts.center ? 'text-align:center;' : ''}">${html}</p>`;

export const strong = (s: string) =>
  `<strong class="em-ink" style="color:${C.ink};">${esc(s)}</strong>`;

/** Botão "à prova de Outlook" (tabela com fundo; o link ocupa o botão inteiro). */
export function button(label: string, url: string, opts: { center?: boolean } = {}) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ${opts.center !== false ? 'align="center"' : ''} style="margin:8px ${opts.center !== false ? 'auto' : '0'} 22px;">
  <tr><td align="center" bgcolor="${C.button}" style="background:${C.button};border-radius:12px;">
    <a href="${esc(url)}" target="_blank" style="display:inline-block;padding:15px 30px;font:700 16px/20px ${FONT};color:#FFFFFF;text-decoration:none;border-radius:12px;">${esc(label)}&nbsp;&rarr;</a>
  </td></tr>
</table>`;
}

/** Link em texto embaixo do botão (quando o botão não abre). */
export const fallbackLink = (url: string) =>
  `<p class="em-faint" style="margin:-10px 0 18px;font:400 12px/18px ${FONT};color:${C.faint};text-align:center;word-break:break-all;">Se o botão não abrir, copie: <a href="${esc(url)}" style="color:${C.faint};">${esc(url)}</a></p>`;

/**
 * O código grande, numa caixa só, sem espaço no meio: dois toques (ou tocar e segurar) seleciona
 * os 6 números de uma vez para copiar.
 */
export function codeBox(code: string, caption: string) {
  return `<table role="presentation" class="em-soft" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;background:${C.soft};border:2px dashed ${C.softLine};border-radius:16px;">
  <tr><td align="center" style="padding:22px 12px 6px;">
    <div class="em-ink em-code em-codebig" style="font:800 42px/50px ${MONO};letter-spacing:10px;color:${C.ink};padding-left:10px;">${esc(code)}</div>
  </td></tr>
  <tr><td align="center" class="em-muted" style="padding:0 12px 18px;font:500 13px/18px ${FONT};color:${C.muted};">${caption}</td></tr>
</table>`;
}

/** Tabela de dados (rótulo em cima, valor embaixo), numa caixa cinza. */
export function rows(items: { label: string; value: string; mono?: boolean }[]) {
  return `<table role="presentation" class="em-box" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;background:#FAF8F6;border:1px solid ${C.line};border-radius:14px;">
${items
  .map(
    (
      r,
      i,
    ) => `  <tr><td class="em-line" style="padding:14px 20px;${i < items.length - 1 ? `border-bottom:1px solid ${C.line};` : ''}">
    <div class="em-muted" style="font:500 12px/16px ${FONT};color:${C.muted};">${esc(r.label)}</div>
    <div class="em-ink" style="font:700 ${r.mono ? `17px/25px ${MONO}` : `16px/24px ${FONT}`};color:${C.ink};word-break:break-all;">${r.value}</div>
  </td></tr>`,
  )
  .join('\n')}
</table>`;
}

/** Passos numerados (bolinha laranja clara com o número). */
export function steps(items: { title: string; text: string }[], heading?: string) {
  return `${heading ? `<div class="em-muted" style="font:700 14px/20px ${FONT};color:${C.muted};margin:6px 0 14px;">${esc(heading)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;">
${items
  .map(
    (s, i) => `  <tr>
    <td width="40" valign="top" style="padding:0 0 18px;">
      <div class="em-soft" style="width:28px;height:28px;border-radius:14px;background:${C.soft};color:${C.button};font:800 13px/28px ${FONT};text-align:center;">${i + 1}</div>
    </td>
    <td valign="top" style="padding:2px 0 18px;">
      <div class="em-ink" style="font:700 15px/22px ${FONT};color:${C.ink};">${esc(s.title)}</div>
      <div class="em-muted" style="font:400 14px/21px ${FONT};color:${C.muted};">${esc(s.text)}</div>
    </td>
  </tr>`,
  )
  .join('\n')}
</table>`;
}

/** Faixa de aviso (prazo, segurança, sucesso). */
export function note(html: string, tone: 'warn' | 'ok' | 'danger' | 'info' = 'info') {
  const t = {
    warn: { cls: 'em-warn', bg: C.warnBg, ink: C.warnInk },
    ok: { cls: 'em-ok', bg: C.okBg, ink: C.okInk },
    danger: { cls: 'em-danger', bg: C.dangerBg, ink: C.dangerInk },
    info: { cls: 'em-box', bg: '#F6F3F0', ink: C.muted },
  }[tone];
  return `<table role="presentation" class="${t.cls}" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:${t.bg};border-radius:12px;">
  <tr><td${tone === 'info' ? ' class="em-muted"' : ''} style="padding:14px 18px;font:400 14px/21px ${FONT};color:${t.ink};">${html}</td></tr>
</table>`;
}

export const divider = () =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="em-line" style="border-top:1px solid ${C.line};padding:0 0 22px;font-size:0;line-height:0;">&nbsp;</td></tr></table>`;

/** Valor grande com rótulo pequeno (mensalidade, vencimento). */
export function bigFigures(items: { label: string; value: string }[]) {
  const w = Math.floor(100 / items.length);
  return `<table role="presentation" class="em-box" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;background:#FAF8F6;border:1px solid ${C.line};border-radius:14px;">
  <tr>${items
    .map(
      (
        it,
        i,
      ) => `<td width="${w}%" align="center" class="em-line" style="padding:18px 10px;${i ? `border-left:1px solid ${C.line};` : ''}">
    <div class="em-muted" style="font:500 12px/16px ${FONT};color:${C.muted};">${esc(it.label)}</div>
    <div class="em-ink" style="font:800 22px/30px ${FONT};color:${C.ink};letter-spacing:-0.3px;">${esc(it.value)}</div>
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
