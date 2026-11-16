/*
 * Escolhe o manifesto do app instalado (PWA) antes de a página terminar de abrir. O Safari do
 * iPhone e o Chrome leem o manifesto do começo da página: trocado só depois (no React), o app
 * instalado a partir do cardápio abria em "/", no login da equipe. Mesmas regras de
 * applyManifest (src/design-system/brand.ts), que continua acompanhando a troca de tela.
 */
(function () {
  var path = location.pathname;
  var href = '/manifest.webmanifest';
  if (location.hostname.indexOf('admin.') === 0) href = '/admin.webmanifest';
  else if (/^\/entregador\/[A-Za-z0-9_-]{20,64}$/.test(path))
    href = '/api/v1/store/manifest?start=' + encodeURIComponent(path);
  else if (/^\/(pedir|pedido|mesa)(\/|$)/.test(path))
    href = '/api/v1/store/manifest?start=%2Fpedir';
  var link = document.createElement('link');
  link.rel = 'manifest';
  link.href = href;
  document.head.appendChild(link);
})();
