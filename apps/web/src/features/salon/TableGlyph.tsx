import type { TableShape } from '../../lib/types';
import { chairSpots, tableTop, viewBoxOf } from './table-layout';

/**
 * Desenho minimalista da mesa vista de cima: tampo no formato cadastrado e uma cadeira por
 * lugar. As cores vêm do estado (`data-state` no elemento pai).
 */
export function TableGlyph({ shape, seats }: { shape: TableShape; seats: number }) {
  const box = viewBoxOf(shape);
  const top = tableTop(shape);
  const chairs = chairSpots(shape, seats);
  return (
    <svg
      className="tglyph"
      viewBox={`0 0 ${box.w} ${box.h}`}
      aria-hidden
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      {chairs.map((c, i) => (
        <rect
          key={i}
          className="tglyph__chair"
          x={c.x - c.w / 2}
          y={c.y - 3}
          width={c.w}
          height={6}
          rx={3}
          transform={`rotate(${c.rot} ${c.x} ${c.y})`}
          style={{ animationDelay: `${i * 30}ms` }}
        />
      ))}
      {shape === 'round' ? (
        <circle className="tglyph__top" cx={50} cy={50} r={top.w / 2} />
      ) : (
        <rect
          className="tglyph__top"
          x={top.x}
          y={top.y}
          width={top.w}
          height={top.h}
          rx={shape === 'rect' ? 12 : 10}
        />
      )}
    </svg>
  );
}
