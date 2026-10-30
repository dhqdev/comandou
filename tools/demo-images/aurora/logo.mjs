// Gera a logo da Aurora (apps/api/db/demo/aurora/logo.webp, 512x512) a partir de logo.svg.
// Uso: node tools/demo-images/aurora/logo.mjs (precisa do Chromium do Playwright).
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', '..', 'apps', 'api', 'db', 'demo', 'aurora');
const require = createRequire(join(here, '..', '..', '..', 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');

const svg = readFileSync(join(here, 'logo.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
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
const file = join(out, 'logo.webp');
writeFileSync(file, Buffer.from(webp, 'base64'));
const manifestPath = join(out, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.logo = { width: 512, height: 512, bytes: statSync(file).size };
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
