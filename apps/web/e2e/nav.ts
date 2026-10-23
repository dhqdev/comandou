import { Page } from '@playwright/test';

/** Mesma regra do AppFrame: até 860px de largura vale a navegação do celular. */
export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1200) <= 860;

/**
 * Navega pela moldura padrão (AppFrame), igual a uma pessoa:
 * - computador: ícone da barra lateral; se o item está num submenu, abre o grupo antes;
 * - celular: aba de baixo ou "Mais" (folha que sobe) e o atalho lá dentro.
 */
export async function nav(page: Page, name: string | RegExp) {
  const exact = typeof name === 'string';
  if (isPhone(page)) {
    const tab = page.locator('.cm-tabbar').getByRole('link', { name, exact });
    if (await tab.count()) return tab.click();
    await page.locator('.cm-tabbar').getByRole('button', { name: 'Mais' }).click();
    await settled(page);
    return page.getByRole('dialog').getByRole('link', { name, exact }).click();
  }
  const rail = page.locator('.cm-rail');
  const direct = rail.getByRole('link', { name, exact });
  if (await direct.count()) return direct.click();
  for (const group of await rail.locator('button[aria-haspopup]').all()) {
    await group.click();
    await page.getByRole('menu').waitFor();
    const link = page.getByRole('menu').getByRole('menuitem', { name, exact });
    if (await link.count()) return link.click();
    await page.keyboard.press('Escape');
  }
  throw new Error(`item de menu não encontrado: ${String(name)}`);
}

/** Abre "Conta" (submenu no computador, folha no celular) e clica numa ação, ex.: "Sair". */
export async function account(page: Page, action: string) {
  if (isPhone(page)) {
    await page.locator('.cm-tabbar').getByRole('button', { name: 'Mais' }).click();
    await settled(page);
    return page.getByRole('dialog').getByRole('button', { name: action }).click();
  }
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
