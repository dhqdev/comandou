import { createHmac } from 'node:crypto';
import { expect, Page } from '@playwright/test';

/** Login no painel Super Admin (admin.<base>) com senha + código do autenticador de teste. */
export const BASE = process.env.E2E_BASE_URL ?? 'http://demo.comandou.localhost:5173';
export const ADMIN_URL = process.env.E2E_ADMIN_URL ?? BASE.replace(/\/\/[^.]+\./, '//admin.');
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@comandou.local';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
export const ADMIN_TOTP = process.env.E2E_ADMIN_TOTP ?? '';

function base32(s: string) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let v = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, '')) {
    v = (v << 5) | A.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totp(step: number) {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32(ADMIN_TOTP)).update(c).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
export const stepNow = () => Math.floor(Date.now() / 30_000);

/** Cada código vale uma vez: tenta o passo atual e o próximo; se já foram usados, espera. */
export async function adminLogin(page: Page) {
  await page.goto(ADMIN_URL);
  await expect(page.getByLabel('Código do autenticador')).toBeVisible();
  await page.getByLabel('E-mail').fill(ADMIN_EMAIL);
  await page.getByLabel('Senha').fill(ADMIN_PASSWORD);
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0 && attempt % 2 === 0)
      await page.waitForTimeout((30 - ((Date.now() / 1000) % 30) + 1) * 1000);
    await page.getByLabel('Código do autenticador').fill(totp(stepNow() + (attempt % 2)));
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/platform/auth/login')),
      page.getByRole('button', { name: 'Entrar' }).click(),
    ]);
    if (res.ok()) {
      await expect(page.locator('.topbar__tenant')).toContainText('Status');
      return;
    }
  }
  throw new Error('não conseguiu entrar no painel');
}
