import { expect, test } from '@playwright/test';
import { enterPanel } from './nav';

const EMAIL = process.env.E2E_EMAIL ?? 'dono@demo.local';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
test.skip(!PASSWORD, 'defina E2E_PASSWORD (senha do administrador do tenant de teste)');

const brand500 = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--cm-brand-500').trim(),
  );

test('a cor salva na Loja online vale em todas as telas da loja', async ({ page, context }) => {
  await enterPanel(page, EMAIL, PASSWORD);
  await page.goto('/loja-online');
  await page.getByLabel('Cor principal em hexadecimal').fill('#1f6feb');
  await page.getByRole('button', { name: 'Salvar identidade' }).click();
  await expect(page.getByText(/Identidade salva/)).toBeVisible();
  try {
    // Depois de salvar vale na hora e sobrevive a recarregar a página.
    await expect.poll(() => brand500(page)).toBe('#1f6feb');
    for (const path of ['/', '/mesas', '/cozinha', '/entregas', '/garcom', '/pedir']) {
      await page.goto(path);
      await expect.poll(() => brand500(page), { message: path }).toBe('#1f6feb');
    }
    // Quem ainda não entrou (login) e o cliente sem sessão veem a cor da loja também.
    const anon = await context.browser()!.newContext({ baseURL: test.info().project.use.baseURL });
    const p = await anon.newPage();
    for (const path of ['/', '/pedir']) {
      await p.goto(path);
      await expect.poll(() => brand500(p), { message: `anônimo ${path}` }).toBe('#1f6feb');
    }
    await anon.close();
  } finally {
    await page.goto('/loja-online');
    await page.getByRole('button', { name: 'Voltar ao padrão' }).click();
    await page.getByRole('button', { name: 'Salvar identidade' }).click();
    await expect(page.getByText(/Identidade salva/)).toBeVisible();
  }
  await page.goto('/pedir');
  await expect.poll(() => brand500(page)).toBe('#e23a00');
});
