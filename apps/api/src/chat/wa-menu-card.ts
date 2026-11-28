import { contrast, esc, mix, readable } from '../birthdays/birthday-art';
import type { FontMetrics } from '../birthdays/font-metrics';
import { textWidth } from '../birthdays/font-metrics';

/**
 * Cartão de uma categoria do cardápio para o WhatsApp (0.280). David: "a forma que está mostrando
 * os itens está muito feia, uma sequência muito grande de coisas; pense em algo mais criativo".
 * Em vez de um paredão de texto, a categoria vira uma imagem como a vitrine do cardápio: foto de
 * cada item com o número para responder, nome, preço e selo, na cor da loja. A lista curta vai de
 * legenda. Aqui só o SVG (puro, testado); quem desenha é o resvg (`wa-media.ts`).
 */

export const CARD_W = 1080;
/** Itens no cartão; o resto continua na legenda. */
export const CARD_MAX_ITEMS = 12;

export interface CardItem {
  /** Número que o cliente responde. */
  n: number;
  name: string;
  /** "R$ 39,90" (null = a loja esconde os preços). */
  price: string | null;
  badge: string | null;
  soldOut: boolean;
  /** Foto já como data URI (PNG ou JPEG). */
  photo: string | null;
}

export interface CardInput {
  store: string;
  category: string;
  /** Cor da loja (#rrggbb). */
  color: string;
  logo: string | null;
  items: CardItem[];
  /** Itens da categoria que não couberam no cartão (estão na legenda). */
  more: number;
}

export interface CardFonts {
  body: FontMetrics;
  bold: FontMetrics;
}

const PAD = 44;
const GAP = 22;
const HEAD_H = 236;
const FOOT_H = 120;
const BG = '#f7f3ef';
const INK = '#2b211c';
const MUTED = '#7a6c63';

/** Corta o texto para caber na largura (com reticências). */
function fit(f: FontMetrics, text: string, size: number, max: number) {
  if (textWidth(f, text, size) <= max) return text;
  let t = text;
  while (t.length > 1 && textWidth(f, `${t}…`, size) > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Quebra em até `lines` linhas pela largura (a última com reticências se sobrar). */
export function wrap(f: FontMetrics, text: string, size: number, max: number, lines: number) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const out: string[] = [];
  let cur = '';
  for (let k = 0; k < words.length; k++) {
    const w = words[k]!;
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(f, next, size) <= max) {
      cur = next;
      continue;
    }
    if (out.length === lines - 1) {
      out.push(fit(f, `${cur ? `${cur} ` : ''}${words.slice(k).join(' ')}`, size, max));
      return out;
    }
    if (cur) out.push(cur);
    cur = textWidth(f, w, size) <= max ? w : fit(f, w, size, max);
  }
  if (cur) out.push(cur);
  return out.slice(0, lines);
}

const brand = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : '#e8590c');

/** SVG do cartão e a altura final (a largura é sempre CARD_W). */
export function menuCardSvg(c: CardInput, fonts: CardFonts): { svg: string; height: number } {
  const color = brand(c.color);
  const items = c.items.slice(0, CARD_MAX_ITEMS);
  const cols = items.length <= 4 ? 2 : 3;
  const cardW = (CARD_W - PAD * 2 - GAP * (cols - 1)) / cols;
  const photoH = Math.round(cardW * (cols === 2 ? 0.72 : 0.8));
  const nameSize = cols === 2 ? 34 : 27;
  const nameLH = Math.round(nameSize * 1.22);
  const priceSize = cols === 2 ? 36 : 29;
  const cardH = photoH + 18 + nameLH * 2 + 10 + Math.round(priceSize * 1.2) + 20;
  const rows = Math.max(1, Math.ceil(items.length / cols));
  const height = HEAD_H + PAD + rows * cardH + (rows - 1) * GAP + FOOT_H;

  // Texto do topo legível sobre a cor da loja (cor clara pede letra escura).
  const headInk = contrast('#ffffff', color) >= 3 ? '#ffffff' : INK;
  const headSoft = headInk === '#ffffff' ? 'rgba(255,255,255,0.86)' : 'rgba(43,33,28,0.75)';
  const price = readable(color, '#ffffff', 3.2);
  const tint = mix(color, '#ffffff', 0.86);
  const dark = mix(color, '#000000', 0.25);

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_W}" height="${height}" viewBox="0 0 ${CARD_W} ${height}">`,
    `<defs><linearGradient id="hd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>`,
    `<rect width="${CARD_W}" height="${height}" fill="${BG}"/>`,
    `<rect width="${CARD_W}" height="${HEAD_H}" fill="url(#hd)"/>`,
    // Bolinhas de enfeite no canto do topo.
    `<circle cx="${CARD_W - 70}" cy="40" r="120" fill="#ffffff" fill-opacity="0.07"/>`,
    `<circle cx="${CARD_W - 20}" cy="${HEAD_H - 10}" r="70" fill="#ffffff" fill-opacity="0.06"/>`,
  );

  // Logo da loja (círculo) e títulos.
  let tx = PAD;
  if (c.logo) {
    const r = 64;
    const cx = PAD + r;
    const cy = HEAD_H / 2;
    out.push(
      `<clipPath id="lg"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`,
      `<circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="#ffffff"/>`,
      `<image x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#lg)" xlink:href="${c.logo}"/>`,
    );
    tx = PAD + r * 2 + 30;
  }
  const titleMax = CARD_W - tx - PAD;
  const titleSize = textWidth(fonts.bold, c.category, 66) <= titleMax ? 66 : 52;
  const count = items.length + c.more;
  out.push(
    `<text x="${tx}" y="${HEAD_H / 2 - 8}" font-family="Inter" font-weight="800" font-size="${titleSize}" fill="${headInk}">${esc(fit(fonts.bold, c.category, titleSize, titleMax))}</text>`,
    `<text x="${tx}" y="${HEAD_H / 2 + 44}" font-family="Inter" font-weight="500" font-size="30" fill="${headSoft}">${esc(fit(fonts.body, `${c.store} · ${count} ${count === 1 ? 'opção' : 'opções'}`, 30, titleMax))}</text>`,
  );

  items.forEach((it, k) => {
    const col = k % cols;
    const row = Math.floor(k / cols);
    const x = PAD + col * (cardW + GAP);
    const y = HEAD_H + PAD + row * (cardH + GAP);
    const id = `p${k}`;
    out.push(
      `<rect x="${x}" y="${y + 4}" width="${cardW}" height="${cardH}" rx="26" fill="#000000" fill-opacity="0.05"/>`,
      `<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="26" fill="#ffffff"/>`,
      `<clipPath id="${id}"><path d="M${x} ${y + 26}a26 26 0 0 1 26-26h${cardW - 52}a26 26 0 0 1 26 26v${photoH - 26}h-${cardW}z"/></clipPath>`,
    );
    if (it.photo)
      out.push(
        `<image x="${x}" y="${y}" width="${cardW}" height="${photoH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})" xlink:href="${it.photo}"/>`,
      );
    else {
      const letter = [...it.name.trim()][0]?.toUpperCase() ?? '?';
      out.push(
        `<rect x="${x}" y="${y}" width="${cardW}" height="${photoH}" fill="${tint}" clip-path="url(#${id})"/>`,
        `<text x="${x + cardW / 2}" y="${y + photoH / 2 + photoH * 0.16}" text-anchor="middle" font-family="Inter" font-weight="800" font-size="${Math.round(photoH * 0.46)}" fill="${color}" fill-opacity="0.35">${esc(letter)}</text>`,
      );
    }
    if (it.soldOut)
      out.push(
        `<rect x="${x}" y="${y}" width="${cardW}" height="${photoH}" fill="#ffffff" fill-opacity="0.62" clip-path="url(#${id})"/>`,
      );
    // Número para responder, no canto da foto.
    const r = cols === 2 ? 34 : 29;
    out.push(
      `<circle cx="${x + 14 + r}" cy="${y + 14 + r}" r="${r + 3}" fill="#ffffff"/>`,
      `<circle cx="${x + 14 + r}" cy="${y + 14 + r}" r="${r}" fill="${color}"/>`,
      `<text x="${x + 14 + r}" y="${y + 14 + r + r * 0.36}" text-anchor="middle" font-family="Inter" font-weight="800" font-size="${Math.round(r * 1.05)}" fill="${contrast('#ffffff', color) >= 3 ? '#ffffff' : INK}">${it.n}</text>`,
    );
    // Selo ("Novo", "Vegetariano") ou "Esgotado" embaixo da foto.
    const pill = it.soldOut ? 'Esgotado' : it.badge?.trim() ? it.badge.trim() : null;
    if (pill) {
      const ps = cols === 2 ? 24 : 20;
      const label = fit(fonts.bold, pill, ps, cardW - 60);
      const pw = textWidth(fonts.bold, label, ps) + 28;
      const py = y + photoH - ps - 30;
      out.push(
        `<rect x="${x + 14}" y="${py}" width="${pw}" height="${ps + 18}" rx="${(ps + 18) / 2}" fill="${it.soldOut ? '#c92a2a' : '#ffffff'}" fill-opacity="${it.soldOut ? 1 : 0.94}"/>`,
        `<text x="${x + 28}" y="${py + ps + 3}" font-family="Inter" font-weight="800" font-size="${ps}" fill="${it.soldOut ? '#ffffff' : INK}">${esc(label)}</text>`,
      );
    }
    const lines = wrap(fonts.bold, it.name, nameSize, cardW - 36, 2);
    lines.forEach((l, j) =>
      out.push(
        `<text x="${x + 18}" y="${y + photoH + 18 + nameSize + j * nameLH}" font-family="Inter" font-weight="800" font-size="${nameSize}" fill="${it.soldOut ? MUTED : INK}">${esc(l)}</text>`,
      ),
    );
    if (it.price)
      out.push(
        `<text x="${x + 18}" y="${y + cardH - 22}" font-family="Inter" font-weight="800" font-size="${priceSize}" fill="${it.soldOut ? MUTED : price}"${it.soldOut ? ' text-decoration="line-through"' : ''}>${esc(it.price)}</text>`,
      );
  });

  const fy = height - FOOT_H / 2;
  out.push(
    `<text x="${CARD_W / 2}" y="${fy + 4}" text-anchor="middle" font-family="Inter" font-weight="800" font-size="34" fill="${INK}">Responda com o número do item</text>`,
  );
  if (c.more > 0)
    out.push(
      `<text x="${CARD_W / 2}" y="${fy + 44}" text-anchor="middle" font-family="Inter" font-weight="500" font-size="26" fill="${MUTED}">+ ${c.more} ${c.more === 1 ? 'item' : 'itens'} na lista da mensagem</text>`,
    );
  out.push('</svg>');
  return { svg: out.join(''), height };
}
