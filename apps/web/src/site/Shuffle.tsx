/**
 * Shuffle — React Bits (https://reactbits.dev/text-animations/shuffle), de David Haz.
 * Licença MIT + Commons Clause: pode ser usado dentro do Comandou; não pode ser revendido como
 * componente. O movimento é o original (cada letra corre numa fita dentro de uma janela do tamanho
 * dela, ímpares primeiro e pares depois, "power3.out"); passado do GSAP para Web Animations, sem
 * dependência nova, e só com transform. O texto de verdade fica num `cm-sr-only` (leitor de tela,
 * busca e testes leem a frase inteira); o desenho que anima é `aria-hidden`. Com "reduzir
 * movimento", fica parado.
 */
import { Fragment, useEffect, useRef, useState } from 'react';
import { calmMotion } from './motion';

/**
 * Use dentro do título (`<h2><Shuffle text="..." /></h2>`): o componente é só um `<span>`, e o
 * título continua sendo do HTML de quem chama.
 */
export interface ShuffleProps {
  text: string;
  className?: string;
  /** Duração de cada letra, em ms. */
  duration?: number;
  /** Intervalo entre letras, em ms. */
  stagger?: number;
  /** Quantas letras falsas passam antes da certa. */
  shuffleTimes?: number;
  /** Ordem: ímpares e depois pares (o padrão do React Bits), em sequência ou do meio para fora. */
  mode?: 'evenodd' | 'sequence' | 'center';
  /** De onde a fita vem. */
  direction?: 'right' | 'left';
  /** Letras sorteadas no meio do caminho (vazio: a própria letra). */
  charset?: string;
  /** `view`: toca quando aparece na tela; `mount`: toca assim que desenha. */
  trigger?: 'view' | 'mount';
  /** Passar o mouse toca de novo. */
  hover?: boolean;
  /** Espera antes da primeira vez, em ms. */
  delay?: number;
  /** Texto para leitor de tela (padrão: o próprio texto). */
  label?: string;
  /** Sem o texto escondido para leitor de tela (quando quem está em volta já tem a frase). */
  sr?: boolean;
}

/** "power3.out" do GSAP. */
const EASE = 'cubic-bezier(0.215, 0.61, 0.355, 1)';

export function shuffleOffsets(
  n: number,
  mode: ShuffleProps['mode'],
  duration: number,
  stagger: number,
): number[] {
  if (mode === 'sequence') return Array.from({ length: n }, (_, i) => i * stagger);
  if (mode === 'center') {
    const mid = (n - 1) / 2;
    return Array.from({ length: n }, (_, i) => Math.abs(i - mid) * stagger);
  }
  // evenodd: as ímpares correm primeiro; as pares começam quando a primeira leva vai em 70%.
  const odd = Math.floor(n / 2);
  const evenStart = odd ? (duration + Math.max(0, odd - 1) * stagger) * 0.7 : 0;
  return Array.from({ length: n }, (_, i) =>
    i % 2 === 1 ? Math.floor(i / 2) * stagger : evenStart + (i / 2) * stagger,
  );
}

interface Cell {
  cell: HTMLElement;
  strip: HTMLElement;
  glyph: HTMLElement;
}

/** Volta a letra ao normal: só ela na fita, sem largura fixa e sem recorte. */
function settle({ cell, strip, glyph }: Cell) {
  strip.replaceChildren(glyph);
  cell.style.width = '';
  cell.style.overflow = '';
  glyph.style.width = '';
}

export function Shuffle({
  text,
  className = '',
  duration = 350,
  stagger = 30,
  shuffleTimes = 1,
  mode = 'evenodd',
  direction = 'right',
  charset = '',
  trigger = 'view',
  hover = true,
  delay = 0,
  label,
  sr = true,
}: ShuffleProps) {
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || calmMotion() || typeof Element.prototype.animate !== 'function') return;
    let alive = true;
    const timers: number[] = [];
    const running = new Map<Animation, Cell>();
    const pick = (fallback: string) =>
      charset ? charset.charAt(Math.floor(Math.random() * charset.length)) : fallback;

    const play = () => {
      if (running.size || !alive) return;
      const cells: Cell[] = [];
      for (const cell of el.querySelectorAll<HTMLElement>('.st-shuffle__c')) {
        const strip = cell.firstElementChild as HTMLElement | null;
        const glyph = strip?.firstElementChild as HTMLElement | null;
        if (strip && glyph) cells.push({ cell, strip, glyph });
      }
      // Mede tudo antes de escrever (medir no meio das escritas refaz a página a cada letra).
      const widths = cells.map((c) => c.cell.getBoundingClientRect().width);
      const at = shuffleOffsets(cells.length, mode, duration, stagger);
      const rolls = Math.max(1, Math.floor(shuffleTimes));
      const forward = direction === 'right';
      cells.forEach((c, i) => {
        const w = widths[i]!;
        const ch = c.glyph.textContent ?? '';
        if (!w || !ch.trim()) return;
        const copy = (t: string) => {
          const n = c.glyph.cloneNode(false) as HTMLElement;
          n.textContent = t;
          n.style.width = `${w}px`;
          return n;
        };
        c.cell.style.width = `${w}px`;
        c.cell.style.overflow = 'hidden';
        c.glyph.style.width = `${w}px`;
        const mids = Array.from({ length: rolls }, () => copy(pick(ch)));
        const head = copy(ch);
        c.strip.replaceChildren(...(forward ? [c.glyph, ...mids, head] : [head, ...mids, c.glyph]));
        const span = (rolls + 1) * w;
        const from = forward ? -span : 0;
        const to = forward ? 0 : -span;
        const anim = c.strip.animate(
          [
            { transform: `translate3d(${from}px, 0, 0)` },
            { transform: `translate3d(${to}px, 0, 0)` },
          ],
          { duration, delay: at[i], easing: EASE, fill: 'both' },
        );
        running.set(anim, c);
        anim.onfinish = () => {
          running.delete(anim);
          anim.cancel();
          settle(c);
        };
      });
    };

    // Fonte ainda chegando muda a largura das letras: mede só depois dela.
    const ready: Promise<unknown> = 'fonts' in document ? document.fonts.ready : Promise.resolve();
    const start = () =>
      void ready.then(() => {
        if (!alive) return;
        if (delay) timers.push(window.setTimeout(play, delay));
        else play();
      });

    let io: IntersectionObserver | null = null;
    if (trigger === 'view' && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(
        ([e]) => {
          if (!e?.isIntersecting) return;
          io?.disconnect();
          start();
        },
        { threshold: 0.1, rootMargin: '0px 0px -8% 0px' },
      );
      io.observe(el);
    } else start();

    const fine = window.matchMedia('(pointer: fine)').matches;
    if (hover && fine) el.addEventListener('mouseenter', play);

    return () => {
      alive = false;
      io?.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
      el.removeEventListener('mouseenter', play);
      for (const [anim, c] of running) {
        anim.onfinish = null;
        anim.cancel();
        settle(c);
      }
      running.clear();
    };
  }, [text, duration, stagger, shuffleTimes, mode, direction, charset, trigger, hover, delay]);

  const words = text.split(' ');
  return (
    <span ref={root} className={`st-shuffle ${className}`}>
      {sr && <span className="cm-sr-only">{label ?? text}</span>}
      <span className="st-shuffle__vis" aria-hidden>
        {words.map((w, wi) => (
          <Fragment key={wi}>
            {wi > 0 && ' '}
            <span className="st-shuffle__w">
              {[...w].map((ch, ci) => (
                <span className="st-shuffle__c" key={ci}>
                  <span className="st-shuffle__s">
                    <span className="st-shuffle__g">{ch}</span>
                  </span>
                </span>
              ))}
            </span>
          </Fragment>
        ))}
      </span>
    </span>
  );
}

/**
 * Palavras que trocam com o Shuffle (o título do topo: "Seu restaurante", "Sua lanchonete"...).
 * Cada troca embaralha as letras até a palavra nova. Para quando a aba some; com "reduzir
 * movimento", fica só a primeira.
 */
export function ShuffleWords({
  words,
  every = 3000,
  className = '',
  sr = true,
}: {
  words: string[];
  every?: number;
  className?: string;
  sr?: boolean;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (calmMotion() || words.length < 2) return;
    const t = window.setInterval(() => {
      if (!document.hidden) setI((n) => (n + 1) % words.length);
    }, every);
    return () => window.clearInterval(t);
  }, [words.length, every]);
  const word = words[i] ?? words[0] ?? '';
  const first = i === 0;
  return (
    <Shuffle
      key={word}
      text={word}
      className={`st-shuffle--words ${className}`}
      trigger="mount"
      hover={false}
      shuffleTimes={first ? 1 : 3}
      duration={first ? 420 : 560}
      stagger={26}
      charset={first ? '' : 'abcdefghijklmnopqrstuvwxyz'}
      delay={first ? 150 : 0}
      sr={sr}
    />
  );
}
