import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { DiningTable, Reservation } from './parts';
import './table-squares.css';

/** Situações que seguram a mesa (as mesmas da API: aguardando, confirmada e chegou). */
const HOLDS = new Set<Reservation['status']>(['pending', 'confirmed', 'seated']);
const MIN = 60_000;

interface Taken {
  name: string;
  time: string;
}

/**
 * Mesas que já estão com outra reserva no horário (o mesmo cruzamento que a API confere ao
 * salvar). Busca as reservas de 12 h antes a 12 h depois do horário e recalcula quando ele muda.
 */
function useTaken(startsAt: string | null, minutes: number, ignoreId?: string) {
  const [taken, setTaken] = useState<Map<string, Taken>>(new Map());
  useEffect(() => {
    const start = startsAt ? Date.parse(startsAt) : NaN;
    if (!Number.isFinite(start) || !(minutes > 0)) {
      setTaken(new Map());
      return;
    }
    let alive = true;
    const from = new Date(start - 12 * 60 * MIN).toISOString();
    const to = new Date(start + 12 * 60 * MIN).toISOString();
    api<Reservation[]>(
      `/reservations?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    )
      .then((list) => {
        if (!alive) return;
        const end = start + minutes * MIN;
        const m = new Map<string, Taken>();
        for (const r of list) {
          if (!r.tableId || r.id === ignoreId || !HOLDS.has(r.status)) continue;
          const s = Date.parse(r.startsAt);
          if (s < end && s + r.durationMinutes * MIN > start && !m.has(r.tableId))
            m.set(r.tableId, {
              name: r.name,
              time: new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            });
        }
        setTaken(m);
      })
      .catch(() => alive && setTaken(new Map()));
    return () => {
      alive = false;
    };
  }, [startsAt, minutes, ignoreId]);
  return taken;
}

/**
 * Mesas em quadradinhos, no jeito da Nova venda do PDV: nome grande, lugares e a situação no
 * horário da reserva (livre, reservada para outra pessoa ou ocupada agora). Agrupa pela área do
 * Salão. Reservada não dá para escolher (a API recusaria); mesa pequena para o grupo fica
 * avisada, mas dá (juntar mesas).
 */
export function TableSquares({
  tables,
  value,
  onPick,
  partySize,
  startsAt,
  durationMinutes,
  ignoreId,
  noneLabel,
  disabled,
  label,
}: {
  tables: DiningTable[];
  value: string | null;
  onPick(id: string | null): void;
  partySize: number;
  /** Horário da reserva (ISO); sem ele não confere as outras reservas. */
  startsAt: string | null;
  durationMinutes: number;
  /** A própria reserva (não conta como "reservada"). */
  ignoreId?: string;
  /** Quadradinho para tirar a mesa ("Sem mesa", "Escolher depois"). */
  noneLabel: string;
  disabled?: boolean;
  /** Nome do grupo para o leitor de tela. */
  label: string;
}) {
  const taken = useTaken(startsAt, durationMinutes, ignoreId);
  if (!tables.length)
    return <p className="cm-hint">Nenhuma mesa cadastrada. Crie as mesas no Salão.</p>;

  // Ocupada (comanda aberta) só importa se a reserva é agora: de 30 min antes até o fim dela.
  const start = startsAt ? Date.parse(startsAt) : NaN;
  const now = Date.now();
  const isNow =
    Number.isFinite(start) && now >= start - 30 * MIN && now <= start + durationMinutes * MIN;

  const areas: { name: string; list: DiningTable[] }[] = [];
  for (const t of tables) {
    const name = t.area?.trim() || 'Outras mesas';
    let a = areas.find((x) => x.name === name);
    if (!a) areas.push((a = { name, list: [] }));
    a.list.push(t);
  }
  const titled = areas.length > 1;

  return (
    <div className="tsq" role="radiogroup" aria-label={label}>
      <div className="tsq__grid">
        <button
          type="button"
          role="radio"
          aria-checked={!value}
          className="tsq__tbl tsq__tbl--none"
          disabled={disabled}
          onClick={() => onPick(null)}
        >
          <span className="tsq__state">{noneLabel}</span>
        </button>
      </div>
      {areas.map((a) => (
        <section key={a.name} className="tsq__area" aria-label={titled ? a.name : undefined}>
          {titled && <h4 className="tsq__title">{a.name}</h4>}
          <div className="tsq__grid">
            {a.list.map((t) => {
              const other = taken.get(t.id);
              const busy = isNow && !!t.tabId && t.id !== value;
              const small = t.seats < partySize;
              const state = other ? 'reserved' : busy ? 'busy' : 'free';
              const text = other ? `Reservada ${other.time}` : busy ? 'Ocupada agora' : 'Livre';
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={value === t.id}
                  aria-label={`Mesa ${t.label}, ${t.seats} lugares, ${text.toLowerCase()}`}
                  title={
                    other
                      ? `Reservada para ${other.name} às ${other.time}`
                      : small
                        ? `Pequena para ${partySize} pessoas`
                        : undefined
                  }
                  className="tsq__tbl"
                  data-state={state}
                  disabled={disabled || (!!other && value !== t.id)}
                  onClick={() => onPick(t.id)}
                >
                  <span className="tsq__name">{t.label}</span>
                  <span className="tsq__seats" data-small={small || undefined}>
                    {t.seats} {t.seats === 1 ? 'lugar' : 'lugares'}
                  </span>
                  <span className="tsq__state">{text}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
