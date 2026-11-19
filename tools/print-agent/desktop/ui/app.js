// Tela do Comandou Impressão. Sem framework: o estado vem do processo principal (window.agent).
'use strict';

const $ = (id) => document.getElementById(id);
const api = window.agent;
let state = null;
let systemPrinters = [];
let ports = { serial: [], direct: [] };
let usbFree = []; // ligadas no cabo, sem driver
let btPaired = []; // pareadas sem porta serial
let busy = false;

const STATUS = {
  idle: ['Não conectado', 'muted'],
  connecting: ['Conectando…', 'info'],
  online: ['Online', 'success'],
  offline: ['Sem conexão', 'warning'],
  unauthorized: ['Desconectado', 'danger'],
};
const KIND = {
  kitchen_ticket: 'Comanda',
  receipt: 'Conferência',
  test: 'Teste',
  fiscal_receipt: 'Cupom fiscal',
  kitchen_cancel: 'Item cancelado',
};
const BAUDS = [9600, 19200, 38400, 57600, 115200];

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c);
  return n;
}

function toast(msg, tone = 'success') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast toast--${tone}`;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 4200);
}

const errMsg = (e) =>
  String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function timeAgo(at) {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const OS = () =>
  state?.platform === 'win32' ? 'win' : state?.platform === 'darwin' ? 'mac' : 'linux';

// ---------------------------------------------------------------- ícones (traços do lucide)
const ICONS = {
  printer: [
    'M6 9V3h12v6',
    'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2',
    'M6 14h12v7H6z',
  ],
  usb: ['M9 2v6', 'M15 2v6', 'M6 8h12v4a6 6 0 0 1-12 0z', 'M12 18v4'],
  network: [
    'M12 20h.01',
    'M2 8.82a15 15 0 0 1 20 0',
    'M5 12.86a10 10 0 0 1 14 0',
    'M8.5 16.43a5 5 0 0 1 7 0',
  ],
  bluetooth: ['m7 7 10 10-5 5V2l5 5L7 17'],
  serial: ['M3 8h18l-2 8H5z', 'M8 12h.01', 'M12 12h.01', 'M16 12h.01'],
  none: ['M4.9 4.9l14.2 14.2', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'],
};

function icon(name, size = 22) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(k, String(v));
  for (const d of ICONS[name] ?? ICONS.printer) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

// ---------------------------------------------------------------- impressora (texto ↔ partes)
function splitSpec(spec) {
  const s = String(spec ?? '');
  const q = s.lastIndexOf('?');
  let base = s;
  let raw = new URLSearchParams();
  if (q > 0 && /^[a-z]+=[\w.-]*(&[a-z]+=[\w.-]*)*$/.test(s.slice(q + 1))) {
    base = s.slice(0, q);
    raw = new URLSearchParams(s.slice(q + 1));
  }
  const baud = Number(raw.get('baud'));
  const mac = /^[0-9A-F]{2}(-[0-9A-F]{2}){5}$/.test(raw.get('mac') ?? '') ? raw.get('mac') : '';
  return {
    base,
    opts: {
      paper: raw.get('papel') === '58' ? 58 : 80,
      codepage: ['850', 'ascii'].includes(raw.get('acentos')) ? raw.get('acentos') : '860',
      baud: BAUDS.includes(baud) ? baud : 9600,
      mac,
    },
  };
}

function joinSpec(base, opts) {
  const p = new URLSearchParams();
  if (opts.paper === 58) p.set('papel', '58');
  if (opts.codepage !== '860') p.set('acentos', opts.codepage);
  if (base.startsWith('serial:') && opts.baud !== 9600) p.set('baud', String(opts.baud));
  if (base.startsWith('tcp://') && opts.mac) p.set('mac', opts.mac);
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}

/** Tipo, ícone, nome e detalhe de uma impressora, para mostrar na tela. */
function info(spec) {
  if (!spec || spec === 'none') return { type: 'none', title: 'Não imprimir', detail: '' };
  const { base, opts } = splitSpec(spec);
  const extras = [
    opts.paper === 58 ? 'papel 58 mm' : '',
    opts.codepage === '850' ? 'acentos CP850' : '',
    opts.codepage === 'ascii' ? 'sem acentos' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const tail = extras ? ` · ${extras}` : '';
  if (base.startsWith('printer:')) {
    const name = base.slice(8);
    const p = systemPrinters.find((x) => x.name === name);
    return {
      type: 'usb',
      title: p ? p.label : name,
      detail: (p ? 'Instalada neste computador' : 'Não encontrada neste computador') + tail,
      missing: !p,
    };
  }
  if (base.startsWith('tcp://'))
    return {
      type: 'network',
      title: base.slice(6),
      detail: `Rede (cabo ou Wi-Fi)${opts.mac ? ' · acha sozinho se o IP mudar' : ''}${tail}`,
    };
  if (base.startsWith('ble:')) {
    const name = state?.bleNames?.[base.slice(4)];
    return {
      type: 'bluetooth',
      title: name || 'Impressora Bluetooth',
      detail: `Bluetooth BLE · ${base.slice(4)}${tail}`,
    };
  }
  if (base.startsWith('serial:')) {
    const port = base.slice(7);
    const p = ports.serial.find((x) => x.path.toUpperCase() === port.toUpperCase());
    const bt = p?.kind === 'bluetooth';
    return {
      type: bt ? 'bluetooth' : 'serial',
      title: p ? p.label : port,
      detail: `${bt ? 'Bluetooth' : 'Serial'} · ${port}${bt ? '' : ` · ${opts.baud}`}${tail}`,
    };
  }
  if (base.startsWith('file:')) {
    const path = base.slice(5);
    const p = ports.direct.find((x) => x.path === path);
    return { type: 'usb', title: p ? p.label : path, detail: `USB direto · ${path}${tail}` };
  }
  return { type: 'printer', title: spec, detail: '' };
}

async function runTest(spec, button) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Imprimindo…';
  try {
    await api.testPrint(spec);
    toast('Teste enviado. Saiu o papel? Confira a régua e os acentos.');
    return true;
  } catch (err) {
    toast(errMsg(err), 'danger');
    return false;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

// ---------------------------------------------------------------- cartões da tela principal
function mainPrinter() {
  const spec = state.printers.default;
  if (!spec || spec === 'none')
    return el(
      'div',
      { class: 'empty-printer' },
      el('div', { class: 'empty-printer__icon' }, icon('printer', 28)),
      el(
        'div',
        { class: 'empty-printer__body' },
        el('strong', { text: 'Nenhuma impressora escolhida' }),
        el('span', {
          class: 'muted',
          text: 'Enquanto não escolher, as comandas esperam na fila do Comandou.',
        }),
      ),
      el(
        'button',
        { class: 'btn btn--primary', onclick: () => openPicker(null) },
        'Adicionar impressora',
      ),
    );
  const i = info(spec);
  const last = state.jobs.find((j) => j.printer === spec);
  return el(
    'div',
    { class: `tile tile--main${i.missing ? ' tile--warn' : ''}` },
    el('div', { class: 'tile__icon' }, icon(i.type, 26)),
    el(
      'div',
      { class: 'tile__body' },
      el('strong', { class: 'tile__title', text: i.title }),
      el('span', { class: 'muted tile__detail', text: i.detail }),
      healthLine(spec) ??
        (last && !last.ok ? el('span', { class: 'tile__error', text: last.error }) : null),
    ),
    el('button', { class: 'btn', onclick: (e) => runTest(spec, e.currentTarget) }, 'Testar'),
    el('button', { class: 'btn btn--ghost', onclick: () => openPicker(null) }, 'Trocar'),
  );
}

/** Bolinha e frase da última conferência da impressora (feita a cada 2 minutos, sem imprimir). */
function healthLine(spec) {
  const h = state.health?.[spec];
  if (!h) return null;
  return el(
    'span',
    { class: `health ${h.ok ? 'health--ok' : 'health--fail'}` },
    el('span', { class: `dot dot--${h.ok ? 'ok' : 'fail'}` }),
    h.text,
  );
}

function routeRow(target) {
  const own = state.printers.routes[target] ?? '';
  const effective = own || state.printers.default || '';
  const i = own ? info(own) : null;
  const last = state.jobs.find((j) => j.target === target);
  const h = effective ? state.health?.[effective] : null;
  const ok = h ? h.ok : last ? last.ok : null;
  return el(
    'div',
    { class: 'route' },
    el('span', {
      class: `dot ${ok === null ? '' : ok ? 'dot--ok' : 'dot--fail'}`,
      title: h
        ? h.text
        : last
          ? last.ok
            ? 'Última impressão ok'
            : last.error
          : 'Nada impresso ainda',
    }),
    el('div', { class: 'route__name' }, target),
    el(
      'div',
      { class: 'route__printer' },
      i ? icon(i.type, 16) : null,
      el('span', { text: i ? i.title : 'Usa a principal', class: i ? '' : 'muted' }),
    ),
    el(
      'button',
      {
        class: 'btn btn--ghost btn--sm',
        disabled: !effective || effective === 'none',
        onclick: (e) => runTest(effective, e.currentTarget),
      },
      'Testar',
    ),
    el('button', { class: 'btn btn--sm', onclick: () => openPicker(target) }, 'Escolher'),
  );
}

// ---------------------------------------------------------------- render
function render() {
  if (!state) return;
  $('view-connect').hidden = state.connected;
  $('view-main').hidden = !state.connected;
  if (!state.connected) return;

  $('restaurant').textContent = state.restaurant ?? state.url;
  $('agent-name').textContent = state.agentName ? `Computador: ${state.agentName}` : '';
  const [label, tone] = STATUS[state.status.state] ?? STATUS.idle;
  const pill = $('status');
  pill.className = `pill pill--${tone}`;
  pill.replaceChildren(el('span', { class: 'pill__dot' }), label);
  $('version').textContent = `v${state.version}`;
  $('autostart').checked = state.autostart;

  const banner = $('banner');
  const s = state.status.state;
  if (s === 'unauthorized') {
    banner.className = 'banner banner--danger';
    banner.replaceChildren(
      el(
        'div',
        {},
        el('strong', { text: 'Este computador foi desconectado no painel. ' }),
        'O código foi trocado ou o computador foi desativado. Gere um código novo em Impressão.',
      ),
      el(
        'button',
        { class: 'btn', onclick: () => api.disconnect().then(apply) },
        'Conectar de novo',
      ),
    );
    banner.hidden = false;
  } else if (s === 'offline') {
    banner.className = 'banner banner--warning';
    banner.replaceChildren(
      el(
        'div',
        {},
        el('strong', { text: 'Sem conexão com o Comandou. ' }),
        'Os pedidos ficam guardados e saem assim que a internet voltar.',
      ),
      el('button', { class: 'btn', onclick: () => api.reconnect() }, 'Tentar agora'),
    );
    banner.hidden = false;
  } else if (s === 'online' && (!state.printers.default || state.printers.default === 'none')) {
    banner.className = 'banner banner--info';
    banner.replaceChildren(
      el(
        'div',
        {},
        el('strong', { text: 'Falta pouco: ' }),
        'adicione a impressora principal e imprima um teste.',
      ),
      el(
        'button',
        { class: 'btn btn--primary', onclick: () => openPicker(null) },
        'Adicionar impressora',
      ),
    );
    banner.hidden = false;
  } else banner.hidden = true;

  $('main-printer').replaceChildren(mainPrinter());
  const routes = state.targets.map(routeRow);
  $('routes').replaceChildren(
    ...(routes.length
      ? routes
      : [
          el('p', {
            class: 'muted',
            text: 'Os setores da cozinha aparecem aqui assim que o computador se conectar.',
          }),
        ]),
  );

  const log = $('log');
  if (!state.jobs.length) {
    log.replaceChildren(
      el(
        'li',
        { class: 'log__empty' },
        'Nada impresso ainda. As comandas aparecem aqui assim que saírem.',
      ),
    );
  } else {
    log.replaceChildren(
      ...state.jobs.map((j) =>
        el(
          'li',
          { class: `log__item ${j.ok ? '' : 'log__item--fail'}` },
          el('span', { class: `dot dot--${j.ok ? 'ok' : 'fail'}` }),
          el(
            'div',
            { class: 'log__body' },
            el('strong', { text: `${KIND[j.kind] ?? j.kind} · ${j.target}` }),
            el('span', { class: 'muted', text: j.ok ? j.printerLabel : j.error }),
          ),
          el('time', { class: 'muted', text: timeAgo(j.at) }),
        ),
      ),
    );
  }
}

function apply(s) {
  state = s;
  render();
}

async function refreshPrinters() {
  try {
    systemPrinters = await api.printers();
  } catch {
    systemPrinters = [];
  }
}

async function refreshPorts() {
  try {
    ports = await api.ports();
  } catch {
    ports = { serial: [], direct: [] };
  }
}

/** Listas mais lentas (USB sem driver, Bluetooth pareado sem porta): só dentro do passo a passo. */
async function refreshExtras(type) {
  if (type === 'usb') usbFree = await api.usbCandidates().catch(() => []);
  if (type === 'bluetooth') btPaired = await api.btPaired().catch(() => []);
}

// ---------------------------------------------------------------- adicionar / trocar impressora
const TYPES = [
  {
    id: 'usb',
    icon: 'usb',
    title: 'USB',
    text: 'Cabo USB no computador, com a impressora instalada no sistema.',
  },
  {
    id: 'network',
    icon: 'network',
    title: 'Rede (cabo ou Wi-Fi)',
    text: 'Ligada no roteador ou no Wi-Fi. Tem um IP, como 192.168.0.50.',
  },
  {
    id: 'bluetooth',
    icon: 'bluetooth',
    title: 'Bluetooth',
    text: 'Pareada com o computador, ou BLE sem parear. Comum nas portáteis.',
  },
  {
    id: 'serial',
    icon: 'serial',
    title: 'Serial (COM)',
    text: 'Cabo RS-232, adaptador USB-serial ou porta COM virtual.',
  },
  {
    id: 'direct',
    icon: 'usb',
    title: 'USB direto',
    text: 'Linux: cabo USB sem instalar driver (/dev/usb/lp0).',
    os: 'linux',
  },
];

const pick = {
  target: null,
  stage: 'type',
  type: null,
  base: '',
  opts: { paper: 80, codepage: '860', baud: 9600 },
  scan: null, // { running, done, total, found, error }
  manualIp: '',
  manualPort: '9100',
  tested: null, // null | true | false
  loading: false,
};

function typeOf(base) {
  if (base.startsWith('printer:')) return 'usb';
  if (base.startsWith('tcp://')) return 'network';
  if (base.startsWith('file:')) return 'direct';
  if (base.startsWith('ble:')) return 'bluetooth';
  if (base.startsWith('serial:')) {
    const p = ports.serial.find((x) => x.path.toUpperCase() === base.slice(7).toUpperCase());
    return p?.kind === 'bluetooth' ? 'bluetooth' : 'serial';
  }
  return null;
}

async function openPicker(target) {
  const current = target === null ? state.printers.default : state.printers.routes[target];
  const { base, opts } = splitSpec(current && current !== 'none' ? current : '');
  Object.assign(pick, {
    target,
    stage: 'type',
    base,
    opts: { ...opts },
    type: null,
    tested: null,
    scan: null,
    manualIp: '',
    manualPort: '9100',
    hostCheck: null,
    status: null,
    ble: null,
  });
  if (base.startsWith('tcp://')) {
    const m = /^tcp:\/\/([^:]+):?(\d*)$/.exec(base);
    if (m) Object.assign(pick, { manualIp: m[1], manualPort: m[2] || '9100' });
  }
  $('pick-title').textContent =
    target === null
      ? current && current !== 'none'
        ? 'Trocar a impressora principal'
        : 'Adicionar impressora'
      : `Impressora do setor ${target}`;
  $('pick-sub').textContent =
    target === null
      ? 'Ela recebe tudo o que não tiver impressora própria.'
      : `Só as comandas de ${target} saem nela.`;
  renderPicker();
  $('pick').showModal();
  pick.loading = true;
  renderPicker();
  await Promise.all([refreshPrinters(), refreshPorts()]);
  pick.loading = false;
  pick.type = base ? typeOf(base) : null;
  renderPicker();
}

function go(stage) {
  pick.stage = stage;
  if (stage === 'device' && pick.type === 'network' && !pick.scan) void scan();
  if (stage === 'device' && (pick.type === 'usb' || pick.type === 'bluetooth')) {
    pick.extrasLoading = true;
    void refreshExtras(pick.type).then(() => {
      pick.extrasLoading = false;
      if (pick.stage === 'device') renderPicker();
    });
  }
  if (stage !== 'device' && pick.ble?.running) void api.bleCancel();
  renderPicker();
  $('pick-body').scrollTop = 0;
}

async function scan() {
  pick.scan = { running: true, done: 0, total: 0, found: [] };
  renderPicker();
  try {
    pick.scan.found = await api.scanNetwork();
  } catch (e) {
    pick.scan.error = errMsg(e);
  }
  pick.scan.running = false;
  if (pick.stage === 'device') renderPicker();
}

api.onScanProgress?.(({ done, total }) => {
  if (!pick.scan?.running) return;
  pick.scan.done = done;
  pick.scan.total = total;
  const bar = document.querySelector('.scan__bar span');
  if (bar) bar.style.width = `${Math.round((done / total) * 100)}%`;
});

const choose = (base, extra = {}) => {
  pick.base = base;
  pick.opts.mac = extra.mac ?? '';
  pick.tested = null;
  pick.status = null;
  renderPicker();
};

function option({ base, iconName, title, detail, badge, mac }) {
  const on = pick.base === base;
  return el(
    'button',
    {
      type: 'button',
      class: `opt${on ? ' is-on' : ''}`,
      'aria-pressed': on ? 'true' : 'false',
      onclick: () => choose(base, { mac }),
    },
    el('span', { class: 'opt__radio' }),
    el('span', { class: 'opt__icon' }, icon(iconName, 18)),
    el(
      'span',
      { class: 'opt__body' },
      el('strong', { text: title }),
      detail ? el('span', { class: 'muted', text: detail }) : null,
    ),
    badge ? el('span', { class: 'badge', text: badge }) : null,
  );
}

function helpBox(lines, section) {
  return el(
    'div',
    { class: 'help-box' },
    el('ol', {}, ...lines.map((l) => el('li', {}, l))),
    el(
      'button',
      { type: 'button', class: 'link', onclick: () => openGuide(section) },
      'Ver o passo a passo completo',
    ),
  );
}

function refreshButton(label = 'Atualizar a lista') {
  return el(
    'button',
    {
      type: 'button',
      class: 'btn btn--ghost btn--sm',
      onclick: async (e) => {
        e.currentTarget.disabled = true;
        await Promise.all([refreshPrinters(), refreshPorts()]);
        renderPicker();
      },
    },
    label,
  );
}

function emptyList(text) {
  return el('div', { class: 'list-empty' }, el('p', { text }), refreshButton('Procurar de novo'));
}

const DEVICE_HELP = {
  usb: {
    win: [
      'Ligue o cabo USB e a impressora.',
      'Instale o driver do fabricante, ou o "Generic / Text Only" do Windows.',
      'A impressora aparece na lista abaixo. Escolha e avance.',
    ],
    mac: [
      'Ligue o cabo USB e a impressora.',
      'Adicione em Ajustes do Sistema › Impressoras e Scanners (driver do fabricante ou "PostScript Genérica").',
      'Escolha na lista abaixo.',
    ],
    linux: [
      'Ligue o cabo USB e a impressora.',
      'Instale pelo CUPS (driver "Raw" ou "Generic") ou volte e escolha "USB direto".',
      'Escolha na lista abaixo.',
    ],
  },
  network: {
    all: [
      'A impressora precisa estar na mesma rede deste computador (cabo no roteador ou Wi-Fi).',
      'Para ver o IP: desligue, segure o botão FEED e ligue. A folha de autoteste mostra o "IP Address".',
      'Escolha na lista ou digite o IP. A porta quase sempre é 9100.',
    ],
  },
  bluetooth: {
    win: [
      'Ligue a impressora perto do computador.',
      'Pareie em Configurações › Bluetooth e dispositivos › Adicionar dispositivo (PIN 0000 ou 1234).',
      'Volte aqui e clique em Atualizar a lista. Portátil que não pareia? Use "Procurar por BLE".',
    ],
    mac: [
      'Ligue a impressora perto do computador.',
      'Pareie em Ajustes do Sistema › Bluetooth (PIN 0000 ou 1234).',
      'Volte aqui e clique em Atualizar a lista. Portátil que não pareia? Use "Procurar por BLE".',
    ],
    linux: [
      'Pareie a impressora pelo menu Bluetooth (ou bluetoothctl).',
      'Ela aparece em "Pareadas, mas sem porta": clique em Criar porta (pede a senha).',
      'Portátil que não pareia? Use "Procurar por BLE".',
    ],
  },
  serial: {
    all: [
      'Ligue o cabo serial ou o adaptador USB-serial (com o driver dele instalado).',
      'Escolha a porta abaixo. A velocidade você ajusta no próximo passo.',
    ],
  },
  direct: {
    all: [
      'Ligue o cabo USB e a impressora.',
      'Ela aparece como /dev/usb/lp0. Se der "sem permissão": sudo usermod -aG lp $USER e entre de novo.',
    ],
  },
};
const GUIDE_FOR = {
  usb: 'usb',
  network: 'rede',
  bluetooth: 'bluetooth',
  serial: 'serial',
  direct: 'usb',
};

function deviceStage() {
  const t = pick.type;
  const help = DEVICE_HELP[t][OS()] ?? DEVICE_HELP[t].all;
  const parts = [helpBox(help, GUIDE_FOR[t])];

  if (t === 'usb') {
    parts.push(
      el(
        'div',
        { class: 'list-head' },
        el('h4', { text: 'Impressoras instaladas' }),
        refreshButton(),
      ),
    );
    parts.push(
      systemPrinters.length
        ? el(
            'div',
            { class: 'opts' },
            ...systemPrinters.map((p) =>
              option({
                base: `printer:${p.name}`,
                iconName: 'usb',
                title: p.label,
                detail: p.isDefault ? 'Impressora padrão do sistema' : '',
              }),
            ),
          )
        : emptyList('Nenhuma impressora instalada neste computador.'),
    );
    parts.push(...usbUninstalled());
  }

  if (t === 'bluetooth') parts.push(...bluetoothLists());

  if (t === 'serial') {
    const list = ports.serial;
    parts.push(
      el('div', { class: 'list-head' }, el('h4', { text: 'Portas seriais' }), refreshButton()),
    );
    parts.push(
      list.length
        ? el(
            'div',
            { class: 'opts' },
            ...list.map((p) =>
              option({
                base: `serial:${p.path}`,
                iconName: p.kind === 'bluetooth' ? 'bluetooth' : 'serial',
                title: p.label,
                detail: p.path,
                badge: p.kind === 'bluetooth' ? 'Bluetooth' : p.kind === 'usb' ? 'USB' : '',
              }),
            ),
          )
        : emptyList('Nenhuma porta serial encontrada. Confira o cabo e o driver do adaptador.'),
    );
  }

  if (t === 'direct') {
    parts.push(
      el('div', { class: 'list-head' }, el('h4', { text: 'Impressoras USB' }), refreshButton()),
    );
    parts.push(
      ports.direct.length
        ? el(
            'div',
            { class: 'opts' },
            ...ports.direct.map((p) =>
              option({ base: `file:${p.path}`, iconName: 'usb', title: p.label, detail: p.path }),
            ),
          )
        : emptyList(
            'Nenhuma impressora em /dev/usb. Confira o cabo e se a impressora está ligada.',
          ),
    );
  }

  if (t === 'network') {
    const sc = pick.scan;
    parts.push(
      el(
        'div',
        { class: 'list-head' },
        el('h4', { text: 'Impressoras encontradas na rede' }),
        el(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost btn--sm',
            disabled: !!sc?.running,
            onclick: () => scan(),
          },
          sc?.running ? 'Procurando…' : 'Procurar de novo',
        ),
      ),
    );
    if (sc?.running) {
      const bar = el('span');
      if (sc.total) bar.style.width = `${Math.round((sc.done / sc.total) * 100)}%`;
      parts.push(
        el(
          'div',
          { class: 'scan' },
          el('p', {
            class: 'muted',
            text: 'Procurando impressoras na rede (porta 9100 e Bonjour)… leva uns segundos.',
          }),
          el('div', { class: 'scan__bar' }, bar),
        ),
      );
    } else if (sc?.found?.length) {
      parts.push(
        el(
          'div',
          { class: 'opts' },
          ...sc.found.map((f) =>
            option({
              base: `tcp://${f.host}:${f.port}`,
              iconName: 'network',
              title: f.name || 'Impressora de rede',
              detail: `${f.host} · porta ${f.port}${f.mac ? ` · ${f.mac}` : ''}`,
              badge: f.via === 'bonjour' ? 'Bonjour' : '',
              mac: f.mac,
            }),
          ),
        ),
      );
    } else if (sc) {
      parts.push(
        el(
          'p',
          { class: 'list-empty muted' },
          sc.error ??
            'Nenhuma impressora respondeu. Confira se ela está ligada e na mesma rede, ou digite o IP abaixo.',
        ),
      );
    }
    const ip = el('input', {
      id: 'man-ip',
      placeholder: '192.168.0.50',
      inputmode: 'decimal',
      value: pick.manualIp,
      oninput: (e) => {
        pick.manualIp = e.target.value.trim();
        syncManual();
      },
    });
    const port = el('input', {
      id: 'man-port',
      inputmode: 'numeric',
      value: pick.manualPort,
      oninput: (e) => {
        pick.manualPort = e.target.value.trim();
        syncManual();
      },
    });
    parts.push(
      el(
        'div',
        { class: 'manual' },
        el('h4', { text: 'Ou digite o IP' }),
        el(
          'div',
          { class: 'net-fields' },
          el('label', {}, el('span', { class: 'label', text: 'IP da impressora' }), ip),
          el('label', {}, el('span', { class: 'label', text: 'Porta' }), port),
          el(
            'button',
            {
              type: 'button',
              class: 'btn btn--sm net-fields__check',
              disabled: !pick.manualIp || !!pick.hostCheck?.running,
              onclick: () => checkManualHost(),
            },
            pick.hostCheck?.running ? 'Testando…' : 'Testar este IP',
          ),
        ),
        pick.hostCheck?.text
          ? el('p', {
              class: `host-check ${pick.hostCheck.ok ? 'host-check--ok' : 'host-check--fail'}`,
              text: pick.hostCheck.text,
            })
          : null,
      ),
    );
  }
  return parts;
}

async function checkManualHost() {
  pick.hostCheck = { running: true };
  renderPicker();
  try {
    const r = await api.checkHost(pick.manualIp);
    if (r.raw) {
      pick.manualPort = String(r.raw);
      syncManual();
      pick.opts.mac = r.mac ?? '';
      pick.hostCheck = {
        ok: true,
        text: `Achei! Impressora respondendo na porta ${r.raw}.${r.mac ? ' Se o IP mudar, o aplicativo acha ela de novo sozinho.' : ''}`,
      };
    } else if (r.open.length)
      pick.hostCheck = {
        ok: false,
        text: `Esse IP responde (portas ${r.open.join(', ')}), mas não na 9100. Para térmica, ative "RAW/9100" no programa do fabricante ou confira o IP na folha de autoteste.`,
      };
    else
      pick.hostCheck = {
        ok: false,
        text: 'Nada respondeu nesse IP. Confira na folha de autoteste e se o começo do IP é igual ao deste computador.',
      };
  } catch (e) {
    pick.hostCheck = { ok: false, text: errMsg(e) };
  }
  renderPicker();
}

/** Botão de ação dentro da lista (instalar, criar porta), com "trabalhando…" e erro em aviso. */
function actionButton(label, busyLabel, work, cls = 'btn btn--sm') {
  return el(
    'button',
    {
      type: 'button',
      class: cls,
      onclick: async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = busyLabel;
        try {
          await work();
        } catch (err) {
          toast(errMsg(err), 'danger');
          b.disabled = false;
          b.textContent = label;
        }
      },
    },
    label,
  );
}

function actionRow(iconName, title, detail, button) {
  return el(
    'div',
    { class: 'opt opt--action' },
    el('span', { class: 'opt__icon' }, icon(iconName, 18)),
    el(
      'span',
      { class: 'opt__body' },
      el('strong', { text: title }),
      el('span', { class: 'muted', text: detail }),
    ),
    button,
  );
}

/** USB ligadas no cabo, sem driver: o aplicativo instala com o driver que já vem no sistema. */
function usbUninstalled() {
  if (pick.extrasLoading)
    return [el('p', { class: 'muted list-empty', text: 'Procurando impressoras USB sem driver…' })];
  if (!usbFree.length) return [];
  return [
    el('div', { class: 'list-head' }, el('h4', { text: 'Ligadas no cabo, ainda sem driver' })),
    el(
      'div',
      { class: 'opts' },
      ...usbFree.map((u) =>
        actionRow(
          'usb',
          u.label,
          u.detail,
          actionButton(
            'Instalar',
            'Instalando…',
            async () => {
              const { spec } = await api.usbInstall(u.id, u.label);
              await Promise.all([refreshPrinters(), refreshExtras('usb')]);
              toast('Impressora instalada. Agora imprima um teste.');
              choose(spec);
              go('adjust');
            },
            'btn btn--primary btn--sm',
          ),
        ),
      ),
    ),
    el('p', {
      class: 'muted field__hint',
      text:
        OS() === 'win'
          ? 'Usa o driver "Generic / Text Only" do próprio Windows. Se o Windows perguntar, clique em Sim.'
          : 'Cria uma fila direta (RAW) no sistema. Pode pedir a senha do computador.',
    }),
  ];
}

const NO_PORT_HINT = {
  win: 'Falta a porta COM "De saída". Clique em Criar porta → Adicionar → De saída → esta impressora → OK, e volte aqui.',
  linux: 'Falta a porta /dev/rfcomm. O aplicativo cria e deixa fixa (pede a senha do computador).',
  mac: 'O macOS não criou porta serial para ela. Procure por BLE logo abaixo ou use o cabo USB.',
};

/** Bluetooth: pareadas com porta, pareadas sem porta (com o atalho para criar) e BLE. */
function bluetoothLists() {
  const os = OS();
  const parts = [];
  const options = [
    ...ports.serial
      .filter((p) => p.kind === 'bluetooth')
      .map((p) =>
        option({
          base: `serial:${p.path}`,
          iconName: 'bluetooth',
          title: p.label,
          detail: p.path,
          badge: 'Bluetooth',
        }),
      ),
    ...Object.entries(state.bleNames ?? {}).map(([id, name]) =>
      option({ base: `ble:${id}`, iconName: 'bluetooth', title: name, detail: id, badge: 'BLE' }),
    ),
  ];
  parts.push(
    el(
      'div',
      { class: 'list-head' },
      el('h4', { text: 'Prontas para imprimir' }),
      el(
        'span',
        { class: 'list-head__actions' },
        el(
          'button',
          { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => api.btSettings('') },
          'Abrir o Bluetooth do sistema',
        ),
        refreshButton(),
      ),
    ),
    options.length
      ? el('div', { class: 'opts' }, ...options)
      : el('p', {
          class: 'list-empty muted',
          text: 'Nenhuma impressora Bluetooth pronta ainda. Pareie no sistema e clique em Atualizar, ou procure por BLE logo abaixo.',
        }),
  );

  if (pick.extrasLoading)
    parts.push(el('p', { class: 'muted list-empty', text: 'Conferindo aparelhos pareados…' }));
  else if (btPaired.length)
    parts.push(
      el(
        'div',
        { class: 'list-head' },
        el('h4', { text: 'Pareadas, mas sem porta para imprimir' }),
      ),
      el(
        'div',
        { class: 'opts' },
        ...btPaired.map((d) =>
          actionRow(
            'bluetooth',
            d.name,
            NO_PORT_HINT[os],
            os === 'mac'
              ? null
              : os === 'win'
                ? el(
                    'button',
                    { type: 'button', class: 'btn btn--sm', onclick: () => api.btSettings('com') },
                    'Criar porta',
                  )
                : actionButton('Criar porta', 'Criando…', async () => {
                    const { port } = await api.btBind(d.mac);
                    await Promise.all([refreshPorts(), refreshExtras('bluetooth')]);
                    toast(`Porta ${port} criada. Agora imprima um teste.`);
                    choose(`serial:${port}`);
                    go('adjust');
                  }),
          ),
        ),
      ),
    );

  // BLE: procura ao vivo, sem parear no sistema.
  const b = pick.ble;
  parts.push(
    el(
      'div',
      { class: 'list-head' },
      el('h4', { text: 'Bluetooth BLE (sem parear)' }),
      el(
        'button',
        {
          type: 'button',
          class: 'btn btn--ghost btn--sm',
          onclick: () => (b?.running ? api.bleCancel() : startBle()),
        },
        b?.running ? 'Parar' : 'Procurar por BLE',
      ),
    ),
  );
  if (b?.running)
    parts.push(
      b.devices.length
        ? el(
            'div',
            { class: 'opts' },
            ...b.devices.map((d) =>
              el(
                'button',
                { type: 'button', class: 'opt', onclick: () => api.bleChoose(d.id) },
                el('span', { class: 'opt__radio' }),
                el('span', { class: 'opt__icon' }, icon('bluetooth', 18)),
                el(
                  'span',
                  { class: 'opt__body' },
                  el('strong', { text: d.name || 'Aparelho sem nome' }),
                  el('span', { class: 'muted', text: d.id }),
                ),
              ),
            ),
          )
        : el(
            'div',
            { class: 'scan' },
            el('p', {
              class: 'muted',
              text: 'Procurando por perto… ligue a impressora e deixe perto do computador.',
            }),
          ),
    );
  else
    parts.push(
      el('p', {
        class: 'muted field__hint',
        text: 'Para impressoras portáteis que não aparecem como porta COM. Clique em Procurar, escolha a impressora na lista e imprima um teste.',
      }),
    );
  return parts;
}

async function startBle() {
  pick.ble = { running: true, devices: [] };
  renderPicker();
  try {
    const r = await api.bleScan();
    pick.ble = null;
    if (r) {
      state = await api.state();
      choose(`ble:${r.id}`);
      toast(`${r.name || 'Impressora'} encontrada. Avance e imprima um teste.`);
    } else renderPicker();
  } catch (e) {
    pick.ble = null;
    toast(errMsg(e), 'danger');
    renderPicker();
  }
}

api.onBleDevices?.((list) => {
  if (!pick.ble?.running) return;
  pick.ble.devices = list;
  if (pick.stage === 'device') renderPicker();
});

function syncManual() {
  const ok =
    /^[a-zA-Z0-9.-]+$/.test(pick.manualIp) &&
    Number(pick.manualPort) > 0 &&
    Number(pick.manualPort) < 65536;
  pick.base = ok ? `tcp://${pick.manualIp}:${Number(pick.manualPort)}` : '';
  pick.opts.mac = '';
  pick.tested = null;
  document.querySelectorAll('#pick .opt').forEach((o) => {
    o.classList.remove('is-on');
    o.setAttribute('aria-pressed', 'false');
  });
  renderFoot();
}

function radioGroup(name, value, items, onChange) {
  return el(
    'div',
    { class: 'seg seg--block', role: 'radiogroup' },
    ...items.map(([v, label]) =>
      el(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': v === value ? 'true' : 'false',
          class: v === value ? 'is-on' : '',
          onclick: () => onChange(v),
        },
        label,
      ),
    ),
  );
}

function adjustStage() {
  const spec = joinSpec(pick.base, pick.opts);
  const i = info(spec);
  const set = (k) => (v) => {
    pick.opts[k] = v;
    pick.tested = null;
    renderPicker();
  };
  const serial = pick.base.startsWith('serial:') && pick.type === 'serial';
  const test = el(
    'button',
    {
      type: 'button',
      class: 'btn btn--lg',
      onclick: async (e) => {
        pick.tested = await runTest(spec, e.currentTarget);
        renderPicker();
      },
    },
    'Imprimir teste',
  );
  return [
    el(
      'div',
      { class: 'tile' },
      el('div', { class: 'tile__icon' }, icon(i.type, 24)),
      el(
        'div',
        { class: 'tile__body' },
        el('strong', { class: 'tile__title', text: i.title }),
        el('span', { class: 'muted tile__detail', text: i.detail }),
      ),
    ),
    el(
      'div',
      { class: 'adjust' },
      el(
        'div',
        { class: 'field' },
        el('span', { class: 'label', text: 'Largura do papel' }),
        radioGroup(
          'paper',
          pick.opts.paper,
          [
            [80, '80 mm (padrão)'],
            [58, '58 mm'],
          ],
          set('paper'),
        ),
        el('span', {
          class: 'muted field__hint',
          text: 'A bobina de 58 mm é a mais estreita, comum nas portáteis. Nela a letra fica menor para a linha caber.',
        }),
      ),
      el(
        'div',
        { class: 'field' },
        el('span', { class: 'label', text: 'Acentos' }),
        radioGroup(
          'cp',
          pick.opts.codepage,
          [
            ['860', 'Padrão'],
            ['850', 'CP850'],
            ['ascii', 'Sem acentos'],
          ],
          set('codepage'),
        ),
        el('span', {
          class: 'muted field__hint',
          text: 'Deixe "Padrão". Se no teste os acentos saírem como símbolos, troque para CP850; se ainda sair errado, "Sem acentos".',
        }),
      ),
      serial
        ? el(
            'div',
            { class: 'field' },
            el('span', { class: 'label', text: 'Velocidade (baud rate)' }),
            radioGroup(
              'baud',
              pick.opts.baud,
              BAUDS.map((b) => [b, String(b)]),
              set('baud'),
            ),
            el('span', {
              class: 'muted field__hint',
              text: 'Está na folha de autoteste da impressora. Letras embaralhadas no teste = velocidade errada.',
            }),
          )
        : null,
    ),
    el(
      'div',
      {
        class: `test-box${pick.tested === true ? ' is-ok' : pick.tested === false ? ' is-fail' : ''}`,
      },
      el(
        'div',
        { class: 'test-box__actions' },
        test,
        pick.base.startsWith('ble:')
          ? null
          : el(
              'button',
              {
                type: 'button',
                class: 'btn btn--ghost',
                onclick: async (e) => {
                  const b = e.currentTarget;
                  b.disabled = true;
                  try {
                    pick.status = await api.printerStatus(spec);
                  } catch (err) {
                    pick.status = { ok: false, text: errMsg(err) };
                  }
                  renderPicker();
                },
              },
              'Ver situação',
            ),
      ),
      pick.status
        ? el('p', {
            class: `host-check ${pick.status.ok ? 'host-check--ok' : 'host-check--fail'}`,
            text: pick.status.text,
          })
        : null,
      el(
        'p',
        {},
        pick.tested === true
          ? 'Saiu o papel? Veja se a régua de números coube numa linha só e se os acentos estão certos. Tudo certo: clique em Salvar.'
          : pick.tested === false
            ? 'Não imprimiu. A mensagem acima diz o motivo. Confira, ajuste e teste de novo, ou volte e escolha outra impressora.'
            : 'Imprima um teste antes de salvar. Ele mostra no papel se precisa mudar a largura ou os acentos.',
      ),
    ),
  ];
}

function typeStage() {
  const os = OS();
  const cards = TYPES.filter((t) => !t.os || t.os === os).map((t) =>
    el(
      'button',
      {
        type: 'button',
        class: `type-card${pick.type === t.id ? ' is-on' : ''}`,
        onclick: () => {
          if (pick.type !== t.id) {
            pick.base = '';
            pick.tested = null;
          }
          pick.type = t.id;
          go('device');
        },
      },
      el('span', { class: 'type-card__icon' }, icon(t.icon, 24)),
      el('strong', { text: t.title }),
      el('span', { class: 'muted', text: t.text }),
    ),
  );
  return [
    el('div', { class: 'types' }, ...cards),
    el(
      'p',
      { class: 'muted types__hint' },
      'Não sabe? Olhe atrás da impressora. ',
      el(
        'button',
        { type: 'button', class: 'link', onclick: () => openGuide('inicio') },
        'Como descobrir o tipo',
      ),
    ),
  ];
}

function renderFoot() {
  const foot = $('pick-foot');
  const btns = [];
  if (pick.stage === 'type') {
    if (pick.target !== null) {
      btns.push(
        el(
          'button',
          { type: 'button', class: 'btn btn--ghost', onclick: () => saveRoute('') },
          'Usar a principal',
        ),
        el(
          'button',
          { type: 'button', class: 'btn btn--ghost', onclick: () => saveRoute('none') },
          'Não imprimir este setor',
        ),
      );
    }
    btns.push(el('span', { class: 'spacer' }));
    btns.push(el('button', { type: 'button', class: 'btn', onclick: closePicker }, 'Cancelar'));
  } else if (pick.stage === 'device') {
    btns.push(
      el(
        'button',
        { type: 'button', class: 'btn btn--ghost', onclick: () => go('type') },
        '← Voltar',
      ),
    );
    btns.push(el('span', { class: 'spacer' }));
    btns.push(
      el(
        'button',
        {
          type: 'button',
          class: 'btn btn--primary',
          disabled: !pick.base,
          onclick: () => go('adjust'),
        },
        'Avançar',
      ),
    );
  } else {
    btns.push(
      el(
        'button',
        { type: 'button', class: 'btn btn--ghost', onclick: () => go('device') },
        '← Voltar',
      ),
    );
    btns.push(el('span', { class: 'spacer' }));
    btns.push(
      el(
        'button',
        {
          type: 'button',
          class: 'btn btn--primary',
          onclick: () => saveRoute(joinSpec(pick.base, pick.opts)),
        },
        pick.tested === true ? 'Salvar' : 'Salvar sem testar',
      ),
    );
  }
  foot.replaceChildren(...btns);
}

function renderPicker() {
  const order = ['type', 'device', 'adjust'];
  document.querySelectorAll('#pick-stepper li').forEach((li) => {
    const i = order.indexOf(li.dataset.stage);
    const cur = order.indexOf(pick.stage);
    li.className = i === cur ? 'is-on' : i < cur ? 'is-done' : '';
  });
  const body = $('pick-body');
  if (pick.loading && pick.stage !== 'type')
    body.replaceChildren(el('p', { class: 'muted list-empty', text: 'Procurando impressoras…' }));
  else
    body.replaceChildren(
      ...(pick.stage === 'type'
        ? typeStage()
        : pick.stage === 'device'
          ? deviceStage()
          : adjustStage()),
    );
  renderFoot();
}

async function saveRoute(spec) {
  try {
    state = await api.setPrinter(pick.target, spec);
    closePicker();
    render();
    const who = pick.target === null ? 'Impressora principal' : pick.target;
    toast(
      spec === ''
        ? `${who}: usa a principal`
        : spec === 'none'
          ? `${who}: não imprime`
          : `${who}: ${info(spec).title}`,
    );
  } catch (e) {
    toast(errMsg(e), 'danger');
  }
}

function closePicker() {
  $('pick').close();
}
$('pick').addEventListener('close', () => {
  if (pick.ble?.running) void api.bleCancel();
});
$('pick-close').addEventListener('click', closePicker);

// ---------------------------------------------------------------- ajuda
let guideOs = null;
function setGuideOs(os) {
  guideOs = os;
  document.querySelectorAll('#guide .seg button').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.os === os);
    b.setAttribute('aria-pressed', b.dataset.os === os ? 'true' : 'false');
  });
  document.querySelectorAll('#guide .os').forEach((n) => (n.hidden = n.dataset.os !== os));
}
function showSection(id) {
  document.querySelectorAll('#guide .guide__nav button').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.section === id);
    if (b.dataset.section === id) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  });
  document
    .querySelectorAll('#guide .guide__body > section')
    .forEach((s) => (s.hidden = s.dataset.section !== id));
  document.querySelector('#guide .guide__body').scrollTop = 0;
}
function openGuide(section = 'inicio') {
  setGuideOs(guideOs ?? OS());
  showSection(section);
  if (!$('guide').open) $('guide').showModal();
}
document
  .querySelectorAll('[data-guide]')
  .forEach((b) => b.addEventListener('click', () => openGuide(b.dataset.guide)));
document
  .querySelectorAll('#guide .guide__nav button')
  .forEach((b) => b.addEventListener('click', () => showSection(b.dataset.section)));
document
  .querySelectorAll('#guide [data-goto]')
  .forEach((b) => b.addEventListener('click', () => showSection(b.dataset.goto)));
document
  .querySelectorAll('#guide .seg button')
  .forEach((b) => b.addEventListener('click', () => setGuideOs(b.dataset.os)));
$('guide-close').addEventListener('click', () => $('guide').close());

// Clique fora do cartão fecha os diálogos.
for (const d of [$('pick'), $('guide')])
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });

// ---------------------------------------------------------------- conectar
async function connect(code) {
  if (busy) return;
  busy = true;
  const btn = $('connect-btn');
  const err = $('connect-error');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Conectando…';
  try {
    apply(await api.connect(code));
    await refreshPrinters();
    render();
    $('code').value = '';
    toast(`Conectado a ${state.restaurant ?? 'Comandou'}. Agora adicione a impressora.`);
    if (!state.printers.default) void openPicker(null);
  } catch (e) {
    err.textContent = errMsg(e);
    err.hidden = false;
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = 'Conectar';
  }
}

$('connect-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('code').value.trim();
  if (code) void connect(code);
});
$('code').addEventListener('paste', () =>
  setTimeout(() => {
    const v = $('code').value.trim();
    if (v.startsWith('CMD1-')) void connect(v);
  }, 0),
);
$('autostart').addEventListener('change', async (e) =>
  apply(await api.setAutostart(e.target.checked)),
);
$('open-panel').addEventListener('click', () => api.openPanel());
$('disconnect').addEventListener('click', async () => {
  if (confirm('Desconectar este computador? As comandas param de sair aqui até conectar de novo.'))
    apply(await api.disconnect());
});

api.onState(apply);
api.onLink((link) => {
  if (state?.connected) {
    if (!confirm('Trocar a conexão deste computador pelo novo código?')) return;
  }
  $('code').value = link;
  void connect(link);
});

setInterval(render, 30_000); // atualiza o "há X min"
window.addEventListener('focus', () => {
  // Voltou de parear/instalar no sistema: atualiza as listas.
  void Promise.all([refreshPrinters(), refreshPorts()]).then(() => {
    render();
    if ($('pick').open && pick.stage === 'device') renderPicker();
  });
});

(async () => {
  await Promise.all([refreshPrinters(), refreshPorts()]);
  apply(await api.state());
})();
