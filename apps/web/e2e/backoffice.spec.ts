import { expect, Page, test } from '@playwright/test';
import { nav } from './nav';

/**
 * Fluxo da Etapa 4 no navegador: equipe → estoque com ficha técnica → delivery com
 * entregador e rastreio público → financeiro → impressão → novidades.
 */
const EMAIL = process.env.E2E_EMAIL ?? 'dono@demo.local';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
test.skip(!PASSWORD, 'defina E2E_PASSWORD (senha do administrador do tenant de teste)');

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText(/Olá, /)).toBeVisible();
}

/** Chamada direta à API com a sessão do navegador (para preparar dados). */
async function apiPost<T>(page: Page, path: string, data: object): Promise<T> {
  const r = await page.request.post(`/api/v1${path}`, {
    data,
    headers: { 'X-Comandou-Request': '1' },
  });
  expect(r.ok(), `${path}: ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

const shot = (page: Page, project: string, name: string) =>
  page.screenshot({ path: `test-results/screens/${project}-${name}.png`, fullPage: true });

test('retaguarda: equipe, estoque, entrega com rastreio, financeiro e impressão', async ({
  page,
  context,
}, info) => {
  test.setTimeout(120_000);
  const tag = `${info.project.name.slice(0, 1)}${Date.now().toString(36).slice(-5)}`;
  await login(page);

  // Equipe: adiciona um entregador
  await nav(page, 'Equipe');
  await page.getByRole('button', { name: 'Adicionar pessoa' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome').fill(`Moto ${tag}`);
  await dialog.getByLabel('E-mail').fill(`moto-${tag}@demo.local`);
  await dialog.getByLabel('Senha inicial').fill('senha-do-moto-1');
  await dialog.getByLabel('Papel').selectOption('driver');
  await dialog.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByRole('row', { name: new RegExp(`Moto ${tag}`) })).toBeVisible();
  await shot(page, info.project.name, 'equipe');

  // Dados de apoio: produto e categoria via API
  const cats = await (await page.request.get('/api/v1/categories')).json();
  const product = await apiPost<{ id: string }>(page, '/products', {
    categoryId: cats[0].id,
    name: `Lanche ${tag}`,
    price: '30.00',
  });

  // Estoque: insumo, entrada e ficha técnica
  await nav(page, 'Estoque');
  await page.getByRole('button', { name: 'Novo insumo' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome').fill(`Pão ${tag}`);
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  const row = page.getByRole('row', { name: new RegExp(`Pão ${tag}`) });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Entrada' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Quantidade/).fill('10');
  await dialog.getByLabel(/^Custo por/).fill('1,50');
  await dialog.getByRole('button', { name: 'Registrar' }).click();
  await expect(row).toContainText('10 un');

  await page.getByRole('tab', { name: 'Ficha técnica' }).click();
  await page.getByLabel('Produto ou adicional').selectOption({ label: `Lanche ${tag}` });
  await page.getByRole('button', { name: 'Adicionar insumo' }).click();
  await page.getByLabel('Insumo', { exact: true }).selectOption({ label: `Pão ${tag} (un)` });
  await page.getByLabel(/^Quantidade/).fill('1');
  await page.getByRole('button', { name: 'Salvar ficha' }).click();
  await expect(page.getByText('Ficha técnica salva')).toBeVisible();
  await shot(page, info.project.name, 'estoque');

  // Pedido de delivery pronto (via API) → despacho pela tela de Entregas
  const order = await apiPost<{ id: string; number: number }>(page, '/orders', {
    channel: 'delivery',
    customerName: `Cliente ${tag}`,
    deliveryAddress: 'Rua Teste, 10',
    items: [{ productId: product.id, quantity: 1 }],
  });
  await apiPost(page, `/orders/${order.id}/status`, { to: 'ready' });

  await nav(page, 'Entregas');
  await page.getByLabel('Nome', { exact: true }).fill(`João ${tag}`);
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.locator('strong', { hasText: `João ${tag}` })).toBeVisible();
  await page
    .getByLabel(`Entregador do pedido ${order.number}`)
    .selectOption({ label: `João ${tag}` });
  await page.getByRole('button', { name: 'Saiu para entrega' }).first().click();
  dialog = page.getByRole('dialog');
  const link = await dialog.getByLabel('Link de rastreio').inputValue();
  expect(link).toMatch(/\/rastreio\/[A-Za-z0-9_-]+$/);
  await shot(page, info.project.name, 'entregas-link');
  await dialog.getByRole('button', { name: 'Fechar' }).click();

  // Rastreio público em outra aba, sem login
  const anon = await context.browser()!.newContext();
  const pub = await anon.newPage();
  await pub.goto(link);
  await expect(pub.getByText('Saiu para entrega')).toBeVisible();
  await expect(pub.getByText(`Pedido #${order.number}`)).toBeVisible();
  await expect(pub.getByText('Rua Teste')).toHaveCount(0);
  await pub.screenshot({ path: `test-results/screens/${info.project.name}-rastreio.png` });

  const card = page.locator('.order-card', { hasText: `#${order.number}` });
  await card.getByRole('button', { name: 'Entregue', exact: true }).click();
  await expect(page.getByText('Entrega concluída')).toBeVisible();
  await pub.reload();
  await expect(pub.getByText('Entregue', { exact: true })).toBeVisible();
  await anon.close();

  // A venda baixou o insumo
  await nav(page, 'Estoque');
  await expect(page.getByRole('row', { name: new RegExp(`Pão ${tag}`) })).toContainText('9 un');

  // Financeiro: conta a pagar e baixa
  await nav(page, 'Financeiro');
  await page.getByRole('button', { name: 'Novo lançamento' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Descrição').fill(`Fornecedor ${tag}`);
  await dialog.getByLabel('Valor (R$)').fill('123,45');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  const bill = page.getByRole('row', { name: new RegExp(`Fornecedor ${tag}`) });
  await expect(bill).toContainText('R$ 123,45');
  await bill.getByRole('button', { name: 'Pagar' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Confirmar/ })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByLabel('Situação').selectOption('paid');
  await expect(page.getByRole('row', { name: new RegExp(`Fornecedor ${tag}`) })).toContainText(
    'Pago',
  );
  await page.getByRole('tab', { name: 'Fluxo de caixa' }).click();
  await expect(page.getByRole('cell', { name: 'Total' })).toBeVisible();
  await shot(page, info.project.name, 'financeiro');

  // Impressão: agente com token mostrado uma vez
  await nav(page, 'Impressão');
  await page.getByLabel('Nome do computador').fill(`PC ${tag}`);
  await page.getByRole('button', { name: 'Adicionar agente' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Token')).toHaveValue(/^pma_/);
  await dialog.getByRole('button', { name: 'Fechar' }).click();
  // Desativa para não deixar a fila do tenant de teste ativa.
  await page
    .locator('li', { hasText: `PC ${tag}` })
    .getByRole('button', { name: 'desativar' })
    .click();
  await expect(page.locator('li', { hasText: `PC ${tag}` })).toContainText('desativado');
  await shot(page, info.project.name, 'impressao');

  // Novidades
  await nav(page, /^Novidades/);
  await expect(page.getByRole('heading', { name: /0\.3\.0/ })).toBeVisible();
});

test('telas da etapa 4 não geram rolagem horizontal', async ({ page }) => {
  await login(page);
  for (const path of [
    '/entregas',
    '/estoque',
    '/financeiro',
    '/equipe',
    '/impressao',
    '/novidades',
  ]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
