/**
 * Leitura do que a IA devolve para as fotos e o 3D dos itens (funções puras, testadas em
 * item-ai.test.ts). Tudo o que vem do modelo passa por aqui antes de chegar ao navegador: números
 * presos em faixas seguras, textos curtos, nada de campo a mais.
 */
import type { Box } from './dish3d';

export interface PhotoAdjust {
  /** -0.3 a 0.3 (0 = não mexe). */
  brightness: number;
  contrast: number;
  /** -0.3 a 0.4. */
  saturation: number;
  warmth: number;
}

export interface PhotoTips {
  score: number;
  summary: string;
  tips: string[];
  adjust: PhotoAdjust;
  crop: Box | null;
  background: 'ok' | 'busy' | 'dark';
  cleanWorth: boolean;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const text = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const round = (v: number) => Math.round(v * 1000) / 1000;

/** O objeto JSON da resposta (o modelo às vezes põe ```json em volta ou texto antes). */
export function jsonOf(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(raw.slice(start, end + 1)) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Corte sugerido: só se tirar sobra de verdade e mantiver pelo menos 60% de cada lado. */
export function readCrop(v: unknown): Box | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  let x0 = clamp(num(b.x0, 0), 0, 1);
  let x1 = clamp(num(b.x1, 1), 0, 1);
  let y0 = clamp(num(b.y0, 0), 0, 1);
  let y1 = clamp(num(b.y1, 1), 0, 1);
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  if (x1 - x0 < 0.6 || y1 - y0 < 0.6) return null;
  if (x0 < 0.02 && y0 < 0.02 && x1 > 0.98 && y1 > 0.98) return null;
  return { x0: round(x0), y0: round(y0), x1: round(x1), y1: round(y1) };
}

/** Sugestão de retoque da foto, sempre leve (o modelo pode exagerar: aqui não passa). */
export function readTips(raw: Record<string, unknown> | null): PhotoTips {
  const r = raw ?? {};
  const a = (r.adjust && typeof r.adjust === 'object' ? r.adjust : {}) as Record<string, unknown>;
  const bg = r.background === 'busy' || r.background === 'dark' ? r.background : 'ok';
  const tips = Array.isArray(r.tips)
    ? r.tips
        .map((t) => text(t, 160))
        .filter(Boolean)
        .slice(0, 3)
    : [];
  return {
    score: Math.round(clamp(num(r.score, 5), 0, 10)),
    summary: text(r.summary, 200) || 'Retoque leve de luz e cor.',
    tips,
    adjust: {
      brightness: round(clamp(num(a.brightness), -0.3, 0.3)),
      contrast: round(clamp(num(a.contrast), -0.3, 0.3)),
      saturation: round(clamp(num(a.saturation), -0.3, 0.4)),
      warmth: round(clamp(num(a.warmth), -0.3, 0.3)),
    },
    crop: readCrop(r.crop),
    background: bg,
    cleanWorth: r.cleanWorth === true,
  };
}

/** A foto não é de comida: o modelo devolve kind "none" (ou nada que dê para usar). */
export const notFood = (raw: Record<string, unknown> | null) => !raw || raw.kind === 'none';
