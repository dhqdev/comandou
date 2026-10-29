import { useEffect, useRef, useState } from 'react';
import { LivePanda, type PandaGesture, type PandaMood } from '../../design-system';
import { useMascot } from './state';
import './mascot.css';

/**
 * O panda passeando no canto de baixo da tela (o passeio do Bolinho no Planejai). Ao abrir o
 * sistema ele entra pulando pelo canto, acena e volta; de vez em quando reaparece, olha em volta
 * e vai embora. Fica sempre no canto esquerdo: não passa pelo meio da tela nem pelo botão do chat.
 * Tocar nele: acena e sai. Desliga no guarda-roupa, com "reduzir movimento" e nos testes.
 */
const SPEED = 70; // px por segundo
const OUT = -84; // escondido atrás da borda esquerda

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((ok, no) => {
    const t = setTimeout(ok, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), no(new Error('abort'))), {
      once: true,
    });
  });

export function PandaStroll() {
  const { outfit, stroll } = useMascot();
  const box = useRef<HTMLDivElement>(null);
  const x = useRef(OUT);
  const run = useRef<AbortController | null>(null);
  const [walking, setWalking] = useState(false);
  const [left, setLeft] = useState(false);
  const [mood, setMood] = useState<PandaMood>('idle');
  const [cue, setCue] = useState<{ g: PandaGesture; n: number }>();
  const [shown, setShown] = useState(false);
  /** Cada volta do passeio; depois de um toque, começa outra (sem o aceno de chegada). */
  const [round, setRound] = useState(0);
  const gesture = (g: PandaGesture) => setCue((c) => ({ g, n: (c?.n ?? 0) + 1 }));

  const off =
    !stroll ||
    (typeof navigator !== 'undefined' && navigator.webdriver) ||
    (typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    if (off) return;

    /** Anda até `to` (px a partir da borda), pulando. */
    const walk = async (to: number, signal: AbortSignal) => {
      const el = box.current;
      if (!el || typeof el.animate !== 'function') return;
      const from = x.current;
      setLeft(to < from);
      setWalking(true);
      const ms = (Math.abs(to - from) / SPEED) * 1000;
      const a = el.animate(
        [{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }],
        { duration: ms, easing: 'linear', fill: 'forwards' },
      );
      signal.addEventListener(
        'abort',
        () => {
          x.current = new DOMMatrix(getComputedStyle(el).transform).m41;
          a.pause();
        },
        { once: true },
      );
      await Promise.race([a.finished, wait(ms + 400, signal)]);
      setWalking(false);
      if (signal.aborted) throw new Error('abort');
      x.current = to;
    };

    const visit = async (signal: AbortSignal, first: boolean) => {
      setShown(true);
      await walk(first ? 26 : 18 + Math.random() * 60, signal);
      if (first) {
        setMood('joy');
        gesture('wave');
        await wait(1900, signal);
        setMood('idle');
      } else {
        gesture('look');
        await wait(1800, signal);
        gesture(Math.random() < 0.5 ? 'hop' : 'wave');
        await wait(1600, signal);
      }
      await wait(600, signal);
      await walk(OUT, signal);
      setShown(false);
    };

    const loop = async () => {
      const ctl = new AbortController();
      run.current = ctl;
      try {
        if (round === 0) {
          await wait(4000, ctl.signal);
          await visit(ctl.signal, true);
        }
        for (;;) {
          await wait(120_000 + Math.random() * 120_000, ctl.signal);
          if (!document.hidden) await visit(ctl.signal, false);
        }
      } catch {
        /* interrompido */
      }
    };
    void loop();
    return () => run.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [off, round]);

  // Tocar nele: acena e vai embora (o passeio volta a contar depois).
  const onTap = () => {
    const prev = run.current;
    if (!prev) return true;
    prev.abort();
    const ctl = new AbortController();
    run.current = ctl;
    setMood('joy');
    gesture('wave');
    void (async () => {
      try {
        await wait(1500, ctl.signal);
        setMood('idle');
        const el = box.current;
        if (el && typeof el.animate === 'function') {
          setLeft(true);
          setWalking(true);
          const ms = (Math.abs(OUT - x.current) / SPEED) * 1000;
          await el.animate(
            [{ transform: `translateX(${x.current}px)` }, { transform: `translateX(${OUT}px)` }],
            { duration: ms, easing: 'linear', fill: 'forwards' },
          ).finished;
          x.current = OUT;
          setWalking(false);
          setShown(false);
        }
        setRound((r) => r + 1);
      } catch {
        /* interrompido */
      }
    })();
    return true;
  };

  if (off) return null;
  return (
    <div className={`pw-stroll ${shown ? 'is-shown' : ''}`} aria-hidden>
      <div className="pw-stroll__walker" ref={box} style={{ transform: `translateX(${OUT}px)` }}>
        <div className={`pw-stroll__body ${left ? 'is-left' : ''}`}>
          <LivePanda
            size={58}
            mood={mood}
            outfit={outfit}
            walking={walking}
            cue={cue}
            onTap={onTap}
          />
        </div>
      </div>
    </div>
  );
}
