// Gera a logo da Fumaça Burger (apps/api/db/demo/fumaca/logo.webp, 512x512) a partir de logo.svg.
// Uso: node tools/demo-images/fumaca/logo.mjs (precisa do Chromium do Playwright).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', '..', 'apps', 'api', 'db', 'demo', 'fumaca');
const require = createRequire(join(here, '..', '..', '..', 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');

const svg = readFileSync(join(here, 'logo.svg'), 'utf8');
// Fontes livres (SIL OFL, em fonts/): Anton na marca e Oswald no "Burger & Co.".
const font = (family, file, weight) =>
  `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(
    join(here, 'fonts', file),
  ).toString('base64')}) format('woff2')}`;
const fonts =
  font('Anton', 'anton-latin-400-normal.woff2', 400) +
  font('Oswald', 'oswald-latin-600-normal.woff2', 600);
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(
  `<html><head><style>${fonts}</style></head><body style="margin:0;background:transparent">${svg}</body></html>`,
);
await page.evaluate(() => document.fonts.ready);
const png = await page.locator('svg').screenshot({ omitBackground: true });
await page.setContent('<canvas id="c" width="512" height="512"></canvas>');
const webp = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.getElementById('c');
  c.getContext('2d').drawImage(img, 0, 0);
  return c.toDataURL('image/webp', 0.9).split(',')[1];
}, png.toString('base64'));
await browser.close();
const out2 = process.env.OUT ?? out;
const file = join(out2, 'logo.webp');
// Guarda a versão anterior (sha256 → nome) para a demonstração no ar trocar a logo sozinha.
const prevPath = join(out2, 'previous.json');
const previous = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, 'utf8')) : {};
if (existsSync(file))
  previous[createHash('sha256').update(readFileSync(file)).digest('hex')] = 'logo';
writeFileSync(file, Buffer.from(webp, 'base64'));
delete previous[createHash('sha256').update(readFileSync(file)).digest('hex')];
writeFileSync(prevPath, JSON.stringify(previous, null, 2));
const manifestPath = join(out2, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.logo = { width: 512, height: 512, bytes: statSync(file).size };
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
