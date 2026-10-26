// Comandou Impressão: aplicativo de computador que fica perto do relógio (bandeja), liga o
// restaurante às impressoras térmicas e imprime as comandas sozinho, em segundo plano.
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  safeStorage,
  shell,
  Tray,
} from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrintAgent, parseConnectionCode } from '../core.mjs';
import { describePrinter, parseTcp, printText, testPageText } from '../printers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PROTOCOL = 'comandou-impressao';
const VERSION = app.getVersion();
const CONFIG = join(app.getPath('userData'), 'config.json');
const MAX_LOG = 40;

app.setAppUserModelId('br.com.comandou.impressao');

/** @type {{ url?: string, token?: string, tokenEnc?: string, agentName?: string, restaurant?: string,
 *   printers: { default: string, routes: Record<string, string> }, autostart: boolean, seenTargets: string[] }} */
let config = { printers: { default: '', routes: {} }, autostart: true, seenTargets: [] };
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
    config = { ...config, ...c, printers: { default: '', routes: {}, ...c.printers } };
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

const printerFor = (target) => config.printers.routes[target] || config.printers.default || 'none';
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
    print: printText,
  });
  agent.on('status', async (s) => {
    status = s;
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
    if (!j.ok) notify(`Falha ao imprimir em ${j.target}`, j.error);
    if (!config.seenTargets.includes(j.target)) {
      config.seenTargets.push(j.target);
      await saveConfig();
    }
    push();
  });
  agent.start();
}

function notify(title, body) {
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

function showWindow() {
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
    backgroundColor: '#f7f5f3',
    icon: asset('icon.png'),
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
  const ok = status.state === 'online';
  tray.setImage(trayIcon(ok || status.state === 'connecting'));
  const label = STATUS_LABEL[status.state] ?? '';
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
    print: printText,
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
  return publicState();
}

async function testPrint(spec) {
  if (!spec || spec === 'none') throw new Error('Escolha uma impressora primeiro.');
  const ev = {
    id: `teste-${Date.now()}`,
    kind: 'test',
    target: 'Teste',
    printer: spec,
    at: Date.now(),
  };
  try {
    await printText(spec, testPageText(describePrinter(spec)));
    jobs = [{ ...ev, ok: true, printerLabel: describePrinter(spec) }, ...jobs].slice(0, MAX_LOG);
    push();
  } catch (e) {
    jobs = [
      { ...ev, ok: false, error: e.message, printerLabel: describePrinter(spec) },
      ...jobs,
    ].slice(0, MAX_LOG);
    push();
    throw e;
  }
}

function validSpec(spec) {
  if (spec === '' || spec === 'none') return true;
  if (spec.startsWith('printer:')) return spec.length > 8 && spec.length < 300;
  if (spec.startsWith('tcp://')) return !!parseTcp(spec);
  return false;
}

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
    const list = win ? await win.webContents.getPrintersAsync() : [];
    return list.map((p) => ({
      name: p.name,
      label: p.displayName || p.name,
      isDefault: !!p.isDefault,
    }));
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
    return publicState();
  });
  ipcMain.handle('test-print', (_e, spec) => testPrint(String(spec ?? '')));
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
    registerIpc();
    tray = new Tray(trayIcon(true));
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
    startAgent();
    if (!existsSync(CONFIG)) await saveConfig();
    await applyAutostart();
    const hidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin;
    if (pendingCode) void handleLink(pendingCode);
    else if (!hidden || !config.url) showWindow();
    // Volta da suspensão ou rede trocou: tenta na hora em vez de esperar o próximo ciclo.
    powerMonitor.on('resume', () => agent?.poke());
    powerMonitor.on('unlock-screen', () => agent?.poke());
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
