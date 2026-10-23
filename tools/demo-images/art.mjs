// Ilustrações (SVG) do restaurante de demonstração "Casa Brasa".
// Tudo desenhado em código: nada de fotos de terceiros. generate.mjs transforma em WebP.

/** Gerador pseudoaleatório com semente (as imagens saem sempre iguais). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n) => Math.round(n * 10) / 10;

/** Contorno irregular (bolha) em volta de um centro. */
function blob(cx, cy, rx, ry, rand, wobble = 0.12, points = 14) {
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const k = 1 + (rand() - 0.5) * 2 * wobble;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  // Curva suave pelos pontos (Catmull-Rom → Bézier).
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < points; i++) {
    const p0 = pts[(i - 1 + points) % points];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % points];
    const p3 = pts[(i + 2) % points];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return d + 'Z';
}

// ------------------------------------------------------------------------------ cenário
const SCENES = {
  warm: ['#f6d7b0', '#e9a96a', '#7a3d18'],
  red: ['#f5c2a8', '#e0714e', '#6d2414'],
  slate: ['#5b5550', '#37322e', '#141110'],
  green: ['#dcebc4', '#9cc27a', '#2f4a1c'],
  cream: ['#fbecd6', '#efc995', '#7b5228'],
  berry: ['#f0cfe0', '#c77aa6', '#4b1735'],
  blue: ['#d4e6f2', '#8db8d8', '#1d3a52'],
  night: ['#3d3430', '#231d1a', '#0c0a09'],
};

export function scene(w, h, kind, body, opts = {}) {
  const [c1, c2, c3] = SCENES[kind];
  const rand = rng(opts.seed ?? 7);
  const crumbs = Array.from({ length: opts.crumbs ?? 0 }, () => {
    const x = rand() * w;
    const y = h * 0.62 + rand() * h * 0.36;
    return `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(3 + rand() * 5)}" ry="${f(2 + rand() * 3)}" fill="${opts.crumbColor ?? '#fff3d6'}" opacity="${f(0.35 + rand() * 0.4)}" transform="rotate(${f(rand() * 180)} ${f(x)} ${f(y)})"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0" stop-color="${c1}"/><stop offset="0.62" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/>
    </radialGradient>
    <linearGradient id="table" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.28"/>
    </linearGradient>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/>
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.10 0"/>
      <feComposite in2="SourceGraphic" operator="in"/>
    </filter>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#2a1206" flood-opacity="0.35"/>
    </filter>
    <filter id="tex" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="9"/>
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.22 0"/>
      <feComposite in2="SourceGraphic" operator="in"/>
    </filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect y="${h * 0.6}" width="${w}" height="${h * 0.4}" fill="url(#table)"/>
  ${crumbs}
  ${body}
  <rect width="${w}" height="${h}" fill="#fff" filter="url(#grain)" opacity="0.6"/>
</svg>`;
}

/** Sombra macia no chão. */
export const floorShadow = (cx, cy, rx, ry, op = 0.4) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#1c0b03" opacity="${op}" filter="url(#soft)"/>`;

/** Prato branco visto de lado (elipse). */
export function plate(cx, cy, rx, ry, color = '#fbf7f1') {
  return `${floorShadow(cx, cy + ry * 0.35, rx * 1.02, ry * 0.9, 0.35)}
  <ellipse cx="${cx}" cy="${cy + 8}" rx="${rx}" ry="${ry}" fill="#d9d1c5"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color}"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${rx * 0.72}" ry="${ry * 0.68}" fill="#efe8dd"/>
  <ellipse cx="${cx}" cy="${cy - ry * 0.05}" rx="${rx * 0.7}" ry="${ry * 0.64}" fill="${color}"/>`;
}

/** Tábua de madeira redonda (pizza). */
export function board(cx, cy, rx, ry) {
  return `${floorShadow(cx, cy + ry * 0.25, rx * 1.02, ry, 0.45)}
  <ellipse cx="${cx}" cy="${cy + 16}" rx="${rx}" ry="${ry}" fill="#6e4322"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#b47a45"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" filter="url(#tex)" opacity="0.7"/>
  ${[0.92, 0.75, 0.55, 0.32].map((k) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx * k}" ry="${ry * k}" fill="none" stroke="#8d5a2e" stroke-opacity="0.35" stroke-width="2"/>`).join('')}`;
}

// ------------------------------------------------------------------------------ hambúrguer
const L = {
  bunBottom: (cx, y, w) => ({
    h: 70,
    svg: `<path d="M${cx - w / 2},${y + 8} Q${cx - w / 2},${y} ${cx - w / 2 + 16},${y} L${cx + w / 2 - 16},${y} Q${cx + w / 2},${y} ${cx + w / 2},${y + 8} L${cx + w / 2 - 10},${y + 58} Q${cx + w / 2 - 14},${y + 70} ${cx + w / 2 - 34},${y + 70} L${cx - w / 2 + 34},${y + 70} Q${cx - w / 2 + 14},${y + 70} ${cx - w / 2 + 10},${y + 58}Z" fill="url(#bunG)"/>
    <path d="M${cx - w / 2 + 6},${y + 6} L${cx + w / 2 - 6},${y + 6}" stroke="#f6d39b" stroke-width="10" stroke-linecap="round" opacity="0.7"/>`,
  }),
  patty: (cx, y, w, color = '#5b2c12', rand) => {
    const spots = Array.from({ length: 26 }, () => {
      const x = cx - w / 2 + 20 + rand() * (w - 40);
      const yy = y + 14 + rand() * 50;
      return `<ellipse cx="${f(x)}" cy="${f(yy)}" rx="${f(3 + rand() * 7)}" ry="${f(2 + rand() * 4)}" fill="#2a1206" opacity="${f(0.35 + rand() * 0.4)}"/>`;
    }).join('');
    return {
      h: 74,
      svg: `<path d="${blob(cx, y + 38, w / 2, 38, rand, 0.04, 18)}" fill="${color}"/>
      <path d="M${cx - w / 2 + 30},${y + 14} Q${cx},${y + 2} ${cx + w / 2 - 30},${y + 14}" stroke="#fff" stroke-opacity="0.15" stroke-width="8" fill="none" stroke-linecap="round"/>${spots}`,
    };
  },
  crispy: (cx, y, w, _c, rand) => {
    const bumps = Array.from({ length: 40 }, () => {
      const x = cx - w / 2 + 18 + rand() * (w - 36);
      const yy = y + 10 + rand() * 56;
      return `<circle cx="${f(x)}" cy="${f(yy)}" r="${f(3 + rand() * 5)}" fill="${rand() > 0.5 ? '#f2b65a' : '#a85d1d'}" opacity="0.7"/>`;
    }).join('');
    return {
      h: 78,
      svg: `<path d="${blob(cx, y + 40, w / 2 + 6, 40, rand, 0.07, 20)}" fill="#d38a33"/>${bumps}`,
    };
  },
  cheese: (cx, y, w, color = '#f7b52c', rand) => {
    let d = `M${cx - w / 2 - 8},${y} L${cx + w / 2 + 8},${y} L${cx + w / 2 + 8},${y + 14}`;
    const n = 7;
    for (let i = n; i >= 0; i--) {
      const x = cx - w / 2 - 8 + ((w + 16) * i) / n;
      const drip = 18 + rand() * 34;
      d += ` L${f(x + 14)},${y + 14} Q${f(x + 10)},${f(y + 14 + drip)} ${f(x)},${f(y + 14 + drip)} Q${f(x - 10)},${f(y + 14 + drip)} ${f(x - 14)},${y + 14}`;
    }
    d += ` L${cx - w / 2 - 8},${y + 14}Z`;
    return {
      h: 16,
      svg: `<path d="${d}" fill="${color}"/><path d="M${cx - w / 2},${y + 4} L${cx + w / 2},${y + 4}" stroke="#fff" stroke-opacity="0.35" stroke-width="4" stroke-linecap="round"/>`,
    };
  },
  bacon: (cx, y, w, _c, rand) => {
    const strip = (yy, dx) => {
      let d = `M${cx - w / 2 + dx},${yy}`;
      for (let i = 1; i <= 8; i++) {
        const x = cx - w / 2 + dx + ((w - 40) * i) / 8;
        d += ` Q${f(x - (w - 40) / 16)},${f(yy + (i % 2 ? -14 : 14))} ${f(x)},${yy}`;
      }
      return `<path d="${d}" stroke="#8e2b1b" stroke-width="22" fill="none" stroke-linecap="round"/>
      <path d="${d}" stroke="#e7a08a" stroke-width="5" fill="none" stroke-linecap="round" transform="translate(0,-4)" opacity="0.8"/>`;
    };
    return { h: 30, svg: strip(y + 10, 10 + rand() * 6) + strip(y + 22, 26) };
  },
  lettuce: (cx, y, w, _c, rand) => {
    let d = `M${cx - w / 2 - 20},${y + 14}`;
    const n = 14;
    for (let i = 1; i <= n; i++) {
      const x = cx - w / 2 - 20 + ((w + 40) * i) / n;
      d += ` Q${f(x - (w + 40) / n / 2)},${f(y + 26 + rand() * 10)} ${f(x)},${f(y + 12 + rand() * 6)}`;
    }
    d += ` L${cx + w / 2},${y} L${cx - w / 2},${y}Z`;
    return {
      h: 26,
      svg: `<path d="${d}" fill="#4f9d2c"/><path d="${d}" fill="#7cc84f" transform="translate(0,-8)"/>`,
    };
  },
  tomato: (cx, y, w) => ({
    h: 24,
    svg: [-1, 1]
      .map(
        (s) =>
          `<rect x="${cx + (s < 0 ? -w / 2 + 4 : 8)}" y="${y}" width="${w / 2 - 12}" height="26" rx="13" fill="#d8321f"/>
           <rect x="${cx + (s < 0 ? -w / 2 + 18 : 22)}" y="${y + 5}" width="${w / 2 - 40}" height="9" rx="4.5" fill="#f56a50" opacity="0.8"/>`,
      )
      .join(''),
  }),
  onion: (cx, y, w) => ({
    h: 14,
    svg: [-0.3, 0, 0.28]
      .map(
        (k) =>
          `<ellipse cx="${cx + w * k}" cy="${y + 8}" rx="${w * 0.16}" ry="10" fill="none" stroke="#b46aa8" stroke-width="7"/>`,
      )
      .join(''),
  }),
  pickles: (cx, y, w) => ({
    h: 12,
    svg: [-0.32, -0.1, 0.12, 0.34]
      .map(
        (k) =>
          `<ellipse cx="${cx + w * k}" cy="${y + 6}" rx="38" ry="9" fill="#7a9a2e"/><ellipse cx="${cx + w * k}" cy="${y + 5}" rx="26" ry="5" fill="#b9cf62"/>`,
      )
      .join(''),
  }),
  sauce: (cx, y, w) => ({
    h: 8,
    svg: `<path d="M${cx - w / 2 + 10},${y + 4} Q${cx},${y + 16} ${cx + w / 2 - 10},${y + 4}" stroke="#f3e2b8" stroke-width="12" fill="none" stroke-linecap="round"/>`,
  }),
  bunTop: (cx, y, w, _c, rand, seeds = true) => {
    const h = 190;
    const sesame = seeds
      ? Array.from({ length: 22 }, () => {
          const a = Math.PI * (0.12 + rand() * 0.76);
          const r = 0.25 + rand() * 0.68;
          const x = cx - Math.cos(a) * (w / 2) * r;
          const yy = y + h - Math.sin(a) * h * r * 0.78;
          return `<ellipse cx="${f(x)}" cy="${f(yy)}" rx="7" ry="3.6" fill="#fff4dc" transform="rotate(${f((rand() - 0.5) * 70)} ${f(x)} ${f(yy)})"/>`;
        }).join('')
      : '';
    return {
      h,
      svg: `<path d="M${cx - w / 2},${y + h} C${cx - w / 2},${y - h * 0.22} ${cx + w / 2},${y - h * 0.22} ${cx + w / 2},${y + h} Q${cx + w / 2},${y + h + 14} ${cx + w / 2 - 20},${y + h + 14} L${cx - w / 2 + 20},${y + h + 14} Q${cx - w / 2},${y + h + 14} ${cx - w / 2},${y + h}Z" fill="url(#bunG)"/>
      <ellipse cx="${cx - w * 0.16}" cy="${y + h * 0.36}" rx="${w * 0.17}" ry="${h * 0.1}" fill="#fff" opacity="0.22" transform="rotate(-12 ${cx - w * 0.16} ${y + h * 0.36})"/>${sesame}`,
    };
  },
};

const BUN_DEFS = `<defs><linearGradient id="bunG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2a64b"/><stop offset="0.6" stop-color="#d27a2a"/><stop offset="1" stop-color="#a95a1a"/></linearGradient></defs>`;

/**
 * Hambúrguer de lado. layers: de baixo para cima (sem os pães).
 * Ex.: ['patty','cheese','bacon','lettuce']
 */
export function burger(cx, baseY, w, layers, opts = {}) {
  const rand = rng(opts.seed ?? 11);
  const parts = [];
  let y = baseY;
  const push = (name, ...args) => {
    // Calcula a altura primeiro e desenha de cima para baixo depois (camadas de cima por cima).
    const probe = L[name](cx, 0, w, ...args, rand);
    y -= probe.h - 6;
    parts.push(L[name](cx, y, w, ...args, rand).svg);
  };
  const bottom = L.bunBottom(cx, baseY - 70, w - 30);
  y = baseY - 70;
  for (const l of layers) {
    if (typeof l === 'string') push(l, undefined);
    else push(l[0], l[1]);
  }
  y -= 184;
  const top = L.bunTop(cx, y, w - 10, undefined, rand, opts.seeds !== false);
  return `${BUN_DEFS}${floorShadow(cx, baseY + 4, w * 0.62, 40, 0.45)}${bottom.svg}${parts.join('')}${top.svg}`;
}

// ------------------------------------------------------------------------------ pizza
/** Pizza vista de cima, levemente inclinada. toppings: lista de tipos. */
export function pizza(cx, cy, r, toppings, opts = {}) {
  const rand = rng(opts.seed ?? 21);
  const ry = r * 0.72;
  const sauce = opts.sauce ?? '#c8361f';
  const cheese = opts.cheese ?? '#f8d77c';
  const items = [];
  const inside = () => {
    for (;;) {
      const x = (rand() * 2 - 1) * 0.82;
      const y = (rand() * 2 - 1) * 0.82;
      if (x * x + y * y < 0.66) return [cx + x * r, cy + y * ry];
    }
  };
  const count = (n) => Math.round(n * (opts.density ?? 1));
  for (const t of toppings) {
    if (t === 'pepperoni')
      for (let i = 0; i < count(16); i++) {
        const [x, y] = inside();
        items.push(
          `<ellipse cx="${f(x)}" cy="${f(y)}" rx="34" ry="25" fill="#9e2716"/><ellipse cx="${f(x)}" cy="${f(y)}" rx="28" ry="20" fill="#c23a22"/>${[0, 1, 2].map(() => `<circle cx="${f(x + (rand() - 0.5) * 30)}" cy="${f(y + (rand() - 0.5) * 20)}" r="3" fill="#7a1a0c"/>`).join('')}`,
        );
      }
    if (t === 'calabresa')
      for (let i = 0; i < count(15); i++) {
        const [x, y] = inside();
        items.push(
          `<ellipse cx="${f(x)}" cy="${f(y)}" rx="30" ry="22" fill="#a8452a"/><ellipse cx="${f(x)}" cy="${f(y)}" rx="24" ry="17" fill="#d77a5a"/>${[0, 1, 2, 3].map(() => `<circle cx="${f(x + (rand() - 0.5) * 30)}" cy="${f(y + (rand() - 0.5) * 22)}" r="3.4" fill="#f4d3b8"/>`).join('')}`,
        );
      }
    if (t === 'onion')
      for (let i = 0; i < count(12); i++) {
        const [x, y] = inside();
        items.push(
          `<path d="M${f(x - 26)},${f(y)} A26,18 0 0 1 ${f(x + 26)},${f(y)}" stroke="#f1e3ef" stroke-width="5" fill="none" transform="rotate(${f(rand() * 360)} ${f(x)} ${f(y)})"/>`,
        );
      }
    if (t === 'basil')
      for (let i = 0; i < count(9); i++) {
        const [x, y] = inside();
        const a = rand() * 360;
        items.push(
          `<g transform="rotate(${f(a)} ${f(x)} ${f(y)})"><path d="M${f(x - 30)},${f(y)} Q${f(x)},${f(y - 22)} ${f(x + 30)},${f(y)} Q${f(x)},${f(y + 22)} ${f(x - 30)},${f(y)}Z" fill="#2f7d2a"/><path d="M${f(x - 26)},${f(y)} L${f(x + 26)},${f(y)}" stroke="#6fbf5a" stroke-width="2"/></g>`,
        );
      }
    if (t === 'tomato')
      for (let i = 0; i < count(8); i++) {
        const [x, y] = inside();
        items.push(
          `<ellipse cx="${f(x)}" cy="${f(y)}" rx="32" ry="24" fill="#d9301c"/><ellipse cx="${f(x)}" cy="${f(y)}" rx="22" ry="15" fill="#f0634a"/><ellipse cx="${f(x - 6)}" cy="${f(y - 3)}" rx="4" ry="3" fill="#ffd9a8"/><ellipse cx="${f(x + 7)}" cy="${f(y + 4)}" rx="4" ry="3" fill="#ffd9a8"/>`,
        );
      }
    if (t === 'olive')
      for (let i = 0; i < count(14); i++) {
        const [x, y] = inside();
        items.push(
          `<ellipse cx="${f(x)}" cy="${f(y)}" rx="12" ry="9" fill="#2a2620"/><ellipse cx="${f(x)}" cy="${f(y)}" rx="5" ry="3.6" fill="${cheese}"/>`,
        );
      }
    if (t === 'ham')
      for (let i = 0; i < count(12); i++) {
        const [x, y] = inside();
        items.push(
          `<rect x="${f(x - 22)}" y="${f(y - 14)}" width="44" height="28" rx="6" fill="#f2a3a0" transform="rotate(${f(rand() * 90)} ${f(x)} ${f(y)})"/>`,
        );
      }
    if (t === 'egg')
      for (let i = 0; i < count(6); i++) {
        const [x, y] = inside();
        items.push(
          `<ellipse cx="${f(x)}" cy="${f(y)}" rx="28" ry="20" fill="#fffaf0"/><ellipse cx="${f(x)}" cy="${f(y)}" rx="12" ry="9" fill="#f7b928"/>`,
        );
      }
    if (t === 'chicken')
      for (let i = 0; i < count(26); i++) {
        const [x, y] = inside();
        items.push(
          `<path d="${blob(x, y, 15, 9, rand, 0.3, 8)}" fill="#e8c38f"/><path d="${blob(x + 2, y + 1, 9, 5, rand, 0.3, 8)}" fill="#c99757"/>`,
        );
      }
    if (t === 'catupiry')
      for (let i = 0; i < count(7); i++) {
        const [x, y] = inside();
        items.push(
          `<path d="${blob(x, y, 30, 20, rand, 0.25, 10)}" fill="#fffaf2"/><path d="${blob(x - 6, y - 5, 12, 7, rand, 0.2, 8)}" fill="#fff" opacity="0.9"/>`,
        );
      }
    if (t === 'cheeses')
      for (let i = 0; i < count(22); i++) {
        const [x, y] = inside();
        const c = ['#fff8e6', '#f4c35a', '#eadfc4', '#fbe7a6'][i % 4];
        items.push(`<path d="${blob(x, y, 22, 15, rand, 0.3, 9)}" fill="${c}"/>`);
        if (i % 4 === 2)
          items.push(
            `<path d="M${f(x - 10)},${f(y)} q6,-4 12,2 q4,4 10,0" stroke="#3f6b8f" stroke-width="2.5" fill="none" opacity="0.7"/>`,
          );
      }
    if (t === 'corn')
      for (let i = 0; i < count(40); i++) {
        const [x, y] = inside();
        items.push(`<ellipse cx="${f(x)}" cy="${f(y)}" rx="6" ry="5" fill="#ffd23f"/>`);
      }
    if (t === 'strawberry')
      for (let i = 0; i < count(12); i++) {
        const [x, y] = inside();
        const a = rand() * 360;
        items.push(
          `<g transform="rotate(${f(a)} ${f(x)} ${f(y)})"><path d="M${f(x)},${f(y + 26)} C${f(x - 30)},${f(y + 8)} ${f(x - 22)},${f(y - 20)} ${f(x)},${f(y - 18)} C${f(x + 22)},${f(y - 20)} ${f(x + 30)},${f(y + 8)} ${f(x)},${f(y + 26)}Z" fill="#e0263b"/><path d="M${f(x)},${f(y + 16)} C${f(x - 16)},${f(y + 4)} ${f(x - 12)},${f(y - 10)} ${f(x)},${f(y - 8)} C${f(x + 12)},${f(y - 10)} ${f(x + 16)},${f(y + 4)} ${f(x)},${f(y + 16)}Z" fill="#ff8c94"/></g>`,
        );
      }
    if (t === 'oregano')
      for (let i = 0; i < count(70); i++) {
        const [x, y] = inside();
        items.push(`<circle cx="${f(x)}" cy="${f(y)}" r="2" fill="#4c6b2a" opacity="0.8"/>`);
      }
  }
  const slices = Array.from({ length: 4 }, (_, i) => {
    const a = (i * Math.PI) / 4 + 0.2;
    return `<line x1="${f(cx - Math.cos(a) * r * 0.93)}" y1="${f(cy - Math.sin(a) * ry * 0.93)}" x2="${f(cx + Math.cos(a) * r * 0.93)}" y2="${f(cy + Math.sin(a) * ry * 0.93)}" stroke="#000" stroke-opacity="0.12" stroke-width="3"/>`;
  }).join('');
  const melt = Array.from({ length: 30 }, () => {
    const [x, y] = inside();
    return `<path d="${blob(x, y, 20 + rand() * 30, 12 + rand() * 18, rand, 0.3, 8)}" fill="#fff6c9" opacity="0.35"/>`;
  }).join('');
  return `${board(cx, cy + 8, r * 1.12, ry * 1.14)}
  <ellipse cx="${cx}" cy="${cy + 10}" rx="${r}" ry="${ry}" fill="#8f531f"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${ry}" fill="#dc9b4f"/>
  <ellipse cx="${cx}" cy="${cy - 4}" rx="${r * 0.97}" ry="${ry * 0.95}" fill="#eab36a"/>
  <path d="${blob(cx, cy, r * 0.88, ry * 0.86, rand, 0.03, 24)}" fill="${sauce}"/>
  <path d="${blob(cx, cy, r * 0.84, ry * 0.82, rand, 0.06, 24)}" fill="${cheese}"/>
  ${melt}${items.join('')}${slices}
  ${Array.from({ length: 30 }, () => {
    const a = rand() * Math.PI * 2;
    const x = cx + Math.cos(a) * r * 0.94;
    const y = cy + Math.sin(a) * ry * 0.93;
    return `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(8 + rand() * 10)}" ry="5" fill="#a5612a" opacity="0.5"/>`;
  }).join('')}`;
}

// ------------------------------------------------------------------------------ porções
/** Caixinha de papel com batatas (ou mandioca). */
export function friesBox(cx, baseY, s = 1, opts = {}) {
  const rand = rng(opts.seed ?? 31);
  const w = 300 * s;
  const h = 300 * s;
  const color = opts.stick ?? '#f7c948';
  const shade = opts.stickShade ?? '#e0a526';
  const sticks = Array.from({ length: 26 }, (_, i) => {
    const x = cx - w * 0.42 + (w * 0.84 * i) / 25 + (rand() - 0.5) * 10 * s;
    const len = (170 + rand() * 110) * s;
    const a = (rand() - 0.5) * 22;
    const sw = (opts.thick ? 34 : 24) * s;
    return `<g transform="rotate(${f(a)} ${f(x)} ${f(baseY - h * 0.5)})"><rect x="${f(x - sw / 2)}" y="${f(baseY - h * 0.5 - len)}" width="${f(sw)}" height="${f(len)}" rx="${f(5 * s)}" fill="${color}"/><rect x="${f(x - sw / 2)}" y="${f(baseY - h * 0.5 - len)}" width="${f(sw * 0.35)}" height="${f(len)}" rx="${f(4 * s)}" fill="${shade}"/></g>`;
  });
  const topping = opts.cheddar
    ? `<path d="${blob(cx, baseY - h * 0.62, w * 0.42, 40 * s, rand, 0.25, 12)}" fill="#f39c12"/><path d="${blob(cx - 20 * s, baseY - h * 0.66, w * 0.25, 18 * s, rand, 0.3, 10)}" fill="#ffc04d"/>${Array.from({ length: 16 }, () => `<rect x="${f(cx - w * 0.36 + rand() * w * 0.72)}" y="${f(baseY - h * 0.72 + rand() * 40 * s)}" width="${f(16 * s)}" height="${f(10 * s)}" rx="3" fill="#8e2b1b" transform="rotate(${f(rand() * 90)})" transform-origin="center"/>`).join('')}`
    : '';
  return `${floorShadow(cx, baseY + 4, w * 0.75, 36 * s, 0.45)}
  ${sticks.join('')}${topping}
  <path d="M${cx - w / 2},${baseY - h * 0.55} L${cx + w / 2},${baseY - h * 0.55} L${cx + w * 0.4},${baseY} L${cx - w * 0.4},${baseY}Z" fill="#c8281e"/>
  <path d="M${cx - w / 2},${baseY - h * 0.55} Q${cx},${baseY - h * 0.42} ${cx + w / 2},${baseY - h * 0.55} L${cx + w * 0.48},${baseY - h * 0.48} Q${cx},${baseY - h * 0.36} ${cx - w * 0.48},${baseY - h * 0.48}Z" fill="#e8463a"/>
  <path d="M${cx - w * 0.44},${baseY - h * 0.26} L${cx + w * 0.44},${baseY - h * 0.26}" stroke="#fff" stroke-width="${10 * s}" opacity="0.9"/>
  ${flame(cx, baseY - h * 0.13, 0.32 * s, '#fff')}`;
}

/** Chama simples (marca da Casa Brasa). */
export function flame(cx, cy, s = 1, color = '#ea8a0b', inner = null) {
  return `<g transform="translate(${cx} ${cy}) scale(${s})">
    <path d="M0,-80 C30,-46 60,-22 54,22 C49,58 24,80 0,80 C-26,80 -54,60 -56,26 C-58,-6 -36,-26 -26,-50 C-20,-30 -10,-22 -2,-20 C-10,-44 -10,-62 0,-80Z" fill="${color}"/>
    ${inner ? `<path d="M2,-10 C18,8 30,24 26,44 C23,62 12,70 0,70 C-14,70 -26,60 -26,42 C-26,26 -14,16 -8,4 C-4,14 2,18 6,18 C2,8 0,0 2,-10Z" fill="${inner}"/>` : ''}
  </g>`;
}

export function onionRings(cx, baseY, opts = {}) {
  const rand = rng(opts.seed ?? 41);
  const rings = [
    [-150, 0],
    [0, 10],
    [150, 0],
    [-80, -90],
    [80, -86],
    [0, -170],
  ];
  return `${plate(cx, baseY - 40, 400, 120)}${rings
    .map(([dx, dy]) => {
      const x = cx + dx;
      const y = baseY - 120 + dy;
      const crumbs = Array.from({ length: 30 }, () => {
        const a = rand() * Math.PI * 2;
        return `<circle cx="${f(x + Math.cos(a) * (88 + (rand() - 0.5) * 30))}" cy="${f(y + Math.sin(a) * (60 + (rand() - 0.5) * 22))}" r="${f(3 + rand() * 4)}" fill="${rand() > 0.5 ? '#f6c46a' : '#b8701f'}"/>`;
      }).join('');
      return `<ellipse cx="${x}" cy="${y + 8}" rx="100" ry="70" fill="none" stroke="#9a5512" stroke-width="40"/><ellipse cx="${x}" cy="${y}" rx="96" ry="66" fill="none" stroke="#e39b3c" stroke-width="40"/>${crumbs}`;
    })
    .join('')}`;
}

/** Cestinha com papel e pedaços empanados (isca de frango). */
export function basket(cx, baseY, opts = {}) {
  const rand = rng(opts.seed ?? 51);
  const pieces = Array.from({ length: 16 }, () => {
    const x = cx + (rand() - 0.5) * 380;
    const y = baseY - 150 - rand() * 90;
    const crumbs = Array.from(
      { length: 8 },
      () =>
        `<circle cx="${f(x + (rand() - 0.5) * 60)}" cy="${f(y + (rand() - 0.5) * 34)}" r="${f(2 + rand() * 4)}" fill="#f8cf7a"/>`,
    ).join('');
    return `<path d="${blob(x, y, 52, 30, rand, 0.22, 10)}" fill="#c77a26"/><path d="${blob(x - 4, y - 4, 44, 22, rand, 0.25, 10)}" fill="#e3a043"/>${crumbs}`;
  }).join('');
  return `${floorShadow(cx, baseY, 300, 40, 0.45)}
  <path d="M${cx - 290},${baseY - 170} L${cx - 250},${baseY - 230} L${cx + 260},${baseY - 230} L${cx + 300},${baseY - 170}Z" fill="#fff8ea"/>
  ${pieces}
  <path d="M${cx - 270},${baseY - 150} L${cx + 270},${baseY - 150} L${cx + 230},${baseY} L${cx - 230},${baseY}Z" fill="#7a4a24"/>
  ${Array.from({ length: 8 }, (_, i) => `<path d="M${cx - 265 + i * 76},${baseY - 150} L${cx - 228 + i * 66},${baseY}" stroke="#5a3418" stroke-width="6"/>`).join('')}
  ${[0, 1, 2].map((i) => `<path d="M${cx - 262 + i * 6},${baseY - 110 + i * 46} L${cx + 262 - i * 6},${baseY - 110 + i * 46}" stroke="#a46a37" stroke-width="10"/>`).join('')}
  ${opts.sauce ? sauceCup(cx + 330, baseY - 10, opts.sauce) : ''}`;
}

export function sauceCup(cx, baseY, color = '#f4e1b0') {
  return `${floorShadow(cx, baseY, 80, 18, 0.35)}<path d="M${cx - 70},${baseY - 70} L${cx + 70},${baseY - 70} L${cx + 56},${baseY} L${cx - 56},${baseY}Z" fill="#f2efe9"/><ellipse cx="${cx}" cy="${baseY - 70}" rx="70" ry="18" fill="#dcd6cc"/><ellipse cx="${cx}" cy="${baseY - 70}" rx="62" ry="14" fill="${color}"/>`;
}

export function saladBowl(cx, baseY, opts = {}) {
  const rand = rng(opts.seed ?? 61);
  const leaves = Array.from({ length: 34 }, () => {
    const x = cx + (rand() - 0.5) * 520;
    const y = baseY - 250 + (rand() - 0.5) * 100;
    const a = rand() * 360;
    const c = ['#4f9d2c', '#7cc84f', '#a6d96a', '#3c7f22'][Math.floor(rand() * 4)];
    return `<path d="${blob(x, y, 60, 30, rand, 0.25, 10)}" fill="${c}" transform="rotate(${f(a)} ${f(x)} ${f(y)})"/>`;
  }).join('');
  const extras = Array.from({ length: 22 }, (_, i) => {
    const x = cx + (rand() - 0.5) * 460;
    const y = baseY - 260 + (rand() - 0.5) * 80;
    if (i % 3 === 0)
      return `<circle cx="${f(x)}" cy="${f(y)}" r="20" fill="#d8321f"/><circle cx="${f(x - 6)}" cy="${f(y - 6)}" r="6" fill="#fff" opacity="0.5"/>`;
    if (i % 3 === 1)
      return `<rect x="${f(x - 16)}" y="${f(y - 14)}" width="32" height="28" rx="6" fill="#e2b261" transform="rotate(${f(rand() * 60)} ${f(x)} ${f(y)})"/>`;
    return `<path d="${blob(x, y, 18, 6, rand, 0.4, 7)}" fill="#fbf2d5"/>`;
  }).join('');
  return `${floorShadow(cx, baseY, 330, 44, 0.4)}
  ${leaves}${extras}
  <path d="M${cx - 320},${baseY - 230} Q${cx - 300},${baseY} ${cx},${baseY} Q${cx + 300},${baseY} ${cx + 320},${baseY - 230}Z" fill="#f4efe6"/>
  <path d="M${cx - 320},${baseY - 230} Q${cx},${baseY - 200} ${cx + 320},${baseY - 230}" stroke="#d9d1c5" stroke-width="10" fill="none"/>
  <path d="M${cx - 250},${baseY - 140} Q${cx},${baseY - 60} ${cx + 250},${baseY - 140}" stroke="#7da35a" stroke-width="10" fill="none" opacity="0.5"/>`;
}

// ------------------------------------------------------------------------------ bebidas
export function can(cx, baseY, s, color, accent, label = '') {
  const w = 190 * s;
  const h = 360 * s;
  const x = cx - w / 2;
  const top = baseY - h;
  const drops = Array.from({ length: 14 }, (_, i) => {
    const r = rng(100 + i);
    return `<ellipse cx="${f(x + 20 * s + r() * (w - 40 * s))}" cy="${f(top + 50 * s + r() * (h - 90 * s))}" rx="${f(3 * s)}" ry="${f(5 * s)}" fill="#fff" opacity="0.55"/>`;
  }).join('');
  return `${floorShadow(cx, baseY, w * 0.7, 18 * s, 0.4)}
  <rect x="${x}" y="${top}" width="${w}" height="${h}" rx="${22 * s}" fill="${color}"/>
  <rect x="${x}" y="${top}" width="${w}" height="${30 * s}" rx="${14 * s}" fill="#c9cdd2"/>
  <rect x="${x}" y="${baseY - 24 * s}" width="${w}" height="${24 * s}" rx="${12 * s}" fill="#b5b9be"/>
  <path d="M${x},${top + h * 0.45} C${x + w * 0.3},${top + h * 0.35} ${x + w * 0.6},${top + h * 0.6} ${x + w},${top + h * 0.48} L${x + w},${top + h * 0.62} C${x + w * 0.6},${top + h * 0.74} ${x + w * 0.3},${top + h * 0.5} ${x},${top + h * 0.6}Z" fill="${accent}"/>
  <rect x="${x + w * 0.12}" y="${top + 34 * s}" width="${w * 0.14}" height="${h - 64 * s}" rx="${8 * s}" fill="#fff" opacity="0.22"/>
  ${label ? `<text x="${cx}" y="${top + h * 0.33}" font-family="Georgia, serif" font-weight="700" font-size="${34 * s}" fill="#fff" text-anchor="middle">${label}</text>` : ''}
  ${drops}`;
}

export function glass(cx, baseY, s, liquid, opts = {}) {
  const w = 240 * s;
  const h = 400 * s;
  const top = baseY - h;
  const fill = top + h * (opts.empty ?? 0.14);
  const rand = rng(opts.seed ?? 71);
  const ice = opts.ice
    ? Array.from({ length: 4 }, (_, i) => {
        const x = cx - w * 0.3 + i * w * 0.18 + (rand() - 0.5) * 10;
        const y = fill + 20 * s + rand() * 60 * s;
        return `<rect x="${f(x)}" y="${f(y)}" width="${f(60 * s)}" height="${f(56 * s)}" rx="${f(10 * s)}" fill="#fff" opacity="0.35" transform="rotate(${f((rand() - 0.5) * 40)} ${f(x + 30 * s)} ${f(y + 28 * s)})"/>`;
      }).join('')
    : '';
  return `${floorShadow(cx, baseY, w * 0.7, 20 * s, 0.35)}
  ${opts.straw ? `<rect x="${cx + w * 0.08}" y="${top - 90 * s}" width="${16 * s}" height="${h * 0.8}" rx="${8 * s}" fill="${opts.straw}" transform="rotate(10 ${cx} ${top})"/>` : ''}
  <path d="M${cx - w / 2},${fill} L${cx + w / 2},${fill} L${cx + w * 0.4},${baseY} L${cx - w * 0.4},${baseY}Z" fill="${liquid}"/>
  ${opts.layer ? `<path d="M${cx - w * 0.43},${baseY - h * 0.28} L${cx + w * 0.43},${baseY - h * 0.28} L${cx + w * 0.4},${baseY} L${cx - w * 0.4},${baseY}Z" fill="${opts.layer}"/>` : ''}
  ${ice}
  <ellipse cx="${cx}" cy="${fill}" rx="${w / 2}" ry="${14 * s}" fill="#fff" opacity="0.25"/>
  <path d="M${cx - w / 2},${top} L${cx + w / 2},${top} L${cx + w * 0.4},${baseY} L${cx - w * 0.4},${baseY}Z" fill="#fff" opacity="0.12" stroke="#fff" stroke-opacity="0.6" stroke-width="${4 * s}"/>
  <path d="M${cx - w * 0.36},${top + 30 * s} L${cx - w * 0.3},${baseY - 30 * s}" stroke="#fff" stroke-width="${10 * s}" opacity="0.4" stroke-linecap="round"/>
  ${opts.garnish ?? ''}`;
}

export function citrusSlice(cx, cy, r, color = '#f7a21b', rind = '#e07b00') {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${rind}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.86}" fill="#fff4cf"/><circle cx="${cx}" cy="${cy}" r="${r * 0.78}" fill="${color}"/>${Array.from({ length: 8 }, (_, i) => `<line x1="${cx}" y1="${cy}" x2="${f(cx + Math.cos((i * Math.PI) / 4) * r * 0.78)}" y2="${f(cy + Math.sin((i * Math.PI) / 4) * r * 0.78)}" stroke="#fff4cf" stroke-width="${r * 0.06}"/>`).join('')}`;
}

export function bottle(cx, baseY, s, color, label) {
  const w = 140 * s;
  const h = 520 * s;
  const top = baseY - h;
  return `${floorShadow(cx, baseY, w * 0.8, 18 * s, 0.4)}
  <path d="M${cx - 18 * s},${top} L${cx + 18 * s},${top} L${cx + 20 * s},${top + 150 * s} C${cx + w / 2},${top + 200 * s} ${cx + w / 2},${top + 230 * s} ${cx + w / 2},${top + 260 * s} L${cx + w / 2},${baseY - 16 * s} Q${cx + w / 2},${baseY} ${cx + w / 2 - 16 * s},${baseY} L${cx - w / 2 + 16 * s},${baseY} Q${cx - w / 2},${baseY} ${cx - w / 2},${baseY - 16 * s} L${cx - w / 2},${top + 260 * s} C${cx - w / 2},${top + 230 * s} ${cx - w / 2},${top + 200 * s} ${cx - 20 * s},${top + 150 * s}Z" fill="${color}"/>
  <rect x="${cx - 22 * s}" y="${top - 10 * s}" width="${44 * s}" height="${26 * s}" rx="${6 * s}" fill="#d9b84a"/>
  <rect x="${cx - w / 2}" y="${top + 290 * s}" width="${w}" height="${130 * s}" fill="#f6ecd2"/>
  ${flame(cx, top + 340 * s, 0.32 * s, '#c8281e')}
  <text x="${cx}" y="${top + 405 * s}" font-family="Georgia, serif" font-weight="700" font-size="${22 * s}" fill="#5a2a12" text-anchor="middle">${label}</text>
  <rect x="${cx - w * 0.36}" y="${top + 200 * s}" width="${12 * s}" height="${290 * s}" rx="${6 * s}" fill="#fff" opacity="0.25"/>`;
}

export function waterBottle(cx, baseY, s) {
  const w = 150 * s;
  const h = 440 * s;
  const top = baseY - h;
  return `${floorShadow(cx, baseY, w * 0.8, 18 * s, 0.35)}
  <rect x="${cx - 26 * s}" y="${top - 30 * s}" width="${52 * s}" height="${40 * s}" rx="${8 * s}" fill="#1f6fb2"/>
  <path d="M${cx - 30 * s},${top} L${cx + 30 * s},${top} C${cx + w / 2},${top + 60 * s} ${cx + w / 2},${top + 80 * s} ${cx + w / 2},${top + 110 * s} L${cx + w / 2},${baseY - 14 * s} Q${cx + w / 2},${baseY} ${cx + w / 2 - 14 * s},${baseY} L${cx - w / 2 + 14 * s},${baseY} Q${cx - w / 2},${baseY} ${cx - w / 2},${baseY - 14 * s} L${cx - w / 2},${top + 110 * s} C${cx - w / 2},${top + 80 * s} ${cx - w / 2},${top + 60 * s} ${cx - 30 * s},${top}Z" fill="#d6ecfa" opacity="0.85"/>
  <rect x="${cx - w / 2}" y="${top + 170 * s}" width="${w}" height="${110 * s}" fill="#2b8ad6"/>
  <path d="M${cx - w / 2},${top + 240 * s} q${w / 4},-20 ${w / 2},0 t${w / 2},0" stroke="#fff" stroke-width="${6 * s}" fill="none"/>
  <rect x="${cx - w * 0.34}" y="${top + 120 * s}" width="${12 * s}" height="${280 * s}" rx="${6 * s}" fill="#fff" opacity="0.5"/>`;
}

// ------------------------------------------------------------------------------ sobremesas
export function brownie(cx, baseY, opts = {}) {
  const rand = rng(opts.seed ?? 81);
  return `${plate(cx, baseY - 60, 380, 110)}
  <path d="M${cx - 220},${baseY - 210} L${cx + 160},${baseY - 230} L${cx + 220},${baseY - 140} L${cx + 210},${baseY - 70} L${cx - 170},${baseY - 50} L${cx - 220},${baseY - 130}Z" fill="#3a1d0d"/>
  <path d="M${cx - 220},${baseY - 210} L${cx + 160},${baseY - 230} L${cx + 220},${baseY - 140} L${cx - 170},${baseY - 120}Z" fill="#5a2e14"/>
  ${Array.from({ length: 10 }, () => `<path d="M${f(cx - 150 + rand() * 300)},${f(baseY - 200 + rand() * 60)} l${f(20 + rand() * 30)},${f((rand() - 0.5) * 16)}" stroke="#2a1206" stroke-width="3"/>`).join('')}
  <circle cx="${cx + 40}" cy="${baseY - 290}" r="95" fill="#fbf3e0"/>
  <path d="M${cx - 50},${baseY - 270} q20,20 40,0 q20,24 46,0 q20,22 44,0" stroke="#e9dcc1" stroke-width="10" fill="none"/>
  <path d="M${cx - 30},${baseY - 360} q40,40 0,80 q-30,40 30,70 M${cx + 60},${baseY - 370} q-30,50 20,90 q40,30 -10,80 M${cx - 160},${baseY - 210} q60,20 120,-10" stroke="#3a1d0d" stroke-width="12" fill="none" stroke-linecap="round"/>
  <path d="M${cx + 100},${baseY - 360} q14,-30 34,-8" stroke="#2f7d2a" stroke-width="12" fill="none" stroke-linecap="round"/>`;
}

export function petitGateau(cx, baseY) {
  return `${plate(cx, baseY - 60, 380, 110)}
  <path d="M${cx - 200},${baseY - 80} C${cx - 200},${baseY - 330} ${cx + 120},${baseY - 330} ${cx + 120},${baseY - 80}Z" fill="#3b1a0b"/>
  <ellipse cx="${cx - 40}" cy="${baseY - 80}" rx="160" ry="30" fill="#2a1206"/>
  <path d="M${cx - 120},${baseY - 82} q60,50 160,10 q60,-10 100,30 q-80,30 -240,10Z" fill="#4e2410"/>
  <ellipse cx="${cx - 90}" cy="${baseY - 250}" rx="40" ry="20" fill="#fff" opacity="0.12"/>
  <circle cx="${cx + 210}" cy="${baseY - 150}" r="85" fill="#fbf3e0"/>
  <circle cx="${cx + 190}" cy="${baseY - 175}" r="24" fill="#fff" opacity="0.6"/>
  <path d="M${cx + 200},${baseY - 240} q14,-34 40,-10" stroke="#2f7d2a" stroke-width="12" fill="none" stroke-linecap="round"/>
  ${Array.from({ length: 12 }, (_, i) => `<circle cx="${cx - 300 + i * 50}" cy="${baseY - 40 + (i % 2) * 14}" r="5" fill="#f2c94c" opacity="0.8"/>`).join('')}`;
}

export function pudim(cx, baseY) {
  return `${plate(cx, baseY - 60, 380, 110)}
  <path d="M${cx - 220},${baseY - 80} L${cx - 170},${baseY - 290} Q${cx},${baseY - 320} ${cx + 170},${baseY - 290} L${cx + 220},${baseY - 80} Q${cx},${baseY - 50} ${cx - 220},${baseY - 80}Z" fill="#f5c76b"/>
  <path d="M${cx - 172},${baseY - 285} Q${cx},${baseY - 320} ${cx + 172},${baseY - 285} L${cx + 182},${baseY - 240} q-20,40 -30,0 q-26,60 -50,4 q-30,50 -60,0 q-30,70 -60,-4 q-30,40 -50,0 q-26,50 -50,-2 L${cx - 182},${baseY - 240}Z" fill="#9c4a10"/>
  <ellipse cx="${cx}" cy="${baseY - 300}" rx="150" ry="20" fill="#b9601a"/>
  <ellipse cx="${cx - 60}" cy="${baseY - 300}" rx="40" ry="8" fill="#fff" opacity="0.35"/>
  <path d="M${cx - 260},${baseY - 70} q60,24 120,6 q80,30 160,-2 q60,20 100,-4" stroke="#9c4a10" stroke-width="16" fill="none" stroke-linecap="round" opacity="0.9"/>`;
}

export function acai(cx, baseY, opts = {}) {
  const rand = rng(opts.seed ?? 91);
  const bananas = Array.from({ length: 7 }, (_, i) => {
    const x = cx - 220 + i * 40;
    const y = baseY - 250 + Math.sin(i) * 14;
    return `<ellipse cx="${x}" cy="${f(y)}" rx="30" ry="20" fill="#f7e6a8"/><ellipse cx="${x}" cy="${f(y)}" rx="8" ry="5" fill="#d6c27a"/>`;
  }).join('');
  const granola = Array.from(
    { length: 60 },
    () =>
      `<rect x="${f(cx + 20 + rand() * 180)}" y="${f(baseY - 290 + rand() * 60)}" width="${f(8 + rand() * 10)}" height="${f(6 + rand() * 6)}" rx="3" fill="${rand() > 0.5 ? '#c98a3d' : '#e8b56c'}"/>`,
  ).join('');
  return `${floorShadow(cx, baseY, 320, 44, 0.4)}
  <ellipse cx="${cx}" cy="${baseY - 250}" rx="300" ry="80" fill="#4a1a46"/>
  <path d="${blob(cx, baseY - 262, 270, 60, rand, 0.06, 18)}" fill="#5e2259"/>
  ${bananas}${granola}
  ${[0, 1, 2].map((i) => `<path d="M${cx - 60 + i * 50},${baseY - 300} c-26,-10 -24,-44 0,-44 c24,0 26,34 0,44Z" fill="#e0263b"/>`).join('')}
  <path d="M${cx - 260},${baseY - 230} q40,30 100,0 q60,30 120,0" stroke="#fff6e0" stroke-width="10" fill="none" stroke-linecap="round" opacity="0.9"/>
  <path d="M${cx - 300},${baseY - 250} Q${cx - 290},${baseY} ${cx},${baseY} Q${cx + 290},${baseY} ${cx + 300},${baseY - 250} Q${cx},${baseY - 190} ${cx - 300},${baseY - 250}Z" fill="#8a5a2b"/>
  <path d="M${cx - 300},${baseY - 250} Q${cx},${baseY - 190} ${cx + 300},${baseY - 250}" stroke="#a87444" stroke-width="10" fill="none"/>`;
}

export function milkshake(cx, baseY, s, liquid, top = '#fff7ef') {
  const g = glass(cx, baseY, s, liquid, { straw: '#e8463a', empty: 0.1 });
  const ty = baseY - 400 * s;
  return `${g}
  <path d="M${cx - 130 * s},${ty} q-20,-50 30,-60 q0,-60 60,-56 q40,-40 90,0 q60,0 50,60 q40,20 0,56Z" fill="${top}"/>
  <path d="M${cx - 80 * s},${ty - 50 * s} q60,20 140,-6" stroke="#eaded0" stroke-width="${8 * s}" fill="none"/>
  <circle cx="${cx + 10 * s}" cy="${ty - 150 * s}" r="${28 * s}" fill="#c2142b"/>
  <path d="M${cx + 10 * s},${ty - 176 * s} q10,-40 40,-50" stroke="#2f7d2a" stroke-width="${6 * s}" fill="none"/>
  <path d="M${cx - 100 * s},${ty + 10 * s} q20,40 0,80 M${cx + 90 * s},${ty + 10 * s} q-10,50 10,90" stroke="#5a2e14" stroke-width="${10 * s}" fill="none" stroke-linecap="round"/>`;
}

// ------------------------------------------------------------------------------ logo
export function logoSvg(size = 512) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f59f2a"/><stop offset="1" stop-color="#c8281e"/></linearGradient></defs>
  <rect width="512" height="512" rx="112" fill="#1d1410"/>
  <rect x="18" y="18" width="476" height="476" rx="96" fill="none" stroke="#f59f2a" stroke-opacity="0.35" stroke-width="6"/>
  ${flame(256, 218, 1.55, 'url(#lg)', '#ffd36b')}
  <text x="256" y="420" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="74" fill="#fbecd6" text-anchor="middle" letter-spacing="2">CASA</text>
  <text x="256" y="470" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="40" fill="#f59f2a" text-anchor="middle" letter-spacing="14">BRASA</text>
</svg>`;
}
