/**
 * Efeito de adicionar à sacola: a foto do item vira uma bolinha, sobe um pouco ("pega" o item) e
 * voa em arco até o botão da sacola que está à vista, encolhendo até caber nele. A sacola recebe
 * (`onLand`) um pouco antes de a bolinha sumir, para o pulo dela casar com a chegada.
 *
 * Camadas (cada uma anima uma coisa só, então as animações não brigam):
 * - `.fly` (posição X), `.fly__y` (posição Y: o arco), `.fly__lift` (o "pegar": cresce/encolhe
 *   com a mola), `.fly__disc` (recorte de retângulo para círculo, encolher, girar e sumir) e a
 *   sombra `.fly__shadow` ao lado do disco.
 * Só transform, opacity e clip-path, nada de layout: roda liso no celular mais simples.
 *
 * O cálculo (tempo, altura do arco, tamanhos) é puro em `flightPlan`, testado em fly-to-cart.test.ts.
 */
import { reducedMotion } from './morph';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FlightPlan {
  /** lado do quadrado que vira o círculo (o menor lado da foto) */
  side: number;
  /** tamanho da bolinha depois de "pegar" o item (px) */
  lifted: number;
  /** tamanho da bolinha ao chegar na sacola (px) */
  landed: number;
  dx: number;
  dy: number;
  /** quanto a bolinha sobe antes de descer (px; 0 quando a sacola fica acima) */
  hop: number;
  /** duração do voo (ms) */
  duration: number;
  /** giro total no voo (graus), para o lado em que ela vai */
  spin: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A bolinha "pega" fica do tamanho de um polegar: foto pequena quase não muda, a grande encolhe. */
export const liftedSize = (side: number) => Math.min(side, clamp(side * 0.62, 56, 104));

/** Plano do voo da foto `from` até o botão `to` (os dois em coordenadas da tela). */
export function flightPlan(from: Box, to: Box): FlightPlan {
  const side = Math.max(1, Math.min(from.width, from.height));
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const dist = Math.hypot(dx, dy);
  const lifted = liftedSize(side);
  const landed = clamp(Math.min(to.width, to.height) * 0.78, 18, 40);
  return {
    side,
    lifted,
    landed,
    dx,
    dy,
    hop: dy > 24 ? clamp(dist * 0.12, 18, 56) : 0,
    // Longe demora um pouco mais, mas nunca arrasta: entre 300 e 460 ms.
    duration: Math.round(clamp(230 + dist * 0.26, 300, 460)),
    spin: dx === 0 ? 0 : Math.sign(dx) * clamp(Math.abs(dx) * 0.03, 4, 14),
  };
}

/** Foto de dentro do elemento que mais aparece na tela agora (galeria: a foto da vez). */
function visibleImage(root: HTMLElement): HTMLImageElement | null {
  const imgs = [
    ...(root instanceof HTMLImageElement ? [root] : []),
    ...root.querySelectorAll('img'),
  ];
  let best: HTMLImageElement | null = null;
  let area = 0;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  for (const img of imgs) {
    if (!img.complete || !img.naturalWidth) continue;
    const r = img.getBoundingClientRect();
    const w = Math.min(r.right, vw) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    if (w > 0 && h > 0 && w * h > area) {
      area = w * h;
      best = img;
    }
  }
  return best;
}

/** Quanto do retângulo está dentro da tela (0 a 1). */
function shownFraction(r: Box) {
  const w = Math.min(r.left + r.width, window.innerWidth) - Math.max(r.left, 0);
  const h = Math.min(r.top + r.height, window.innerHeight) - Math.max(r.top, 0);
  return w > 0 && h > 0 ? (w * h) / Math.max(1, r.width * r.height) : 0;
}

let flying = 0;

export function flyToCart(
  from: HTMLElement,
  leaving: boolean,
  findTarget: () => HTMLElement | null,
  onLand: () => void,
) {
  // Muitos toques seguidos: a partir da quarta bolinha no ar, a sacola só pula.
  if (reducedMotion() || !from.animate || flying >= 4) return onLand();

  const img = visibleImage(from);
  let a: Box = from.getBoundingClientRect();
  // Foto rolada para fora da tela (ex.: botão Adicionar no fim do item): sai do botão tocado.
  if (shownFraction(a) < 0.35) {
    const btn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const r = btn && btn !== document.body ? btn.getBoundingClientRect() : null;
    const cx = r ? r.left + r.width / 2 : window.innerWidth / 2;
    const cy = r ? r.top + r.height / 2 : window.innerHeight / 2;
    a = { left: cx - 36, top: cy - 36, width: 72, height: 72 };
  }

  const ghost = document.createElement('div');
  ghost.className = 'fly';
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    left: `${a.left}px`,
    top: `${a.top}px`,
    width: `${a.width}px`,
    height: `${a.height}px`,
  });
  const y = document.createElement('div');
  y.className = 'fly__y';
  const lift = document.createElement('div');
  lift.className = 'fly__lift';
  const shadow = document.createElement('div');
  shadow.className = 'fly__shadow';
  const disc = document.createElement('div');
  disc.className = 'fly__disc';
  if (img) {
    const pic = document.createElement('img');
    pic.src = img.currentSrc || img.src;
    pic.alt = '';
    pic.decoding = 'sync';
    disc.appendChild(pic);
  } else {
    // Sem foto: leva o desenho que está no lugar (ícone do prato).
    const copy = from.cloneNode(true) as HTMLElement;
    copy.removeAttribute('id');
    copy.classList.add('fly__copy');
    disc.appendChild(copy);
  }
  lift.append(shadow, disc);
  y.appendChild(lift);
  ghost.appendChild(y);
  document.body.appendChild(ghost);
  flying++;

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    flying--;
    ghost.remove();
  };

  const side = Math.max(1, Math.min(a.width, a.height));
  const ix = (a.width - side) / 2;
  const iy = (a.height - side) / 2;
  const radius = getComputedStyle(from).borderRadius || '16px';
  const circle = `inset(${iy}px ${ix}px round ${side / 2}px)`;
  const lifted = liftedSize(side) / side;

  // 1) Pegar: a foto vira bolinha e salta um pouquinho (mola rápida, um leve passar do ponto).
  const pickMs = leaving ? 220 : 170;
  disc.animate([{ clipPath: `inset(0px round ${radius})` }, { clipPath: circle }], {
    duration: pickMs,
    easing: 'cubic-bezier(.2,0,0,1)',
    fill: 'forwards',
  });
  shadow.animate(
    [
      { opacity: 0, transform: 'scale(.9)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: pickMs, easing: 'ease-out', fill: 'forwards' },
  );
  lift.animate(
    [
      { transform: 'scale(1)' },
      { transform: `scale(${lifted * 1.08})`, offset: 0.7 },
      { transform: `scale(${lifted})` },
    ],
    { duration: pickMs + 60, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'forwards' },
  );

  // 2) Voar até a sacola que está à vista agora.
  const fly = () => {
    const target = findTarget();
    if (!target || !ghost.isConnected) {
      finish();
      return onLand();
    }
    const plan = flightPlan(a, target.getBoundingClientRect());
    const t = plan.duration;
    // Indo para baixo (celular: pílula embaixo) a bolinha sobe antes de cair; indo para cima
    // (notebook: sacola no alto) sobe rápido e chega de lado, numa curva só.
    ghost.animate([{ transform: 'none' }, { transform: `translateX(${plan.dx}px)` }], {
      duration: t,
      easing: plan.dy > 24 ? 'cubic-bezier(.3,.1,.6,1)' : 'cubic-bezier(.5,0,.75,.6)',
      fill: 'forwards',
    });
    y.animate(
      plan.hop
        ? [
            { transform: 'none', easing: 'cubic-bezier(.2,.6,.35,1)' },
            {
              transform: `translateY(${-plan.hop}px)`,
              offset: 0.3,
              easing: 'cubic-bezier(.6,0,.9,.5)',
            },
            { transform: `translateY(${plan.dy}px)` },
          ]
        : [
            { transform: 'none', easing: 'cubic-bezier(.2,.7,.4,1)' },
            { transform: `translateY(${plan.dy}px)` },
          ],
      { duration: t, fill: 'forwards' },
    );
    const end = plan.landed / (side * lifted);
    const shrink = [
      { transform: 'none', opacity: 1 },
      { transform: `scale(${(1 + end) / 2}) rotate(${plan.spin * 0.6}deg)`, offset: 0.55 },
      { transform: `scale(${end}) rotate(${plan.spin}deg)`, opacity: 1, offset: 0.86 },
      { transform: `scale(${end * 0.4}) rotate(${plan.spin}deg)`, opacity: 0 },
    ];
    const opts: KeyframeAnimationOptions = {
      duration: t,
      easing: 'cubic-bezier(.4,0,.7,.4)',
      fill: 'forwards',
    };
    // Medido dentro do `.fly__lift`, que já está na escala da bolinha pega.
    const last = disc.animate(shrink, opts);
    shadow.animate(shrink, opts);
    // A sacola pula quando a bolinha entra nela (um pouco antes do fim, para casar).
    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      onLand();
    };
    window.setTimeout(land, t * 0.84);
    last.finished
      .catch(() => undefined)
      .then(() => {
        finish();
        land();
      });
  };

  if (!leaving) return void window.setTimeout(fly, Math.round(pickMs * 0.45));
  // Saindo da tela do item: espera o endereço mudar (a tela some em ~160 ms) e o cardápio
  // desenhar, porque lá a sacola pode estar em outro lugar. A bolinha fica "pega" enquanto isso.
  const path = window.location.pathname;
  const t0 = performance.now();
  const wait = () => {
    if (window.location.pathname !== path)
      return void requestAnimationFrame(() => requestAnimationFrame(fly));
    if (performance.now() - t0 > 600) return fly();
    requestAnimationFrame(wait);
  };
  requestAnimationFrame(wait);
}
