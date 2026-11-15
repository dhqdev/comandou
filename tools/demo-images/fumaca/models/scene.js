// Modelos 3D de exemplo da Fumaça Burger, feitos só com código (sem foto nem escaneamento de
// terceiros): roda no Chromium, chamado por build.mjs. Medidas em metros, base apoiada em y = 0,
// para "Ver na minha mesa" mostrar o prato do tamanho real.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const CM = 0.01;

// ---------- aleatório e ruído determinísticos (o mesmo arquivo a cada execução) ----------
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const rr = (a, b) => a + (b - a) * rand();
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    xf = x - xi,
    yf = y - yi;
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi),
    b = hash(xi + 1, yi),
    c = hash(xi, yi + 1),
    d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, o = 4) => {
  let s = 0,
    a = 0.5,
    f = 1;
  for (let i = 0; i < o; i++) ((s += a * vnoise(x * f, y * f)), (a *= 0.5), (f *= 2));
  return s;
};
// ruído que fecha a volta em u (para texturas que dão a volta no objeto)
const fbmU = (u, v, freq, o = 4) => {
  const t = u * Math.PI * 2;
  return fbm(Math.cos(t) * freq * 0.32 + 10, v * freq + Math.sin(t) * freq * 0.32, o);
};

// ---------- texturas pintadas pixel a pixel ----------
const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.min(1, Math.max(0, t)));
function paint(size, fn, { alpha = false, h = size } = {}) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(size, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < size; x++) {
      const [r, gg, b, a = 255] = fn(x / (size - 1), 1 - y / (h - 1));
      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = gg;
      img.data[i + 2] = b;
      img.data[i + 3] = a;
    }
  g.putImageData(img, 0, 0);
  return texture(c, alpha);
}
function texture(canvas, alpha = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.mimeType = alpha ? 'image/png' : 'image/jpeg';
  t.anisotropy = 4;
  return t;
}
const mat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0, ...o });

// ---------- burger: Fumaça (o da casa) ----------
function lathe(points, segs = 72) {
  return new THREE.LatheGeometry(
    points.map(([x, y]) => new THREE.Vector2(x * CM, y * CM)),
    segs,
  );
}
// v da LatheGeometry cresce por índice de ponto: devolve o v de cada ponto
const vAt = (i, n) => i / (n - 1);

function burger() {
  const g = new THREE.Group();
  const crumb = hex('#EAD3A6'),
    crust = hex('#8F3E0A'),
    dark = hex('#5A2206'),
    gold = hex('#C06A1E');

  // pão de baixo: lado tostado, face cortada (em cima) clara
  const bb = [
    [0, 0],
    [4.6, 0],
    [5.1, 0.25],
    [5.35, 0.8],
    [5.4, 1.4],
    [5.3, 1.9],
    [5.05, 2.15],
    [0, 2.15],
  ];
  const bbCut = vAt(bb.length - 2, bb.length);
  const bottom = new THREE.Mesh(
    lathe(bb),
    mat({
      map: paint(512, (u, v) => {
        if (v > bbCut + 0.01) return mix(crumb, hex('#D9B57E'), fbmU(u, v, 18) * 0.9 - 0.1);
        const n = fbmU(u, v, 9);
        return mix(mix(crust, gold, v * 0.8), dark, n * 0.5 - 0.05);
      }),
      roughness: 0.75,
    }),
  );
  g.add(bottom);

  // carne: disco irregular, crosta escura e marcas de brasa
  const pg = new THREE.CylinderGeometry(5.6 * CM, 5.5 * CM, 1.5 * CM, 96, 6);
  const p = pg.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-6) continue;
    const t = Math.atan2(z, x);
    const k = 1 + (fbm(Math.cos(t) * 2 + 3, Math.sin(t) * 2 + y * 90) - 0.5) * 0.09;
    p.setX(i, x * k);
    p.setZ(i, z * k);
    p.setY(i, y + (fbm(x * 80, z * 80) - 0.5) * 0.35 * CM * Math.min(1, r / (4 * CM)));
  }
  pg.computeVertexNormals();
  const patty = new THREE.Mesh(
    pg,
    mat({
      map: paint(512, (u, v) => {
        const n = fbm(u * 70, v * 9, 5);
        const char = fbm(u * 140 + 5, v * 18, 3);
        let c = mix(hex('#5A2E19'), hex('#2B140B'), n * 1.2 - 0.2);
        if (char > 0.62) c = mix(c, hex('#140906'), (char - 0.62) * 4);
        if (n > 0.66) c = mix(c, hex('#8C4A26'), (n - 0.66) * 3);
        return c;
      }),
      roughness: 0.85,
    }),
  );
  patty.position.y = 2.75 * CM;
  g.add(patty);

  // cheddar: fatia quadrada derretendo pelas quinas
  const cg = new THREE.BoxGeometry(10.4 * CM, 0.22 * CM, 10.4 * CM, 40, 1, 40);
  const cp = cg.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i),
      z = cp.getZ(i);
    const r = Math.hypot(x, z) / CM;
    const over = Math.max(0, r - 5.0);
    const wob = (fbm(x * 40, z * 40) - 0.5) * 0.4;
    cp.setY(i, cp.getY(i) - (Math.pow(over, 1.7) * 0.55 + over * wob) * CM);
    // a quina que cai encolhe um pouco, como queijo escorrendo
    const s = 1 - over * 0.05;
    cp.setX(i, x * s);
    cp.setZ(i, z * s);
  }
  cg.computeVertexNormals();
  const cheese = new THREE.Mesh(
    cg,
    new THREE.MeshPhysicalMaterial({
      color: '#F29A12',
      roughness: 0.3,
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
    }),
  );
  cheese.position.y = 3.62 * CM;
  cheese.rotation.y = Math.PI / 4 + 0.15;
  g.add(cheese);

  // bacon: duas tiras onduladas com listras de gordura
  const baconTex = paint(256, (u, v) => {
    const band = Math.sin(v * Math.PI * 3 + fbm(u * 6, v * 3) * 4);
    let c =
      band > 0.55
        ? mix(hex('#D9A07E'), hex('#B86A45'), fbm(u * 10, v * 10))
        : mix(hex('#7A2412'), hex('#4E160A'), fbm(u * 20, v * 6));
    return mix(c, hex('#3A1208'), fbm(u * 40 + 3, v * 40) > 0.68 ? 0.6 : 0);
  });
  for (const [ang, off, ph] of [
    [0.35, -1.1, 0],
    [-0.25, 1.2, 1.7],
  ]) {
    const bg = new THREE.BoxGeometry(11 * CM, 0.2 * CM, 2.5 * CM, 60, 1, 6);
    const bp = bg.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i) / CM,
        z = bp.getZ(i) / CM;
      bp.setY(
        i,
        bp.getY(i) +
          (Math.sin(x * 1.3 + ph) * 0.32 +
            Math.sin(z * 2 + x) * 0.06 -
            Math.max(0, Math.abs(x) - 4.5) * 0.5) *
            CM,
      );
    }
    bg.computeVertexNormals();
    const b = new THREE.Mesh(bg, mat({ map: baconTex, roughness: 0.55 }));
    b.position.set(0, 4.05 * CM, off * CM);
    b.rotation.y = ang;
    g.add(b);
  }

  // barbecue defumado brilhante
  const sg = new THREE.CylinderGeometry(4.4 * CM, 4.4 * CM, 0.14 * CM, 64, 1);
  const sp = sg.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i),
      z = sp.getZ(i);
    const t = Math.atan2(z, x);
    const k = 1 + (fbm(Math.cos(t) * 3 + 1, Math.sin(t) * 3) - 0.5) * 0.35;
    sp.setX(i, x * k);
    sp.setZ(i, z * k);
  }
  sg.computeVertexNormals();
  const sauce = new THREE.Mesh(
    sg,
    new THREE.MeshPhysicalMaterial({ color: '#4E150A', roughness: 0.12, clearcoat: 1 }),
  );
  sauce.position.y = 4.42 * CM;
  g.add(sauce);

  // cebola crispy
  const rings = [];
  for (let i = 0; i < 22; i++) {
    const t = new THREE.TorusGeometry(rr(0.35, 0.6) * CM, rr(0.1, 0.14) * CM, 6, 14, rr(3, 6.2));
    t.rotateX(rr(0, Math.PI));
    t.rotateY(rr(0, Math.PI));
    const a = rr(0, Math.PI * 2),
      d = Math.sqrt(rand()) * 4.2;
    t.translate(Math.cos(a) * d * CM, (4.6 + rr(0, 0.35)) * CM, Math.sin(a) * d * CM);
    rings.push(t);
  }
  g.add(new THREE.Mesh(mergeGeometries(rings), mat({ color: '#B4651F', roughness: 0.8 })));

  // pão de cima: brioche brilhante com gergelim
  const tb = [
    [0, 0],
    [4.9, 0],
    [5.35, 0.25],
    [5.6, 0.85],
    [5.55, 1.6],
    [5.25, 2.4],
    [4.6, 3.15],
    [3.6, 3.75],
    [2.4, 4.12],
    [1.2, 4.3],
    [0, 4.36],
  ];
  const top = new THREE.Mesh(
    lathe(tb),
    new THREE.MeshPhysicalMaterial({
      map: paint(512, (u, v) => {
        if (v < vAt(1, tb.length) - 0.01) return mix(crumb, hex('#D9B57E'), fbmU(u, v, 18));
        const n = fbmU(u, v, 7);
        const base = mix(gold, crust, Math.pow(v, 0.8) * 1.15);
        return mix(base, dark, n * 0.55 - 0.1);
      }),
      roughness: 0.42,
      clearcoat: 0.35,
      clearcoatRoughness: 0.5,
    }),
  );
  top.position.y = 4.7 * CM;
  g.add(top);

  // gergelim espalhado na cúpula
  const seedGeo = new THREE.SphereGeometry(1, 8, 6);
  seedGeo.scale(0.2 * CM, 0.07 * CM, 0.11 * CM);
  const seeds = [];
  const curve = tb.slice(3);
  for (let i = 0; i < 70; i++) {
    const s = rand() * (curve.length - 1.6) + 0.4;
    const j = Math.floor(s),
      f = s - j;
    const [x0, y0] = curve[j],
      [x1, y1] = curve[j + 1];
    const r = x0 + (x1 - x0) * f,
      y = y0 + (y1 - y0) * f;
    const a = rand() * Math.PI * 2;
    const m = new THREE.Object3D();
    m.position.set(Math.cos(a) * r * CM, (y + 4.7 + 0.03) * CM, Math.sin(a) * r * CM);
    const nrm = new THREE.Vector3(
      Math.cos(a) * (y1 - y0) * -1,
      x1 - x0,
      Math.sin(a) * (y1 - y0) * -1,
    ).normalize();
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
    m.rotateY(rr(0, Math.PI));
    m.updateMatrix();
    seeds.push(seedGeo.clone().applyMatrix4(m.matrix));
  }
  g.add(new THREE.Mesh(mergeGeometries(seeds), mat({ color: '#F4E3BB', roughness: 0.6 })));
  return g;
}

// ---------- batata frita no copo da casa ----------
async function fries() {
  const g = new THREE.Group();
  await document.fonts.load('80px Anton');
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#B81F17';
  x.fillRect(0, 0, 1024, 512);
  x.fillStyle = '#F3E7D6';
  x.fillRect(0, 70, 1024, 10);
  x.fillRect(0, 430, 1024, 10);
  x.font = '120px Anton';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  for (const cx of [256, 768]) x.fillText('FUMAÇA', cx, 262);
  const cupTex = texture(c);
  // o "v" do canvas cresce para baixo; a parede externa vai do índice 1 ao 2 do perfil
  const prof = [
    [0, 0],
    [3.0, 0],
    [4.3, 10],
    [4.12, 10],
    [2.85, 0.18],
    [0, 0.18],
  ];
  const geo = lathe(prof, 64);
  // remapeia o v da parede externa para a textura inteira
  const uv = geo.attributes.uv,
    pos = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    const y = pos.getY(i) / CM,
      rad = Math.hypot(pos.getX(i), pos.getZ(i)) / CM;
    const outer = rad >= 3.0 + (y / 10) * 1.3 - 0.05;
    uv.setY(i, outer ? y / 10 : 0.02);
  }
  const cup = new THREE.Mesh(geo, mat({ map: cupTex, roughness: 0.6, side: THREE.DoubleSide }));
  g.add(cup);

  const fryTex = paint(128, (u, v) => {
    const n = fbm(u * 6, v * 30, 3);
    const end = Math.max(0, Math.abs(v - 0.5) * 2 - 0.82) * 5;
    return mix(mix(hex('#EDB045'), hex('#C77A22'), n * 1.2), hex('#8A4A14'), end);
  });
  const sticks = [];
  for (let i = 0; i < 64; i++) {
    const L = rr(8, 12.5);
    const b = new THREE.BoxGeometry(0.72 * CM, L * CM, 0.72 * CM, 1, 4, 1);
    const p = b.attributes.position;
    for (let k = 0; k < p.count; k++) p.setX(k, p.getX(k) + Math.sin(p.getY(k) * 40) * 0.08 * CM);
    const a = rand() * Math.PI * 2,
      d = Math.sqrt(rand()) * 2.2;
    const m = new THREE.Object3D();
    m.position.set(Math.cos(a) * d * CM, (L / 2 + rr(1.0, 3.6)) * CM, Math.sin(a) * d * CM);
    m.rotation.set(
      rr(-0.12, 0.12) + Math.sin(a) * d * 0.06,
      rr(0, Math.PI),
      rr(-0.12, 0.12) - Math.cos(a) * d * 0.06,
    );
    m.updateMatrix();
    sticks.push(b.applyMatrix4(m.matrix));
  }
  g.add(new THREE.Mesh(mergeGeometries(sticks), mat({ map: fryTex, roughness: 0.62 })));
  return g;
}

// ---------- milk-shake de chocolate ----------
function shake() {
  const g = new THREE.Group();
  const glassProf = [
    [0, 0],
    [3.1, 0],
    [3.2, 0.5],
    [2.7, 1.0],
    [2.55, 2.0],
    [2.9, 6],
    [3.95, 15.5],
    [3.8, 15.5],
    [2.75, 6.1],
    [2.4, 2.1],
    [2.3, 1.2],
    [0, 1.2],
  ];
  const glass = new THREE.Mesh(
    lathe(glassProf, 72),
    new THREE.MeshPhysicalMaterial({
      color: '#FFFFFF',
      roughness: 0.04,
      transmission: 1,
      thickness: 0.002,
      ior: 1.5,
      transparent: true,
      opacity: 0.35,
    }),
  );
  g.add(glass);

  const choc = paint(256, (u, v) => {
    const streak = fbmU(u, v, 5, 3);
    let c = mix(hex('#8A5233'), hex('#6A3A20'), streak);
    // calda escorrendo pela parede do copo
    const drip = Math.sin(u * Math.PI * 2 * 7 + fbmU(u, v, 3) * 3);
    if (drip > 0.7 && v > 0.2 + fbmU(u, 0, 4) * 0.5) c = mix(c, hex('#2A0F06'), 0.85);
    return c;
  });
  const liquid = new THREE.Mesh(
    lathe(
      [
        [0, 1.25],
        [2.3, 1.25],
        [2.7, 6],
        [3.72, 14.6],
        [0, 14.6],
      ],
      72,
    ),
    mat({ map: choc, roughness: 0.3 }),
  );
  g.add(liquid);

  // chantilly em espiral
  const cream = lathe(
    [
      [0, 14.5],
      [3.75, 14.5],
      [3.95, 15.2],
      [3.7, 16.1],
      [3.0, 16.6],
      [3.15, 17.3],
      [2.5, 18.0],
      [1.9, 18.4],
      [1.8, 19.1],
      [1.0, 19.8],
      [0.4, 20.3],
      [0, 20.5],
    ],
    96,
  );
  const cp = cream.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i),
      y = cp.getY(i),
      z = cp.getZ(i);
    const t = Math.atan2(z, x);
    const k = 1 + Math.sin(t * 6 + y * 520) * 0.07;
    cp.setX(i, x * k);
    cp.setZ(i, z * k);
  }
  cream.computeVertexNormals();
  g.add(new THREE.Mesh(cream, mat({ color: '#FBF5EC', roughness: 0.8 })));

  // raspas de chocolate e cereja
  const flakes = [];
  for (let i = 0; i < 40; i++) {
    const b = new THREE.BoxGeometry(0.35 * CM, 0.08 * CM, 0.2 * CM);
    const h = rr(15.8, 19.8),
      a = rand() * Math.PI * 2;
    const r = Math.max(0.3, 3.3 - (h - 15.8) * 0.7);
    b.rotateY(rr(0, 3));
    b.rotateX(rr(-0.5, 0.5));
    b.translate(Math.cos(a) * r * CM, h * CM, Math.sin(a) * r * CM);
    flakes.push(b);
  }
  g.add(new THREE.Mesh(mergeGeometries(flakes), mat({ color: '#2E1408', roughness: 0.5 })));
  const cherry = new THREE.Mesh(
    new THREE.SphereGeometry(0.95 * CM, 32, 24),
    new THREE.MeshPhysicalMaterial({ color: '#A90E1C', roughness: 0.18, clearcoat: 1 }),
  );
  cherry.position.set(0, 21.2 * CM, 0);
  g.add(cherry);
  const stem = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 22 * CM, 0),
        new THREE.Vector3(0.3 * CM, 23.5 * CM, 0),
        new THREE.Vector3(1.2 * CM, 24.4 * CM, 0),
      ),
      12,
      0.08 * CM,
      6,
    ),
    mat({ color: '#5B4A1E' }),
  );
  g.add(stem);

  // canudo listrado
  const strawTex = paint(256, (u, v) =>
    Math.sin((u * 2 + v * 6) * Math.PI * 2) > 0 ? hex('#C8211B') : hex('#F7F1E8'),
  );
  const straw = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38 * CM, 0.38 * CM, 22 * CM, 24, 1, true),
    mat({ map: strawTex, roughness: 0.4, side: THREE.DoubleSide }),
  );
  straw.position.set(1.2 * CM, 15.5 * CM, 0.4 * CM);
  straw.rotation.z = -0.22;
  g.add(straw);
  return g;
}

// ---------- brownie com sorvete ----------
function brownie() {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(
    lathe(
      [
        [0, 0],
        [6.5, 0],
        [6.8, 0.3],
        [9.4, 0.7],
        [10, 1.3],
        [9.85, 1.36],
        [9.2, 0.95],
        [6.6, 0.62],
        [0, 0.62],
      ],
      96,
    ),
    mat({ color: '#2A2A2E', roughness: 0.35 }),
  );
  g.add(plate);

  // calda no prato
  const pd = new THREE.CircleGeometry(5.2 * CM, 64);
  const pp = pd.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i),
      y = pp.getY(i);
    const t = Math.atan2(y, x);
    const k = 1 + (fbm(Math.cos(t) * 2.5 + 7, Math.sin(t) * 2.5) - 0.5) * 0.5;
    pp.setX(i, x * k);
    pp.setY(i, y * k);
  }
  pd.rotateX(-Math.PI / 2);
  const puddle = new THREE.Mesh(
    pd,
    new THREE.MeshPhysicalMaterial({ color: '#2A0F06', roughness: 0.1, clearcoat: 1 }),
  );
  puddle.position.set(0.6 * CM, 0.66 * CM, 0.4 * CM);
  g.add(puddle);

  // o brownie: bloco com quinas suaves e casquinha rachada por cima
  const bgeo = new RoundedBoxGeometry(7 * CM, 3.2 * CM, 7 * CM, 6, 0.45 * CM);
  const bp = bgeo.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i),
      y = bp.getY(i),
      z = bp.getZ(i);
    const n = (fbm(x * 90 + 2, z * 90 + y * 50) - 0.5) * 0.25 * CM;
    bp.setX(i, x + n * Math.sign(x) * 0.6);
    bp.setZ(i, z + n * Math.sign(z) * 0.6);
    if (y > 0) bp.setY(i, y + n * 0.8);
  }
  bgeo.computeVertexNormals();
  const bTex = paint(512, (u, v) => {
    const n = fbm(u * 18, v * 18, 5);
    const crack = Math.abs(fbm(u * 9 + 4, v * 9, 4) - 0.5);
    let c = mix(hex('#4A2615'), hex('#2C150A'), n);
    if (crack < 0.03) c = mix(c, hex('#1A0B05'), 0.8);
    if (fbm(u * 50, v * 50, 2) > 0.7) c = mix(c, hex('#6B3A20'), 0.6);
    return c;
  });
  const b = new THREE.Mesh(bgeo, mat({ map: bTex, roughness: 0.72 }));
  b.position.y = (0.62 + 1.6) * CM;
  b.rotation.y = 0.35;
  g.add(b);

  // bola de sorvete de creme
  const top = 0.62 + 3.2;
  const sgeo = new THREE.SphereGeometry(2.7 * CM, 64, 48);
  const sp = sgeo.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i),
      y = sp.getY(i),
      z = sp.getZ(i);
    const n = 1 + (fbm(x * 70 + 9, y * 70 + z * 70) - 0.5) * 0.12;
    let ny = y * 0.86 * n;
    if (ny < -1.3 * CM) ny = -1.3 * CM + (ny + 1.3 * CM) * 0.15;
    sp.setX(i, x * n);
    sp.setY(i, ny);
    sp.setZ(i, z * n);
  }
  sgeo.computeVertexNormals();
  const scoop = new THREE.Mesh(
    sgeo,
    mat({
      map: paint(256, (u, v) => {
        let c = mix(hex('#FBF1DC'), hex('#EADBB8'), fbm(u * 20, v * 20));
        if (fbm(u * 80, v * 80, 2) > 0.72) c = mix(c, hex('#2A1A10'), 0.7);
        return c;
      }),
      roughness: 0.82,
    }),
  );
  scoop.position.y = (top + 1.2) * CM;
  g.add(scoop);
  const lip = new THREE.Mesh(
    new THREE.TorusGeometry(2.45 * CM, 0.32 * CM, 12, 64),
    mat({ color: '#F5E8CC', roughness: 0.85 }),
  );
  lip.rotation.x = Math.PI / 2;
  lip.position.y = (top + 0.05) * CM;
  g.add(lip);

  // calda de chocolate por cima da bola, escorrendo
  const sauceTex = paint(
    512,
    (u, v) => {
      const drip =
        0.66 -
        Math.pow(Math.max(0, Math.sin(u * Math.PI * 2 * 5 + fbm(u * 6, 1) * 4)), 6) * 0.3 -
        fbm(u * 12, 3) * 0.06;
      const on = v > drip;
      return [...hex('#2A0E05'), on ? 255 : 0];
    },
    { alpha: true },
  );
  const sauce = new THREE.Mesh(
    sgeo.clone().scale(1.025, 1.03, 1.025),
    new THREE.MeshPhysicalMaterial({
      map: sauceTex,
      alphaTest: 0.5,
      roughness: 0.1,
      clearcoat: 1,
      color: '#FFFFFF',
    }),
  );
  sauce.position.copy(scoop.position);
  g.add(sauce);

  // folhinhas de hortelã
  for (const [a, rz] of [
    [0.4, 0.5],
    [-0.5, -0.4],
  ]) {
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 8),
      mat({ color: '#3E8A2E', roughness: 0.5 }),
    );
    leaf.scale.set(0.9 * CM, 0.12 * CM, 0.45 * CM);
    leaf.position.set(Math.cos(a) * 0.6 * CM, (top + 3.6) * CM, Math.sin(a) * 0.6 * CM);
    leaf.rotation.set(0.3, a * 3, rz);
    g.add(leaf);
  }
  return g;
}

export const builders = { burger, fries, shake, brownie };

export async function exportModel(name) {
  seed = 7;
  const obj = await builders[name]();
  const scene = new THREE.Scene();
  scene.add(obj);
  scene.updateMatrixWorld(true);
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, maxTextureSize: 1024 });
  const usdz = await new USDZExporter().parseAsync(scene, { maxTextureSize: 512 });
  return { glb: new Uint8Array(glb), usdz, obj };
}

/** Foto de conferência (só para quem gera os modelos olhar o resultado). */
export async function preview(name, w = 640, h = 640) {
  seed = 7;
  const obj = await builders[name]();
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#EDE7DF');
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const sun = new THREE.DirectionalLight('#ffffff', 1.4);
  sun.position.set(1, 2, 1.2);
  scene.add(sun, obj);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()),
    center = box.getCenter(new THREE.Vector3());
  const d = Math.max(size.x, size.y, size.z) * 1.9;
  const cam = new THREE.PerspectiveCamera(35, w / h, 0.001, 10);
  cam.position.set(center.x + d * 0.75, center.y + d * 0.45, center.z + d * 0.75);
  cam.lookAt(center);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.domElement.remove();
  return url;
}
