// Gera as imagens do restaurante de demonstração (apps/api/db/demo/images/*.webp).
// Uso (só quando mudar algum desenho): node tools/demo-images/generate.mjs
// Precisa do Chromium do Playwright (pnpm --filter @comandou/web exec playwright install chromium).
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from './art.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'apps', 'api', 'db', 'demo', 'images');
const require = createRequire(join(here, '..', '..', 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');

const W = 1200;
const H = 900;
const P = (kind, body, o) => A.scene(W, H, kind, body, o);

/** Cada imagem: nome do arquivo → SVG. */
const IMAGES = {
  // Hambúrgueres
  'burger-classico': P(
    'warm',
    A.burger(600, 780, 640, ['sauce', 'patty', 'cheese', 'tomato', 'lettuce'], { seed: 1 }),
    { crumbs: 18 },
  ),
  'burger-cheddar-bacon': P(
    'red',
    A.burger(600, 790, 640, ['patty', ['cheese', '#f39c12'], 'bacon', 'onion'], { seed: 2 }),
    { crumbs: 18 },
  ),
  'burger-duplo-smash': P(
    'slate',
    A.burger(
      600,
      810,
      600,
      ['patty', ['cheese', '#ffcf4a'], 'patty', ['cheese', '#ffcf4a'], 'pickles', 'sauce'],
      {
        seed: 3,
      },
    ),
    { crumbs: 14, crumbColor: '#c9a26b' },
  ),
  'burger-salada': P(
    'green',
    A.burger(600, 780, 640, ['patty', 'cheese', 'onion', 'tomato', 'lettuce', 'lettuce'], {
      seed: 4,
    }),
    { crumbs: 12 },
  ),
  'burger-chicken': P(
    'cream',
    A.burger(600, 780, 640, [['crispy'], 'sauce', 'lettuce'], { seed: 5 }),
    { crumbs: 16 },
  ),
  'burger-veggie': P(
    'green',
    A.burger(600, 780, 640, [['patty', '#7a6a2c'], 'tomato', 'onion', 'lettuce'], {
      seed: 6,
      seeds: false,
    }),
    { crumbs: 12 },
  ),
  'burger-kids': P(
    'blue',
    A.burger(600, 740, 420, ['patty', 'cheese'], { seed: 7 }) +
      A.can(930, 760, 0.55, '#d8321f', '#fff'),
    { crumbs: 10 },
  ),

  // Pizzas
  'pizza-margherita': P(
    'slate',
    A.pizza(600, 450, 470, ['tomato', 'basil', 'oregano'], { seed: 1 }),
  ),
  'pizza-calabresa': P(
    'slate',
    A.pizza(600, 450, 470, ['calabresa', 'onion', 'olive', 'oregano'], { seed: 2 }),
  ),
  'pizza-portuguesa': P(
    'slate',
    A.pizza(600, 450, 470, ['ham', 'egg', 'onion', 'olive'], { seed: 3 }),
  ),
  'pizza-quatro-queijos': P(
    'night',
    A.pizza(600, 450, 470, ['cheeses', 'oregano'], { seed: 4, cheese: '#f6e3a1' }),
  ),
  'pizza-frango-catupiry': P(
    'night',
    A.pizza(600, 450, 470, ['chicken', 'catupiry', 'corn', 'oregano'], { seed: 5 }),
  ),
  'pizza-pepperoni': P('red', A.pizza(600, 450, 470, ['pepperoni', 'oregano'], { seed: 6 })),
  'pizza-chocolate-morango': P(
    'berry',
    A.pizza(600, 450, 470, ['strawberry'], {
      seed: 7,
      sauce: '#4a2210',
      cheese: '#5b2c12',
      density: 1.2,
    }),
  ),

  // Porções e salada
  'porcao-batata': P(
    'warm',
    A.friesBox(560, 800, 1.5, { seed: 1 }) + A.sauceCup(930, 810, '#d8321f'),
    { crumbs: 20 },
  ),
  'porcao-batata-cheddar': P('red', A.friesBox(600, 800, 1.55, { seed: 2, cheddar: true }), {
    crumbs: 14,
  }),
  'porcao-aneis-cebola': P('cream', A.onionRings(600, 760, { seed: 3 }), { crumbs: 14 }),
  'porcao-isca-frango': P('warm', A.basket(560, 780, { seed: 4, sauce: '#f4e1b0' }), {
    crumbs: 16,
  }),
  'porcao-mandioca': P(
    'green',
    A.friesBox(600, 800, 1.5, { seed: 5, stick: '#f6e7b5', stickShade: '#dcc27c', thick: true }),
    { crumbs: 10 },
  ),
  'salada-caesar': P('green', A.saladBowl(600, 790, { seed: 6 })),

  // Bebidas
  'bebida-refrigerante': P(
    'red',
    A.can(470, 790, 1.35, '#c8281e', '#fff', 'Cola') +
      A.can(760, 800, 1.1, '#2f8a3a', '#ffd23f', 'Guaraná'),
  ),
  'bebida-suco-laranja': P(
    'cream',
    A.glass(600, 800, 1.45, '#f79a1c', {
      ice: true,
      straw: '#2f8a3a',
      garnish: A.citrusSlice(760, 240, 70),
    }) + A.citrusSlice(860, 780, 60),
  ),
  'bebida-limonada': P(
    'green',
    A.glass(600, 800, 1.45, '#eef3c9', {
      ice: true,
      straw: '#f7c948',
      garnish: A.citrusSlice(770, 240, 70, '#b9d84a', '#5e9b22'),
    }) + A.citrusSlice(860, 790, 58, '#b9d84a', '#5e9b22'),
  ),
  'bebida-cerveja': P(
    'night',
    A.bottle(520, 820, 1.25, '#6b3a12', 'Lager') +
      A.glass(800, 820, 1, '#f2b134', { layer: null, empty: 0.22, garnish: '' }),
  ),
  'bebida-agua': P('blue', A.waterBottle(600, 810, 1.45)),
  'bebida-milkshake': P('berry', A.milkshake(600, 820, 1.35, '#6b3a1e')),
  'bebida-caipirinha': P(
    'green',
    A.glass(600, 810, 1.25, '#e9f5d4', {
      ice: true,
      empty: 0.35,
      garnish:
        A.citrusSlice(470, 700, 46, '#9ccc4a', '#4f8a1d') +
        A.citrusSlice(700, 720, 40, '#9ccc4a', '#4f8a1d'),
    }),
  ),

  // Sobremesas
  'sobremesa-brownie': P('cream', A.brownie(600, 800, { seed: 1 })),
  'sobremesa-petit-gateau': P('night', A.petitGateau(600, 800)),
  'sobremesa-pudim': P('cream', A.pudim(600, 800)),
  'sobremesa-acai': P('berry', A.acai(600, 800, { seed: 2 })),

  // Combos
  'combo-brasa': P(
    'warm',
    A.friesBox(330, 820, 1.05, { seed: 8 }) +
      A.burger(640, 820, 440, ['patty', 'cheese', 'tomato', 'lettuce'], { seed: 9 }) +
      A.can(960, 830, 0.95, '#c8281e', '#fff', 'Cola'),
    { crumbs: 16 },
  ),
  'combo-casal': P(
    'red',
    A.burger(400, 780, 380, ['patty', ['cheese', '#f39c12'], 'bacon'], { seed: 10 }) +
      A.burger(800, 800, 380, ['patty', 'cheese', 'tomato', 'lettuce'], { seed: 11 }) +
      A.can(180, 850, 0.7, '#2f8a3a', '#ffd23f') +
      A.can(1030, 850, 0.7, '#c8281e', '#fff'),
    { crumbs: 16 },
  ),
};

/** Capa (16:7) e banners da loja online. */
const WIDE = {
  capa: A.scene(
    1600,
    700,
    'night',
    A.pizza(1160, 380, 380, ['pepperoni', 'basil', 'oregano'], { seed: 31 }) +
      A.burger(470, 610, 420, ['patty', 'cheese', 'bacon', 'tomato', 'lettuce'], { seed: 32 }) +
      A.friesBox(150, 640, 0.8, { seed: 33 }),
    { crumbs: 30, crumbColor: '#c9a26b' },
  ),
  'banner-burger-dobro': A.scene(
    1600,
    700,
    'red',
    A.burger(560, 620, 460, ['patty', 'cheese', 'tomato', 'lettuce'], { seed: 41 }) +
      A.burger(1060, 640, 460, ['patty', ['cheese', '#f39c12'], 'bacon'], { seed: 42 }),
    { crumbs: 24 },
  ),
  'banner-pizza-refri': A.scene(
    1600,
    700,
    'slate',
    A.pizza(700, 360, 400, ['calabresa', 'onion', 'oregano'], { seed: 43 }) +
      A.can(1250, 640, 1.1, '#c8281e', '#fff', 'Cola'),
  ),
  'banner-sobremesa': A.scene(
    1600,
    700,
    'berry',
    A.acai(560, 640, { seed: 44 }) + A.milkshake(1150, 660, 1.1, '#f08aa8'),
    {
      crumbs: 10,
    },
  ),
};

async function main() {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  const manifest = {};
  const render = async (name, svg, w, h, quality = 0.84) => {
    await page.setViewportSize({ width: w, height: h });
    const data = await page.evaluate(
      async ({ svg, w, h, quality }) => {
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await img.decode();
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        return c.toDataURL('image/webp', quality);
      },
      { svg, w, h, quality },
    );
    const buf = Buffer.from(data.split(',')[1], 'base64');
    writeFileSync(join(out, `${name}.webp`), buf);
    manifest[name] = { width: w, height: h, bytes: buf.length };
  };
  for (const [name, svg] of Object.entries(IMAGES)) await render(name, svg, W, H);
  for (const [name, svg] of Object.entries(WIDE)) await render(name, svg, 1600, 700);
  await render('logo', A.logoSvg(512), 512, 512, 0.92);
  await browser.close();
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const total = Object.values(manifest).reduce((s, m) => s + m.bytes, 0);
  console.log(`${Object.keys(manifest).length} imagens, ${(total / 1024).toFixed(0)} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
