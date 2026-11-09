import { expect, test } from '@playwright/test';
import { enterPanel } from './nav';

const EMAIL = process.env.E2E_EMAIL ?? 'dono@demo.local';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
// Mexe na identidade do mesmo restaurante: roda só no desktop para os projetos não se atropelarem.
test.skip(({ isMobile }) => isMobile, 'só no desktop');
test.skip(!PASSWORD, 'defina E2E_PASSWORD (senha do administrador do tenant de teste)');

const brand500 = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--cm-brand-500').trim(),
  );

test('a cor salva na Loja online vale em todas as telas da loja', async ({ page, context }) => {
  await enterPanel(page, EMAIL, PASSWORD);
  await page.goto('/loja-online');
  await page.getByLabel('Cor principal em hexadecimal').fill('#1f6feb');
  // Salva sozinho ao escolher: sem clicar em botão.
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
    // No cardápio, a barra do topo do navegador também fica na cor da loja.
    await expect(p.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#1f6feb');
    await anon.close();
  } finally {
    await page.goto('/loja-online');
    await page.getByRole('button', { name: 'Voltar ao padrão' }).click();
    await expect(page.getByText(/Identidade salva/)).toBeVisible();
  }
  await page.goto('/pedir');
  await expect.poll(() => brand500(page)).toBe('#e23a00');
});

test('seletor nativo e cores prontas salvam; o manifesto do app segue a loja', async ({ page }) => {
  await enterPanel(page, EMAIL, PASSWORD);
  await page.goto('/loja-online');
  const save = async () => {
    // Salva sozinho ao escolher: sem clicar em botão.
    await expect(page.getByText(/Identidade salva/)).toBeVisible();
  };
  try {
    // Seletor nativo (input type=color).
    await page.getByLabel('Cor principal: outra cor').fill('#8c1c3a');
    await save();
    await page.goto('/pedir');
    await expect.poll(() => brand500(page)).toBe('#8c1c3a');
    // Cor pronta (bolinha).
    await page.goto('/loja-online');
    await page.getByRole('radio', { name: 'Turquesa' }).click();
    await save();
    await page.goto('/pedir');
    await expect.poll(() => brand500(page)).toBe('#0f9d9a');
    // O app instalado (PWA) usa o manifesto da loja, com a cor dela, e abre no cardápio.
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe('/api/v1/store/manifest?start=%2Fpedir');
    const own = await page.evaluate((u) => fetch(u!).then((r) => r.json()), href);
    expect(own).toMatchObject({ start_url: '/pedir', id: '/pedir' });
    const m = await page.evaluate(() => fetch('/api/v1/store/manifest').then((r) => r.json()));
    expect(m.theme_color).toBe('#0f9d9a');
    expect(m.icons.length).toBeGreaterThan(0);
  } finally {
    await page.goto('/loja-online');
    await page.getByRole('button', { name: 'Voltar ao padrão' }).click();
    await save();
  }
});
