// Impressora comum (jato de tinta, laser) pelo driver do sistema: a comanda vira uma folha com
// letra de largura fixa (as colunas continuam alinhadas), impressa sem abrir a janela de impressão.
import { BrowserWindow } from 'electron';
import { sentError } from '../core.mjs';
import { spoolBacklog } from '../printers.mjs';
import { documentHtml } from './pure.mjs';

/** Imprime em silêncio na impressora `name` do sistema. */
export async function printDocument(name, text, opts = {}) {
  // A impressora parou (sem papel, sem tinta, desligada) e as comandas estão acumulando na fila
  // do Windows: não manda mais uma. Quando ela voltar, sairia tudo de uma vez.
  const stuck = await spoolBacklog(name).catch(() => null);
  if (stuck && (stuck.error > 0 || stuck.count >= 3))
    throw new Error(
      `A impressora "${name}" tem ${stuck.count} comanda${stuck.count === 1 ? '' : 's'} parada${stuck.count === 1 ? '' : 's'} na fila do Windows${stuck.error ? ' com erro' : ''}. Confira se ela está ligada, com papel e tinta, ou use "Limpar fila do Windows" na tela Impressão.`,
    );
  const w = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, javascript: false },
  });
  try {
    await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(documentHtml(text, opts))}`);
    await new Promise((resolve, reject) =>
      w.webContents.print(
        {
          silent: true,
          deviceName: name,
          printBackground: false,
          margins: { marginType: 'default' },
        },
        (ok, reason) =>
          ok
            ? resolve()
            : reject(
                /cancel/i.test(reason ?? '')
                  ? new Error('A impressão foi cancelada.')
                  : /invalid ?device|deviceName/i.test(reason ?? '')
                    ? new Error(
                        `Impressora "${name}" não encontrada no sistema. Ela foi removida ou mudou de nome: escolha de novo.`,
                      )
                    : // O Windows pode já ter recebido a folha (impressora pela rede/WSD
                      // costuma responder "falhou" e imprimir depois): não manda de novo.
                      sentError(
                        new Error(
                          `A impressora "${name}" não confirmou (${reason || 'sem motivo do sistema'}). Confira se saiu antes de mandar de novo.`,
                        ),
                      ),
              ),
      ),
    );
  } finally {
    w.destroy();
  }
}
