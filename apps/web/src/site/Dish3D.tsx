import { createElement, useEffect, useRef, useState } from 'react';
import { calmMotion } from './motion';
import { DISHES } from './site-data';

/**
 * Prato em 3D do site: os modelos de verdade da demonstração (public/site/3d/*.glb), no mesmo
 * visualizador que o cliente do restaurante usa no cardápio (@google/model-viewer). O visualizador
 * e o modelo só baixam quando a seção chega perto da tela; até lá (e sem WebGL) fica a foto.
 */
let viewerLib: Promise<unknown> | null = null;
function loadViewer() {
  // Mesmo cuidado do cardápio (pages/public/Model3D.tsx): o descompactador de malhas vem do
  // próprio Comandou, nunca do gstatic.com (bloqueado pela política de conteúdo).
  const g = self as unknown as { ModelViewerElement?: Record<string, unknown> };
  g.ModelViewerElement = { ...g.ModelViewerElement, dracoDecoderLocation: '/vendor/draco/' };
  viewerLib ??= import('@google/model-viewer');
  viewerLib.catch(() => (viewerLib = null));
  return viewerLib;
}

function webgl(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function Dish3D({ dish, onPick }: { dish: string; onPick: (key: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'wait' | 'ready' | 'off'>('wait');
  const [loaded, setLoaded] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!webgl()) {
      setState('off');
      return;
    }
    const start = () =>
      loadViewer().then(
        () => setState('ready'),
        () => setState('off'),
      );
    if (!('IntersectionObserver' in window)) {
      void start();
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        void start();
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // O modelo novo avisa quando terminou de carregar (evento "load" do model-viewer).
  useEffect(() => {
    const mv = box.current?.querySelector('model-viewer');
    if (!mv) return;
    const on = () => setLoaded(dish);
    mv.addEventListener('load', on);
    return () => mv.removeEventListener('load', on);
  }, [state, dish]);

  const current = DISHES.find((d) => d.key === dish) ?? DISHES[0]!;
  const calm = calmMotion();

  return (
    <div className="st-dish" data-loaded={loaded === dish || undefined}>
      <div className="st-dish__stage" ref={box}>
        <span className="st-dish__floor" aria-hidden />
        {state === 'ready' ? (
          createElement('model-viewer', {
            class: 'st-dish__viewer',
            src: `/site/3d/${current.key}.glb`,
            alt: `${current.name} em 3D, girando`,
            'camera-controls': '',
            'disable-zoom': '',
            'disable-pan': '',
            'auto-rotate': calm ? undefined : '',
            'auto-rotate-delay': '0',
            'rotation-per-second': '18deg',
            'interaction-prompt': 'none',
            'camera-orbit': '30deg 66deg 125%',
            'min-camera-orbit': 'auto 30deg auto',
            'max-camera-orbit': 'auto 88deg auto',
            'field-of-view': '30deg',
            exposure: '1.05',
            'shadow-intensity': '1.1',
            'shadow-softness': '0.9',
            'environment-image': 'neutral',
            'touch-action': 'pan-y',
            loading: 'eager',
          })
        ) : (
          <img
            className="st-dish__photo"
            src="/site/food-burger-fumaca.webp"
            alt={state === 'off' ? 'Fumaça (o da casa)' : ''}
            width={480}
            height={480}
            loading="lazy"
          />
        )}
      </div>
      <div className="st-dish__picker" role="tablist" aria-label="Pratos em 3D">
        {DISHES.map((d) => (
          <button
            key={d.key}
            type="button"
            role="tab"
            aria-selected={d.key === dish}
            className={d.key === dish ? 'is-on' : undefined}
            disabled={state === 'off'}
            onClick={() => onPick(d.key)}
          >
            <span>{d.name}</span>
            <small>R$ {d.price}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
