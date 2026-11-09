/**
 * Molas no jeito do iPhone (SwiftUI `spring(duration:bounce:)`), em CSS puro.
 *
 * A mola é uma curva de tempo `linear(...)` com vários pontos: o navegador anima transform e opacidade
 * na placa de vídeo seguindo o desenho da mola (passa um pouco do ponto e assenta), sem JavaScript a
 * cada quadro. Navegador sem `linear()` recebe uma curva parecida de uma volta só.
 *
 * - `response`: tempo que a mola leva para chegar perto do fim (segundos), como o "duration" da Apple;
 * - `bounce`: 0 = sem passar do ponto; 0,15–0,3 = elástico discreto; acima disso, brinquedo.
 *
 * As mesmas curvas estão escritas em tokens.css (--cm-spring*): o teste spring.test.ts confere que
 * os dois lugares batem.
 */

export interface Spring {
  /** valor para `easing`/`transition-timing-function` */
  easing: string;
  /** duração total em ms, até a mola parar de mexer */
  duration: number;
}

/** Posição (0 → 1) da mola no tempo t (s), partindo parada. */
export function springAt(response: number, bounce: number, t: number) {
  const w = (2 * Math.PI) / response;
  const z = Math.min(1, Math.max(0, 1 - bounce));
  if (z >= 1) return 1 - Math.exp(-w * t) * (1 + w * t);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
}

/** Até quando a mola mexe de forma visível (fica a menos de 0,1% do fim). */
export function springDuration(response: number, bounce: number) {
  const step = 1 / 240;
  let still = 0;
  for (let t = step; t < 4; t += step) {
    if (Math.abs(1 - springAt(response, bounce, t)) > 0.001) still = t;
    else if (t - still > 0.05) break;
  }
  return Math.ceil((still + step) * 100) / 100;
}

/** Tira pontos que quase caem na reta entre os vizinhos (Ramer–Douglas–Peucker). */
function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  let worst = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const yLine = ay + ((by - ay) * (x - ax)) / (bx - ax || 1);
    const d = Math.abs(y - yLine);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= tol) return [pts[0], pts[pts.length - 1]];
  const left = simplify(pts.slice(0, at + 1), tol);
  return [...left.slice(0, -1), ...simplify(pts.slice(at), tol)];
}

const round = (n: number, d: number) => {
  const r = Number(n.toFixed(d));
  return Object.is(r, -0) ? 0 : r;
};

/** Curva `linear(...)` da mola (independente da duração: só o desenho). */
export function springLinear(response: number, bounce: number) {
  const total = springDuration(response, bounce);
  const n = 90;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    pts.push([x, i === n ? 1 : springAt(response, bounce, x * total)]);
  }
  const kept = simplify(pts, 0.0025);
  const body = kept
    .map(([x, y], i) =>
      i === 0 ? '0' : i === kept.length - 1 ? '1' : `${round(y, 3)} ${round(x * 100, 1)}%`,
    )
    .join(', ');
  return `linear(${body})`;
}

/** Curva de reserva (navegador sem linear()): uma volta só passando do ponto. */
const FALLBACK = 'cubic-bezier(0.34, 1.32, 0.5, 1)';
const FALLBACK_FLAT = 'cubic-bezier(0.32, 0.72, 0, 1)';

let linearOk: boolean | null = null;
function supportsLinear() {
  if (linearOk === null)
    linearOk =
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('transition-timing-function', 'linear(0, 1)');
  return linearOk;
}

const cache = new Map<string, Spring>();
/** Mola pronta para Web Animations: `el.animate(frames, { ...spring(0.4, 0.2) })`. */
export function spring(response: number, bounce: number): Spring {
  const key = `${response}:${bounce}`;
  let s = cache.get(key);
  if (!s) {
    const duration = Math.round(springDuration(response, bounce) * 1000);
    s = supportsLinear()
      ? { easing: springLinear(response, bounce), duration }
      : {
          easing: bounce > 0.05 ? FALLBACK : FALLBACK_FLAT,
          duration: Math.round(response * 1000 * 0.9),
        };
    cache.set(key, s);
  }
  return s;
}

/**
 * As molas do sistema (mesmos valores de tokens.css):
 * - expand: janela nascendo de quem foi clicado (elástico discreto);
 * - snappy: toque, liga/desliga, indicadores (rápida, um pulinho);
 * - smooth: folhas e painéis (sem pulo visível).
 */
export const SPRINGS = {
  expand: [0.42, 0.26],
  snappy: [0.3, 0.28],
  smooth: [0.4, 0.04],
} as const satisfies Record<string, readonly [number, number]>;
