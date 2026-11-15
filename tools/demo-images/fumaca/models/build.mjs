// Gera os modelos 3D de exemplo da Fumaça Burger (apps/api/db/demo/fumaca/models/*.glb e *.usdz).
// Uso: node tools/demo-images/fumaca/models/build.mjs [pasta-de-prévia]
// Precisa do pnpm install feito (usa o three que vem com o @google/model-viewer do apps/web) e do
// Chromium do Playwright (CHROMIUM=/caminho/do/chrome se não estiver no lugar padrão).
// Com uma pasta de prévia, só grava fotos PNG dos modelos ali, para conferir.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const web = createRequire(join(root, 'apps', 'web', 'package.json'));
const viewer = createRequire(web.resolve('@google/model-viewer'));
const threeDir = dirname(dirname(viewer.resolve('three')));
const { chromium } = web('@playwright/test');

/** Modelo de cada produto do cardápio (chave do produto em src/demo/fumaca.ts). */
export const MODELS = {
  fumaca: 'burger',
  batata: 'fries',
  'shake-chocolate': 'shake',
  'brownie-sorvete': 'brownie',
};

const out = join(root, 'apps', 'api', 'db', 'demo', 'fumaca', 'models');
const previewDir = process.argv[2];

const types = { '.js': 'text/javascript', '.woff2': 'font/woff2', '.html': 'text/html' };
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'error' && console.error(m.text()));
page.on('pageerror', (e) => console.error(e));
await page.route('http://modelos.local/**', (route) => {
  const path = new URL(route.request().url()).pathname;
  let file;
  if (path === '/') file = null;
  else if (path.startsWith('/three/')) file = join(threeDir, path.slice(7));
  else if (path.startsWith('/fonts/')) file = join(here, '..', 'fonts', path.slice(7));
  else file = join(here, path.slice(1));
  if (!file)
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><style>@font-face{font-family:'Anton';src:url(/fonts/anton-latin-400-normal.woff2)}</style>
      <script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
      </head><body style="margin:0"></body></html>`,
    });
  return route.fulfill({
    contentType: types[extname(file)] ?? 'application/octet-stream',
    body: readFileSync(file),
  });
});
await page.goto('http://modelos.local/');

if (previewDir) mkdirSync(previewDir, { recursive: true });
else mkdirSync(out, { recursive: true });
for (const [product, model] of Object.entries(MODELS)) {
  if (previewDir) {
    const png = await page.evaluate(async (m) => (await import('/scene.js')).preview(m), model);
    writeFileSync(join(previewDir, `${product}.png`), Buffer.from(png.split(',')[1], 'base64'));
  } else {
    const files = await page.evaluate(async (m) => {
      const { glb, usdz } = await (await import('/scene.js')).exportModel(m);
      const b64 = (u8) => {
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000)
          s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        return btoa(s);
      };
      return { glb: b64(glb), usdz: b64(usdz) };
    }, model);
    for (const ext of ['glb', 'usdz']) {
      const buf = Buffer.from(files[ext], 'base64');
      writeFileSync(join(out, `${product}.${ext}`), buf);
      console.log(`${product}.${ext}`, `${(buf.length / 1024).toFixed(0)} KB`);
    }
  }
}
await browser.close();
