// Busca de todas as impressoras ao mesmo tempo, para a tela inicial do aplicativo. Cada etapa
// entra na lista assim que termina (a rede, a mais lenta, vem por último).
import { listPairedWithoutPort } from '../bluetooth.mjs';
import { listDirectDevices, listSerialPorts, scanNetwork } from '../devices.mjs';
import { isVirtualPrinter, looksLikeReceipt } from '../printers.mjs';
import { listUninstalledUsb, windowsPrinterDrivers } from '../usb.mjs';

/**
 * @typedef {{ id: string, kind: 'system'|'usb-new'|'network'|'bluetooth'|'serial'|'direct'|'bt-noport',
 *   name: string, detail: string, spec?: string, receipt?: boolean, action?: 'install'|'bind'|'com',
 *   installId?: string, mac?: string }} Found
 */

/** Junta as listas de cada etapa numa só, sem repetir, na ordem que mais ajuda. */
export function mergeFound(parts) {
  const order = ['system', 'usb-new', 'network', 'bluetooth', 'bt-noport', 'serial', 'direct'];
  const seen = new Set();
  const out = [];
  for (const kind of order)
    for (const f of parts[kind] ?? []) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push(f);
    }
  return out;
}

/** Itens da lista a partir de cada fonte (funções puras, testadas). */
export const toFound = {
  system(list, drivers = new Map()) {
    return list
      .map((p) => {
        const info = drivers.get(p.name);
        const driver = info?.driver || p.options?.['printer-make-and-model'] || '';
        return { p, driver };
      })
      .filter(({ p, driver }) => !isVirtualPrinter(p.name, driver))
      .map(({ p, driver }) => {
        const receipt = looksLikeReceipt(p.name, driver);
        return {
          id: `printer:${p.name}`,
          kind: 'system',
          name: p.displayName || p.name,
          detail: receipt
            ? `Instalada no computador${driver ? ` · ${driver}` : ''}`
            : `Impressora comum (folha)${driver ? ` · ${driver}` : ''}`,
          spec: receipt ? `printer:${p.name}` : `printer:${p.name}?modo=folha`,
          receipt,
        };
      });
  },
  usbNew: (list) =>
    list.map((u) => ({
      id: `usb-new:${u.id}`,
      kind: 'usb-new',
      name: u.label,
      detail: 'No cabo USB, falta instalar (um clique)',
      action: 'install',
      installId: u.id,
    })),
  network: (list) =>
    list.map((n) => ({
      id: `tcp://${n.host}:${n.port}`,
      kind: 'network',
      name: n.name || 'Impressora de rede',
      detail: `Rede · ${n.host}${n.port === 9100 ? '' : `:${n.port}`}`,
      spec: `tcp://${n.host}:${n.port}${n.mac ? `?mac=${n.mac}` : ''}`,
      receipt: true,
      mac: n.mac,
    })),
  serial: (list) =>
    list.map((p) => ({
      id: `serial:${p.path}`,
      kind: p.kind === 'bluetooth' ? 'bluetooth' : 'serial',
      name: p.label,
      detail: `${p.kind === 'bluetooth' ? 'Bluetooth' : p.kind === 'usb' ? 'USB-serial' : 'Serial'} · ${p.path}`,
      spec: `serial:${p.path}`,
      receipt: true,
    })),
  direct: (list) =>
    list.map((p) => ({
      id: `file:${p.path}`,
      kind: 'direct',
      name: p.label,
      detail: `USB direto · ${p.path}`,
      spec: `file:${p.path}`,
      receipt: true,
    })),
  btNoPort: (list, platform = process.platform) =>
    list.map((d) => ({
      id: `bt:${d.mac}`,
      kind: 'bt-noport',
      name: d.name,
      detail:
        platform === 'win32'
          ? 'Bluetooth pareada, falta a porta COM'
          : platform === 'linux'
            ? 'Bluetooth pareada, falta a porta (um clique)'
            : 'Bluetooth pareada sem porta serial: use BLE ou o cabo',
      action: platform === 'win32' ? 'com' : platform === 'linux' ? 'bind' : undefined,
      mac: d.mac,
    })),
};

/**
 * @param {{ systemPrinters: () => Promise<any[]>, onStep: (step: string, st: string) => void,
 *   onFound: (list: Found[]) => void, onProgress?: (done: number, total: number) => void }} o
 */
export async function discoverAll(o) {
  const parts = {};
  const step = async (name, kinds, run) => {
    o.onStep(name, 'busy');
    try {
      Object.assign(parts, await run());
      o.onStep(name, 'ok');
    } catch {
      for (const k of kinds) parts[k] = parts[k] ?? [];
      o.onStep(name, 'fail');
    }
    o.onFound(mergeFound(parts));
  };
  await Promise.all([
    step('instaladas', ['system'], async () => {
      const [list, drivers] = await Promise.all([
        o.systemPrinters(),
        process.platform === 'win32' ? windowsPrinterDrivers() : new Map(),
      ]);
      return { system: toFound.system(list, drivers) };
    }),
    step('usb', ['usb-new', 'direct'], async () => {
      const [fresh, direct] = await Promise.all([listUninstalledUsb(), listDirectDevices()]);
      return { 'usb-new': toFound.usbNew(fresh), direct: toFound.direct(direct) };
    }),
    step('bluetooth', ['bluetooth', 'serial', 'bt-noport'], async () => {
      const [ports, noPort] = await Promise.all([listSerialPorts(), listPairedWithoutPort()]);
      const all = toFound.serial(ports);
      return {
        bluetooth: all.filter((f) => f.kind === 'bluetooth'),
        serial: all.filter((f) => f.kind === 'serial'),
        'bt-noport': toFound.btNoPort(noPort),
      };
    }),
    step('rede', ['network'], async () => ({
      network: toFound.network(await scanNetwork({ onProgress: o.onProgress })),
    })),
  ]);
  return mergeFound(parts);
}
