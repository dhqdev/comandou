import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { DepthPhoto, depthSupported } from './depth-photo';
import { calmMotion } from './motion';
import { DISHES } from './site-data';

/**
 * Prato em 3D do site: foto de verdade com profundidade (depth-photo.ts). O prato acompanha o
 * mouse (ou o dedo arrastando) e, parado, passeia sozinho devagar. A moldura gira junto e a sombra
 * anda embaixo. O visualizador só começa quando a seção chega perto da tela; antes disso (e sem
 * WebGL) fica a foto parada, que já é bonita sozinha.
 */
export function Dish3D() {
  const [dish, setDish] = useState(DISHES[0]!.key);
  const [state, setState] = useState<'wait' | 'ready' | 'off'>('wait');
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<DepthPhoto | null>(null);
  /** Prato que está no visualizador (não carrega o mesmo duas vezes). */
  const showing = useRef<string | null>(null);
  const current = DISHES.find((d) => d.key === dish) ?? DISHES[0]!;

  // Liga perto da tela e para fora dela (o laço do WebGL não roda à toa).
  useEffect(() => {
    const el = box.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    if (!depthSupported()) {
      setState('off');
      return;
    }
    let made: DepthPhoto | null = null;
    // Só desenha com a seção na tela e a aba aberta.
    let inView = !('IntersectionObserver' in window);
    const sync = () => made?.setShown(inView && !document.hidden);
    const start = () => {
      if (made) return;
      try {
        made = new DepthPhoto(cv, {
          onFrame: (x, y) => {
            el.style.setProperty('--lx', x.toFixed(4));
            el.style.setProperty('--ly', y.toFixed(4));
          },
          onLost: () => setState('off'),
        });
      } catch {
        setState('off');
        return;
      }
      engine.current = made;
      sync();
      const first = DISHES.find((d) => d.key === el.dataset.dish) ?? DISHES[0]!;
      showing.current = first.key;
      made.show(scene(first.key)).then(
        () => setState('ready'),
        () => setState('off'),
      );
    };
    if (!('IntersectionObserver' in window)) {
      start();
      return () => made?.destroy();
    }
    const near = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) start();
      },
      { rootMargin: '300px 0px' },
    );
    const seen = new IntersectionObserver(([e]) => {
      inView = !!e?.isIntersecting;
      sync();
    });
    const tab = () => sync();
    near.observe(el);
    seen.observe(el);
    document.addEventListener('visibilitychange', tab);
    return () => {
      near.disconnect();
      seen.disconnect();
      document.removeEventListener('visibilitychange', tab);
      made?.destroy();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    if (state !== 'ready' || showing.current === dish) return;
    showing.current = dish;
    void engine.current?.show(scene(dish)).catch(() => undefined);
  }, [dish, state]);

  // Mouse: o prato segue o ponteiro em cima da cena. Dedo: arrastar gira; soltar volta a passear.
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' && e.buttons === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    engine.current?.point(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      ((e.clientY - r.top) / r.height) * 2 - 1,
    );
  };

  return (
    <div className="st-dish" data-state={state}>
      <div
        className="st-dish__stage"
        ref={box}
        data-dish={dish}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => engine.current?.release()}
        onPointerUp={() => engine.current?.release()}
        onPointerCancel={() => engine.current?.release()}
      >
        <div className="st-dish__card">
          <img
            key={current.key}
            className="st-dish__photo"
            src={`/site/3d/${current.key}.webp`}
            alt={`${current.name}, foto do prato`}
            width={1080}
            height={810}
            loading="lazy"
            decoding="async"
          />
          <canvas className="st-dish__canvas" ref={canvas} aria-hidden />
          <span className="st-dish__light" aria-hidden />
        </div>
        <span className="st-dish__shadow" aria-hidden />
        {state === 'ready' && !calmMotion() && (
          <span className="st-dish__hint" aria-hidden>
            <span className="st-dish__hint-fine">Mexa o mouse para girar</span>
            <span className="st-dish__hint-touch">Arraste para girar</span>
          </span>
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
            onClick={() => setDish(d.key)}
            style={{ '--thumb': `url(/site/3d/${d.key}-sm.webp)` } as CSSProperties}
          >
            <i aria-hidden />
            <span>
              {d.name}
              <small>R$ {d.price}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const scene = (key: string) => ({
  photo: `/site/3d/${key}.webp`,
  depth: `/site/3d/${key}-depth.webp`,
});
