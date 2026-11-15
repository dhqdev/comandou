import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll } from './nav';

/**
 * Site público (domínio base): a página abre, o celular acompanha o que a pessoa descreve e o
 * cadastro cria o restaurante de teste, mostrando o endereço, o login e a senha.
 */
test('site: descreve os itens e cria o restaurante de teste', async ({ page, baseURL }, info) => {
  // http://demo.comandou.localhost:5173 -> http://comandou.localhost:5173
  const site = new URL(baseURL!);
  site.hostname = site.hostname.split('.').slice(1).join('.');
  await page.goto(site.origin);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Seu restaurante no ar');
  await expectNoHorizontalScroll(page, ['/']);

  await page.getByRole('tab', { name: /descrever/i }).click();
  await page.getByLabel('Descreva o que você vende').fill('Pastel de carne 12\nCaldo de cana 8,50');
  // O celular do topo mostra os itens digitados, com o preço.
  await expect(page.locator('.st-phone')).toContainText('Pastel de carne');
  await expect(page.locator('.st-phone')).toContainText('R$ 8,50');

  await page.locator('.st-build__go').click();
  const id = `${info.project.name}-${Date.now()}`;
  await page.getByLabel('Nome do restaurante').fill(`Pastelaria E2E ${id}`);
  await page.getByLabel('Seu nome').fill('Dona E2E');
  await page.getByLabel('E-mail').fill(`e2e-${id}@site.test`);
  await page.screenshot({ path: `test-results/screens/${info.project.name}-site-cadastro.png` });
  await page.getByRole('button', { name: 'Criar e abrir' }).click();

  await expect(page.getByText('Seu restaurante está no ar')).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('.st-cred')).toContainText('pastelaria-e2e');
  await expect(page.locator('.st-cred')).toContainText(`e2e-${id}@site.test`);
  await expect(page.locator('.st-cred__pass')).toHaveText(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  await page.screenshot({ path: `test-results/screens/${info.project.name}-site-pronto.png` });
});
