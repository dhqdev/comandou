import { expect, test } from '@playwright/test';
import { enterPanel, nav } from './nav';

const EMAIL = process.env.E2E_EMAIL ?? 'dono@demo.local';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
test.skip(!PASSWORD, 'defina E2E_PASSWORD (senha do administrador do tenant de teste)');

/** Quantos itens do cardápio com este nome o servidor tem (direto na API, fora da tela). */
async function onServer(page: import('@playwright/test').Page, name: string) {
  return page.evaluate(async (n) => {
    const res = await fetch('/api/v1/products', { credentials: 'same-origin', cache: 'no-store' });
    const list = (await res.json()) as { name: string }[];
    return list.filter((p) => p.name === n).length;
  }, name);
}

/** Espera o app guardar as telas principais no aparelho (logo depois de entrar). */
async function warmed(page: import('@playwright/test').Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (JSON.parse(sessionStorage.getItem('cm:offline-warm') ?? '{}') as { done?: boolean })
              .done,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
}

/**
 * Perda de conexão de verdade (o aparelho sem rede, com o service worker ligado): o app abre
 * pelo que está no aparelho, salva na fila, sobrevive a fechar a aba e sobe sozinho, uma vez só,
 * quando a rede volta.
 */
test('sem rede nenhuma: abre, salva, fecha a aba e sincroniza sem duplicar', async ({
  page,
  context,
}, info) => {
  await enterPanel(page, EMAIL, PASSWORD);
  // O service worker precisa estar no controle para a tela abrir sem rede.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r));
  });
  await nav(page, 'Itens');
  await expect(page.getByRole('heading', { name: 'Cardápio' })).toBeVisible();
  // Sem abrir o cadastro de item antes: ele precisa abrir sem rede pelo que foi guardado ao entrar.
  await warmed(page);
  const itensUrl = page.url();

  await context.setOffline(true);
  // Recarregar sem rede: o app vem do aparelho, logado, na mesma tela.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cardápio' })).toBeVisible();
  const banner = page.getByTestId('offline-banner');
  await expect(banner).toContainText('Sem internet');

  const name = `Sem rede ${info.project.name} ${Date.now()}`;
  await page.getByRole('button', { name: 'Adicionar item' }).click();
  await page.getByLabel('Nome do item', { exact: true }).fill(name);
  await page.getByLabel('Preço', { exact: true }).fill('9,90');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(banner).toContainText('1 alteração salva só neste aparelho');

  // Fecha a aba e abre outra, ainda sem rede: a fila continua guardada.
  await page.close();
  const again = await context.newPage();
  await again.goto(itensUrl);
  await expect(again.getByRole('heading', { name: 'Cardápio' })).toBeVisible();
  const banner2 = again.getByTestId('offline-banner');
  await expect(banner2).toContainText('1 alteração salva só neste aparelho');

  // A rede volta: sobe sozinha, sem recarregar.
  await context.setOffline(false);
  await expect(again.getByText(/1 alteração enviada para a nuvem/)).toBeVisible();
  await expect(banner2).toHaveCount(0);
  expect(await onServer(again, name)).toBe(1);

  // Voltar, recarregar e trocar de tela não reenviam nada.
  await again.reload();
  await expect(again.getByRole('heading', { name: 'Cardápio' })).toBeVisible();
  await expect(again.getByRole('row', { name: new RegExp(name) })).toHaveCount(1);
  expect(await onServer(again, name)).toBe(1);
});

/**
 * Wi-Fi ligado mas o servidor não responde: a faixa avisa, o que for salvo vai para o aparelho
 * sem esperar a rede e sobe sozinho quando o servidor volta (sem recarregar a tela).
 */
test('Wi-Fi ligado com o servidor fora: avisa e sobe sozinho quando ele volta', async ({
  page,
}, info) => {
  await enterPanel(page, EMAIL, PASSWORD);
  await nav(page, 'Itens');
  await expect(page.getByRole('heading', { name: 'Cardápio' })).toBeVisible();
  await warmed(page);

  await page.route('**/api/v1/**', (r) => r.abort('connectionrefused'));
  const name = `Servidor fora ${info.project.name} ${Date.now()}`;
  await page.getByRole('button', { name: 'Adicionar item' }).click();
  await page.getByLabel('Nome do item', { exact: true }).fill(name);
  await page.getByLabel('Preço', { exact: true }).fill('7,00');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  const banner = page.getByTestId('offline-banner');
  await expect(banner).toContainText('Sem conexão com o servidor');
  await expect(banner).toContainText('1 alteração salva só neste aparelho');

  await page.unroute('**/api/v1/**');
  await expect(page.getByText(/1 alteração enviada para a nuvem/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(banner).toHaveCount(0);
  expect(await onServer(page, name)).toBe(1);
});
