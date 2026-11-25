import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { enterPanel } from './nav';

const EMAIL = process.env.E2E_EMAIL ?? 'dono@demo.local';
const PASSWORD = process.env.E2E_PASSWORD ?? 'senha';
const PHOTO = readFileSync(
  fileURLToPath(new URL('../public/apple-touch-icon.png', import.meta.url)),
);

/**
 * Conversa do cliente com a loja: o cliente escreve pelo cardápio (texto, emoji e foto), o PDV
 * mostra o selo e o aviso, a equipe responde e o cliente recebe na hora.
 */
test('cliente conversa com a loja pelo cardápio e o PDV responde', async ({
  browser,
  page,
}, info) => {
  const shots = (name: string) => `test-results/screens/${info.project.name}-chat-${name}.png`;
  const customer = await browser.newContext({
    ...info.project.use,
    baseURL: info.project.use.baseURL ?? 'http://demo.comandou.localhost:5173',
  });
  const c = await customer.newPage();
  const phone = info.project.name === 'mobile' ? '11955554444' : '11955553333';
  // Nome único por execução: uma nova tentativa (retry) não pode achar a conversa da anterior.
  const who = `${info.project.name === 'mobile' ? 'Cliente Celular' : 'Cliente Notebook'} ${Date.now().toString(36)}`;

  // Cliente sem conta: nome e celular, depois a conversa.
  await c.goto('/pedir/conversa');
  await c.getByLabel('Seu nome').fill(who);
  await c.getByLabel('Celular').fill(phone);
  await c.getByRole('button', { name: 'Começar conversa' }).click();
  const field = c.getByLabel('Mensagem');
  await field.fill('Oi! Vocês têm opção vegana?');
  await c.getByRole('button', { name: 'Emojis' }).click();
  await c.getByRole('dialog', { name: 'Emojis' }).getByRole('button', { name: '😀' }).click();
  await c.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(c.locator('.scx-msg[data-mine]').last()).toContainText('vegana?');
  // Foto da galeria (reduzida no aparelho antes de subir).
  await c
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: 'prato.png', mimeType: 'image/png', buffer: PHOTO });
  await expect(c.locator('.scx-attach__file')).toBeVisible();
  await c.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(c.locator('.scx-msg[data-mine] .scx-media img')).toBeVisible();
  await expect(c.locator('.scx-msg[data-mine] .scx-status').last()).toHaveText('Enviada');
  await c.screenshot({ path: shots('cliente') });

  // Equipe: selo no Chat do topo, aba Clientes, abre e responde.
  await enterPanel(page, EMAIL, PASSWORD);
  const button = page.locator('.tc-top:not(.tc-top--ai)');
  await expect(button.locator('.tc-top__badge')).toBeVisible();
  await button.click();
  const chat = page.getByRole('dialog', { name: 'Chat da equipe' });
  await chat
    .getByRole('navigation', { name: 'Seções do chat' })
    .getByRole('button', { name: /Clientes/ })
    .click();
  let panel = chat;
  await panel.getByRole('button', { name: new RegExp(who) }).click();
  await expect(panel.locator('.scx-media img')).toBeVisible();
  await panel.getByLabel('Mensagem').fill('Temos sim! Hambúrguer de grão-de-bico 🌱');
  await panel.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(panel.locator('.scx-msg[data-mine]').last()).toContainText('grão-de-bico');
  await page.screenshot({ path: shots('pdv-conversa') });

  // O cliente recebe na hora e a mensagem dele aparece como lida.
  await expect(c.locator('.scx-msg:not([data-mine])').last()).toContainText('grão-de-bico');
  await expect(c.locator('.scx-msg[data-mine] .scx-status').last()).toHaveText('Lida');

  // Nova mensagem com o painel fechado: aviso no canto com "Responder".
  await panel.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(panel).toBeHidden();
  await c.getByLabel('Mensagem').fill('Perfeito, vou pedir! 😋');
  await c.getByRole('button', { name: 'Enviar', exact: true }).click();
  const peek = page.locator('.speek');
  await expect(peek).toContainText(who);
  await page.screenshot({ path: shots('pdv-aviso') });
  await peek.getByRole('button', { name: new RegExp(`Responder ${who}`) }).click();
  panel = page.getByRole('dialog', { name: /Mensagens dos clientes/ });
  await expect(panel.locator('.scx-msg:not([data-mine])').last()).toContainText('vou pedir');
  await c.screenshot({ path: shots('cliente-resposta') });
  await customer.close();
});
