import { Browser, expect, Page, test } from '@playwright/test';
import { emailField, enterPanel, passwordField } from './nav';

/**
 * App do entregador e da cozinha: cada um entra pelo próprio endereço e vê só a sua tela.
 * O entregador precisa da localização (não precisa instalar o app), e conclui com o código do
 * cliente (que aparece no rastreio).
 */
const EMAIL = process.env.E2E_EMAIL ?? 'dono@demo.local';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
test.skip(!PASSWORD, 'defina E2E_PASSWORD (senha do administrador do tenant de teste)');

async function apiPost<T>(page: Page, path: string, data: object): Promise<T> {
  const r = await page.request.post(`/api/v1${path}`, {
    data,
    headers: { 'X-Comandou-Request': '1' },
  });
  expect(r.ok(), `${path}: ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

/** Celular com o app aberto pelo atalho (display-mode: standalone) e o GPS permitido. */
/** Celular no navegador comum (sem instalar o app), com ou sem a localização permitida. */
async function phone(browser: Browser, baseURL: string, gps = true) {
  return browser.newContext({
    baseURL,
    permissions: gps ? ['geolocation'] : [],
    geolocation: { latitude: -23.55, longitude: -46.63 },
  });
}

async function signIn(page: Page, path: string, email: string, password: string, cta: string) {
  await page.goto(path);
  await emailField(page).fill(email);
  await passwordField(page).fill(password);
  await page.getByRole('button', { name: cta }).click();
}

test('entregador: só as corridas, localização obrigatória, conclui com o código', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const tag = `${info.project.name.slice(0, 1)}${Date.now().toString(36).slice(-5)}`;
  await enterPanel(page, EMAIL, PASSWORD);

  // Entregador com login, vinculado ao cadastro de entregadores, e um pedido na rua com ele.
  const email = `moto-${tag}@demo.local`;
  const user = await apiPost<{ id: string }>(page, '/users', {
    name: `Moto ${tag}`,
    email,
    password: 'senha-do-moto-1',
    role: 'driver',
  });
  const courier = await apiPost<{ id: string }>(page, '/couriers', {
    name: `Moto ${tag}`,
    userId: user.id,
  });
  const cats = await (await page.request.get('/api/v1/categories')).json();
  const product = await apiPost<{ id: string }>(page, '/products', {
    categoryId: cats[0].id,
    name: `Lanche ${tag}`,
    price: '25.00',
  });
  const order = await apiPost<{ id: string; number: number }>(page, '/orders', {
    channel: 'delivery',
    customerName: `Cliente ${tag}`,
    deliveryAddress: 'Rua Teste, 10',
    items: [{ productId: product.id, quantity: 1 }],
  });
  await apiPost(page, `/orders/${order.id}/status`, { to: 'ready' });
  const sent = await apiPost<{ trackingPath: string }>(page, `/orders/${order.id}/dispatch`, {
    courierId: courier.id,
  });

  // O cliente vê o código de entrega no rastreio.
  const anon = await browser.newContext({ baseURL });
  const pub = await anon.newPage();
  await pub.goto(sent.trackingPath);
  const code = (await pub.locator('.dcode__num').innerText()).trim();
  expect(code).toMatch(/^[0-9]{4}$/);
  await anon.close();

  // Sem a localização, não libera as corridas.
  const browserCtx = await phone(browser, baseURL!, false);
  let moto = await browserCtx.newPage();
  await signIn(moto, '/entregas', email, 'senha-do-moto-1', 'Entrar nas entregas');
  await expect(moto.getByRole('heading', { name: 'Antes de começar' })).toBeVisible();
  await expect(moto.getByText(`#${order.number}`)).toHaveCount(0);
  await browserCtx.close();

  // No navegador, sem atalho na tela inicial, e com GPS: só as corridas, sem o menu da loja.
  const app = await phone(browser, baseURL!);
  moto = await app.newPage();
  await signIn(moto, '/entregas', email, 'senha-do-moto-1', 'Entrar nas entregas');
  await expect(moto.getByText(`Olá, Moto`)).toBeVisible();
  await expect(moto.locator('.run__num', { hasText: `#${order.number}` })).toBeVisible();
  for (const other of ['Pedidos', 'Sistema', 'Novidades', 'Cardápio'])
    await expect(moto.getByRole('link', { name: other })).toHaveCount(0);
  await moto.goto('/pedidos');
  await expect(moto).toHaveURL(/\/entregas$/);
  expect((await moto.request.get('/api/v1/orders')).status()).toBe(403);
  await moto.screenshot({ path: `test-results/screens/${info.project.name}-entregador.png` });

  const run = moto.locator('.run', {
    has: moto.locator('.run__num', { hasText: `#${order.number}` }),
  });
  await run.getByRole('button', { name: 'Entreguei' }).click();
  await run.getByLabel('Código de entrega').fill(code === '0000' ? '1111' : '0000');
  await run.getByRole('button', { name: 'Confirmar entrega' }).click();
  await expect(moto.getByText(/Código errado/)).toBeVisible();
  await run.getByLabel('Código de entrega').fill(code);
  await run.getByRole('button', { name: 'Confirmar entrega' }).click();
  await expect(moto.getByText('Entrega concluída')).toBeVisible();
  await expect(moto.getByText('Encerradas hoje (1)')).toBeVisible();
  await app.close();
});

test('cozinha: login próprio em /cozinha, só a fila e tela cheia', async ({
  page,
  browser,
  baseURL,
}, info) => {
  const tag = `${info.project.name.slice(0, 1)}${Date.now().toString(36).slice(-5)}`;
  await enterPanel(page, EMAIL, PASSWORD);
  const email = `cozinha-${tag}@demo.local`;
  await apiPost(page, '/users', {
    name: `Cozinha ${tag}`,
    email,
    password: 'senha-da-cozinha-1',
    role: 'kitchen',
  });
  const ctx = await browser.newContext({ baseURL });
  const k = await ctx.newPage();
  await signIn(k, '/cozinha', email, 'senha-da-cozinha-1', 'Entrar na cozinha');
  // A abinha de tela cheia do topo já aparece na tela de login: espera o KDS abrir de verdade.
  const kds = k.locator('.kapp');
  await expect(kds.getByRole('heading', { name: 'Cozinha' })).toBeVisible();
  await expect(kds.getByRole('button', { name: 'Tela cheia' })).toBeVisible();
  await expect(k.locator('.cm-rail, .cm-tabbar')).toHaveCount(0);
  await k.goto('/caixa');
  await expect(k).toHaveURL(/\/cozinha$/);
  await k.screenshot({ path: `test-results/screens/${info.project.name}-cozinha-app.png` });
  await ctx.close();
});
