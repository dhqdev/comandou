import { expect, Page, Request } from '@playwright/test';

/** Mesma regra do AppFrame: até 860px de largura vale a navegação do celular. */
export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1200) <= 860;

/**
 * Navega pela moldura padrão (AppFrame), igual a uma pessoa:
 * - computador: item da barra lateral; se está dentro de um grupo (Cardápio, Estoque…), abre o grupo antes;
 * - celular: aba de baixo ou a tela "Mais" (última aba) e o bloco lá dentro.
 */
export async function nav(page: Page, name: string | RegExp) {
  const exact = typeof name === 'string';
  if (isPhone(page)) {
    const tab = page.locator('.cm-tabbar').getByRole('link', { name, exact });
    if (await tab.count()) return tab.click();
    await page.locator('.cm-tabbar').getByRole('link', { name: 'Mais' }).click();
    await page.locator('.cm-menu').waitFor();
    const tile = page.locator('.cm-menu').getByRole('link', { name, exact });
    if (await tile.count()) return tile.click();
    // Assinatura e Ajustes moram na tela Conta (restaurante).
    return accountCard(page, name);
  }
  const rail = page.locator('.cm-rail');
  const direct = rail.getByRole('link', { name, exact });
  if (await direct.count()) return direct.click();
  // Menu largo: o grupo abre os subitens logo abaixo, dentro da própria barra.
  for (const group of await rail.locator('.cm-rail__group').all()) {
    const head = group.locator('button[aria-expanded]');
    if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
    const link = group.getByRole('link', { name, exact });
    if (await link.count()) return link.click();
  }
  // Menu recolhido: o grupo abre um submenu ao lado.
  for (const group of await rail.locator('button[aria-haspopup]').all()) {
    await group.click();
    await page.getByRole('menu').waitFor();
    const link = page.getByRole('menu').getByRole('menuitem', { name, exact });
    if (await link.count()) return link.click();
    await page.keyboard.press('Escape');
  }
  // Assinatura e Ajustes moram na tela Conta (restaurante).
  if (await rail.getByRole('link', { name: 'Conta', exact: true }).count())
    return accountCard(page, name);
  throw new Error(`item de menu não encontrado: ${String(name)}`);
}

/** Abre a tela Conta do restaurante (nome no pé do menu; no celular, o cartão da tela Mais). */
async function openAccountPage(page: Page) {
  if (isPhone(page)) {
    await page.locator('.cm-tabbar').getByRole('link', { name: 'Mais' }).click();
    await page
      .locator('.cm-menu')
      .getByRole('link', { name: /^Abrir a conta/ })
      .click();
  } else {
    await page.locator('.cm-rail').getByRole('link', { name: 'Conta', exact: true }).click();
  }
  await page.locator('.acc').waitFor();
}

/** Toca num bloco da tela Conta (o nome do bloco vem antes da frase de explicação). */
async function accountCard(page: Page, name: string | RegExp) {
  if (!(await page.locator('.acc').count())) await openAccountPage(page);
  const label = typeof name === 'string' ? new RegExp(`^${name}\\b`) : name;
  const acc = page.locator('.acc');
  const link = acc.getByRole('link', { name: label });
  if (await link.count()) return link.first().click();
  return acc.getByRole('button', { name: label }).first().click();
}

/**
 * Clica numa ação da conta, ex.: "Sair". Restaurante: tela Conta (nome no pé do menu; no celular,
 * o Sair fica no fim da tela "Mais" e o resto na Conta). Super Admin: submenu "Conta" no
 * computador e tela "Mais" no celular.
 */
export async function account(page: Page, action: string) {
  if (isPhone(page)) {
    await page.locator('.cm-tabbar').getByRole('link', { name: 'Mais' }).click();
    await page.locator('.cm-menu').waitFor();
    const here = page.locator('.cm-menu').getByRole('button', { name: action });
    if (await here.count()) return here.click();
    return accountCard(page, action);
  }
  if (await page.locator('.cm-rail').getByRole('link', { name: 'Conta', exact: true }).count())
    return accountCard(page, action);
  await page.locator('.cm-rail').getByRole('button', { name: 'Conta' }).click();
  await page.getByRole('menu').getByRole('button', { name: action }).click();
}

/** A folha sobe com animação: espera ela parar antes de tocar num item. */
export async function settled(page: Page) {
  await page.getByRole('dialog').last().waitFor();
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  );
}

/** Campos do login do restaurante (exatos: "Mostrar senha" também casa com "Senha"). */
export const emailField = (page: Page) => page.getByLabel('E-mail', { exact: true });
export const passwordField = (page: Page) => page.getByLabel('Senha', { exact: true });

/**
 * No primeiro acesso de cada navegador abre a apresentação das telas (ou, na loja ainda sem
 * itens, a conversa de primeiros passos): pula.
 */
export async function skipTour(page: Page) {
  await page
    .getByRole('dialog', { name: /Boas-vindas|Primeiros passos/ })
    .getByRole('button', { name: 'Pular' })
    .click();
}

/** Entra no painel do restaurante, pula a apresentação e espera a saudação do PDV. */
export async function enterPanel(page: Page, email: string, password: string) {
  await page.goto('/');
  await emailField(page).fill(email);
  await passwordField(page).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await skipTour(page);
  await expect(page.getByText(/Olá, /)).toBeVisible();
}

/**
 * Confere que nenhuma das telas rola na horizontal.
 *
 * Troca de tela pelo roteador (como um clique no menu), sem recarregar a página: no CI o
 * Vite de desenvolvimento leva vários segundos por recarga e o teste estourava o tempo.
 * Antes de medir, espera a rede ficar quieta (meio segundo sem pedido aberto) e os
 * indicadores de carregamento sumirem, para medir a tela já com os dados.
 */
export async function expectNoHorizontalScroll(page: Page, paths: string[]) {
  const pending = new Set<Request>();
  let lastActivity = Date.now();
  const start = (r: Request) => {
    pending.add(r);
    lastActivity = Date.now();
  };
  const end = (r: Request) => {
    pending.delete(r);
    lastActivity = Date.now();
  };
  page.on('request', start);
  page.on('requestfinished', end);
  page.on('requestfailed', end);
  try {
    for (const path of paths) {
      await page.evaluate((p) => {
        window.history.pushState(null, '', p);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, path);
      await expect(page).toHaveURL((u) => u.pathname === path);
      await expect
        .poll(
          () =>
            pending.size === 0 && Date.now() - lastActivity >= 500
              ? 'quieta'
              : `abertos: ${[...pending].map((r) => r.url()).join(', ') || 'nenhum'}`,
          { message: `rede quieta em ${path}`, timeout: 15_000, intervals: [100] },
        )
        .toBe('quieta');
      await expect(page.locator('.cm-loader:not(.cm-loader--inline)'), path).toHaveCount(0);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  } finally {
    page.off('request', start);
    page.off('requestfinished', end);
    page.off('requestfailed', end);
  }
}
