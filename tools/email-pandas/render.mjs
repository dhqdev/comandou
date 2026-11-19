/**
 * Desenha o panda dos e-mails (apps/web/public/email/panda-*.png) e a capa do topo de cada
 * assunto (hero-*.jpg).
 *
 * E-mail não mostra SVG (o Gmail e o Outlook cortam), então cada pose vira um PNG transparente
 * de 240×240 (aparece com 120×120: nítido em tela de celular). Mesmo panda do `Mascot`
 * (viewBox 64), com um objeto de cada assunto: aceno, chave, relógio, chapéu de festa...
 *
 * Rodar depois de mudar o desenho (usa o Chromium do Playwright do apps/web):
 *   node tools/email-pandas/render.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../../apps/web/public/email');
const require = createRequire(join(here, '../../apps/web/package.json'));
const { chromium } = require('@playwright/test');

const INK = '#1a1613';
const FACE = '#ffffff';
const ORANGE = '#e23a00';
const SOFT = '#ffd9c7';
const GOLD = '#f5b301';
const TEAL = '#14a39a';
/** Círculo claro atrás do panda: no modo escuro do e-mail as orelhas pretas não somem no fundo. */
const HALO = '#fff0e8';

const HEAD =
  'M7.2 38C7.2 24.5 20 15.8 34.5 15.8C48.5 15.8 58.6 24.5 58.6 38C58.6 49 48 53 32 53C15.5 53 7.2 49 7.2 38Z';

/** O rosto do Mascot (mesmos olhos e bocas). */
function head(mood) {
  const shut = `stroke="${FACE}" stroke-width="1.9" stroke-linecap="round" fill="none"`;
  const eye = (cx, cy, px, py, big) =>
    `<circle cx="${cx}" cy="${cy}" r="${big ? 3.4 : 2.9}" fill="${FACE}"/><ellipse cx="${px}" cy="${py}" rx=".95" ry="1.4" fill="${INK}"/>`;
  const left =
    mood === 'joy'
      ? `<path d="M23.4 32.6q2.2-2.6 4.4 0" ${shut}/>`
      : mood === 'sleep'
        ? `<path d="M23.3 32.3h4.4" ${shut}/>`
        : eye(25.5, 31.9, 27.4, 31.2, mood === 'wow');
  const right =
    mood === 'joy' || mood === 'wink'
      ? `<path d="M42.8 29.6q2.1-2.5 4.2 0" ${shut}/>`
      : mood === 'sleep'
        ? `<path d="M42.8 29.2h4.2" ${shut}/>`
        : eye(44.9, 28.8, 46.8, 28.3, mood === 'wow');
  const mouth =
    mood === 'wow'
      ? `<ellipse cx="40.6" cy="41" rx="1.9" ry="2.3" fill="${INK}"/>`
      : mood === 'sleep'
        ? `<path d="M38.5 40.6q3 .8 5-1" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" fill="none"/>`
        : mood === 'joy'
          ? `<path d="M36.8 39.8Q42.5 42.6 45 37.2Z" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" fill="${INK}"/>`
          : `<path d="M37.5 40.6Q42.5 41.5 44.2 37.6" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" fill="none"/>`;
  const blush =
    mood === 'joy' || mood === 'happy' || mood === 'wink'
      ? `<ellipse cx="17.5" cy="42" rx="3.2" ry="1.8" fill="${SOFT}" opacity=".9"/><ellipse cx="52.5" cy="38.6" rx="2.8" ry="1.6" fill="${SOFT}" opacity=".9"/>`
      : '';
  return `<g fill="${INK}"><circle cx="14" cy="19.9" r="8.2"/><circle cx="49.8" cy="17.9" r="8.2"/></g>
<path d="${HEAD}" fill="${FACE}" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/>
${blush}
<ellipse cx="22" cy="33.7" rx="8.8" ry="5.9" transform="rotate(-40 22 33.7)" fill="${INK}"/>
<ellipse cx="46.3" cy="29.4" rx="7.6" ry="5.3" transform="rotate(30 46.3 29.4)" fill="${INK}"/>
${left}${right}
<ellipse cx="36.3" cy="35.2" rx="4.2" ry="2.5" transform="rotate(-12 36.3 35.2)" fill="${INK}"/>
${mouth}`;
}

/** Corpo sentado embaixo da cabeça (no espaço 100×100, cabeça em translate(18 14)). */
const body = `<path d="M30 74C30 64 40 60 50 60C60 60 70 64 70 74L70 86C70 92 62 95 50 95C38 95 30 92 30 86Z" fill="${FACE}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
<ellipse cx="38" cy="93" rx="7" ry="4.2" fill="${INK}"/><ellipse cx="62" cy="93" rx="7" ry="4.2" fill="${INK}"/>`;

const paw = (cx, cy, r = 5.4, rot = 0) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.86}" transform="rotate(${rot} ${cx} ${cy})" fill="${INK}"/>`;

/** Cena: fundo + corpo + cabeça + objetos (antes e depois da cabeça). */
function scene({ mood, behind = '', front = '', bodyOn = true }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="240" height="240">
<circle class="halo" cx="50" cy="52" r="47" fill="${HALO}"/>
${behind}
${bodyOn ? body : ''}
<g transform="translate(17 8)">${head(mood)}</g>
${front}
</svg>`;
}

const confetti = (items) =>
  items
    .map(
      ([x, y, c, r = 0, w = 4, h = 2]) =>
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx=".8" fill="${c}" transform="rotate(${r} ${x + w / 2} ${y + h / 2})"/>`,
    )
    .join('');

const sparkle = (x, y, s = 1, c = GOLD) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -5Q.8 -.8 5 0Q.8 .8 0 5Q-.8 .8 -5 0Q-.8 -.8 0 -5Z" fill="${c}"/>`;

const POSES = {
  /** Boas-vindas: acenando, com faíscas. */
  ola: scene({
    mood: 'joy',
    behind: `${sparkle(10, 22, 1.1)}${sparkle(90, 40, 0.8, ORANGE)}${sparkle(84, 14, 0.6, TEAL)}`,
    front: `<path d="M82 52q5 3 6 9" stroke="${INK}" stroke-width="1.6" stroke-linecap="round" fill="none" opacity=".5"/>
<path d="M86 47q6 4 7 11" stroke="${INK}" stroke-width="1.6" stroke-linecap="round" fill="none" opacity=".3"/>
<path d="M67 70Q75 65 77 56" stroke="${INK}" stroke-width="8.5" stroke-linecap="round" fill="none"/>
${paw(78.5, 52, 5.6, -20)}${paw(36, 78, 5.2)}`,
  }),
  /** Código de nova senha: segurando uma chave. */
  codigo: scene({
    mood: 'wink',
    behind: `${sparkle(88, 26, 0.9)}${sparkle(12, 30, 0.7, ORANGE)}`,
    front: `<g transform="rotate(-28 70 74)">
  <circle cx="78" cy="74" r="8" fill="${GOLD}" stroke="${INK}" stroke-width="2.2"/>
  <circle cx="78" cy="74" r="3" fill="${FACE}" stroke="${INK}" stroke-width="1.6"/>
  <path d="M70 74H50v6h4v-3h4v4h4v-7" fill="${GOLD}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
</g>
${paw(64, 82, 5.4)}${paw(38, 80, 5.2)}`,
  }),
  /** Vencimento chegando: relógio do lado. */
  relogio: scene({
    mood: 'happy',
    behind: `<g transform="translate(80 66)">
  <circle r="13" fill="${FACE}" stroke="${INK}" stroke-width="2.4"/>
  <circle r="10" fill="none" stroke="${SOFT}" stroke-width="1.4"/>
  <path d="M0 -7V0L5 3" stroke="${ORANGE}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle r="1.6" fill="${INK}"/>
  <path d="M-9 -15l-4 -3M9 -15l4 -3" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>
</g>`,
    front: `${paw(68, 76, 5.4)}${paw(36, 80, 5.2)}`,
  }),
  /** Teste grátis acabou: dormindo, com lua e zzz. */
  dormindo: scene({
    mood: 'sleep',
    behind: `<path d="M18 18a9 9 0 1 0 9 13a7 7 0 1 1 -9 -13Z" fill="${GOLD}" opacity=".9"/>
<text x="74" y="24" font-family="Arial, sans-serif" font-size="11" font-weight="900" fill="${INK}" opacity=".75">z</text>
<text x="83" y="15" font-family="Arial, sans-serif" font-size="8" font-weight="900" fill="${INK}" opacity=".5">z</text>
<text x="90" y="8" font-family="Arial, sans-serif" font-size="6" font-weight="900" fill="${INK}" opacity=".35">z</text>`,
    front: `${paw(42, 82, 5.4)}${paw(58, 82, 5.4)}`,
  }),
  /** Pagamento recebido: chapéu de festa e confete. */
  festa: scene({
    mood: 'joy',
    behind: confetti([
      [8, 20, ORANGE, 20],
      [16, 44, TEAL, -30],
      [86, 22, GOLD, 40],
      [90, 50, ORANGE, -15],
      [78, 8, TEAL, 10],
      [6, 64, GOLD, 50],
      [92, 76, TEAL, 25],
    ]),
    front: `<g transform="rotate(14 54 18)">
  <path d="M46 26L54 4L62 26Z" fill="${ORANGE}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M49 18L59 18M51 12L57 12" stroke="${FACE}" stroke-width="2" stroke-linecap="round"/>
  <circle cx="54" cy="4" r="2.8" fill="${GOLD}" stroke="${INK}" stroke-width="1.6"/>
</g>
${paw(36, 80, 5.2)}${paw(64, 80, 5.2)}`,
  }),
  /** Pagamento vencido: surpreso, com um sinal de atenção. */
  alerta: scene({
    mood: 'wow',
    behind: `<g transform="translate(84 22)">
  <path d="M0 -11L11 8H-11Z" fill="${GOLD}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M0 -3V2" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>
  <circle cx="0" cy="5" r="1.3" fill="${INK}"/>
</g>`,
    front: `${paw(40, 80, 5.2)}${paw(60, 80, 5.2)}`,
  }),
  /** Contrato: piscando, com a folha e a caneta. */
  contrato: scene({
    mood: 'wink',
    behind: `<g transform="rotate(8 78 66)">
  <rect x="68" y="50" width="22" height="28" rx="2.5" fill="${FACE}" stroke="${INK}" stroke-width="2.2"/>
  <path d="M72 57h14M72 62h14M72 67h9" stroke="${SOFT}" stroke-width="2" stroke-linecap="round"/>
  <path d="M72 73q3 -3 5 0t5 0" stroke="${ORANGE}" stroke-width="1.8" stroke-linecap="round" fill="none"/>
</g>`,
    front: `${paw(68, 78, 5.2)}${paw(36, 80, 5.2)}`,
  }),
};

mkdirSync(out, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 240, height: 240 } });
for (const [name, svg] of Object.entries(POSES)) {
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  const png = await page.locator('svg').screenshot({ omitBackground: true });
  writeFileSync(join(out, `panda-${name}.png`), png);
  console.log(`panda-${name}.png`);
}
await page.close();

/*
 * Capa do topo de cada e-mail do Comandou (hero-<pose>.jpg): fundo escuro com o brilho laranja,
 * o ícone e o nome do Comandou à esquerda e o panda do assunto sentado na "lua" laranja à direita.
 * 1120×336 (aparece com 560×168). A fonte (Inter) vai embutida para sair igual em qualquer máquina.
 */
const font = readFileSync(
  join(
    here,
    '../../apps/web/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  ),
).toString('base64');
const icon = readFileSync(join(here, '../../apps/web/public/icons/icon-192.png')).toString(
  'base64',
);
const hero = (svg) => `<html><head><style>
@font-face { font-family: 'InterE'; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
body { width: 560px; height: 168px; overflow: hidden; background: #171412; font-family: 'InterE', sans-serif; }
.hero { position: relative; width: 560px; height: 168px; overflow: hidden;
  background:
    radial-gradient(circle at 86% 120%, rgba(255,98,31,.55) 0, rgba(226,58,0,.18) 34%, transparent 62%),
    radial-gradient(circle at 0% 0%, rgba(255,255,255,.06) 0, transparent 40%),
    #171412; }
.dots { position: absolute; inset: 0; opacity: .5;
  background-image: radial-gradient(rgba(255,255,255,.10) 1px, transparent 1.2px);
  background-size: 14px 14px;
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 45%, #000 70%, transparent 100%); }
.brand { position: absolute; left: 40px; top: 50px; display: flex; align-items: center; gap: 12px; }
.brand img { width: 42px; height: 42px; border-radius: 11px; box-shadow: 0 0 0 1px rgba(255,255,255,.12); }
.brand b { color: #fff; font-size: 34px; font-weight: 800; letter-spacing: -1.4px; line-height: 1; }
.brand b i { font-style: normal; color: #FF6A2B; }
.tag { position: absolute; left: 40px; top: 106px; color: rgba(255,255,255,.55); font-size: 13px; font-weight: 500; letter-spacing: .1px; }
.moon { position: absolute; right: -6px; bottom: -118px; width: 236px; height: 236px; border-radius: 50%;
  background: radial-gradient(circle at 40% 30%, #FF7A3D, #E23A00 60%, #B92F00); }
.ring { position: absolute; right: -40px; bottom: -152px; width: 304px; height: 304px; border-radius: 50%; border: 1px solid rgba(255,122,61,.28); }
.ring.r2 { right: -78px; bottom: -190px; width: 380px; height: 380px; border-color: rgba(255,122,61,.14); }
.panda { position: absolute; right: 26px; bottom: -14px; width: 176px; height: 176px; }
.panda svg { width: 176px; height: 176px; }
.panda .halo { display: none; }
</style></head><body><div class="hero">
<div class="dots"></div>
<div class="ring r2"></div><div class="ring"></div><div class="moon"></div>
<div class="brand"><img src="data:image/png;base64,${icon}" alt=""><b>comandou<i>.</i></b></div>
<div class="tag">Sistema para restaurantes</div>
<div class="panda">${svg}</div>
</div></body></html>`;

const wide = await browser.newPage({ viewport: { width: 560, height: 168 }, deviceScaleFactor: 2 });
for (const [name, svg] of Object.entries(POSES)) {
  await wide.setContent(hero(svg));
  await wide.evaluate(() => document.fonts.ready);
  const jpg = await wide.locator('.hero').screenshot({ type: 'jpeg', quality: 88 });
  writeFileSync(join(out, `hero-${name}.jpg`), jpg);
  console.log(`hero-${name}.jpg`);
}
await browser.close();
