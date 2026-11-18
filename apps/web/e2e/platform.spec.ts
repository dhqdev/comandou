import { expect, Page, test } from '@playwright/test';
import { account, nav, enterPanel, expectNoHorizontalScroll } from './nav';
import { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_TOTP, ADMIN_URL, adminLogin } from './admin';

/**
 * Etapa 6 no navegador: painel Super Admin (admin.<base>) com senha + código do autenticador,
 * preço, novo restaurante, assinatura, suspensão/reativação e histórico; no restaurante, a
 * tela "Plano". O segredo TOTP de teste vem de E2E_ADMIN_TOTP (nunca o de produção).
 */
const EMAIL = process.env.E2E_EMAIL ?? 'dono@demo.local';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
test.skip(
  !ADMIN_PASSWORD || !ADMIN_TOTP || !PASSWORD,
  'defina E2E_ADMIN_PASSWORD, E2E_ADMIN_TOTP e E2E_PASSWORD',
);

const shot = (page: Page, project: string, name: string) =>
  page.screenshot({ path: `test-results/screens/${project}-${name}.png`, fullPage: true });

test('Super Admin: código errado, preço, novo restaurante, assinatura e suspensão', async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  const tag = `${info.project.name.slice(0, 1)}${Date.now().toString(36).slice(-5)}`;

  // Código errado é recusado.
  await page.goto(ADMIN_URL);
  await page.getByLabel('E-mail').fill(ADMIN_EMAIL);
  await page.getByLabel('Senha', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByLabel('Código do autenticador').fill('000000');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('E-mail, senha ou código inválidos.')).toBeVisible();
  await shot(page, info.project.name, 'admin-login');

  await adminLogin(page);
  await expect(page.getByText('Banco de dados').first()).toBeVisible();
  // Aparelho lembrado: o painel continua conectado (cookie de semanas, não de horas).
  const session = (await page.context().cookies()).find((c) => c.name === 'cm_admin');
  expect(session!.expires * 1000 - Date.now()).toBeGreaterThan(7 * 86400_000);
  await page.reload();
  await expect(page.locator('.topbar__tenant')).toContainText('Status');
  await shot(page, info.project.name, 'admin-visao-geral');

  // Preço: valor único (plano "comandou"), com os dias de teste de todo restaurante novo.
  await nav(page, 'Preço');
  await expect(page.getByRole('heading', { name: 'Preço', level: 1 })).toBeVisible();
  await expect(page.locator('.adm-tile', { hasText: /^Mensalidade/ })).toContainText('R$ 400,00');
  await expect(page.locator('.adm-tile', { hasText: 'Teste grátis' })).toContainText('dias');
  await expect(page.getByRole('button', { name: 'Mudar valor e teste' })).toBeVisible();
  await shot(page, info.project.name, 'admin-preco');

  // Restaurante novo no valor único: tela própria, em passos (não fecha num clique fora).
  await nav(page, 'Restaurantes');
  await page.getByRole('button', { name: 'Novo', exact: true }).click();
  await expect(page).toHaveURL(/\/restaurantes\/novo$/);
  const wizard = page.locator('.adm-wizard__body');
  const next = () => wizard.getByRole('button', { name: /^(Continuar|Pular)$/ }).click();
  // Passo 1: restaurante. Sem nome não segue.
  await next();
  await expect(wizard.getByText('Informe o nome')).toBeVisible();
  await wizard.getByLabel('Nome do restaurante').fill(`Cantina ${tag}`);
  // O endereço sai do nome sozinho; dá para trocar.
  await expect(wizard.getByLabel('Endereço')).toHaveValue(`cantina-${tag}`);
  await wizard.getByLabel('Endereço').fill('admin');
  await expect(wizard.getByText('identificador reservado')).toBeVisible();
  await wizard.getByLabel('Endereço').fill(`e2e-${tag}`);
  await wizard.getByLabel('Cidade').fill('Manaus');
  await wizard.getByLabel('UF').selectOption('AM');
  await expect(wizard.getByLabel('Fuso horário')).toHaveValue('America/Manaus');
  await shot(page, info.project.name, 'admin-novo-restaurante');
  await next();
  // Passo 2: acesso do dono (login e senha vão por e-mail).
  await wizard.getByLabel('Nome do dono').fill('Dona E2E');
  await wizard.getByLabel('E-mail (vira o login)').fill(`dona-${tag}@e2e.local`);
  await wizard.getByRole('button', { name: 'Gerar' }).click();
  await expect(wizard.getByLabel('Senha inicial')).not.toHaveValue('');
  await wizard.getByLabel('Senha inicial').fill('senha-e2e-12345');
  await expect(wizard.getByText('Mandar o login e a senha para o e-mail do dono')).toBeVisible();
  await next();
  // Passo 3: plano.
  await wizard.locator('label.adm-plan-opt', { hasText: 'Comandou' }).click();
  await next();
  // Passo 4: contato e cobrança (opcional).
  await wizard.getByLabel('CPF ou CNPJ').fill('12345678000195');
  await expect(wizard.getByLabel('CPF ou CNPJ')).toHaveValue('12.345.678/0001-95');
  await next();
  // Passo 5: conferir e criar.
  await expect(wizard.getByText(`vão para dona-${tag}@e2e.local`)).toBeVisible();
  await wizard.getByRole('button', { name: 'Criar restaurante' }).click();
  await expect(page.getByRole('heading', { name: 'Restaurante criado' })).toBeVisible();
  await expect(page.getByText(`dona-${tag}@e2e.local`).first()).toBeVisible();
  await page.getByRole('button', { name: 'Abrir o restaurante' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`Cantina ${tag}`) })).toBeVisible();
  // O banco próprio do restaurante é criado pelo serviço de backup; a tela se atualiza sozinha.
  // No valor único o restaurante novo começa no teste grátis (dias do plano padrão).
  await expect(page.locator('.adm-tag', { hasText: /^Em teste$/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(`dona-${tag}@e2e.local`).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'Cadastro' }).click();
  await expect(page.getByLabel('CPF ou CNPJ')).toHaveValue('12.345.678/0001-95');
  await expect(page.getByLabel('Cidade')).toHaveValue('Manaus');
  await page.getByRole('tab', { name: 'Banco de dados' }).click();
  await expect(page.locator('.adm-tag', { hasText: /^em uso$/ })).toBeVisible();
  await expect(page.getByText(`comandou_e2e_${tag}`.replace(/-/g, '_')).first()).toBeVisible();
  await expect(page.getByText(`restaurantes/e2e-${tag}/`).first()).toBeVisible();

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
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Motivo (fica na auditoria)').fill(`Teste E2E ${tag}`);
  await dialog.getByRole('button', { name: 'Suspender' }).click();
  await expect(page.getByText(/Suspenso: ninguém entra nem opera/)).toBeVisible();
  await shot(page, info.project.name, 'admin-restaurante-suspenso');
  await page.getByRole('button', { name: 'Reativar' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Motivo (fica na auditoria)').fill('Regularizado');
  await dialog.getByRole('button', { name: 'Reativar' }).click();
  await expect(page.getByRole('button', { name: 'Suspender' })).toBeVisible();

  // Histórico do restaurante (a antiga tela Auditoria): a suspensão com o motivo e a criação.
  await page.getByRole('tab', { name: 'Histórico' }).click();
  await expect(page.getByText(`Motivo: Teste E2E ${tag}`)).toBeVisible();
  await expect(page.getByText('Restaurante criado').first()).toBeVisible();

  // Ranking de consumo na tela do servidor (aparece mesmo sem o agente)
  await nav(page, 'Infraestrutura');
  await expect(page.getByRole('heading', { name: 'Infraestrutura' })).toBeVisible();
  await expect(page.getByText('Consumo por restaurante')).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(`Cantina ${tag}`) })).toBeVisible();

  // Site: o cadastro pelo site e o site com IA são abas da mesma tela.
  await nav(page, 'Site');
  await expect(page.getByRole('heading', { name: 'Site', level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'Site com IA' }).click();
  await expect(page).toHaveURL(/\/site\/ia$/);
  // Servidor, Bancos e Backups são abas da mesma tela (Infraestrutura).
  await nav(page, 'Infraestrutura');
  await page.getByRole('tab', { name: 'Backups' }).click();
  await expect(page).toHaveURL(/\/servidor\/backups$/);
  await expect(page.getByRole('heading', { name: 'Histórico' })).toBeVisible();
  // Bancos: o servidor principal com os restaurantes de banco próprio (o criado acima incluído).
  await page.getByRole('tab', { name: 'Bancos' }).click();
  await expect(page).toHaveURL(/\/servidor\/bancos$/);
  await expect(page.getByText('Servidor principal')).toBeVisible();
  await expect(page.getByRole('link', { name: `Cantina ${tag}` })).toBeVisible();

  // Nenhuma tela do painel rola na horizontal (celular e computador).
  await expectNoHorizontalScroll(page, [
    '/',
    '/restaurantes',
    '/servidor',
    '/servidor/bancos',
    '/servidor/backups',
    '/planos',
    '/cobranca',
    '/site',
    '/site/ia',
    '/conversas',
  ]);
  // Conversas: no celular a lista (busca, abas e conversas) ocupa a largura toda da caixa, sem
  // coluna vazia à direita; no computador, lista e conversa lado a lado.
  const inbox = await page.locator('.adm-support .sinbox').boundingBox();
  const list = await page.locator('.sinbox__list').boundingBox();
  if (info.project.name === 'mobile') expect(list!.width).toBeGreaterThan(inbox!.width - 4);
  else expect(list!.width).toBeLessThan(inbox!.width / 2);

  // O registro do que não é de restaurante (entradas no painel, ajustes) fica em Conta.
  await account(page, 'Registro do painel');
  await expect(page.getByRole('dialog').getByText('Entrou no painel').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await account(page, 'Sair');
  // Entrou com código e "Lembrar este aparelho" marcado: o navegador fica confiável, só senha.
  await expect(page.getByText(/Navegador confiável/)).toBeVisible();
  await page.getByRole('button', { name: 'Usar código' }).click();
  await expect(page.getByLabel('Código do autenticador')).toBeVisible();
});

test('restaurante: tela Assinatura sem cadastro de domínio', async ({ page }, info) => {
  await enterPanel(page, EMAIL, PASSWORD);
  await nav(page, 'Assinatura');
  await expect(
    page.getByRole('heading', { name: 'Assinatura', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByLabel('Domínio', { exact: true })).toHaveCount(0);
  await shot(page, info.project.name, 'plano');
});
