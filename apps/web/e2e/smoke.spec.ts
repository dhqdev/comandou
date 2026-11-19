import { expect, test } from '@playwright/test';
import {
  nav,
  enterPanel,
  emailField,
  passwordField,
  skipTour,
  expectNoHorizontalScroll,
} from './nav';

const EMAIL = process.env.E2E_EMAIL ?? 'dono@demo.local';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
test.skip(!PASSWORD, 'defina E2E_PASSWORD (senha do administrador do tenant de teste)');

test('login, PDV e cadastro de produto no cardápio', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.screenshot({
    path: `test-results/screens/${info.project.name}-login.png`,
    fullPage: true,
  });

  await emailField(page).fill(EMAIL);
  await passwordField(page).fill('senha-errada');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText(/E-mail ou senha incorretos/)).toBeVisible();

  await passwordField(page).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await skipTour(page);
  await expect(page.getByText(/Olá, /)).toBeVisible();
  // Fica conectado no aparelho: o cookie vale semanas e não some ao fechar o app.
  const session = (await page.context().cookies()).find((c) => c.name === 'cm_sid');
  expect(session!.expires * 1000 - Date.now()).toBeGreaterThan(7 * 86400_000);
  await expect(page.getByRole('heading', { name: 'Pedidos', exact: true })).toBeVisible();
  await page.screenshot({
    path: `test-results/screens/${info.project.name}-pdv.png`,
    fullPage: true,
  });

  await nav(page, 'Itens');
  await expect(page.getByRole('heading', { name: 'Cardápio' })).toBeVisible();

  const name = `X-Salada ${info.project.name} ${Date.now()}`;
  await page.getByRole('button', { name: 'Adicionar item' }).click();
  await page.getByLabel('Nome do item', { exact: true }).fill(name);
  await page.getByLabel('Preço', { exact: true }).fill('29,90');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Item criado')).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Itens' }).click();
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('29,90');
  await page.screenshot({
    path: `test-results/screens/${info.project.name}-cardapio.png`,
    fullPage: true,
  });

  // Sessão sobrevive a recarregar (cookie HttpOnly; no localStorage só a marca de
  // apresentação vista, as cores da loja em cache, o e-mail do login e qual app da equipe o
  // aparelho usou por último, para o QR Code da mesa, e a marca do último "Limpar cache" do
  // Super Admin já aplicado neste aparelho; nada de sessão).
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cardápio' })).toBeVisible();
  const kept = new Set(['cm-brand', 'cm-login-email', 'cm.staff.app', 'cm.cacheEpoch']);
  expect(
    await page.evaluate(
      (k) => Object.keys(localStorage).filter((x) => !x.startsWith('cm-tour:') && !k.includes(x)),
      [...kept],
    ),
  ).toEqual([]);
});

test('layout não gera rolagem horizontal na página', async ({ page }) => {
  await enterPanel(page, EMAIL, PASSWORD);
  await expectNoHorizontalScroll(page, ['/', '/cardapio']);
});
