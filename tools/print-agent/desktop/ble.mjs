// Bluetooth BLE (baixo consumo) pelo Web Bluetooth do Chromium, para as impressoras portáteis
// que não criam porta COM. Uma janela escondida (ble/index.html) guarda as impressoras e manda
// os dados; aqui escolhemos o aparelho no evento "select-bluetooth-device":
//   - pela tela do aplicativo (lista ao vivo, a pessoa clica), ao adicionar a impressora;
//   - sozinho, pelo endereço salvo, quando precisa religar (aplicativo reaberto, impressora
//     desligada e ligada).
import { BrowserWindow } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validBleId } from '../printers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIND_MS = 15_000;

export class BleBridge {
  /** @param {{ onDevices: (list: { id: string, name: string }[]) => void }} o */
  constructor(o) {
    this.o = o;
    /** @type {BrowserWindow | undefined} */
    this.win = undefined;
    /** escolha em andamento: { mode: 'pick' } ou { mode: 'auto', id } */
    this.select = null;
    this.queue = Promise.resolve();
  }

  /** Janela escondida (também serve para ler as impressoras do sistema sem a janela principal). */
  window() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    void this.win.loadFile(join(here, 'ble', 'index.html'));
    this.win.webContents.on('will-navigate', (e) => e.preventDefault());
    this.win.webContents.on('select-bluetooth-device', (event, list, callback) => {
      event.preventDefault();
      this.onList(list, callback);
    });
    // Impressora que pede confirmação ou PIN no pareamento: aceita e tenta os PINs de fábrica.
    this.win.webContents.session.setBluetoothPairingHandler?.((details, callback) => {
      if (details.pairingKind === 'providePin') callback({ confirmed: true, pin: '0000' });
      else callback({ confirmed: true });
    });
    return this.win;
  }

  async ready() {
    const w = this.window();
    if (w.webContents.isLoading())
      await new Promise((r) => w.webContents.once('did-finish-load', r));
    return w;
  }

  onList(list, callback) {
    const sel = this.select;
    if (!sel) return;
    if (sel.done) {
      // Escolha (ou desistência) feita antes da primeira lista: responde agora.
      if (sel.cancelLater) {
        sel.cancelLater = false;
        callback(sel.chosen ?? '');
      }
      return;
    }
    sel.callback = callback;
    const devices = list
      .filter((d) => validBleId(d.deviceId))
      .map((d) => ({ id: d.deviceId, name: d.deviceName || '' }));
    if (sel.mode === 'auto') {
      if (devices.some((d) => d.id === sel.id)) this.finish(sel.id);
      return;
    }
    // Aparelhos sem nome quase nunca são impressora: ficam no fim da lista.
    devices.sort((a, b) => Number(!a.name) - Number(!b.name) || a.name.localeCompare(b.name));
    this.o.onDevices(devices);
  }

  finish(id) {
    const sel = this.select;
    if (!sel || sel.done) return;
    sel.done = true;
    clearTimeout(sel.timer);
    sel.chosen = id;
    sel.callback?.(id);
    // Sem lista ainda (nenhum aparelho apareceu): o Chromium só cancela pelo retorno.
    if (!sel.callback) sel.cancelLater = true;
  }

  async call(code) {
    const w = await this.ready();
    // userGesture = true: o Chromium só abre a procura de Bluetooth "depois de um clique".
    const r = await w.webContents.executeJavaScript(
      `(${code}).then((v) => ({ ok: true, v }), (e) => ({ ok: false, name: e.name, message: String(e.message) }))`,
      true,
    );
    if (!r.ok) throw Object.assign(new Error(r.message), { name: r.name });
    return r.v;
  }

  /** Uma procura de cada vez (o Chromium não abre duas). */
  serial(fn) {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async request(sel) {
    this.select = sel;
    sel.timer = setTimeout(() => this.finish(''), sel.mode === 'auto' ? FIND_MS : 120_000);
    let hang;
    const limit = new Promise((_, reject) => {
      hang = setTimeout(
        () => reject(new Error('NOT_FOUND')),
        (sel.mode === 'auto' ? FIND_MS : 120_000) + 15_000,
      );
    });
    try {
      const r = await Promise.race([this.call('bleRequest()'), limit]).catch((e) => {
        // O Chromium não devolveu a procura: recarrega a janela para a próxima não travar.
        if (e.message === 'NOT_FOUND' && !sel.chosen) this.win?.webContents.reload();
        throw e;
      });
      if (!sel.chosen) throw new Error('NOT_FOUND');
      await this.call(`Promise.resolve(bleKeep(${JSON.stringify(sel.chosen)}))`);
      return { id: sel.chosen, name: r.name };
    } finally {
      clearTimeout(sel.timer);
      clearTimeout(hang);
      if (this.select === sel) this.select = null;
    }
  }

  /** Abre a procura; a tela recebe a lista por onDevices e responde com choose(id) ou cancel(). */
  scan() {
    return this.serial(() =>
      this.request({ mode: 'pick' }).catch((e) => {
        const m = `${e.name} ${e.message}`;
        if (!/adapter|not available/i.test(m) && /NOT_FOUND|NotFoundError|cancel/i.test(m))
          return null;
        throw new Error(bleError(e));
      }),
    );
  }

  choose(id) {
    if (this.select?.mode === 'pick' && validBleId(id)) this.finish(id);
  }

  cancel() {
    if (this.select?.mode === 'pick') this.finish('');
  }

  /** Manda os bytes; se a janela não conhece a impressora (app reaberto), acha pelo endereço. */
  write(id, data) {
    if (!validBleId(id)) return Promise.reject(new Error('Impressora Bluetooth inválida.'));
    return this.serial(async () => {
      const b64 = Buffer.from(data).toString('base64');
      if (!(await this.call(`Promise.resolve(bleKnown(${JSON.stringify(id)}))`)))
        await this.request({ mode: 'auto', id }).catch((e) => {
          throw new Error(bleError(e));
        });
      try {
        await this.call(`bleWrite(${JSON.stringify(id)}, ${JSON.stringify(b64)})`);
      } catch (e) {
        // Desligou e ligou: uma nova tentativa religa do zero.
        if (/NetworkError|disconnected|GATT/i.test(`${e.name} ${e.message}`))
          await this.call(`bleWrite(${JSON.stringify(id)}, ${JSON.stringify(b64)})`).catch((e2) => {
            throw new Error(bleError(e2));
          });
        else throw new Error(bleError(e));
      }
    });
  }
}

/** Mensagem clara para as falhas do BLE. */
export function bleError(e) {
  const m = `${e?.name ?? ''} ${e?.message ?? e}`;
  if (/NotSupportedError|adapter|not available/i.test(m))
    return 'O Bluetooth deste computador está desligado ou não aceita BLE. Ligue o Bluetooth e tente de novo.';
  if (/NOT_FOUND|NotFoundError/.test(m))
    return 'Impressora Bluetooth não encontrada. Ela está ligada, perto do computador e desconectada do celular?';
  if (/NO_CHAR/.test(m))
    return 'Esta impressora Bluetooth não aceita impressão por BLE. Pareie no sistema (porta COM) ou use o cabo USB.';
  if (/SecurityError|NotAllowedError/.test(m))
    return 'O sistema não deixou usar o Bluetooth. Libere o Comandou Impressão nas permissões de Bluetooth.';
  if (/NetworkError|GATT|disconnected/i.test(m))
    return 'A impressora Bluetooth desconectou no meio. Desligue e ligue a impressora e tente de novo.';
  return `Falha no Bluetooth: ${String(e?.message ?? e).slice(0, 160)}`;
}
