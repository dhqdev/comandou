import { expect, Page, test } from '@playwright/test';

/**
 * Fluxo da Etapa 5 no navegador, sem contas reais de Focus NFe ou WhatsApp:
 * dados fiscais no cardápio → configuração fiscal → NFC-e no pedido pago (bloqueada com a
 * emissão desativada) → tela do WhatsApp (QR Code com aviso de risco; API oficial) → Novidades.
 */
const EMAIL = process.env.E2E_EMAIL ?? 'dono@demo.local';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
test.skip(!PASSWORD, 'defina E2E_PASSWORD (senha do administrador do tenant de teste)');

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
}

async function nav(page: Page, name: string | RegExp) {
  const isMobile = (page.viewportSize()?.width ?? 1200) < 1024;
  if (isMobile) await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.getByRole('link', { name, exact: typeof name === 'string' }).click();
}

async function api<T>(
  page: Page,
  method: 'POST' | 'PUT',
  path: string,
  data: object,
  idem?: string,
) {
  const r = await page.request.fetch(`/api/v1${path}`, {
    method,
    data,
    headers: { 'X-Comandou-Request': '1', ...(idem ? { 'Idempotency-Key': idem } : {}) },
  });
  expect(r.ok(), `${path}: ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

const shot = (page: Page, project: string, name: string) =>
  page.screenshot({ path: `test-results/screens/${project}-${name}.png`, fullPage: true });

test('integrações: dados fiscais, NFC-e no pedido e WhatsApp', async ({ page }, info) => {
  test.setTimeout(120_000);
  const tag = `${info.project.name.slice(0, 1)}${Date.now().toString(36).slice(-5)}`;
  await login(page);

  // Produto com dados fiscais pelo Cardápio
  const cats = await (await page.request.get('/api/v1/categories')).json();
  const product = await api<{ id: string; name: string }>(page, 'POST', '/products', {
    categoryId: cats[0].id,
    name: `Suco NF ${tag}`,
    price: '9.50',
  });
  await nav(page, 'Cardápio');
  await page.getByRole('button', { name: cats[0].name }).first().click();
  await page
    .getByRole('row', { name: new RegExp(`Suco NF ${tag}`) })
    .getByRole('button', { name: 'Configurar' })
    .click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('NCM').fill('123');
  await expect(dialog.getByText('8 dígitos')).toBeVisible();
  await dialog.getByLabel('NCM').fill('22029900');
  await dialog.getByLabel('CSOSN / CST do ICMS').fill('102');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Produto atualizado')).toBeVisible();
  const saved = await (await page.request.get(`/api/v1/products/${product.id}`)).json();
  expect(saved).toMatchObject({ ncm: '22029900', fiscalCode: '102' });

  // Configuração fiscal (homologação; sem token, a emissão não ativa)
  await nav(page, 'Nota fiscal');
  await page.getByRole('tab', { name: 'Configuração' }).click();
  await expect(page.getByText('Homologação (teste)')).toBeVisible();
  await page.getByLabel('CNPJ do emitente').fill('12.345.678/0001-95');
  await page.getByLabel('NCM padrão').fill('21069090');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Configuração salva')).toBeVisible();
  await shot(page, info.project.name, 'nota-fiscal-config');

  // Pedido pago: o detalhe mostra a NFC-e; com a emissão desativada, a API recusa e a tela avisa.
  const reg = await api<{ id: string }>(page, 'POST', '/cash-registers', {
    name: `Caixa NF ${tag}`,
  });
  const sess = await api<{ id: string }>(page, 'POST', '/cash/sessions', {
    registerId: reg.id,
    openingAmount: '0.00',
  });
  const order = await api<{ id: string; number: number }>(page, 'POST', '/orders', {
    channel: 'counter',
    items: [{ productId: product.id, quantity: 1 }],
  });
  await api(
    page,
    'POST',
    `/orders/${order.id}/payments`,
    {
      cashSessionId: sess.id,
      method: 'pix',
      amount: '9.50',
    },
    `e2e-nf-${tag}`,
  );
  await nav(page, 'Pedidos');
  await page.getByRole('row', { name: new RegExp(`^${order.number} `) }).click();
  dialog = page.getByRole('dialog').filter({ hasText: /Pedido #/ });
  await expect(dialog.getByRole('heading', { name: 'Nota fiscal (NFC-e)' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Emitir NFC-e' }).click();
  await expect(page.getByText(/Emissão fiscal desativada/)).toBeVisible();
  await shot(page, info.project.name, 'pedido-nfce');
  await dialog.getByRole('button', { name: 'Fechar' }).click();
  // Fecha o caixa de teste para não sobrar sessão aberta.
  await api(
    page,
    'POST',
    `/cash/sessions/${sess.id}/close`,
    { counted: { cash: '0.00', pix: '9.50' } },
    `e2e-close-${tag}`,
  );

  // WhatsApp: QR Code por padrão, com aviso de risco; API oficial como alternativa
  await nav(page, 'WhatsApp');
  await expect(page.getByRole('heading', { name: 'Conexão por QR Code' })).toBeVisible();
  await expect(page.getByText(/pode bloquear o número/)).toBeVisible();
  await page
    .getByLabel('Texto: pedido pronto')
    .fill(`Oi {cliente}, pedido {pedido} pronto! ${tag}`);
  await page.getByRole('button', { name: 'Salvar textos' }).click();
  await expect(page.getByText('Textos salvos')).toBeVisible();
  await shot(page, info.project.name, 'whatsapp-qr');
  await page.getByRole('tab', { name: 'API oficial da Meta' }).click();
  await expect(page.getByLabel('ID do número de telefone')).toBeVisible();
  await page.getByRole('tab', { name: 'QR Code (padrão)' }).click();
  await expect(page.getByRole('heading', { name: 'Conexão por QR Code' })).toBeVisible();

  // Novidades
  await nav(page, /^Novidades/);
  await expect(page.getByRole('heading', { name: /0\.4\.0/ })).toBeVisible();
});

test('telas da etapa 5 não geram rolagem horizontal', async ({ page }) => {
  await login(page);
  for (const path of ['/nota-fiscal', '/whatsapp']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
