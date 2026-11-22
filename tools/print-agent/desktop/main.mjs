// Comandou Impressão: aplicativo de computador que fica perto do relógio (bandeja), liga o
// restaurante às impressoras térmicas e imprime as comandas sozinho, em segundo plano.
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  safeStorage,
  shell,
  Tray,
} from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrintAgent, parseConnectionCode } from '../core.mjs';
import { bindRfcomm, listPairedWithoutPort, validBtMac } from '../bluetooth.mjs';
import {
  arpTable,
  checkHost,
  listDirectDevices,
  listSerialPorts,
  printResilient,
  probe,
  scanNetwork,
  statusText,
  tcpStatus,
} from '../devices.mjs';
import {
  describePrinter,
  installedTwinOf,
  listSpool,
  parseSpec,
  parseTcp,
  registerTransport,
  removeSpool,
  testPageText,
  validBleId,
  validDirectDevice,
  validSerialPort,
} from '../printers.mjs';
import {
  installNetwork,
  installUsb,
  listUninstalledUsb,
  validCupsUri,
  validIp,
  validIppPath,
  validWinPort,
  windowsPrinterDrivers,
} from '../usb.mjs';
import { BleBridge } from './ble.mjs';
import { Brand } from './brand.mjs';
import { careCheck, careRun } from './care.mjs';
import { printDocument } from './document.mjs';
import { discoverAll } from './discover.mjs';
import { confirmHealth, macFromLinkLocal, printerEndpoints } from './pure.mjs';
import { Updater } from './updater.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PROTOCOL = 'comandou-impressao';
const VERSION = app.getVersion();
const CONFIG = join(app.getPath('userData'), 'config.json');
const MAX_LOG = 40;

app.setAppUserModelId('br.com.comandou.impressao');
// Linux: o Bluetooth BLE do Chromium ainda fica atrás desta opção.
if (process.platform === 'linux')
  app.commandLine.appendSwitch('enable-experimental-web-platform-features');

/** @type {{ url?: string, token?: string, tokenEnc?: string, agentName?: string, restaurant?: string,
 *   printers: { default: string, routes: Record<string, string> }, autostart: boolean, seenTargets: string[],
 *   bleNames: Record<string, string> }} */
let config = {
  printers: { default: '', routes: {} },
  autostart: true,
  notifications: true,
  seenTargets: [],
  bleNames: {},
};
/** Situação de cada impressora configurada: { [spec]: { ok, text, at } }. */
let health = {};
/** @type {PrintAgent | undefined} */
let agent;
let status = { state: 'idle' };
let jobs = [];
let win;
let tray;
let quitting = false;
let pendingCode;

// ------------------------------------------------------------------ configuração
async function loadConfig() {
  try {
    const c = JSON.parse(await readFile(CONFIG, 'utf8'));
    if (c.tokenEnc && safeStorage.isEncryptionAvailable())
      c.token = safeStorage.decryptString(Buffer.from(c.tokenEnc, 'base64'));
    config = {
      ...config,
      ...c,
      printers: { default: '', routes: {}, ...c.printers },
      bleNames: { ...c.bleNames },
    };
  } catch {
    /* primeira vez */
  }
}

async function saveConfig() {
  const { token, ...rest } = config;
  const out = { ...rest };
  delete out.tokenEnc;
  if (token) {
    if (safeStorage.isEncryptionAvailable())
      out.tokenEnc = safeStorage.encryptString(token).toString('base64');
    else out.token = token; // Linux sem chaveiro: arquivo só do usuário (0600)
  }
  await mkdir(dirname(CONFIG), { recursive: true });
  await writeFile(CONFIG, JSON.stringify(out, null, 2), { mode: 0o600 });
}

// ------------------------------------------------------------------ impressão
const ble = new BleBridge({ onDevices: (list) => win?.webContents.send('ble-devices', list) });
registerTransport('ble:', (base, data) => ble.write(base.slice(4), data));
// Impressora comum (jato de tinta, laser): o texto vai numa folha, pelo driver do sistema.
registerTransport('doc', (base, text, opts) => printDocument(base.slice(8), text, opts));

// Atualização pelo botão Atualizar (sem reinstalar na mão).
let updateNotified = '';
const updater = new Updater({
  version: VERSION,
  onChange: () => {
    const u = updater.state;
    if (u.available && u.latest && u.latest !== updateNotified && u.progress === null) {
      updateNotified = u.latest;
      notify(
        'Versão nova do Comandou Impressão',
        `A ${u.latest} está pronta. Abra o aplicativo e clique em Atualizar.`,
      );
    }
    push();
  },
  quit: () => {
    quitting = true;
    app.quit();
  },
  openExternal: (url) => shell.openExternal(url),
});

const brand = new Brand({
  helper: ble,
  defaultIcon: join(here, 'assets', 'icon.png'),
  onChange: () => {
    if (win && !win.isDestroyed()) win.setIcon(brand.windowImage());
    trayKey = '';
    push();
  },
});
let trayKey = '';

/** Troca uma impressora por outra em todos os setores (ex.: o roteador deu outro IP). */
async function replacePrinter(from, to) {
  if (config.printers.default === from) config.printers.default = to;
  for (const [t, spec] of Object.entries(config.printers.routes))
    if (spec === from) config.printers.routes[t] = to;
  delete health[from];
  await saveConfig();
  push();
}

/** Imprime; impressora de rede que mudou de IP é achada pelo MAC e salva no IP novo. */
function print(spec, text, meta) {
  return printResilient(spec, text, {
    meta,
    onMoved: async (from, to) => {
      await replacePrinter(from, to);
      notify(
        'A impressora mudou de IP',
        `Achamos ${describePrinter(to)} e ela continua imprimindo. Reserve o IP no roteador para não mudar mais.`,
      );
    },
  });
}

/** Impressoras escolhidas, para a tela Impressão do sistema (vai no heartbeat). */
function report() {
  const kindOf = (spec) => {
    const { base, opts } = parseSpec(spec);
    if (!spec || spec === 'none') return 'none';
    if (opts.mode === 'doc') return 'document';
    if (base.startsWith('tcp://')) return 'network';
    if (base.startsWith('ble:')) return 'bluetooth';
    if (base.startsWith('serial:')) return /rfcomm|cu\./.test(base) ? 'bluetooth' : 'serial';
    return 'usb';
  };
  const row = (target, spec) => ({
    target: target === null ? null : String(target).slice(0, 60),
    label: (spec && spec !== 'none' ? printerName(spec) : 'Não imprime').slice(0, 80),
    kind: kindOf(spec),
    ...(health[spec] ? { state: health[spec].off ? 'off' : 'ok' } : {}),
  });
  const out = [];
  if (config.printers.default) out.push(row(null, config.printers.default));
  for (const [t, spec] of Object.entries(config.printers.routes)) if (spec) out.push(row(t, spec));
  return out.slice(0, 40);
}

const printerFor = (target) => config.printers.routes[target] || config.printers.default || 'none';

/**
 * Impressoras desligadas (conferidas sem imprimir): o que vai para elas espera no Comandou.
 * Antes, o Windows aceitava a folha com a impressora desligada e, quando ela ligava, saía tudo.
 */
function hold() {
  const off = (spec) => !!(spec && spec !== 'none' && health[spec]?.off);
  const on = [];
  const offTargets = [];
  for (const [t, spec] of Object.entries(config.printers.routes))
    if (spec) (off(spec) ? offTargets : on).push(String(t).slice(0, 60));
  return {
    mainOn: !off(config.printers.default),
    on: on.slice(0, 40),
    off: offTargets.slice(0, 40),
  };
}

// ------------------------------------------------------------------ fila do Windows
/** O que está na fila do Windows agora (para a tela daqui e para o painel). */
let spool = { jobs: [], at: 0 };
/** Documentos do Comandou que este computador apagou da fila e o Comandou ainda não sabe. */
let spoolRemoved = [];

/**
 * Lê a fila do Windows das impressoras escolhidas, apaga as comandas que passaram da validade
 * (não saem atrasadas quando a impressora volta) e devolve o que mandar ao Comandou.
 * Fora do Windows: null (o aplicativo não sabe ler a fila do sistema).
 */
async function readSpool(maxAge) {
  const list = await listSpool(chosenSystemPrinters());
  if (!list) return null;
  const old = (d) =>
    maxAge > 0 && d.ours && d.at && Date.now() - Date.parse(d.at) > maxAge * 60_000;
  const expired = list.filter(old);
  let jobs = list;
  if (expired.length) {
    await removeSpool(expired).catch(() => 0);
    const gone = new Set(expired);
    jobs = list.filter((d) => !gone.has(d));
    for (const d of expired) if (d.jobId) spoolRemoved.push({ id: d.jobId, reason: 'expired' });
    notify(
      'Comandas velhas apagadas',
      `${expired.length} comanda${expired.length === 1 ? '' : 's'} esperava${expired.length === 1 ? '' : 'm'} na fila do Windows há mais de ${maxAge} min e não ${expired.length === 1 ? 'vai' : 'vão'} sair atrasada${expired.length === 1 ? '' : 's'}.`,
    );
  }
  const before = JSON.stringify(spool.jobs);
  spool = { jobs, at: Date.now() };
  if (JSON.stringify(jobs) !== before) push();
  const removed = spoolRemoved.slice(0, 200);
  spoolRemoved = spoolRemoved.slice(200);
  return {
    jobs: jobs.slice(0, 100).map(({ spoolId: _id, ...d }) => d),
    removed,
  };
}
// Sem impressora principal escolhida, não pega trabalhos: eles esperam na fila em vez de sumir.
const canPrint = () => !!config.printers.default;

// ------------------------------------------------------------------ agente
function startAgent() {
  agent?.stop();
  agent = undefined;
  if (!config.url || !config.token) {
    status = { state: 'idle' };
    return push();
  }
  agent = new PrintAgent({
    url: config.url,
    token: config.token,
    version: VERSION,
    printerFor,
    canPrint,
    print,
    report,
    label: (spec) => printerName(spec),
    purge: purgeChosen,
    removePrinters,
    hold,
    spool: readSpool,
    spoolFailed: (removed) => {
      spoolRemoved = [...removed, ...spoolRemoved];
    },
  });
  agent.on('status', async (s) => {
    status = s;
    if (s.brand) {
      const colors = {
        brandColor: s.brand.brandColor ?? null,
        accentColor: s.brand.accentColor ?? null,
        theme: s.brand.theme ?? 'auto',
        iconUrl: s.brand.iconUrl ?? null,
      };
      if (JSON.stringify(colors) !== JSON.stringify(config.brand)) {
        config.brand = colors;
        await saveConfig();
      }
      brand.update(config.url, colors.iconUrl).catch(() => undefined);
      brand.updateLogo(config.url, s.brand.logoUrl ?? null).catch(() => undefined);
    }
    if (s.restaurant && (s.restaurant !== config.restaurant || s.agent !== config.agentName)) {
      config.restaurant = s.restaurant;
      config.agentName = s.agent;
      await saveConfig();
    }
    if (s.targets) {
      const all = [...new Set([...s.targets, ...config.seenTargets])];
      if (all.length !== config.seenTargets.length) {
        config.seenTargets = all;
        await saveConfig();
      }
    }
    if (s.state === 'unauthorized')
      notify(
        'Impressão desligada',
        'O token foi trocado ou o computador foi desativado no painel.',
      );
    push();
  });
  agent.on('job', async (j) => {
    jobs = [{ ...j, printerLabel: describePrinter(j.printer) }, ...jobs].slice(0, MAX_LOG);
    if (!j.ok && !j.cancelled) notify(`Falha ao imprimir em ${j.target}`, j.error);
    // O Windows aceita a folha mesmo com a impressora desligada: só a conferência tira o aviso.
    if (!health[j.printer]?.off)
      health[j.printer] = {
        ok: j.ok,
        text: j.ok ? 'Imprimiu agora há pouco.' : j.error,
        at: Date.now(),
        misses: health[j.printer]?.misses ?? 0,
      };
    if (!config.seenTargets.includes(j.target)) {
      config.seenTargets.push(j.target);
      await saveConfig();
    }
    push();
  });
  agent.start();
}

/** Impressoras do sistema escolhidas aqui (as que têm fila do Windows). */
function chosenSystemPrinters() {
  return [config.printers.default, ...Object.values(config.printers.routes)]
    .map((spec) => parseSpec(spec).base)
    .filter((b) => b.startsWith('printer:'))
    .map((b) => b.slice(8));
}

/**
 * Pedido da tela Impressão (ou o botão daqui): apaga as comandas do Comandou paradas na fila do
 * Windows. Os documentos dos outros programas ficam. O Comandou fica sabendo quais eram.
 */
async function purgeChosen() {
  const list = (await listSpool(chosenSystemPrinters())) ?? [];
  const ours = list.filter((d) => d.ours);
  const n = ours.length ? await removeSpool(ours) : 0;
  for (const d of ours) if (d.jobId) spoolRemoved.push({ id: d.jobId, reason: 'purged' });
  if (agent) agent.spoolAt = 0;
  if (n)
    notify(
      'Fila do Windows limpa',
      `${n === 1 ? '1 comanda parada foi apagada' : `${n} comandas paradas foram apagadas`} da fila do Windows. Os documentos dos outros programas ficaram.`,
    );
  return n;
}

/** Pedido da tela Impressão: tira impressoras escolhidas (null = principal). */
async function removePrinters(targets) {
  let changed = false;
  for (const t of targets) {
    if (t === null) {
      if (config.printers.default) {
        delete health[config.printers.default];
        config.printers.default = '';
        changed = true;
      }
    } else if (config.printers.routes[t] !== undefined) {
      delete config.printers.routes[t];
      changed = true;
    }
  }
  if (!changed) return;
  await saveConfig();
  push();
  notify(
    'Impressora tirada',
    'A tela Impressão do Comandou tirou uma impressora deste computador.',
  );
}

/**
 * Impressora de rede escolhida como térmica (texto direto na porta 9100) que é a jato de tinta
 * ou laser instalada no Windows (ex.: Epson L4260): passa a imprimir pelo driver, numa folha.
 * Texto cru na porta 9100 de uma jato de tinta não sai ou sai uma folha por tentativa.
 */
async function fixRawToInkjet() {
  const raw = [config.printers.default, ...Object.values(config.printers.routes)].filter((s) =>
    /^tcp:\/\/.*[?&]mac=/.test(s ?? ''),
  );
  if (!raw.length) return;
  const installed = (await systemPrinters().catch(() => [])).map((p) => ({
    name: p.name,
    driver: p.options?.['printer-make-and-model'] ?? '',
  }));
  for (const spec of new Set(raw)) {
    const twin = installedTwinOf(spec, installed);
    if (!twin) continue;
    const to = `printer:${twin}?modo=folha`;
    await replacePrinter(spec, to);
    notify(
      'Impressora ajustada',
      `${describePrinter(spec)} é a ${twin}, que não é térmica de cupom: agora imprime pelo Windows, numa folha.`,
    );
  }
}

function notify(title, body) {
  if (config.notifications === false) return;
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
}

function publicState() {
  const targets = [...new Set(['Caixa', ...(status.targets ?? []), ...config.seenTargets])].filter(
    (t) => t && t !== 'Teste',
  );
  return {
    version: VERSION,
    platform: process.platform,
    connected: !!(config.url && config.token),
    url: config.url,
    restaurant: config.restaurant,
    agentName: config.agentName,
    status,
    printers: config.printers,
    targets,
    jobs,
    autostart: config.autostart,
    notifications: config.notifications !== false,
    offPrinters: offPrinters().map(printerName),
    health,
    bleNames: config.bleNames,
    brand: { ...(config.brand ?? {}), icon: brand.icon },
    discovery,
    update: updater.state,
    spool,
  };
}

function push() {
  win?.webContents.send('state', publicState());
  updateTray();
}

// ------------------------------------------------------------------ início automático
const LINUX_AUTOSTART = join(homedir(), '.config', 'autostart', 'comandou-impressao.desktop');

async function applyAutostart() {
  if (!app.isPackaged) return;
  if (process.platform === 'linux') {
    if (config.autostart) {
      const exe = process.env.APPIMAGE || process.execPath;
      await mkdir(dirname(LINUX_AUTOSTART), { recursive: true });
      await writeFile(
        LINUX_AUTOSTART,
        `[Desktop Entry]\nType=Application\nName=Comandou Impressão\nExec="${exe}" --hidden\nX-GNOME-Autostart-enabled=true\n`,
      );
    } else await rm(LINUX_AUTOSTART, { force: true });
    return;
  }
  app.setLoginItemSettings({ openAtLogin: config.autostart, args: ['--hidden'] });
}

// ------------------------------------------------------------------ janela e bandeja
function asset(name) {
  return join(here, 'assets', name);
}

/** Confere se há versão nova sem insistir: no máximo uma vez a cada 10 minutos. */
function checkUpdateSoon() {
  if (Date.now() - (updater.state.checkedAt ?? 0) > 10 * 60_000) void updater.check(true);
}

function showWindow() {
  checkUpdateSoon();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'Comandou Impressão',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1114' : '#f4f5f7',
    icon: brand.windowImage(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(join(here, 'ui', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('show', () => {
    void checkAll();
    trayKey = '';
    updateTray();
    // Abriu a janela: procura as impressoras sozinho (rede só se faz mais de 2 minutos).
    if (config.url) void discover(false);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!config.hintShown && config.url) {
      config.hintShown = true;
      void saveConfig();
      notify(
        'O Comandou continua imprimindo',
        'Fechamos só a janela. O ícone fica perto do relógio; clique nele para abrir de novo.',
      );
    }
  });
  win.on('closed', () => (win = undefined));
}

const STATUS_LABEL = {
  idle: 'Não conectado',
  connecting: 'Conectando…',
  online: 'Online, imprimindo',
  offline: 'Sem internet, tentando de novo',
  unauthorized: 'Desconectado pelo painel',
};

function updateTray() {
  if (!tray) return;
  const st = config.url ? status.state : 'idle';
  // Ícone do restaurante com a bolinha: verde conectado, amarelo tentando, vermelho desligado.
  if (trayKey !== st) {
    trayKey = st;
    brand
      .trayImage(st)
      .then((img) => {
        if (trayKey === st) tray.setImage(img);
      })
      .catch(() => tray.setImage(trayIcon(st === 'online')));
    if (process.platform === 'win32' && win && !win.isDestroyed())
      brand
        .dotImage(st)
        .then((img) => win?.setOverlayIcon(img, STATUS_LABEL[st] ?? ''))
        .catch(() => undefined);
  }
  const off = offPrinters();
  const label = off.length
    ? `Impressora desligada: ${off.map(printerName).join(', ')}`.slice(0, 90)
    : (STATUS_LABEL[status.state] ?? '');
  tray.setToolTip(
    `Comandou Impressão — ${label}${config.restaurant ? ` (${config.restaurant})` : ''}`,
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: config.restaurant ?? 'Comandou Impressão', enabled: false },
      { label, enabled: false },
      { type: 'separator' },
      { label: 'Abrir o painel de impressão', click: showWindow },
      {
        label: 'Imprimir página de teste',
        enabled: !!(config.printers.default && config.printers.default !== 'none'),
        click: () => void testPrint(config.printers.default),
      },
      ...(updater.state.available
        ? [
            { type: 'separator' },
            {
              label: `Atualizar para a ${updater.state.latest}`,
              enabled: updater.state.progress === null,
              click: () => void updater.install(),
            },
          ]
        : []),
      { type: 'separator' },
      {
        label: 'Sair (para de imprimir)',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function trayIcon(ok) {
  const name =
    process.platform === 'darwin' ? 'trayTemplate.png' : ok ? 'tray.png' : 'tray-alert.png';
  const img = nativeImage.createFromPath(asset(name));
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

// ------------------------------------------------------------------ ações da tela
async function connect(code) {
  const c = parseConnectionCode(code);
  // Testa antes de salvar: o usuário vê o erro na hora, não depois.
  const probe = new PrintAgent({
    url: c.url,
    token: c.token,
    version: VERSION,
    printerFor,
    print,
  });
  let hb;
  try {
    hb = await probe.api('/heartbeat', { version: VERSION });
  } catch (e) {
    if (e.status === 401)
      throw new Error('Este código já foi usado ou trocado. Gere um novo no painel.');
    throw new Error(`Não consegui falar com ${c.url}. Confira a internet e tente de novo.`);
  }
  config.url = c.url;
  config.token = c.token;
  config.restaurant = hb.restaurant;
  config.agentName = hb.agent ?? c.name;
  config.seenTargets = Array.isArray(hb.targets) ? hb.targets : [];
  await saveConfig();
  startAgent();
  // Acabou de conectar: já procura as impressoras deste computador.
  void discover(true);
  return publicState();
}

async function testPrint(spec) {
  if (!spec || spec === 'none') throw new Error('Escolha uma impressora primeiro.');
  // Desligada: o Windows guardaria a folha e ela sairia depois, junto com as outras.
  if (health[spec]?.off)
    throw new Error(
      `${printerName(spec)} está desligada ou não responde. Ligue a impressora e teste de novo.`,
    );
  const ev = {
    id: `teste-${Date.now()}`,
    kind: 'test',
    target: 'Teste',
    printer: spec,
    at: Date.now(),
  };
  try {
    await print(spec, testPageText(printerName(spec), spec), { doc: 'Comandou - Teste' });
    if (agent) agent.spoolAt = 0;
    health[spec] = { ok: true, text: 'Teste impresso.', at: Date.now() };
    jobs = [{ ...ev, ok: true, printerLabel: printerName(spec) }, ...jobs].slice(0, MAX_LOG);
    push();
  } catch (e) {
    jobs = [{ ...ev, ok: false, error: e.message, printerLabel: printerName(spec) }, ...jobs].slice(
      0,
      MAX_LOG,
    );
    push();
    throw e;
  }
}

function validSpec(spec) {
  if (spec === '' || spec === 'none') return true;
  const { base } = parseSpec(spec);
  if (base.startsWith('printer:')) return base.length > 8 && base.length < 300;
  if (base.startsWith('tcp://')) return !!parseTcp(base);
  if (base.startsWith('serial:')) return validSerialPort(base.slice(7));
  // USB direto só aponta para impressora (/dev/usb/lp0), nunca para um arquivo qualquer.
  if (base.startsWith('file:'))
    return process.platform === 'linux' && validDirectDevice(base.slice(5));
  if (base.startsWith('ble:')) return validBleId(base.slice(4));
  return false;
}

/** Nome para mostrar (BLE guarda o nome que a impressora anunciou). */
function printerName(spec) {
  const { base } = parseSpec(spec);
  if (base.startsWith('ble:') && config.bleNames[base.slice(4)])
    return `${config.bleNames[base.slice(4)]} (Bluetooth)`;
  return describePrinter(spec);
}

// ------------------------------------------------------------------ situação das impressoras
let systemNames = [];

async function systemPrinters() {
  const wc = win && !win.isDestroyed() ? win.webContents : (await ble.ready()).webContents;
  const list = await wc.getPrintersAsync();
  systemNames = list.map((p) => p.name);
  return list;
}

// Dados do Windows (porta, "Local"): custam um PowerShell, então valem por 5 minutos.
let winInfo = { at: 0, map: new Map() };
async function windowsInfo(fresh) {
  if (fresh || Date.now() - winInfo.at > 5 * 60_000)
    winInfo = { at: Date.now(), map: await windowsPrinterDrivers() };
  return winInfo.map;
}

/** A impressora responde na rede? Só abre e fecha a conexão. Null: não tem endereço de rede. */
async function answersOnNetwork(w) {
  const points = printerEndpoints(w.host, w.location);
  // WSD: o endereço do "Local" pode ficar velho; o MAC dele acha o IP atual na tabela ARP.
  const mac = macFromLinkLocal(w.location);
  if (mac)
    for (const [ip, m] of await arpTable().catch(() => []))
      if (m === mac) for (const port of [80, 631, 9100]) points.push({ host: ip, port });
  if (!points.length) return null;
  const replies = await Promise.all(points.map((p) => probe(p.host, p.port, 2000)));
  return replies.some(Boolean);
}

/** Impressora instalada no Windows: ligada ou desligada. Null quando o sistema não sabe dizer. */
async function systemPrinterPower(name) {
  if (process.platform !== 'win32') return null;
  let w = (await windowsInfo(false)).get(name);
  if (!w) return null;
  let on = await answersOnNetwork(w);
  if (on === false) {
    // Antes de acusar, relê os dados: o endereço pode ter mudado.
    w = (await windowsInfo(true)).get(name) ?? w;
    on = await answersOnNetwork(w);
  }
  if (on) return { ok: true, text: 'Ligada e respondendo.' };
  if (on === false || w.offline || w.status === 'Offline')
    return {
      ok: false,
      off: true,
      text: 'Desligada ou desconectada. Ligue a impressora e confira o cabo ou a rede.',
    };
  return null;
}

/** Impressoras escolhidas que estão desligadas agora. */
function offPrinters() {
  const specs = [config.printers.default, ...Object.values(config.printers.routes)];
  return [...new Set(specs)].filter((s) => s && s !== 'none' && health[s]?.off);
}

/** Avisa uma vez quando desliga e uma vez quando volta, e conta na hora para o sistema. */
const offWarned = new Set();
function warnPowerChanges() {
  const now = new Set(offPrinters());
  let changed = false;
  for (const s of now)
    if (!offWarned.has(s)) {
      offWarned.add(s);
      changed = true;
      notify(
        'Impressora desligada',
        `${printerName(s)} não responde. Ligue a impressora e confira o cabo ou a rede.`,
      );
    }
  for (const s of [...offWarned])
    if (!now.has(s)) {
      offWarned.delete(s);
      changed = true;
      notify('Impressora ligada de novo', `${printerName(s)} voltou a responder.`);
    }
  if (changed) agent?.poke();
}

/** Confere se a impressora está ao alcance sem imprimir nada. */
async function checkOne(spec) {
  const { base } = parseSpec(spec);
  if (base.startsWith('tcp://')) {
    const t = parseTcp(base);
    return (await probe(t.host, t.port, 2000))
      ? { ok: true, text: 'Ligada na rede.' }
      : {
          ok: false,
          off: true,
          text: `Desligada ou fora da rede: não responde em ${t.host}.`,
        };
  }
  if (base.startsWith('serial:')) {
    const port = base.slice(7).toUpperCase();
    const found = (await listSerialPorts()).some((p) => p.path.toUpperCase() === port);
    return found
      ? { ok: true, text: 'Porta encontrada.' }
      : {
          ok: false,
          off: true,
          text: `A porta ${base.slice(7)} sumiu: a impressora foi desligada, desconectada ou despareada.`,
        };
  }
  if (base.startsWith('file:'))
    return existsSync(base.slice(5))
      ? { ok: true, text: 'Cabo USB conectado.' }
      : {
          ok: false,
          off: true,
          text: 'Não achei a impressora USB. O cabo está conectado e ela, ligada?',
        };
  if (base.startsWith('printer:')) {
    await systemPrinters().catch(() => undefined);
    if (!systemNames.includes(base.slice(8)))
      return { ok: false, text: 'Não está mais instalada no sistema. Escolha de novo.' };
    return (
      (await systemPrinterPower(base.slice(8))) ?? {
        ok: true,
        text: 'Instalada no sistema.',
      }
    );
  }
  return null; // BLE: só se sabe imprimindo (ligar por BLE a cada minuto gasta a bateria dela)
}

/** Busca de impressoras: { running, at, found: [...], steps: { [etapa]: 'ok'|'busy' } } */
let discovery = { running: false, at: 0, found: [], steps: {} };
let discovering;

/** Procura tudo de uma vez (instaladas, USB sem driver, portas, Bluetooth e rede). */
function discover(force) {
  if (discovering) return discovering;
  if (!force && Date.now() - discovery.at < 120_000 && discovery.found.length)
    return Promise.resolve(discovery);
  discovery = { ...discovery, running: true, steps: {} };
  push();
  discovering = discoverAll({
    systemPrinters: () => systemPrinters(),
    onStep: (step, st) => {
      discovery.steps[step] = st;
      push();
    },
    onFound: (list) => {
      discovery.found = list;
      push();
    },
    onProgress: (done, total) => win?.webContents.send('scan-progress', { done, total }),
  })
    .then((list) => {
      discovery = { running: false, at: Date.now(), found: list, steps: discovery.steps };
      push();
      return discovery;
    })
    .catch(() => {
      discovery = { ...discovery, running: false, at: Date.now() };
      push();
      return discovery;
    })
    .finally(() => (discovering = undefined));
  return discovering;
}

let checking;
/** A cada 2 minutos (e ao abrir a janela): uma bolinha verde ou vermelha em cada impressora. */
function checkAll() {
  checking ??= (async () => {
    const specs = new Set(
      [config.printers.default, ...Object.values(config.printers.routes)].filter(
        (s) => s && s !== 'none',
      ),
    );
    for (const spec of specs) {
      const r = await checkOne(spec).catch(() => null);
      if (r) health[spec] = { ...confirmHealth(health[spec], r), at: Date.now() };
    }
    for (const k of Object.keys(health)) if (!specs.has(k)) delete health[k];
    warnPowerChanges();
    push();
  })().finally(() => (checking = undefined));
  return checking;
}

/** Tela de impressoras do sistema (para adicionar uma que o aplicativo não instala sozinho). */
function openPrinterSettings() {
  if (process.platform === 'win32') return void shell.openExternal('ms-settings:printers');
  if (process.platform === 'darwin')
    return void shell.openExternal(
      'x-apple.systempreferences:com.apple.Print-Scan-Settings.extension',
    );
  for (const [cmd, args] of [
    ['system-config-printer', []],
    ['gnome-control-center', ['printers']],
    ['systemsettings', ['kcm_printer_manager']],
  ]) {
    const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    p.on('error', () => undefined);
    p.unref();
    if (p.pid) break;
  }
}

function openBluetoothSettings(what) {
  if (what === 'printers') return openPrinterSettings();
  if (process.platform === 'win32') {
    if (what === 'com')
      spawn('rundll32.exe', ['shell32.dll,Control_RunDLL', 'bthprops.cpl,,2'], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    else void shell.openExternal('ms-settings:bluetooth');
  } else if (process.platform === 'darwin')
    void shell.openExternal('x-apple.systempreferences:com.apple.BluetoothSettings');
  else
    for (const [cmd, args] of [
      ['gnome-control-center', ['bluetooth']],
      ['blueman-manager', []],
      ['systemsettings', ['kcm_bluetooth']],
    ]) {
      const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      p.on('error', () => undefined);
      p.unref();
      if (p.pid) break;
    }
}

let scanning;

function registerIpc() {
  ipcMain.handle('state', () => publicState());
  ipcMain.handle('connect', (_e, code) => connect(String(code)));
  ipcMain.handle('disconnect', async () => {
    agent?.stop();
    agent = undefined;
    Object.assign(config, {
      url: undefined,
      token: undefined,
      restaurant: undefined,
      agentName: undefined,
    });
    status = { state: 'idle' };
    jobs = [];
    await saveConfig();
    push();
    return publicState();
  });
  ipcMain.handle('printers', async () => {
    const list = await systemPrinters().catch(() => []);
    return list.map((p) => ({
      name: p.name,
      label: p.displayName || p.name,
      isDefault: !!p.isDefault,
    }));
  });
  // Cuidar do computador: um processo por vez; a impressão segue no laço dela.
  let careBusy = false;
  ipcMain.handle('care-check', () => {
    if (process.platform !== 'win32') throw new Error('Disponível só no Windows.');
    return careCheck();
  });
  ipcMain.handle('care-run', async (_e, ids) => {
    if (process.platform !== 'win32') throw new Error('Disponível só no Windows.');
    if (careBusy) throw new Error('A limpeza já está rodando.');
    careBusy = true;
    try {
      const r = await careRun(ids, {
        onStep: (text) => win?.webContents.send('care-progress', text),
      });
      notify('Cuidado do computador concluído', 'Abra o Comandou Impressão para ver o relatório.');
      return r;
    } finally {
      careBusy = false;
    }
  });
  ipcMain.handle('set-notifications', async (_e, on) => {
    config.notifications = !!on;
    await saveConfig();
    push();
    return publicState();
  });
  ipcMain.handle('update-check', async () => {
    await updater.check(false);
    return publicState();
  });
  ipcMain.handle('update-install', async () => {
    await updater.install();
    return publicState();
  });
  ipcMain.handle('set-printer', async (_e, target, spec) => {
    spec = String(spec ?? '');
    if (!validSpec(spec)) throw new Error('Impressora inválida.');
    if (target === null) config.printers.default = spec;
    else if (spec) config.printers.routes[String(target)] = spec;
    else delete config.printers.routes[String(target)];
    await saveConfig();
    agent?.poke();
    push();
    void checkAll();
    return publicState();
  });
  ipcMain.handle('ports', async () => ({
    serial: await listSerialPorts(),
    direct: await listDirectDevices(),
  }));
  ipcMain.handle('scan-network', () => {
    // Um clique só procura uma vez; o progresso vai para a tela.
    scanning ??= scanNetwork({
      onProgress: (done, total) => win?.webContents.send('scan-progress', { done, total }),
    }).finally(() => (scanning = undefined));
    return scanning;
  });
  ipcMain.handle('check-host', (_e, host) => {
    host = String(host ?? '').trim();
    if (!/^[a-zA-Z0-9.-]{1,253}$/.test(host)) throw new Error('IP inválido.');
    return checkHost(host);
  });
  ipcMain.handle('printer-status', async (_e, spec) => {
    spec = String(spec ?? '');
    if (!validSpec(spec)) throw new Error('Impressora inválida.');
    const t = parseTcp(spec);
    if (t) {
      const s = await tcpStatus(t.host, t.port);
      const r = {
        ok: s.reachable && s.online !== false && !s.paperOut && !s.coverOpen,
        text: statusText(s),
      };
      health[spec] = { ...r, at: Date.now() };
      push();
      return r;
    }
    const r = await checkOne(spec);
    if (r) health[spec] = { ...r, at: Date.now() };
    push();
    return r ?? { ok: true, text: 'Imprima um teste para conferir.' };
  });
  ipcMain.handle('discover', (_e, force) => discover(!!force).then(() => publicState()));
  ipcMain.handle('check-all', () => checkAll().then(() => publicState()));
  ipcMain.handle('usb-candidates', () => listUninstalledUsb());
  ipcMain.handle('usb-install', async (_e, id, label) => {
    id = String(id ?? '');
    if (!(process.platform === 'win32' ? validWinPort(id) : validCupsUri(id)))
      throw new Error('Impressora USB inválida.');
    const name = await installUsb(id, String(label ?? 'USB').slice(0, 80));
    return { spec: `printer:${name}` };
  });
  ipcMain.handle('net-install', async (_e, host, label, path) => {
    host = String(host ?? '');
    path = String(path ?? 'ipp/print').replace(/^\/+/, '');
    if (!validIp(host) || !validIppPath(path)) throw new Error('Impressora de rede inválida.');
    const name = await installNetwork(host, String(label ?? 'Rede').slice(0, 80), path);
    return { spec: `printer:${name}?modo=folha` };
  });
  ipcMain.handle('bt-paired', () => listPairedWithoutPort());
  ipcMain.handle('bt-bind', async (_e, mac) => {
    if (process.platform !== 'linux') throw new Error('Só no Linux.');
    if (!validBtMac(String(mac))) throw new Error('Endereço Bluetooth inválido.');
    return { port: await bindRfcomm(String(mac)) };
  });
  ipcMain.handle('bt-settings', (_e, what) => openBluetoothSettings(String(what ?? '')));
  ipcMain.handle('ble-scan', async () => {
    const r = await ble.scan();
    if (r) {
      config.bleNames[r.id] = (r.name || 'Impressora Bluetooth').slice(0, 60);
      await saveConfig();
      push();
    }
    return r;
  });
  ipcMain.handle('ble-choose', (_e, id) => ble.choose(String(id ?? '')));
  ipcMain.handle('ble-cancel', () => ble.cancel());
  ipcMain.handle('spool-clear', async () => {
    const n = await purgeChosen();
    await readSpool(agent?.maxAge ?? 0).catch(() => null);
    agent?.poke();
    return { cleared: n, state: publicState() };
  });
  ipcMain.handle('test-print', (_e, spec) => {
    spec = String(spec ?? '');
    if (!validSpec(spec)) throw new Error('Impressora inválida.');
    return testPrint(spec);
  });
  ipcMain.handle('set-autostart', async (_e, on) => {
    config.autostart = !!on;
    await saveConfig();
    await applyAutostart();
    push();
    return publicState();
  });
  ipcMain.handle('open-panel', () => {
    if (config.url) void shell.openExternal(`${config.url}/impressao`);
  });
  ipcMain.handle('reconnect', () => {
    if (status.state === 'unauthorized' || !agent) startAgent();
    else agent.poke();
  });
}

// ------------------------------------------------------------------ link comandou-impressao://
function codeFromArgv(argv) {
  return argv.find((a) => a.toLowerCase().startsWith(`${PROTOCOL}://`));
}

async function handleLink(link) {
  showWindow();
  const send = () => win?.webContents.send('link', link);
  if (win?.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

// ------------------------------------------------------------------ ciclo de vida
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  pendingCode = codeFromArgv(process.argv);
  app.on('second-instance', (_e, argv) => {
    const link = codeFromArgv(argv);
    if (link) void handleLink(link);
    else showWindow();
  });
  app.on('open-url', (e, url) => {
    e.preventDefault();
    if (app.isReady()) void handleLink(url);
    else pendingCode = url;
  });
  if (process.defaultApp && process.argv[1])
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1]]);
  else app.setAsDefaultProtocolClient(PROTOCOL);

  app.whenReady().then(async () => {
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    else app.dock?.hide();
    await loadConfig();
    await brand.load(config.brand?.iconUrl);
    registerIpc();
    tray = new Tray(trayIcon(true));
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
    // Não segura a abertura: a lista de impressoras do sistema pode demorar.
    await Promise.race([
      fixRawToInkjet().catch(() => undefined),
      new Promise((r) => setTimeout(r, 15_000)),
    ]);
    startAgent();
    if (!existsSync(CONFIG)) await saveConfig();
    await applyAutostart();
    const hidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin;
    if (pendingCode) void handleLink(pendingCode);
    else if (!hidden || !config.url) showWindow();
    // Volta da suspensão ou rede trocou: tenta na hora em vez de esperar o próximo ciclo.
    powerMonitor.on('resume', () => {
      agent?.poke();
      checkUpdateSoon();
    });
    powerMonitor.on('unlock-screen', () => {
      agent?.poke();
      checkUpdateSoon();
    });
    void checkAll();
    // A cada 30 s: impressora desligada aparece em cerca de um minuto (duas conferências).
    setInterval(() => void checkAll(), 30_000);
    // Versão nova: confere logo depois de abrir e a cada 6 horas (sem atrapalhar a impressão).
    setTimeout(() => void updater.check(true), 15_000);
    setInterval(() => void updater.check(true), 60 * 60_000);
  });
  app.on('window-all-closed', () => {
    /* continua na bandeja */
  });
  app.on('activate', showWindow);
  app.on('before-quit', () => {
    quitting = true;
    agent?.stop();
  });
}
