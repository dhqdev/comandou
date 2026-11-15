import { Box, ScanLine, X } from 'lucide-react';
import { createElement, useEffect, useRef, useState } from 'react';
import './model3d.css';

export interface ProductModel {
  glb: string;
  usdz: string | null;
}

/**
 * Carrega o visualizador 3D só quando alguém abre um modelo (ele é grande: não entra no
 * cardápio de quem não usa). O descompactador de malhas (Draco) vem do próprio Comandou.
 */
let viewerLib: Promise<unknown> | null = null;
function loadViewer() {
  // O model-viewer lê a configuração global a cada elemento criado (e volta para o gstatic.com,
  // bloqueado pela política de conteúdo, se ela não existir): defina antes de carregar.
  const g = self as unknown as { ModelViewerElement?: Record<string, unknown> };
  g.ModelViewerElement = { ...g.ModelViewerElement, dracoDecoderLocation: '/vendor/draco/' };
  viewerLib ??= import('@google/model-viewer');
  viewerLib.catch(() => (viewerLib = null));
  return viewerLib;
}

/**
 * Prato em 3D: o cliente gira e aproxima com o dedo e, no celular, toca em "Ver na sua mesa"
 * para a câmera mostrar o prato em tamanho real em cima da mesa. Android abre o visualizador do
 * Google, iPhone o Quick Look; sem câmera compatível fica só o giro na tela.
 */
function Viewer({
  model,
  name,
  poster,
  onClose,
}: {
  model: ProductModel;
  name: string;
  poster: string | null;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    let alive = true;
    loadViewer().then(
      () => alive && setState('ready'),
      () => alive && setState('error'),
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <dialog ref={dialog} className="m3d" aria-label={`${name} em 3D`} onClose={onClose}>
      <header className="m3d__head">
        <strong>{name}</strong>
        <button type="button" className="m3d__close" aria-label="Fechar" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <div className="m3d__stage">
        {state === 'loading' && <p className="m3d__note">Carregando o modelo…</p>}
        {state === 'error' && (
          <p className="m3d__note">
            Não deu para abrir o modelo. Confira a conexão e tente de novo.
          </p>
        )}
        {state === 'ready' &&
          createElement(
            'model-viewer',
            {
              class: 'm3d__viewer',
              src: model.glb,
              'ios-src': model.usdz ?? undefined,
              poster: poster ?? undefined,
              alt: `${name} em 3D`,
              // Propriedade, não atributo: o React 19 passa as props para o elemento e ar="" viraria
              // falso, sem o botão de câmera.
              ar: true,
              'ar-modes': 'webxr scene-viewer quick-look',
              'ar-scale': 'fixed',
              'ar-placement': 'floor',
              'camera-controls': '',
              'auto-rotate': '',
              'shadow-intensity': '1',
              'touch-action': 'pan-y',
              'interaction-prompt': 'auto',
            },
            <button slot="ar-button" type="button" className="cta m3d__ar">
              <ScanLine size={18} aria-hidden /> Ver na sua mesa
            </button>,
          )}
      </div>
      <p className="m3d__hint">
        Arraste para girar e use dois dedos para aproximar. No celular, toque em “Ver na sua mesa”:
        a câmera abre e o prato aparece na sua frente, do tamanho real.
      </p>
    </dialog>
  );
}

/**
 * Câmera do celular direto, sem passar pelo visualizador: o iPhone abre o Quick Look (precisa do
 * USDZ) e o Android abre o Scene Viewer do Google, com o prato em tamanho real em cima da mesa.
 * Os dois já vêm no sistema do celular; nada para instalar.
 */
export type ArKind = 'quick-look' | 'scene-viewer';

export function arSupport(
  ua: string = navigator.userAgent,
  touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1,
): ArKind | null {
  if (/iPad|iPhone|iPod/.test(ua) || touchMac) {
    // App do Google no iPhone não abre o Quick Look.
    if (/GSA\//.test(ua)) return null;
    if (/CriOS\/|EdgiOS\/|FxiOS\/|DuckDuckGo\//.test(ua)) return 'quick-look';
    const a = document.createElement('a');
    return a.relList?.supports?.('ar') ? 'quick-look' : null;
  }
  if (/Android/i.test(ua) && !/Firefox|OculusBrowser/i.test(ua)) return 'scene-viewer';
  return null;
}

/** Hash que o Android usa para voltar quando não tem o visualizador de RA (abre o giro em 3D). */
const NO_AR = '#sem-camera-3d';

export function sceneViewerUrl(glb: string, title: string, page: string): string {
  const file = new URL(glb, page).href;
  const fallback = page.split('#')[0] + NO_AR;
  const q = `file=${encodeURIComponent(file)}&mode=ar_preferred&resizable=false&title=${encodeURIComponent(title)}`;
  return (
    `intent://arvr.google.com/scene-viewer/1.0?${q}#Intent;scheme=https;` +
    'package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;' +
    `S.browser_fallback_url=${encodeURIComponent(fallback)};end;`
  );
}

function openCamera(kind: ArKind, model: ProductModel, name: string) {
  const a = document.createElement('a');
  if (kind === 'quick-look') {
    // O Safari só abre o Quick Look num link rel="ar" com uma imagem dentro.
    a.rel = 'ar';
    a.href = `${model.usdz}#allowsContentScaling=0`;
    a.appendChild(document.createElement('img'));
  } else a.href = sceneViewerUrl(model.glb, name, location.href);
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
}

export function Model3DButton({
  model,
  name,
  poster,
}: {
  model: ProductModel;
  name: string;
  poster: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [ar] = useState(() => {
    const k = arSupport();
    // Sem USDZ o iPhone precisa do visualizador (ele converte o modelo na hora).
    return k === 'quick-look' && !model.usdz ? null : k;
  });

  useEffect(() => {
    // Android sem o visualizador de RA do Google volta com este hash: abre o giro em 3D.
    const back = () => {
      if (location.hash !== NO_AR) return;
      history.replaceState(history.state, '', location.href.split('#')[0]);
      setOpen(true);
    };
    back();
    addEventListener('hashchange', back);
    return () => removeEventListener('hashchange', back);
  }, []);

  const viewer = open && (
    <Viewer model={model} name={name} poster={poster} onClose={() => setOpen(false)} />
  );
  if (!ar)
    return (
      <>
        <button type="button" className="m3d-btn" onClick={() => setOpen(true)}>
          <Box size={17} aria-hidden /> Ver em 3D
          <small>no celular, aparece na sua mesa</small>
        </button>
        {viewer}
      </>
    );
  return (
    <>
      <div className="m3d-actions">
        <button type="button" className="m3d-ar" onClick={() => openCamera(ar, model, name)}>
          <ScanLine size={20} aria-hidden />
          <span>
            Ver na sua mesa
            <small>Abre a câmera e coloca o prato na sua frente</small>
          </span>
        </button>
        <button type="button" className="m3d-link" onClick={() => setOpen(true)}>
          <Box size={16} aria-hidden /> Girar em 3D
        </button>
      </div>
      {viewer}
    </>
  );
}
