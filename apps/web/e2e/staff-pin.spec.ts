import { devices, expect, test } from '@playwright/test';
import { enterPanel, expectNoHorizontalScroll } from './nav';

/**
 * Garçom pelo PIN: o gerente cadastra só com o nome em Equipe, vê o PIN uma vez, e o garçom entra
 * no celular digitando os 4 números. As telas do app do garçom não rolam na horizontal, nem no
 * celular pequeno, e o teclado do PIN cabe sem rolar.
 */
const EMAIL = process.env.E2E_EMAIL ?? 'dono@demo.local';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
test.skip(!PASSWORD, 'defina E2E_PASSWORD (senha do administrador do tenant de teste)');

const shot = (name: string) => `test-results/screens/${name}.png`;

test('garçom: cadastro só com nome em Equipe e entrada pelo PIN', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const tag = `${info.project.name.slice(0, 1)}${Date.now().toString(36).slice(-5)}`;
  const name = `Garçom ${tag}`;
  await enterPanel(page, EMAIL, PASSWORD);
  await page.goto('/equipe');
  await page.getByRole('button', { name: 'Adicionar pessoa' }).click();
  const add = page.getByRole('dialog', { name: 'Adicionar pessoa' });
  await add.getByLabel('Nome').fill(name);
  await add.getByLabel('Papel').selectOption('waiter');
  // Garçom não precisa de e-mail nem senha.
  await expect(add.getByLabel('E-mail')).toHaveCount(0);
  await add.getByRole('button', { name: 'Adicionar' }).click();
  const pin = (await page.getByTestId('staff-pin').innerText()).trim();
  expect(pin).toMatch(/^[0-9]{4}$/);
  await page.screenshot({ path: shot(`${info.project.name}-pin-criado`) });
  await page.getByRole('button', { name: 'Pronto' }).click();
  // Tabela no computador, cartões no celular: os dois têm data-search-id="membro-…".
  const row = page.locator('[data-search-id^="membro-"]', { hasText: name });
  await expect(row).toContainText('PIN');
  await expect(row.getByRole('button', { name: `Novo PIN para ${name}` })).toBeVisible();
  // Quem entra só com PIN não tem senha para trocar.
  await expect(row.getByRole('button', { name: /Nova senha/ })).toHaveCount(0);

  for (const [label, device] of [
    ['pixel7', devices['Pixel 7']],
    ['iphone-se', devices['iPhone SE']],
  ] as const) {
    const ctx = await browser.newContext({ ...device, baseURL });
    const w = await ctx.newPage();
    await w.goto('/garcom');
    await expect(w.getByRole('heading', { name: 'Acesso do garçom' })).toBeVisible();
    // O teclado inteiro cabe na tela, sem rolar.
    const zero = w.getByRole('button', { name: '0', exact: true });
    const box = await zero.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(w.viewportSize()!.height);
    await w.screenshot({ path: shot(`${label}-pin-garcom`) });
    for (const d of pin) await w.getByRole('button', { name: d, exact: true }).click();
    await expect(w.getByLabel('Buscar mesa ou comanda')).toBeVisible();
    await expectNoHorizontalScroll(w, [
      '/garcom/mesas',
      '/garcom/pedidos',
      '/garcom/desafios',
      '/garcom/pedido',
    ]);
    await w.goto('/garcom/mesas');
    await expect(w.getByLabel('Buscar mesa ou comanda')).toBeVisible();
    await w.waitForLoadState('networkidle');
    await w.screenshot({ path: shot(`${label}-garcom-mesas`) });
    // Cadastrado só com PIN: a conta não oferece "Trocar senha".
    await w.getByRole('button', { name: 'Conta' }).click();
    await expect(w.getByRole('button', { name: 'Trocar senha' })).toHaveCount(0);
    await ctx.close();
  }
});
