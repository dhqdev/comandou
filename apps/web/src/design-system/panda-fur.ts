/**
 * Textura de pelo do panda: fiozinhos curtos desenhados uma vez num canvas e usados como imagem
 * dentro do SVG (imagem pronta custa quase nada para animar; filtro de ruído redesenharia a cada
 * quadro). Os fios saem do centro da cabeça para fora, como pelo de verdade.
 */
type Fur = { light: string; dark: string };
let cache: Fur | null | undefined;

function draw(color: (a: number) => string, count: number, seed: number, edge: boolean): string {
  const c = document.createElement('canvas');
  const K = 4; // pixels por unidade do viewBox 64
  c.width = c.height = 64 * K;
  const g = c.getContext('2d');
  if (!g) return '';
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  g.lineCap = 'round';
  const cx = 33 * K;
  const cy = 36 * K;
  for (let i = 0; i < count; i++) {
    const x = rnd() * c.width;
    const y = rnd() * c.height;
    const a = Math.atan2(y - cy, x - cx) + (rnd() - 0.5) * 0.7;
    // no rosto, o pelo aparece mais perto da borda e quase some no meio (rosto limpo)
    const d = Math.min(1, Math.hypot(x - cx, (y - cy) * 1.3) / (27 * K));
    const w = edge ? 0.12 + 0.88 * d * d * d : 1;
    const len = (1 + rnd() * 1.4) * K;
    g.strokeStyle = color((0.25 + rnd() * 0.75) * w);
    g.lineWidth = 0.18 * K + rnd() * 0.12 * K;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(
      x + Math.cos(a) * len * 0.5 + (rnd() - 0.5) * K * 0.4,
      y + Math.sin(a) * len * 0.5,
      x + Math.cos(a) * len,
      y + Math.sin(a) * len,
    );
    g.stroke();
  }
  return c.toDataURL('image/png');
}

/** Texturas prontas, ou null onde não há canvas (testes, navegador muito antigo). */
export function pandaFur(): Fur | null {
  if (cache !== undefined) return cache;
  cache = null;
  try {
    if (typeof document === 'undefined' || /jsdom/i.test(navigator.userAgent)) return null;
    const light = draw((a) => `rgba(130, 110, 94, ${(a * 0.3).toFixed(3)})`, 2200, 7, true);
    const dark = draw((a) => `rgba(255, 246, 236, ${(a * 0.14).toFixed(3)})`, 1400, 13, false);
    if (light && dark) cache = { light, dark };
  } catch {
    cache = null;
  }
  return cache;
}
