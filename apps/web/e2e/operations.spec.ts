import { expect, Page, test } from '@playwright/test';
import { nav, settled } from './nav';

/**
 * Fluxo da Etapa 3 no navegador: cadastros → adicionais → caixa → venda com variação →
 * pagamento → cozinha → mesa com divisão de conta → fechamento de caixa.
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

async function pickCaixa(dialog: ReturnType<Page['getByRole']>, tag: string) {
  const select = dialog.getByLabel('Caixa');
  const value = await select.locator('option', { hasText: `Caixa ${tag}` }).getAttribute('value');
  await select.selectOption(value!);
}

const shot = (page: Page, project: string, name: string) =>
  page.screenshot({ path: `test-results/screens/${project}-${name}.png`, fullPage: true });

test('operação completa: venda, cozinha, mesa e caixa', async ({ page }, info) => {
  test.setTimeout(120_000);
  const tag = `${info.project.name.slice(0, 1)}${Date.now().toString(36).slice(-5)}`;
  await login(page);
  await expect(page.getByText('Tempo real', { exact: true })).toBeVisible();

  // Ajustes: mesa e terminal de caixa
  await nav(page, 'Ajustes');
  await page.getByLabel('Número/nome da mesa').fill(`M${tag}`);
  await page.getByLabel('Número/nome da mesa').press('Enter');
  await expect(page.getByText(`Mesa M${tag}`)).toBeVisible();
  await page.getByLabel('Nome do terminal').fill(`Caixa ${tag}`);
  await page.getByLabel('Nome do terminal').press('Enter');
  await expect(page.getByText(`Caixa ${tag}`)).toBeVisible();
  await shot(page, info.project.name, 'ajustes');

  // Cardápio: produto + variação de tamanho
  await nav(page, 'Cardápio');
  const product = `Burger ${tag}`;
  await page.getByRole('button', { name: 'Adicionar item' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome').fill(product);
  await dialog.getByLabel('Preço').fill('20,00');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('row', { name: new RegExp(product) })).toBeVisible();

  await page.getByRole('button', { name: 'Novo grupo' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome do grupo').fill(`Tamanho ${tag}`);
  await dialog.getByRole('radio', { name: 'Variação (escolhe 1)' }).click();
  await dialog.getByLabel('Opção 1').fill('Simples');
  await dialog.getByRole('button', { name: 'Mais uma opção' }).click();
  await dialog.getByLabel('Opção 2').fill('Duplo');
  await dialog.getByLabel('Preço adicional 2').fill('8,50');
  await dialog.getByRole('button', { name: 'Salvar grupo' }).click();
  await expect(page.getByText(`Tamanho ${tag}`)).toBeVisible();

  await page
    .getByRole('row', { name: new RegExp(product) })
    .getByRole('button', { name: 'Configurar' })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: new RegExp(`Tamanho ${tag}`) }).check();
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('row', { name: new RegExp(product) })).toContainText(
    `Opções: Tamanho ${tag}`,
  );
  await shot(page, info.project.name, 'cardapio-opcoes');

  // Caixa: abrir com fundo de troco
  await nav(page, 'Caixa');
  const tile = page.locator('.register-tile', { hasText: `Caixa ${tag}` });
  await tile.getByRole('button', { name: 'Abrir caixa' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Fundo de troco/).fill('100,00');
  await dialog.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(
    page.getByRole('heading', { name: new RegExp(`Caixa ${tag} · sessão`) }),
  ).toBeVisible();

  // PDV: venda de balcão com variação, pagamento em dinheiro com troco
  await nav(page, 'PDV');
  await page.getByRole('button', { name: /Novo pedido/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Buscar produto').fill(product);
  await dialog.getByRole('button', { name: new RegExp(product) }).click();
  await page
    .getByRole('group', { name: `Opções de ${product}` })
    .getByLabel('Duplo')
    .check();
  await page
    .getByRole('group', { name: `Opções de ${product}` })
    .getByRole('button', { name: 'Adicionar' })
    .click();
  await expect(dialog.locator('.totals__grand').last()).toHaveText('R$ 28,50');
  await shot(page, info.project.name, 'nova-venda');
  await dialog.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page.getByText(/Pedido #\d+ criado/)).toBeVisible();
  const card = page.locator('.hcard', { hasText: product }).filter({ hasText: 'R$ 28,50' }).first();
  await expect(card).toBeVisible();
  await shot(page, info.project.name, 'pdv-kanban');

  await card.getByRole('button', { name: /Abrir pedido/ }).click();
  dialog = page.getByRole('dialog').filter({ hasText: /Pedido #/ });
  await dialog.getByRole('button', { name: /Receber/ }).click();
  const pay = page.getByRole('dialog').filter({ hasText: 'Receber — pedido' });
  await pickCaixa(pay, tag);
  await pay.getByRole('radio', { name: 'Dinheiro' }).click();
  await pay.getByLabel(/Valor entregue/).fill('50,00');
  await expect(pay.getByText('Troco: R$ 21,50')).toBeVisible();
  await pay.getByRole('button', { name: /Confirmar/ }).click();
  await expect(page.getByText('Pagamento confirmado. Troco: R$ 21,50')).toBeVisible();
  await expect(dialog.locator('.cm-badge', { hasText: /^Pago$/ })).toBeVisible();
  await shot(page, info.project.name, 'pedido-pago');
  await dialog.getByRole('button', { name: 'Fechar' }).click();

  // Cozinha: item avança o pedido
  await nav(page, 'Cozinha');
  const kcard = page.locator('.kds-card', { hasText: product }).first();
  await kcard.getByRole('button', { name: `${product}: iniciar` }).click();
  await expect(
    page.locator('section[aria-label="Preparando"] .kds-card', { hasText: product }),
  ).toBeVisible();
  await shot(page, info.project.name, 'cozinha');
  await page
    .locator('.kds-card', { hasText: product })
    .first()
    .getByRole('button', { name: `${product}: pronto` })
    .click();
  await expect(
    page.locator('section[aria-label="Pronto"] .kds-card', { hasText: product }),
  ).toBeVisible();

  // Salão: abre mesa, lança pedido, divide em 2, fecha conta
  await nav(page, 'Salão');
  // Mesa livre já abre o pedido: a comanda nasce com o primeiro pedido enviado.
  await page.getByRole('button', { name: `Mesa M${tag} livre` }).click();
  const sale = page.getByRole('dialog', { name: `Novo pedido — Mesa M${tag}` });
  await expect(sale).toBeVisible();
  await settled(page);
  await sale.getByLabel('Buscar produto').fill(product);
  await sale.getByRole('button', { name: new RegExp(product) }).click();
  await page
    .getByRole('group', { name: `Opções de ${product}` })
    .getByLabel('Simples')
    .check();
  await page
    .getByRole('group', { name: `Opções de ${product}` })
    .getByRole('button', { name: 'Adicionar' })
    .click();
  await sale.getByRole('button', { name: 'Aumentar' }).click();
  await sale.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(sale).toBeHidden();
  await page.getByRole('button', { name: `Mesa M${tag} ocupada` }).click();
  dialog = page.getByRole('dialog').filter({ hasText: `Mesa M${tag}` });
  await settled(page);
  await expect(dialog.locator('.tab-summary')).toContainText('R$ 40,00');
  await dialog.getByRole('button', { name: 'Receber / dividir' }).click();
  const tabPay = page.getByRole('dialog').filter({ hasText: 'Receber — comanda' });
  await pickCaixa(tabPay, tag);
  await tabPay.getByRole('button', { name: '2', exact: true }).click();
  await expect(tabPay.getByLabel('Valor')).toHaveValue('20,00');
  await shot(page, info.project.name, 'dividir-conta');
  await tabPay.getByRole('button', { name: /Confirmar/ }).click();
  await expect(dialog.locator('.tab-summary')).toContainText('R$ 20,00');
  await dialog.getByRole('button', { name: 'Receber / dividir' }).click();
  await tabPay.getByRole('button', { name: /Confirmar R\$ 20,00/ }).click();
  await expect(dialog.getByRole('button', { name: 'Fechar conta' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Fechar conta' }).click();
  await expect(page.getByText(/há 1 pedido\(s\) ainda em produção/i)).toBeVisible();
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();

  await nav(page, 'Cozinha');
  await page
    .locator('.kds-card', { hasText: `Mesa M${tag}` })
    .getByRole('button', { name: 'Tudo pronto' })
    .click();
  await expect(
    page.locator('section[aria-label="Pronto"] .kds-card', { hasText: `Mesa M${tag}` }),
  ).toBeVisible();
  await nav(page, 'Salão');
  // Com parte já paga, a mesa aparece como "em pagamento".
  await page
    .getByRole('button', { name: new RegExp(`Mesa M${tag} (ocupada|em pagamento)`) })
    .click();
  dialog = page.getByRole('dialog').filter({ hasText: `Mesa M${tag}` });
  await dialog.getByRole('button', { name: 'Fechar conta' }).click();
  await expect(page.getByText(/Conta da comanda \d+ fechada/)).toBeVisible();
  await expect(page.getByRole('button', { name: `Mesa M${tag} livre` })).toBeVisible();
  await shot(page, info.project.name, 'salao');

  // Caixa: sangria e fechamento com diferença (exige observação)
  await nav(page, 'Caixa');
  await page
    .locator('.register-tile', { hasText: `Caixa ${tag}` })
    .getByRole('button', { name: 'Ver movimento' })
    .click();
  await page.getByRole('button', { name: 'Sangria' }).click();
  dialog = page.getByRole('dialog').filter({ hasText: 'Sangria' });
  await dialog.getByLabel('Valor').fill('10,00');
  await dialog.getByLabel('Motivo').fill('cofre');
  await dialog.getByRole('button', { name: 'Registrar' }).click();
  // 100 + 28,50 (dinheiro) − 10 = 118,50
  await expect(page.locator('.stat', { hasText: 'Dinheiro esperado' })).toContainText('R$ 118,50');
  await page.getByRole('button', { name: 'Fechar caixa' }).click();
  dialog = page.getByRole('dialog').filter({ hasText: 'Fechamento conferido' });
  await dialog.getByLabel('Contado Dinheiro').fill('118,00');
  await dialog.getByLabel('Contado PIX').fill('40,00');
  await expect(dialog.getByText('Diferença total: -R$ 0,50')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Fechar caixa' })).toBeDisabled();
  await dialog.getByLabel(/Observação/).fill('faltaram 50 centavos');
  await shot(page, info.project.name, 'fechamento');
  await dialog.getByRole('button', { name: 'Fechar caixa' }).click();
  await expect(page.getByText(/Fechado em .* Diferença/)).toBeVisible();
  await shot(page, info.project.name, 'caixa-fechado');

  // Relatórios
  await nav(page, 'Relatórios');
  await expect(page.locator('.stat', { hasText: 'Faturamento' })).toBeVisible();
  await shot(page, info.project.name, 'relatorios');
});

test('telas novas não geram rolagem horizontal', async ({ page }) => {
  await login(page);
  for (const path of [
    '/',
    '/pedidos',
    '/mesas',
    '/cozinha',
    '/caixa',
    '/relatorios',
    '/configuracoes',
    '/cardapio',
  ]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
