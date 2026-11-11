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
  viewerLib ??= import('@google/model-viewer').then((m) => {
    (m.ModelViewerElement as unknown as { dracoDecoderLocation: string }).dracoDecoderLocation =
      '/vendor/draco/';
    return m;
  });
  viewerLib.catch(() => (viewerLib = null));
  return viewerLib;
}

/**
 * Prato em 3D: o cliente gira e aproxima com o dedo e, no celular, toca em "Ver na minha mesa"
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
              ar: '',
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
              <ScanLine size={18} aria-hidden /> Ver na minha mesa
            </button>,
          )}
      </div>
      <p className="m3d__hint">
        Arraste para girar e use dois dedos para aproximar. No celular, toque em “Ver na minha mesa”
        e aponte a câmera para a mesa.
      </p>
    </dialog>
  );
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
  return (
    <>
      <button type="button" className="m3d-btn" onClick={() => setOpen(true)}>
        <Box size={17} aria-hidden /> Ver em 3D
        <small>e na sua mesa, pela câmera</small>
      </button>
      {open && <Viewer model={model} name={name} poster={poster} onClose={() => setOpen(false)} />}
    </>
  );
}
