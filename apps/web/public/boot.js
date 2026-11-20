/*
 * Abertura do app (roda antes de tudo, fora do React; precisa ser arquivo à parte porque a CSP
 * não deixa script dentro do HTML). O index.html já chega com o esqueleto da tela (#cm-boot), então
 * o celular nunca mostra tela branca enquanto os arquivos do app baixam.
 *
 * Se o app não abrir, esta é a única saída: o React nem chegou a rodar, então nada dele (aviso de
 * "Atualizar", ErrorBoundary, reloadIfStale) existe. Acontecia no app instalado (PWA) do celular:
 * o service worker servia uma cópia guardada do index.html que pedia um arquivo que não existia
 * mais (o iPhone apaga parte do cache de app pouco usado; deploy no meio do download) e a tela
 * ficava branca toda vez que abria, sem botão nenhum.
 *
 * - Arquivo do app (/assets/) que não veio: limpa o que o navegador guarda do app e recarrega uma
 *   vez sozinho; se já tentou, mostra o aviso com o botão "Tentar de novo".
 * - Demorando demais (rede ruim): mostra o mesmo aviso, sem interromper o carregamento.
 */
(function () {
  var TRIED = 'cm.bootRescue';
  var SLOW_MS = 15000;

  // Tema salvo (o mesmo de design-system/theme.tsx) já no esqueleto, sem piscar branco no escuro.
  try {
    var t = localStorage.getItem('cm-theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.dataset.theme = t;
      document.documentElement.style.colorScheme = t;
    }
  } catch (e) {
    /* navegação privada */
  }

  // Telas do cliente (cardápio, pedido, rastreio, mesa, entregador) e o site: esqueleto sem a
  // moldura da equipe (menu lateral e abas).
  var host = location.hostname;
  var siteHost =
    !/^[\d.]+$/.test(host) &&
    host.indexOf(':') < 0 &&
    host.indexOf('admin.') !== 0 &&
    (host.indexOf('www.') === 0 || host.split('.').length === 2);
  if (
    siteHost ||
    /^\/(pedir|pedido|mesa|rastreio|entregador|site|codigo|pre[cç]os)(\/|$)/.test(location.pathname)
  )
    document.documentElement.dataset.boot = 'plain';

  function boot() {
    return document.getElementById('cm-boot');
  }

  function clearApp() {
    var jobs = [];
    try {
      if (window.caches)
        jobs.push(
          caches.keys().then(function (keys) {
            return Promise.all(
              keys.map(function (k) {
                return caches.delete(k);
              }),
            );
          }),
        );
    } catch (e) {
      /* sem Cache Storage */
    }
    try {
      if (navigator.serviceWorker)
        jobs.push(
          navigator.serviceWorker.getRegistrations().then(function (regs) {
            return Promise.all(
              regs.map(function (r) {
                return r.unregister();
              }),
            );
          }),
        );
    } catch (e) {
      /* sem service worker */
    }
    var all = Promise.all(jobs).catch(function () {});
    var limit = new Promise(function (r) {
      setTimeout(r, 4000);
    });
    return Promise.race([all, limit]);
  }

  function retry() {
    clearApp().then(function () {
      location.reload();
    });
  }

  function show(kind) {
    var el = boot();
    if (!el) return; // o app já abriu
    var box = document.getElementById('cm-boot-msg');
    if (!box || !box.hidden) return;
    var title = document.getElementById('cm-boot-title');
    var text = document.getElementById('cm-boot-text');
    if (kind === 'failed') {
      title.textContent = 'O app não abriu';
      text.textContent =
        'Uma parte do aplicativo não carregou. Toque em Tentar de novo: ele baixa tudo outra vez, sem apagar os seus dados.';
    }
    box.hidden = false;
    var btn = document.getElementById('cm-boot-retry');
    btn.onclick = function () {
      btn.disabled = true;
      btn.textContent = 'Abrindo…';
      retry();
    };
  }

  function rescue() {
    if (!boot()) return;
    var again = false;
    try {
      again = sessionStorage.getItem(TRIED) === '1';
      sessionStorage.setItem(TRIED, '1');
    } catch (e) {
      again = true; // sem sessionStorage não dá para evitar repetir: deixa a pessoa decidir
    }
    if (again || navigator.onLine === false) show('failed');
    else retry();
  }

  // Arquivo do app que não chegou (script ou estilo de /assets/). Erro de recurso não sobe até a
  // janela, por isso a escuta na fase de captura.
  window.addEventListener(
    'error',
    function (e) {
      var t = e.target;
      if (!t || t === window) return;
      var url = t.src || t.href || '';
      if (/\/assets\//.test(url) && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')) rescue();
    },
    true,
  );

  setTimeout(function () {
    show('slow');
  }, SLOW_MS);

  // Abriu: a próxima falha volta a poder recarregar sozinha.
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (boot()) return;
      try {
        sessionStorage.removeItem(TRIED);
      } catch (e) {
        /* nada */
      }
    }, 3000);
  });
})();
