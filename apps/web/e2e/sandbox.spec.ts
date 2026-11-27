import { expect, test, type Page } from '@playwright/test';

/**
 * Sistema de exemplo do site (comandou.com/experimente): o app da equipe de verdade com os dados
 * da Fumaça Burger respondidos no navegador. Cada tela abre sem erro e sem chamada que o exemplo
 * não conhece, e a página inicial troca a tela pelas abas de cima.
 */
const SCREENS: [string, RegExp][] = [
  ['pdv', /Nova venda/],
  ['pedidos', /#18\d{3}/],
  ['mesas', /Varanda/],
  ['cozinha', /Iniciar preparo|Tudo pronto/],
  ['caixa', /Caixa 1/],
  ['cardapio', /Combo Fumaça/],
  ['entregas', /Na rua/],
  ['estoque', /Insumos/],
  ['financeiro', /Lucro líquido|Saldo do mês/],
  ['relatorios', /Resultado/],
];

function siteOrigin(baseURL: string) {
  // http://demo.comandou.localhost:5173 -> http://comandou.localhost:5173
  const site = new URL(baseURL);
  site.hostname = site.hostname.split('.').slice(1).join('.');
  return site.origin;
}

const unknownCalls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __cmSandbox?: { unknown: string[] } }).__cmSandbox?.unknown ?? [],
  );

test('exemplo do site: todas as telas abrem com dados', async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Nada do exemplo vai para o servidor.
  const api: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url());
  });
  for (const [tela, text] of SCREENS) {
    await page.goto(`${siteOrigin(baseURL!)}/experimente?tela=${tela}`);
    await expect(page.locator('main')).toContainText(text, { timeout: 15_000 });
    expect(await unknownCalls(page), tela).toEqual([]);
  }
  expect(errors).toEqual([]);
  expect(api).toEqual([]);
});

test('exemplo do site: uma venda no PDV vai para a cozinha', async ({ page, baseURL }) => {
  await page.goto(`${siteOrigin(baseURL!)}/experimente?tela=pdv`);
  await page
    .getByRole('button', { name: /Nova venda/ })
    .first()
    .click();
  await page.getByText('Batata frita', { exact: true }).first().click();
  await page.getByText('Média (250 g)').click();
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await page.getByRole('button', { name: /Enviar pedido/ }).click();
  await expect(page.getByText(/Pedido #\d+ criado/)).toBeVisible();
  expect(await unknownCalls(page)).toEqual([]);
});

test('site: as abas trocam a tela do sistema de exemplo', async ({ page, baseURL }, info) => {
  await page.goto(siteOrigin(baseURL!));
  const tour = page.locator('.st-tour');
  await tour.scrollIntoViewIfNeeded();
  if (info.project.name === 'mobile') {
    await tour.getByRole('tab', { name: 'Cozinha' }).click();
    await tour.getByRole('button', { name: /Mexer no sistema de exemplo/ }).click();
    const frame = page.frameLocator('.st-tour__sheet iframe');
    await expect(frame.locator('main')).toContainText(/Iniciar preparo|Tudo pronto/, {
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Fechar' }).click();
    await expect(page.locator('.st-tour__sheet')).not.toBeVisible();
    return;
  }
  const frame = page.frameLocator('.st-tour__view iframe');
  await expect(frame.locator('main')).toContainText(/Nova venda/, { timeout: 15_000 });
  await tour.getByRole('button', { name: /Mexer no sistema de exemplo/ }).click();
  await tour.getByRole('tab', { name: 'Cozinha' }).click();
  await expect(frame.locator('main')).toContainText(/Iniciar preparo|Tudo pronto/);
  // Trocar pelo menu de dentro acende a aba de fora.
  await frame.getByRole('link', { name: 'Caixa' }).first().click();
  await expect(tour.getByRole('tab', { name: 'Caixa' })).toHaveAttribute('aria-selected', 'true');
});
