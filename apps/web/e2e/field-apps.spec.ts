import { Browser, devices, expect, Page, test } from '@playwright/test';
import { enterPanel, expectNoHorizontalScroll } from './nav';

/**
 * Garçom e entregador no celular pequeno (iPhone SE), do jeito que usam o dia inteiro: entra pelo
 * PIN, lança pedido na mesa, recebe corrida, não consegue entregar uma, entrega a outra com o
 * código e confere os ganhos. Nenhuma tela rola na horizontal, nem no tema escuro.
 */
const EMAIL = process.env.E2E_EMAIL ?? 'dono@demo.local';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
test.skip(!PASSWORD, 'defina E2E_PASSWORD (senha do administrador do tenant de teste)');
// Um aparelho só (o celular é criado no teste): roda no projeto do computador.
test.skip(({ isMobile }) => isMobile, 'o teste cria o próprio celular');

const shot = (name: string) => `test-results/screens/${name}.png`;

async function apiPost<T>(page: Page, path: string, data: object): Promise<T> {
  const r = await page.request.post(`/api/v1${path}`, {
    data,
    headers: { 'X-Comandou-Request': '1' },
  });
  expect(r.ok(), `${path}: ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

async function phone(browser: Browser, baseURL: string, dark = false) {
  return browser.newContext({
    ...devices['iPhone SE'],
    baseURL,
    colorScheme: dark ? 'dark' : 'light',
    permissions: ['geolocation'],
    geolocation: { latitude: -23.55, longitude: -46.63 },
  });
}

async function typePin(page: Page, path: string, pin: string) {
  await page.goto(path);
  for (const d of pin) await page.getByRole('button', { name: d, exact: true }).click();
}

test('garçom no celular: PIN, pedido na mesa e comanda', async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  const tag = Date.now().toString(36).slice(-5);
  await enterPanel(page, EMAIL, PASSWORD);
  const table = await apiPost<{ id: string }>(page, '/tables', { label: `M${tag}` });
  const cats = await (await page.request.get('/api/v1/categories')).json();
  const product = await apiPost<{ id: string }>(page, '/products', {
    categoryId: cats[0].id,
    name: `Suco de laranja natural com hortelã ${tag}`,
    price: '12.50',
  });
  const waiter = await apiPost<{ pin: string }>(page, '/users', {
    name: `Garçom Campo ${tag}`,
    role: 'waiter',
  });

  for (const dark of [false, true]) {
    const ctx = await phone(browser, baseURL!, dark);
    const w = await ctx.newPage();
    await typePin(w, '/garcom', waiter.pin);
    await expect(w.getByLabel('Buscar mesa ou comanda')).toBeVisible();
    await w.goto(`/garcom/pedido?mesa=${table.id}`);
    await w
      .getByRole('button', { name: `Adicionar Suco de laranja natural com hortelã ${tag}` })
      .click();
    await w
      .getByRole('button', { name: `Mais um Suco de laranja natural com hortelã ${tag}` })
      .click();
    await w.getByRole('button', { name: /Ver pedido/ }).click();
    await w.screenshot({ path: shot(`iphone-se${dark ? '-escuro' : ''}-garcom-pedido`) });
    await w.getByRole('button', { name: /Enviar pedido · R\$ 25,00/ }).click();
    await expect(w).toHaveURL(/\/garcom\/comanda\//);
    await expect(w.getByText(/Pedido #\d+ enviado/)).toBeVisible();
    await w.waitForLoadState('networkidle');
    await w.screenshot({ path: shot(`iphone-se${dark ? '-escuro' : ''}-garcom-comanda`) });
    const tabPath = new URL(w.url()).pathname;
    await expectNoHorizontalScroll(w, ['/garcom/mesas', tabPath, '/garcom/pedidos']);
    await ctx.close();
  }
});

test('entregador no celular: PIN, corridas, não entregue, entregue e ganhos', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const tag = Date.now().toString(36).slice(-5);
  await enterPanel(page, EMAIL, PASSWORD);
  const driver = await apiPost<{ id: string; pin: string }>(page, '/users', {
    name: `Entregador Campo ${tag}`,
    role: 'driver',
  });
  const courier = (await (await page.request.get('/api/v1/couriers')).json()).find(
    (c: { userId: string }) => c.userId === driver.id,
  ) as { id: string };
  const cats = await (await page.request.get('/api/v1/categories')).json();
  const product = await apiPost<{ id: string }>(page, '/products', {
    categoryId: cats[0].id,
    name: `Marmita ${tag}`,
    price: '31.90',
  });
  const send = async (address: string, name: string) => {
    const o = await apiPost<{ id: string; number: number }>(page, '/orders', {
      channel: 'delivery',
      customerName: name,
      customerPhone: '11988887777',
      deliveryAddress: address,
      notes: 'Interfone quebrado, ligar quando chegar no portão azul',
      items: [{ productId: product.id, quantity: 1 }],
    });
    await apiPost(page, `/orders/${o.id}/status`, { to: 'ready' });
    const r = await apiPost<{ trackingPath: string }>(page, `/orders/${o.id}/dispatch`, {
      courierId: courier.id,
    });
    return { ...o, trackingPath: r.trackingPath };
  };
  const a = await send(
    'Avenida Engenheiro Luís Carlos Berrini, 1748, Bloco B, apartamento 2304, Cidade Monções',
    `Maria Aparecida dos Santos Oliveira ${tag}`,
  );
  const b = await send('Rua Teste, 99', `Cliente B ${tag}`);
  const anon = await browser.newContext({ baseURL });
  const pub = await anon.newPage();
  await pub.goto(b.trackingPath);
  const code = (await pub.locator('.dcode__num').innerText()).trim();
  await anon.close();

  // Primeiro o tema escuro (só confere a tela); depois o claro faz as ações.
  for (const dark of [true, false]) {
    const ctx = await phone(browser, baseURL!, dark);
    const m = await ctx.newPage();
    await typePin(m, '/entregas', driver.pin);
    // O app abre no Início; as corridas ficam na aba Entregas.
    await m
      .getByRole('navigation', { name: 'Painel do entregador' })
      .getByRole('button', { name: /^Entregas/ })
      .click();
    await expect(m.locator('.run__num', { hasText: `#${a.number}` })).toBeVisible();
    await expect(m.locator('.run__num', { hasText: `#${b.number}` })).toBeVisible();
    await m.waitForLoadState('networkidle');
    await m.screenshot({
      path: shot(`iphone-se${dark ? '-escuro' : ''}-entregador`),
      fullPage: true,
    });
    await expectNoHorizontalScroll(m, ['/entregas']);
    if (dark) {
      await ctx.close();
      continue;
    }
    const runA = m.locator('.run', { has: m.locator('.run__num', { hasText: `#${a.number}` }) });
    await runA.getByRole('button', { name: 'Não consegui' }).click();
    await runA.getByLabel('Por que não foi entregue?').fill('Cliente ausente');
    await runA.getByRole('button', { name: 'Confirmar' }).click();
    await expect(m.getByText('Avisamos o restaurante')).toBeVisible();

    const runB = m.locator('.run', { has: m.locator('.run__num', { hasText: `#${b.number}` }) });
    await runB.getByRole('button', { name: 'Entreguei' }).click();
    await runB.getByLabel('Código de entrega').fill(code);
    await m.screenshot({ path: shot('iphone-se-entregador-codigo') });
    await runB.getByRole('button', { name: 'Confirmar entrega' }).click();
    await expect(m.getByText('Entrega concluída')).toBeVisible();
    await expect(m.getByText(/Encerradas hoje \(2\)/)).toBeVisible();
    await expect(m.getByText('Nenhuma entrega com você agora')).toBeVisible();

    // Os ganhos ficam no Histórico.
    await m
      .getByRole('navigation', { name: 'Painel do entregador' })
      .getByRole('button', { name: /^Histórico/ })
      .click();
    await m.getByRole('tab', { name: 'Meus ganhos' }).click();
    await m.waitForLoadState('networkidle');
    await m.screenshot({ path: shot('iphone-se-entregador-ganhos'), fullPage: true });
    await expectNoHorizontalScroll(m, ['/entregas']);
    // Sair volta para o PIN.
    await m.getByRole('button', { name: 'Sair' }).click();
    await expect(m.getByRole('heading', { name: 'Acesso do entregador' })).toBeVisible();
    await ctx.close();
  }
});
