// Tela do Comandou Impressão. Sem framework: o estado vem do processo principal (window.agent).
'use strict';

const $ = (id) => document.getElementById(id);
const api = window.agent;
let state = null;
let systemPrinters = [];
let busy = false;

const STATUS = {
  idle: ['Não conectado', 'muted'],
  connecting: ['Conectando…', 'info'],
  online: ['Online', 'success'],
  offline: ['Sem conexão', 'warning'],
  unauthorized: ['Desconectado', 'danger'],
};
const KIND = { kitchen_ticket: 'Comanda', receipt: 'Conferência', test: 'Teste' };

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) n.append(c);
  return n;
}

function toast(msg, tone = 'success') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast toast--${tone}`;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3800);
}

const errMsg = (e) =>
  String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function describe(spec) {
  if (!spec || spec === 'none') return 'Não imprimir';
  if (spec.startsWith('printer:')) {
    const p = systemPrinters.find((x) => x.name === spec.slice(8));
    return p ? p.label : spec.slice(8);
  }
  if (spec.startsWith('tcp://')) return `Rede ${spec.slice(6)}`;
  return spec;
}

function timeAgo(at) {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------- impressora de rede
function askNetwork(current) {
  return new Promise((resolve) => {
    const d = $('net-dialog');
    const m = /^tcp:\/\/([^:]+):?(\d*)$/.exec(current ?? '');
    $('net-ip').value = m ? m[1] : '';
    $('net-port').value = m && m[2] ? m[2] : '9100';
    $('net-error').hidden = true;
    const done = (v) => {
      d.close();
      $('net-form').onsubmit = null;
      resolve(v);
    };
    $('net-cancel').onclick = () => done(null);
    d.oncancel = () => done(null);
    $('net-form').onsubmit = (e) => {
      e.preventDefault();
      const ip = $('net-ip').value.trim();
      const port = Number($('net-port').value.trim() || 9100);
      if (!/^[a-zA-Z0-9.-]+$/.test(ip) || !(port > 0 && port < 65536)) {
        $('net-error').textContent =
          'Confira o IP (ex.: 192.168.0.50) e a porta (normalmente 9100).';
        $('net-error').hidden = false;
        return;
      }
      done(`tcp://${ip}:${port}`);
    };
    d.showModal();
    $('net-ip').focus();
  });
}

// ---------------------------------------------------------------- linha de impressora
function printerRow(target, spec, { main = false } = {}) {
  const select = el('select', {
    class: 'select',
    'aria-label': `Impressora de ${target ?? 'tudo'}`,
  });
  if (!main) select.append(el('option', { value: '', text: 'Usar a principal' }));
  if (systemPrinters.length) {
    const g = el('optgroup', { label: 'Neste computador (USB)' });
    for (const p of systemPrinters)
      g.append(
        el('option', {
          value: `printer:${p.name}`,
          text: p.label + (p.isDefault ? ' (padrão)' : ''),
        }),
      );
    select.append(g);
  }
  const net = el('optgroup', { label: 'Na rede' });
  if (spec?.startsWith('tcp://')) net.append(el('option', { value: spec, text: describe(spec) }));
  net.append(el('option', { value: '__net', text: 'Impressora de rede (IP)…' }));
  select.append(net);
  if (main)
    select.append(el('option', { value: '', text: 'Escolha uma impressora…', disabled: true }));
  select.append(el('option', { value: 'none', text: 'Não imprimir' }));
  if (spec?.startsWith('printer:') && !systemPrinters.some((p) => `printer:${p.name}` === spec))
    select.prepend(el('option', { value: spec, text: `${spec.slice(8)} (não encontrada)` }));
  select.value = spec ?? '';
  let prev = select.value;

  select.addEventListener('change', async () => {
    let v = select.value;
    if (v === '__net') {
      v = await askNetwork(spec);
      if (!v) {
        select.value = prev;
        return;
      }
    }
    try {
      state = await api.setPrinter(main ? null : target, v);
      prev = v;
      render();
      if (v && v !== 'none') toast(`${main ? 'Principal' : target}: ${describe(v)}`);
    } catch (e) {
      select.value = prev;
      toast(errMsg(e), 'danger');
    }
  });

  const effective = spec || (!main && state.printers.default) || '';
  const test = el(
    'button',
    {
      class: 'btn btn--ghost',
      disabled: !effective || effective === 'none',
      title: 'Imprime uma página de teste agora',
      onclick: async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = 'Imprimindo…';
        try {
          await api.testPrint(effective);
          toast('Teste enviado. Saiu o papel?');
        } catch (err) {
          toast(errMsg(err), 'danger');
        } finally {
          b.disabled = false;
          b.textContent = 'Testar';
        }
      },
    },
    'Testar',
  );

  const last = state.jobs.find((j) => (main ? j.printer === spec : j.target === target));
  const dot = last
    ? el('span', {
        class: `dot dot--${last.ok ? 'ok' : 'fail'}`,
        title: last.ok ? 'Última impressão ok' : last.error,
      })
    : el('span', { class: 'dot' });

  if (main)
    return el(
      'div',
      { class: 'printer-main' },
      el('div', { class: 'printer-main__icon', 'aria-hidden': 'true' }, printerIcon()),
      el('div', { class: 'printer-main__body' }, select),
      test,
    );
  return el(
    'div',
    { class: 'route' },
    dot,
    el('div', { class: 'route__name' }, target),
    select,
    test,
  );
}

function printerIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '26');
  svg.setAttribute('height', '26');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of [
    'M6 9V3h12v6',
    'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2',
    'M6 14h12v7H6z',
  ]) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
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
        'O código foi trocado ou o computador foi desativado.',
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
        'escolha a impressora principal abaixo e clique em Testar.',
      ),
    );
    banner.hidden = false;
  } else banner.hidden = true;

  $('main-printer').replaceChildren(printerRow(null, state.printers.default, { main: true }));
  const routes = state.targets.map((t) => printerRow(t, state.printers.routes[t] ?? ''));
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
    toast(`Conectado a ${state.restaurant ?? 'Comandou'}`);
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
window.addEventListener('focus', () => refreshPrinters().then(render));

(async () => {
  await refreshPrinters();
  apply(await api.state());
})();
