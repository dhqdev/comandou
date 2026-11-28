import { expect, test } from '@playwright/test';
import { emailField, expectNoHorizontalScroll, passwordField } from './nav';

/**
 * Site público (domínio base): a página abre, o celular acompanha o que a pessoa descreve e a
 * conversa de criar (0.282, página /criar) monta o cardápio com a prévia de verdade ao lado,
 * pergunta cada coisa e cria o restaurante de teste, mostrando o endereço, o login e a senha.
 */
test('site: descreve os itens e cria o restaurante de teste', async ({ page, baseURL }, info) => {
  // A conversa tem vários passos antes de criar (cada resposta do mascote leva um instante).
  test.setTimeout(240_000);
  // http://demo.comandou.localhost:5173 -> http://comandou.localhost:5173
  const site = new URL(baseURL!);
  site.hostname = site.hostname.split('.').slice(1).join('.');
  await page.goto(site.origin);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Seu restaurante no ar');
  await expectNoHorizontalScroll(page, ['/']);

  // Campo da página inicial: o celular do topo mostra os itens digitados, com o preço.
  await page
    .getByLabel('Conte sobre o seu restaurante')
    .fill('Pastel de carne 12\nCaldo de cana 8,50');
  await expect(page.locator('.st-phone')).toContainText('Pastel de carne');
  await expect(page.locator('.st-phone')).toContainText('R$ 8,50');

  // Mandar leva para a conversa, que já começa com o que foi escrito.
  await page.locator('.st-build__go').click();
  await expect(page).toHaveURL(/\/criar$/);
  await expect(page.getByText('Como o seu restaurante se chama?')).toBeVisible();
  const id = `${info.project.name}-${Date.now()}`;
  await page.getByLabel('Nome do restaurante').fill(`Pastelaria E2E ${id}`);
  await page.getByLabel('Nome do restaurante').press('Enter');

  // O cardápio para conferir na conversa, e o cardápio de verdade na prévia.
  await expect(page.locator('.stc-menu')).toContainText('2 itens');
  await expect(page.getByLabel('Preço de Caldo de cana')).toHaveValue('8,50');
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: /Ver minha loja/ }).click();
  const preview = page.frameLocator('.stc-phone__screen').first();
  await expect(preview.getByText('Pastel de carne')).toBeVisible({ timeout: 15_000 });
  await expect(preview.getByText('R$ 8,50')).toBeVisible();
  // Mudou o preço na conversa: a prévia acompanha.
  if (info.project.name === 'mobile') await page.getByLabel('Fechar a prévia').click();
  await page.getByLabel('Preço de Pastel de carne').fill('13,50');
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: /Ver minha loja/ }).click();
  await expect(preview.getByText('R$ 13,50')).toBeVisible();
  await page.screenshot({ path: `test-results/screens/${info.project.name}-site-conversa.png` });
  if (info.project.name === 'mobile') await page.getByLabel('Fechar a prévia').click();
  await expectNoHorizontalScroll(page, ['/criar']);

  await page.getByRole('button', { name: 'Está certo, continuar' }).click();
  await page.getByRole('button', { name: 'Está certo', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Depois' }).click(); // WhatsApp
  await page.getByRole('button', { name: 'Depois' }).click(); // endereço
  await page.getByRole('button', { name: '30 a 45 min' }).click();

  await page.getByLabel('Seu nome').fill('Dona E2E');
  await page.getByLabel('E-mail').fill(`e2e-${id}@site.test`);
  await page.getByLabel('CNPJ ou CPF').fill('11222333000181');
  await expect(page.getByLabel('Razão social')).toBeVisible();
  await page.getByLabel('Razão social').fill('Pastelaria E2E Ltda');
  await page.screenshot({ path: `test-results/screens/${info.project.name}-site-cadastro.png` });
  await page.getByRole('button', { name: 'Criar meu restaurante' }).click();

  await expect(page.getByText(/está no ar!/)).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('.st-cred')).toContainText('pastelaria-e2e');
  await expect(page.locator('.st-cred')).toContainText(`e2e-${id}@site.test`);
  await expect(page.locator('.st-cred__pass')).toHaveText(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  await page.screenshot({ path: `test-results/screens/${info.project.name}-site-pronto.png` });

  // Primeiro acesso ao restaurante (com o login da tela; no teste o endereço não tem a porta do
  // link "Abrir"): o sistema aplica sozinho o que foi combinado na conversa, sem perguntar.
  const password = (await page.locator('.st-cred__pass').textContent())!.trim();
  const slug = (await page.locator('.st-cred dd').first().textContent())!.trim().split('.')[0]!;
  await page.goto(`${site.protocol}//${slug}.${site.host}/`);
  await emailField(page).fill(`e2e-${id}@site.test`);
  await passwordField(page).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText(/Tudo aplicado: 2 itens no cardápio/)).toBeVisible({
    timeout: 60_000,
  });
  await page.screenshot({ path: `test-results/screens/${info.project.name}-site-aplicado.png` });
});
