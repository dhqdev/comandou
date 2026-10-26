import { expect, Page, test } from '@playwright/test';
import { ADMIN_PASSWORD, ADMIN_TOTP, adminLogin } from './admin';
import { nav } from './nav';

/**
 * Contrato digital do cliente no navegador: o painel configura a contratada, gera o contrato e
 * copia o link; o cliente abre o link, só consegue assinar depois de ler até o fim, assina
 * desenhando e baixa a via assinada; o painel mostra o contrato assinado.
 */
test.skip(!ADMIN_PASSWORD || !ADMIN_TOTP, 'defina E2E_ADMIN_PASSWORD e E2E_ADMIN_TOTP');

const shot = (page: Page, project: string, name: string) =>
  page.screenshot({ path: `test-results/screens/${project}-${name}.png`, fullPage: true });

test('Contrato: gerar, assinar pelo link e guardar o PDF assinado', async ({ page }, info) => {
  test.setTimeout(150_000);
  await adminLogin(page);
  await nav(page, 'Restaurantes');
  await page.getByText('Restaurante Demo').first().click();
  await expect(page.getByRole('heading', { name: /Restaurante Demo/ })).toBeVisible();

  // Cadastro do cliente (razão social e CNPJ entram no contrato).
  await page.getByRole('tab', { name: 'Cadastro' }).click();
  await page.getByLabel('Razão social').fill('Restaurante Demo Alimentos Ltda');
  await page.getByLabel('CPF ou CNPJ').fill('11222333000181');
  const save = page.getByRole('button', { name: 'Salvar cadastro' });
  if (await save.isEnabled()) {
    await save.click();
    await expect(page.getByText('Cadastro salvo')).toBeVisible();
  }

  // Dados da contratada.
  await page.getByRole('tab', { name: 'Contrato' }).click();
  await page.getByRole('button', { name: 'Configurar' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Razão social').fill('Comandou Tecnologia Ltda');
  await dialog.getByLabel('CNPJ').fill('12345678000195');
  await expect(dialog.getByLabel('CNPJ')).toHaveValue('12.345.678/0001-95');
  await dialog.getByLabel('Foro (cidade/UF)').fill('São Paulo/SP');
  await shot(page, info.project.name, 'contrato-configurar');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Configuração salva')).toBeVisible();
  await dialog.getByRole('button', { name: 'Fechar' }).click();

  // Gerar.
  await page.getByRole('button', { name: 'Gerar contrato' }).click();
  dialog = page.getByRole('dialog');
  // O restaurante de teste não tem assinatura: plano e mensalidade vão à mão.
  await dialog.getByLabel('Plano').fill('Profissional');
  await dialog.getByLabel('Mensalidade (R$)').fill('179,90');
  await dialog.getByLabel('Implantação (R$)').fill('250,00');
  await dialog.getByLabel('Condições especiais').fill('Primeiro mês com 50% de desconto.');
  await dialog.getByRole('button', { name: 'Gerar contrato' }).click();
  await expect(page.getByText(/Contrato CMD-\d{4}-\d{4} gerado/)).toBeVisible();
  dialog = page.getByRole('dialog');
  await expect(dialog.locator('.adm-tag', { hasText: 'rascunho' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Copiar link' }).click();
  const link = (await dialog.locator('code').first().textContent())!;
  expect(link).toMatch(/\/assinar\/[A-Za-z0-9_-]{43}$/);
  await shot(page, info.project.name, 'contrato-painel');

  // Cliente abre o link (sem login), lê até o fim e assina.
  const client = await page
    .context()
    .browser()!
    .newPage({
      viewport: page.viewportSize() ?? undefined,
    });
  await client.goto(link);
  await expect(client.getByText('Contrato nº', { exact: false }).first()).toBeVisible();
  await expect(client.getByText('Role o contrato até o fim')).toBeVisible();
  await expect(client.getByRole('button', { name: 'Assinar contrato' })).toBeDisabled();
  await expect(client.getByText('Cláusula 15 · Proteção de dados pessoais (LGPD)')).toBeVisible();
  await client.locator('.cs-end').scrollIntoViewIfNeeded();
  await expect(client.getByText('Role o contrato até o fim')).toBeHidden();
  await client.getByLabel('Nome completo').fill('Dona Demo da Silva');
  await client.getByLabel('CPF').fill('52998224725');
  await expect(client.getByLabel('CPF')).toHaveValue('529.982.247-25');
  await client.getByLabel('E-mail').fill('dona@demo.local');
  const pad = client.locator('.cs-pad__canvas');
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await client.mouse.move(box.x + 30, box.y + 120);
  await client.mouse.down();
  for (let i = 1; i <= 12; i++)
    await client.mouse.move(box.x + 30 + i * 18, box.y + 120 - Math.sin(i / 2) * 40);
  await client.mouse.up();
  await client.getByText('Li todo o contrato').click();
  await shot(client, info.project.name, 'contrato-assinar');
  await client.getByRole('button', { name: 'Assinar contrato' }).click();
  await expect(client.getByRole('heading', { name: 'Contrato assinado' })).toBeVisible();
  const download = client.waitForEvent('download');
  await client.getByRole('link', { name: 'Baixar contrato assinado' }).click();
  expect((await download).suggestedFilename()).toMatch(/-assinado\.pdf$/);
  await shot(client, info.project.name, 'contrato-assinado');
  await client.close();

  // O painel mostra o contrato assinado e o PDF guardado.
  await dialog.getByRole('button', { name: 'Fechar' }).click();
  await page.getByRole('tab', { name: 'Cadastro' }).click();
  await page.getByRole('tab', { name: 'Contrato' }).click();
  await page.locator('.adm-row', { hasText: 'assinado' }).first().click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Dona Demo da Silva')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Baixar assinado' })).toBeVisible();
});
