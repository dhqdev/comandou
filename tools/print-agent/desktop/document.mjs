// Impressora comum (jato de tinta, laser) pelo driver do sistema: a comanda vira uma folha com
// letra de largura fixa (as colunas continuam alinhadas), impressa sem abrir a janela de impressão.
import { BrowserWindow } from 'electron';
import { documentHtml } from './pure.mjs';

/** Imprime em silêncio na impressora `name` do sistema. */
export async function printDocument(name, text, opts = {}) {
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
                new Error(
                  /cancel/i.test(reason ?? '')
                    ? 'A impressão foi cancelada.'
                    : `A impressora "${name}" não imprimiu (${reason || 'sem motivo do sistema'}). Ela está ligada, com papel e sem erro na fila do sistema?`,
                ),
              ),
      ),
    );
  } finally {
    w.destroy();
  }
}
