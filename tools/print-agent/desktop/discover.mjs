// Busca de todas as impressoras ao mesmo tempo, para a tela inicial do aplicativo. Cada etapa
// entra na lista assim que termina (a rede, a mais lenta, vem por último). Toda impressora vem
// com o tipo (térmica, jato de tinta, laser, matricial, etiqueta, virtual) e tudo o que o sistema
// e ela mesma contam: modelo, driver, porta, IP, série, situação, tinta/toner, páginas, papéis.
import { listPairedWithoutPort } from '../bluetooth.mjs';
import { listDirectDevices, listSerialPorts, scanNetwork } from '../devices.mjs';
import { inspectHost, mapLimit, typeOfDetails } from '../inspect.mjs';
import { TYPE_LABEL, printerType, speaksEscPos } from '../kinds.mjs';
import { run } from '../printers.mjs';
import { listUninstalledUsb, windowsPrinterDrivers } from '../usb.mjs';

/**
 * @typedef {{ id: string, kind: 'system'|'usb-new'|'network'|'bluetooth'|'serial'|'direct'|'bt-noport',
 *   name: string, detail: string, spec?: string, receipt?: boolean, type?: string,
 *   action?: 'install'|'bind'|'com'|'install-net'|'os-add', installId?: string, mac?: string, host?: string,
 *   ippPath?: string, usable?: boolean, details?: Record<string, any> }} Found
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
  // Impressora instalada no sistema que aponta para um IP achado na rede: fica só a instalada
  // (com os detalhes da rede), que é a que imprime pelo driver certo.
  const sysHosts = new Map(
    out.filter((f) => f.kind === 'system' && f.host).map((f) => [f.host, f]),
  );
  return out.filter((f) => {
    if (f.kind !== 'network' || !sysHosts.has(f.host)) return true;
    const sys = sysHosts.get(f.host);
    sys.details = { ...f.details, ...sys.details, network: f.details?.network ?? null };
    return false;
  });
}

const WIN_ERRORS = {
  3: 'Pouco papel',
  4: 'Sem papel',
  5: 'Pouco toner/tinta',
  6: 'Sem toner/tinta',
  7: 'Tampa aberta',
  8: 'Papel enroscado',
  9: 'Offline',
  10: 'Precisa de manutenção',
  11: 'Bandeja de saída cheia',
};
const CUPS_STATE = { 3: 'Pronta', 4: 'Imprimindo', 5: 'Parada' };
const CUPS_REASON = {
  'media-empty': 'Sem papel',
  'media-needed': 'Sem papel',
  'media-jam': 'Papel enroscado',
  'toner-low': 'Pouco toner',
  'toner-empty': 'Sem toner',
  'marker-supply-low': 'Pouca tinta',
  'marker-supply-empty': 'Sem tinta',
  'door-open': 'Tampa aberta',
  'cover-open': 'Tampa aberta',
  offline: 'Offline',
  paused: 'Pausada',
};

/** IP de um endereço do CUPS (socket://, ipp://, lpd://, http://...). */
export function hostOfUri(uri) {
  const m = /^(?:socket|ipps?|lpd|https?):\/\/([^/:?]+)/i.exec(String(uri ?? ''));
  return m && /^\d{1,3}(\.\d{1,3}){3}$/.test(m[1]) ? m[1] : null;
}

/** Como a impressora do sistema está ligada, pela porta (Windows) ou pelo endereço (CUPS). */
export function connectionOf(port = '', uri = '', server = '') {
  const s = `${port} ${uri}`;
  if (server || /^\\\\/.test(port)) return 'Compartilhada pela rede';
  if (/^USB\d|usb:\/\//i.test(s)) return 'Cabo USB';
  if (/^(LPT|PRN)|parallel:/i.test(s)) return 'Cabo paralelo (LPT)';
  if (/^COM\d|serial:/i.test(s)) return 'Serial (COM)';
  if (/bluetooth|bth|BTH/i.test(s)) return 'Bluetooth';
  if (/^WSD|wsd:|dnssd:|mdns:/i.test(s)) return 'Rede (achada pelo sistema)';
  if (/^(IP_|\d{1,3}\.\d)|socket:|ipps?:|lpd:|https?:/i.test(s)) return 'Rede (IP)';
  if (/PORTPROMPT|FILE:|NUL:|cups-pdf|file:/i.test(s)) return 'Arquivo';
  return port || uri ? 'Outra' : 'Não informada';
}

const list = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : String(v).split(','));

/** Níveis de tinta/toner que o CUPS guarda (marker-names / marker-levels). */
export function cupsSupplies(o = {}) {
  const names = list(o['marker-names']);
  const levels = list(o['marker-levels']).map(Number);
  const colors = list(o['marker-colors']);
  return names.map((n, i) => ({
    name: String(n).replace(/\\/g, '').trim().slice(0, 60),
    level: Number.isFinite(levels[i]) && levels[i] >= 0 ? Math.min(100, levels[i]) : null,
    color: /^#[0-9a-f]{6}$/i.test(colors[i] ?? '') ? colors[i] : null,
  }));
}

/** Itens da lista a partir de cada fonte (funções puras, testadas). */
export const toFound = {
  /** @param {any[]} list impressoras do Electron  @param {Map<string, any>} win dados do Windows */
  system(list, win = new Map(), jobs = new Map()) {
    const out = list.map((p) => {
      const w = win.get(p.name) ?? {};
      const o = p.options ?? {};
      const driver = w.driver || o['printer-make-and-model'] || '';
      const uri = o['device-uri'] || '';
      const type = printerType(p.name, driver, w.maker, o['printer-info']);
      const receipt = speaksEscPos(type, !!driver);
      const usable = type !== 'virtual';
      const host = w.host && /^\d{1,3}(\.\d{1,3}){3}$/.test(w.host) ? w.host : hostOfUri(uri);
      const reasons = String(o['printer-state-reasons'] ?? '')
        .split(',')
        .map((r) => CUPS_REASON[r.trim().replace(/-(report|warning|error)$/, '')])
        .filter(Boolean);
      const caps = (w.caps ?? []).map(String);
      const details = {
        type,
        model:
          w.maker && driver && !driver.toLowerCase().includes(w.maker.toLowerCase())
            ? `${w.maker} ${driver}`
            : driver || null,
        driver: driver || null,
        connection: connectionOf(w.port, uri, w.server),
        port: w.port || uri || null,
        host: host ?? null,
        share: w.shared ? w.share || p.name : null,
        server: w.server || null,
        location: w.location || o['printer-location'] || null,
        comment: w.comment || o['printer-info'] || null,
        isDefault: !!(w.isDefault ?? p.isDefault),
        status:
          w.offline || w.status === 'Offline'
            ? 'Offline'
            : w.status
              ? ({ Normal: 'Pronta', Paused: 'Pausada', Error: 'Com erro', Printing: 'Imprimindo' }[
                  w.status
                ] ?? w.status)
              : (CUPS_STATE[o['printer-state']] ?? null),
        problems: [...new Set([...(WIN_ERRORS[w.error] ? [WIN_ERRORS[w.error]] : []), ...reasons])],
        jobs: typeof w.jobs === 'number' ? w.jobs : (jobs.get(p.name) ?? null),
        supplies: cupsSupplies(o),
        color: caps.length ? caps.includes('Color') : null,
        duplex: caps.length ? caps.includes('Duplex') : null,
        resolution: w.dpi ? `${w.dpi} dpi` : null,
        paper: (w.paper ?? []).map(String),
      };
      return {
        id: `printer:${p.name}`,
        kind: 'system',
        name: p.displayName || p.name,
        detail: [
          TYPE_LABEL[type],
          details.connection === 'Não informada' ? null : details.connection,
          driver,
        ]
          .filter(Boolean)
          .join(' · '),
        spec: usable ? (receipt ? `printer:${p.name}` : `printer:${p.name}?modo=folha`) : undefined,
        receipt,
        type,
        usable,
        host: host ?? undefined,
        details,
      };
    });
    // As virtuais (PDF, OneNote) aparecem, mas no fim: não servem para a comanda.
    return out.sort((a, b) => Number(b.usable) - Number(a.usable));
  },
  usbNew: (list) =>
    list.map((u) => ({
      id: `usb-new:${u.id}`,
      kind: 'usb-new',
      name: u.label,
      detail: 'No cabo USB, falta instalar (um clique)',
      action: 'install',
      installId: u.id,
      type: printerType(u.label),
      details: { type: printerType(u.label), connection: 'Cabo USB', port: u.id },
    })),
  /** @param {any[]} list  @param {Map<string, any>} inspected detalhes por IP (IPP/SNMP) */
  network: (list, inspected = new Map()) =>
    list.map((n) => {
      const d = inspected.get(n.host) ?? null;
      const name = n.name || d?.model || 'Impressora de rede';
      // Sem pista nenhuma, quem responde na porta 9100 é tratada como térmica (o caso comum).
      const guess = d
        ? typeOfDetails(d, n.name, n.bonjour?.model)
        : (typeFromBonjour(n) ?? printerType(n.name));
      const type = guess === 'desconhecida' && n.raw !== false && !d?.model ? 'termica' : guess;
      const raw = n.raw !== false;
      const receipt = raw && (type === 'termica' || type === 'desconhecida');
      const ippOk = !!d?.ipp || n.port === 631;
      const details = {
        type,
        ...(d ?? {}),
        model: d?.model || n.bonjour?.model || null,
        location: d?.location || n.bonjour?.location || null,
        web: d?.web || n.bonjour?.admin || null,
        connection: 'Rede (IP)',
        host: n.host,
        port: n.port,
        mac: n.mac ?? null,
        network: { raw, ipp: ippOk, port: n.port },
      };
      return {
        id: `tcp://${n.host}:${n.port}`,
        kind: 'network',
        name,
        detail: [TYPE_LABEL[type], `Rede · ${n.host}${n.port === 9100 ? '' : `:${n.port}`}`]
          .filter(Boolean)
          .join(' · '),
        // Térmica: texto direto na porta 9100. Jato/laser/etiqueta: instala no sistema (IPP).
        spec: receipt ? `tcp://${n.host}:${n.port}${n.mac ? `?mac=${n.mac}` : ''}` : undefined,
        // Sem IPP: o jeito é adicionar pelo próprio sistema (abre a tela de impressoras).
        action: receipt ? undefined : ippOk ? 'install-net' : 'os-add',
        receipt,
        type,
        usable: true,
        host: n.host,
        ippPath: d?.ipp ?? n.bonjour?.rp ?? undefined,
        mac: n.mac,
        details,
      };
    }),
  serial: (list) =>
    list.map((p) => ({
      id: `serial:${p.path}`,
      kind: p.kind === 'bluetooth' ? 'bluetooth' : 'serial',
      name: p.label,
      detail: `${p.kind === 'bluetooth' ? 'Bluetooth' : p.kind === 'usb' ? 'USB-serial' : 'Serial'} · ${p.path}`,
      spec: `serial:${p.path}`,
      receipt: true,
      type: 'termica',
      details: {
        type: 'termica',
        connection:
          p.kind === 'bluetooth' ? 'Bluetooth' : p.kind === 'usb' ? 'USB-serial' : 'Serial (COM)',
        port: p.path,
      },
    })),
  direct: (list) =>
    list.map((p) => ({
      id: `file:${p.path}`,
      kind: 'direct',
      name: p.label,
      detail: `USB direto · ${p.path}`,
      spec: `file:${p.path}`,
      receipt: true,
      type: printerType(p.label) === 'desconhecida' ? 'termica' : printerType(p.label),
      details: { type: printerType(p.label), connection: 'Cabo USB (direto)', port: p.path },
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
      type: printerType(d.name),
      details: { type: printerType(d.name), connection: 'Bluetooth (pareada)', mac: d.mac },
    })),
};

/** Tipo pelo que a impressora anuncia no Bonjour (linguagem e modelo). */
function typeFromBonjour(n) {
  const b = n.bonjour;
  if (!b) return null;
  const t = printerType(b.model, n.name);
  if (t !== 'desconhecida') return t;
  if (/urf|pwg|pdf|postscript|pcl/i.test(b.pdl ?? '')) return 'laser';
  return null;
}

/** Trabalhos na fila de cada impressora do CUPS (lpstat -o). */
export function parseLpstatJobs(text) {
  const out = new Map();
  for (const line of String(text).split('\n')) {
    const m = /^(\S+)-\d+\s/.exec(line);
    if (m) out.set(m[1], (out.get(m[1]) ?? 0) + 1);
  }
  return out;
}

/**
 * @param {{ systemPrinters: () => Promise<any[]>, onStep: (step: string, st: string) => void,
 *   onFound: (list: Found[]) => void, onProgress?: (done: number, total: number) => void }} o
 */
export async function discoverAll(o) {
  const parts = {};
  const step = async (name, kinds, fn) => {
    o.onStep(name, 'busy');
    try {
      Object.assign(parts, await fn());
      o.onStep(name, 'ok');
    } catch {
      for (const k of kinds) parts[k] = parts[k] ?? [];
      o.onStep(name, 'fail');
    }
    o.onFound(mergeFound(parts));
  };
  await Promise.all([
    step('instaladas', ['system'], async () => {
      const [list, win, jobs] = await Promise.all([
        o.systemPrinters(),
        process.platform === 'win32' ? windowsPrinterDrivers() : new Map(),
        process.platform === 'win32'
          ? new Map()
          : run('lpstat', ['-o'], { timeoutMs: 8000 }).then(parseLpstatJobs, () => new Map()),
      ]);
      const system = toFound.system(list, win, jobs);
      parts.system = system;
      o.onFound(mergeFound(parts));
      // Impressora instalada que fica na rede: pergunta a ela a tinta, a situação e a série.
      const withHost = system.filter((f) => f.host);
      const info = await mapLimit(withHost, 6, (f) => inspectHost(f.host).catch(() => null));
      withHost.forEach((f, i) => {
        const d = info[i];
        if (!d) return;
        f.details = {
          ...d,
          ...Object.fromEntries(
            Object.entries(f.details).filter(
              ([, v]) => v != null && !(Array.isArray(v) && !v.length),
            ),
          ),
          problems: [...new Set([...(f.details.problems ?? []), ...(d.problems ?? [])])],
        };
      });
      return { system };
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
    step('rede', ['network'], async () => {
      const list = await scanNetwork({ onProgress: o.onProgress });
      parts.network = toFound.network(list);
      o.onFound(mergeFound(parts));
      const info = await mapLimit(list, 8, (n) =>
        inspectHost(n.host, { ippPaths: n.bonjour?.rp ? [n.bonjour.rp] : [] }).catch(() => null),
      );
      return { network: toFound.network(list, new Map(list.map((n, i) => [n.host, info[i]]))) };
    }),
  ]);
  return mergeFound(parts);
}
