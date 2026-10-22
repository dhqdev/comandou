import { expect, test } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? 'dono@demo.local';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
test.skip(!PASSWORD, 'defina E2E_PASSWORD (senha do administrador do tenant de teste)');

test('login, PDV e cadastro de produto no cardápio', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Entrar em/ })).toBeVisible();
  await page.screenshot({
    path: `test-results/screens/${info.project.name}-login.png`,
    fullPage: true,
  });

  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill('senha-errada');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('E-mail ou senha inválidos.')).toBeVisible();

  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  await expect(page.getByText('Em produção')).toBeVisible();
  await page.screenshot({
    path: `test-results/screens/${info.project.name}-pdv.png`,
    fullPage: true,
  });

  const isMobile = (page.viewportSize()?.width ?? 1200) < 1024;
  if (isMobile) await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.getByRole('link', { name: 'Cardápio' }).click();
  await expect(page.getByRole('heading', { name: 'Cardápio' })).toBeVisible();

  const name = `X-Salada ${info.project.name} ${Date.now()}`;
  await page.getByRole('button', { name: 'Adicionar item' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome').fill(name);
  await dialog.getByLabel('Preço').fill('29,90');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('29,90');
  await page.screenshot({
    path: `test-results/screens/${info.project.name}-cardapio.png`,
    fullPage: true,
  });

  // Sessão sobrevive a recarregar (cookie HttpOnly, nada no localStorage).
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cardápio' })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).length)).toBe(0);
});

test('layout não gera rolagem horizontal na página', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  for (const path of ['/', '/cardapio']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
