import { createHmac } from 'node:crypto';
import { expect, Page, test } from '@playwright/test';

/**
 * Etapa 6 no navegador: painel Super Admin (admin.<base>) com senha + código do autenticador,
 * planos, novo restaurante, assinatura, suspensão/reativação e auditoria; no restaurante, a
 * tela "Plano e domínio". O segredo TOTP de teste vem de E2E_ADMIN_TOTP (nunca o de produção).
 */
const BASE = process.env.E2E_BASE_URL ?? 'http://demo.comandou.localhost:5173';
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? BASE.replace(/\/\/[^.]+\./, '//admin.');
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@comandou.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
const ADMIN_TOTP = process.env.E2E_ADMIN_TOTP ?? '';
const EMAIL = process.env.E2E_EMAIL ?? 'dono@demo.local';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
test.skip(
  !ADMIN_PASSWORD || !ADMIN_TOTP || !PASSWORD,
  'defina E2E_ADMIN_PASSWORD, E2E_ADMIN_TOTP e E2E_PASSWORD',
);

function base32(s: string) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let v = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, '')) {
    v = (v << 5) | A.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totp(step: number) {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32(ADMIN_TOTP)).update(c).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
const stepNow = () => Math.floor(Date.now() / 30_000);

/** Cada código vale uma vez: tenta o passo atual e o próximo; se já foram usados, espera. */
async function adminLogin(page: Page) {
  await page.goto(ADMIN_URL);
  await expect(page.getByLabel('Código do autenticador')).toBeVisible();
  await page.getByLabel('E-mail').fill(ADMIN_EMAIL);
  await page.getByLabel('Senha').fill(ADMIN_PASSWORD);
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0 && attempt % 2 === 0)
      await page.waitForTimeout((30 - ((Date.now() / 1000) % 30) + 1) * 1000);
    await page.getByLabel('Código do autenticador').fill(totp(stepNow() + (attempt % 2)));
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/platform/auth/login')),
      page.getByRole('button', { name: 'Entrar' }).click(),
    ]);
    if (res.ok()) {
      await expect(page.locator('.adm-top__title')).toHaveText('Status');
      return;
    }
  }
  throw new Error('não conseguiu entrar no painel');
}

const isMobileAdmin = (page: Page) => (page.viewportSize()?.width ?? 1200) <= 860;
const TABBAR: Record<string, string> = {
  Status: 'Status',
  Restaurantes: 'Clientes',
  Servidor: 'Servidor',
  Planos: 'Planos',
};

/** Painel: barra lateral no computador; no celular, barra inferior + "Mais" (Backups, Auditoria, Sair). */
async function adminNav(page: Page, name: string) {
  if (!isMobileAdmin(page)) return page.getByRole('link', { name, exact: true }).click();
  if (TABBAR[name])
    return page
      .locator('.adm-tabbar')
      .getByRole('link', { name: TABBAR[name], exact: true })
      .click();
  await page.getByRole('button', { name: 'Mais' }).click();
  await page.getByRole('dialog').getByRole('link', { name, exact: true }).click();
}

async function nav(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1200) < 1024)
    await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.getByRole('link', { name, exact: true }).click();
}

const shot = (page: Page, project: string, name: string) =>
  page.screenshot({ path: `test-results/screens/${project}-${name}.png`, fullPage: true });

test('Super Admin: código errado, planos, novo restaurante, assinatura e suspensão', async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  const tag = `${info.project.name.slice(0, 1)}${Date.now().toString(36).slice(-5)}`;

  // Código errado é recusado.
  await page.goto(ADMIN_URL);
  await page.getByLabel('E-mail').fill(ADMIN_EMAIL);
  await page.getByLabel('Senha').fill(ADMIN_PASSWORD);
  await page.getByLabel('Código do autenticador').fill('000000');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('E-mail, senha ou código inválidos.')).toBeVisible();
  await shot(page, info.project.name, 'admin-login');

  await adminLogin(page);
  await expect(page.getByText('Banco de dados').first()).toBeVisible();
  await shot(page, info.project.name, 'admin-visao-geral');

  // Plano novo
  await adminNav(page, 'Planos');
  await page.getByRole('button', { name: 'Novo plano' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Código').fill(`e2e-${tag}`);
  await dialog.getByLabel('Nome').fill(`E2E ${tag}`);
  await dialog.getByLabel('Preço mensal (R$)').fill('149,90');
  await dialog.getByLabel('Máx. produtos ativos').fill('50');
  await dialog.getByLabel('Inclui domínio próprio').check();
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Plano criado')).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(`E2E ${tag}`) });
  await expect(row).toContainText('R$ 149,90');
  await expect(row).toContainText('Domínio próprio');

  // Restaurante novo com esse plano
  await adminNav(page, 'Restaurantes');
  await page.getByRole('button', { name: 'Novo', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome do restaurante').fill(`Cantina ${tag}`);
  await dialog.getByLabel('Endereço').fill('admin');
  await expect(dialog.getByText('identificador reservado')).toBeVisible();
  await dialog.getByLabel('Endereço').fill(`e2e-${tag}`);
  await dialog.getByLabel('Nome do administrador').fill('Dona E2E');
  await dialog.getByLabel('E-mail do administrador').fill(`dona-${tag}@e2e.local`);
  await dialog.getByLabel('Senha inicial').fill('senha-e2e-12345');
  await dialog.getByLabel('Plano').selectOption({ label: `E2E ${tag}` });
  await dialog.getByRole('button', { name: 'Criar restaurante' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`Cantina ${tag}`) })).toBeVisible();
  await expect(page.getByText(`dona-${tag}@e2e.local`).first()).toBeVisible();
  await expect(page.locator('.adm-tag', { hasText: /^Ativa$/ })).toBeVisible();

  // Operação e consumo do restaurante
  await page.getByRole('tab', { name: 'Operação' }).click();
  await expect(page.getByText('Pedidos (30 dias)')).toBeVisible();
  await expect(page.getByText('Faturamento (30 dias)')).toBeVisible();
  await page.getByRole('tab', { name: 'Consumo' }).click();
  await expect(page.getByText('Dados no banco')).toBeVisible();
  await expect(page.getByText('Tamanho dos dados por tabela (estimado)')).toBeVisible();
  await shot(page, info.project.name, 'admin-consumo');
  await page.getByRole('tab', { name: 'Assinatura' }).click();

  // Assinatura: pagamento pendente
  await page.getByLabel('Situação').selectOption('past_due');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Assinatura salva')).toBeVisible();
  await expect(page.locator('.adm-tag', { hasText: 'Pagamento pendente' })).toBeVisible();

  // Suspender e reativar (com motivo)
  await page.getByRole('button', { name: 'Suspender' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Motivo (fica na auditoria)').fill(`Teste E2E ${tag}`);
  await dialog.getByRole('button', { name: 'Suspender' }).click();
  await expect(page.getByText(/Suspenso: ninguém entra nem opera/)).toBeVisible();
  await shot(page, info.project.name, 'admin-restaurante-suspenso');
  await page.getByRole('button', { name: 'Reativar' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Motivo (fica na auditoria)').fill('Regularizado');
  await dialog.getByRole('button', { name: 'Reativar' }).click();
  await expect(page.getByRole('button', { name: 'Suspender' })).toBeVisible();

  // Ranking de consumo na tela do servidor (aparece mesmo sem o agente)
  await adminNav(page, 'Servidor');
  await expect(page.getByText('Consumo por restaurante')).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(`Cantina ${tag}`) })).toBeVisible();

  // Auditoria
  await adminNav(page, 'Auditoria');
  await expect(page.getByText(`Teste E2E ${tag}`)).toBeVisible();
  await expect(page.getByText('Restaurante criado').first()).toBeVisible();
  await adminNav(page, 'Backups');
  await expect(page.getByRole('heading', { name: 'Backups' })).toBeVisible();

  // Nenhuma tela do painel rola na horizontal (celular e computador).
  for (const path of ['/', '/restaurantes', '/servidor', '/planos', '/backups', '/auditoria']) {
    await page.goto(`${ADMIN_URL}${path}`);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }

  if (isMobileAdmin(page)) await page.getByRole('button', { name: 'Mais' }).click();
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByLabel('Código do autenticador')).toBeVisible();
});

test('restaurante: tela Plano e domínio com instruções de DNS', async ({ page }, info) => {
  const tag = `${info.project.name.slice(0, 1)}${Date.now().toString(36).slice(-5)}`;
  await page.goto('/');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText(/Olá, /)).toBeVisible();
  await nav(page, 'Plano e domínio');
  await expect(page.getByRole('heading', { name: 'Plano e domínio' })).toBeVisible();
  const host = `pedidos-${tag}.example.com`;
  await page.getByLabel('Domínio', { exact: true }).fill(host);
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByText('Domínio cadastrado')).toBeVisible();
  await expect(page.getByText(`_comandou.${host}`)).toBeVisible();
  await expect(page.getByText(/^comandou-verify=/).first()).toBeVisible();
  await shot(page, info.project.name, 'plano-dominio');
  // Sem o registro no DNS, não verifica.
  const item = page.locator('li', { hasText: host });
  await item.getByRole('button', { name: 'Verificar agora' }).click();
  await expect(item.getByText('aguardando DNS')).toBeVisible();
  await expect(page.getByText(/registro TXT|consultar o DNS/).first()).toBeVisible();
  await item.getByRole('button', { name: 'Remover' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remover' }).click();
  await expect(page.getByText('Domínio removido')).toBeVisible();
  await expect(page.getByText(host)).toHaveCount(0);
});
