import { expect, test } from '@playwright/test';
import { enterPanel, nav } from './nav';

const EMAIL = process.env.E2E_EMAIL ?? 'dono@demo.local';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
// A rota que derruba a API vale para a página; o service worker passaria por fora dela.
test.use({ serviceWorkers: 'block' });
test.skip(!PASSWORD, 'defina E2E_PASSWORD (senha do administrador do tenant de teste)');

/**
 * Modo offline (lib/offline.ts): sem servidor, a tela abre com os dados guardados, o que for
 * salvo fica no aparelho (mesmo recarregando) e sobe sozinho quando a conexão volta.
 */
test('salva sem internet, recarrega e sincroniza quando a conexão volta', async ({
  page,
}, info) => {
  await enterPanel(page, EMAIL, PASSWORD);
  await nav(page, 'Itens');
  await expect(page.getByRole('heading', { name: 'Cardápio' })).toBeVisible();

  // Telas já abertas com internet ficam guardadas: abre o formulário uma vez antes.
  await page.getByRole('button', { name: 'Adicionar item' }).click();
  await expect(page.getByLabel('Nome do item', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Itens' }).click();

  // Servidor fora do ar: toda chamada à API falha.
  await page.route('**/api/v1/**', (r) => r.abort('internetdisconnected'));

  const name = `Offline ${info.project.name} ${Date.now()}`;
  await page.getByRole('button', { name: 'Adicionar item' }).click();
  await page.getByLabel('Nome do item', { exact: true }).fill(name);
  await page.getByLabel('Preço', { exact: true }).fill('12,50');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  const banner = page.getByTestId('offline-banner');
  await expect(banner).toContainText('1 alteração salva só neste aparelho');

  // Recarregar sem servidor: abre logado, nos dados guardados, e a fila continua lá.
  await page.reload();
  // O item criado sem internet abre com o que foi salvo (ainda sem número do servidor).
  await expect(page.getByLabel('Nome do item', { exact: true })).toHaveValue(name);
  await expect(banner).toContainText('1 alteração salva só neste aparelho');

  // Conexão de volta: a fila sobe e o item aparece de verdade.
  await page.unroute('**/api/v1/**');
  await page.reload();
  await expect(page.getByText(/1 alteração enviada para a nuvem/)).toBeVisible();
  await expect(banner).toHaveCount(0);
  // O endereço com o id provisório continua abrindo o item, agora o do servidor.
  await page.reload();
  await expect(page.getByLabel('Nome do item', { exact: true })).toHaveValue(name);
  await page.getByRole('link', { name: 'Itens' }).click();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(1);
});
