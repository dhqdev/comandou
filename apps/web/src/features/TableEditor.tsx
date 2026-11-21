import { GripVertical, LayoutGrid, Minus, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, EmptyState, Modal, TextField, useToast, Skeleton } from '../design-system';
import { api } from '../lib/api';
import type { DiningTable, TableShape } from '../lib/types';
import './table-editor.css';

export const SHAPE_LABEL: Record<TableShape, string> = {
  square: 'Quadrada',
  round: 'Redonda',
  rect: 'Retangular',
};
const SHAPES: TableShape[] = ['square', 'round', 'rect'];
const NO_AREA = 'Salão principal';

/** Pontos (x, y) das cadeiras em volta do tampo, num desenho de 120 × 120. */
function chairs(shape: TableShape, seats: number): [number, number][] {
  const n = Math.min(seats, 16);
  if (shape === 'round') {
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return [60 + Math.cos(a) * 46, 60 + Math.sin(a) * 46];
    });
  }
  // Cada lado recebe cadeiras em rodízio; a retangular senta nos lados compridos primeiro.
  const [x0, y0, x1, y1] = shape === 'rect' ? [16, 38, 104, 82] : [32, 32, 88, 88];
  const sides =
    shape === 'rect'
      ? n > 8
        ? ['top', 'bottom', 'top', 'bottom', 'left', 'right']
        : ['top', 'bottom']
      : ['top', 'bottom', 'left', 'right'];
  const per: Record<string, number> = { top: 0, bottom: 0, left: 0, right: 0 };
  for (let i = 0; i < n; i++) per[sides[i % sides.length]!]! += 1;
  if (shape === 'rect' && n > 8) {
    // nas pontas, no máximo uma cadeira de cada lado
    const extra = per.left! + per.right! - 2;
    if (extra > 0) {
      per.left = 1;
      per.right = 1;
      per.top! += Math.ceil(extra / 2);
      per.bottom! += Math.floor(extra / 2);
    }
  }
  const out: [number, number][] = [];
  const spread = (k: number, a: number, b: number) =>
    Array.from({ length: k }, (_, i) => a + ((b - a) * (i + 1)) / (k + 1));
  for (const x of spread(per.top!, x0, x1)) out.push([x, y0 - 12]);
  for (const x of spread(per.bottom!, x0, x1)) out.push([x, y1 + 12]);
  for (const y of spread(per.left!, y0, y1)) out.push([x0 - 12, y]);
  for (const y of spread(per.right!, y0, y1)) out.push([x1 + 12, y]);
  return out;
}

/** Largura útil do tampo para o nome, em unidades do desenho. */
const maxText = (shape: TableShape) => (shape === 'rect' ? 76 : shape === 'round' ? 52 : 46);

/** Desenho da mesa vista de cima: tampo no formato escolhido e uma cadeira por lugar. */
export function TableDrawing({
  shape,
  seats,
  label,
  size = 96,
}: {
  shape: TableShape;
  seats: number;
  label?: string;
  size?: number;
}) {
  return (
    <svg
      className="te-drawing"
      viewBox="0 0 120 120"
      width={size}
      height={size}
      aria-hidden
      data-shape={shape}
    >
      {chairs(shape, seats).map(([x, y], i) => (
        <circle key={i} className="te-drawing__chair" cx={x} cy={y} r={7} />
      ))}
      {shape === 'round' ? (
        <circle className="te-drawing__top" cx={60} cy={60} r={32} />
      ) : shape === 'rect' ? (
        <rect className="te-drawing__top" x={16} y={38} width={88} height={44} rx={10} />
      ) : (
        <rect className="te-drawing__top" x={32} y={32} width={56} height={56} rx={10} />
      )}
      {label && (
        <text
          className="te-drawing__label"
          x={60}
          y={60}
          dominantBaseline="central"
          // Nome comprido encolhe para caber no tampo; muito comprido, corta.
          fontSize={label.length <= 2 ? 24 : label.length === 3 ? 20 : 16}
          {...(label.length > 3 && {
            textLength: Math.min(label.length > 5 ? 5 * 10 : label.length * 10, maxText(shape)),
            lengthAdjust: 'spacingAndGlyphs',
          })}
        >
          {label.length > 5 ? `${label.slice(0, 4)}…` : label}
        </text>
      )}
    </svg>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(v: number): void;
  suffix?: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="cm-field">
      <span className="cm-label">{label}</span>
      <div className="te-stepper">
        <button
          type="button"
          aria-label={`Menos ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(clamp(value - 1))}
        >
          <Minus size={18} />
        </button>
        <label className="te-stepper__value">
          <input
            inputMode="numeric"
            aria-label={label}
            value={value}
            onChange={(e) => onChange(clamp(Number(e.target.value.replace(/\D/g, '')) || min))}
            onFocus={(e) => e.target.select()}
          />
          {suffix && <span>{suffix}</span>}
        </label>
        <button
          type="button"
          aria-label={`Mais ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(clamp(value + 1))}
        >
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}

function ShapePicker({ value, onChange }: { value: TableShape; onChange(s: TableShape): void }) {
  return (
    <div className="cm-field">
      <span className="cm-label">Formato</span>
      <div className="te-shapes" role="radiogroup" aria-label="Formato da mesa">
        {SHAPES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={value === s}
            className="te-shape"
            onClick={() => onChange(s)}
          >
            <TableDrawing shape={s} seats={s === 'rect' ? 6 : 4} size={52} />
            <span>{SHAPE_LABEL[s]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AreaField({
  value,
  onChange,
  areas,
}: {
  value: string;
  onChange(v: string): void;
  areas: string[];
}) {
  return (
    <div className="te-area">
      <TextField
        label="Área do salão"
        placeholder={`Ex.: Varanda, Mezanino (vazio = ${NO_AREA.toLowerCase()})`}
        value={value}
        maxLength={40}
        onChange={(e) => onChange(e.target.value)}
      />
      {areas.length > 0 && (
        <div className="chips">
          {areas.map((a) => (
            <button
              key={a}
              type="button"
              className="chip"
              aria-pressed={value.trim().toLowerCase() === a.toLowerCase()}
              onClick={() => onChange(a)}
            >
              {a}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Notebook e computador: salão e formulário lado a lado. Abaixo disso, um de cada vez. */
const WIDE = '(min-width: 901px)';
function useWide() {
  const [wide, setWide] = useState(
    () => typeof matchMedia === 'function' && matchMedia(WIDE).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(WIDE);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

type Panel = { kind: 'add' } | { kind: 'edit'; table: DiningTable };

/**
 * Editor visual do salão: cria várias mesas de uma vez, desenha cada mesa com o formato e as
 * cadeiras, agrupa por área e deixa arrastar para mudar a ordem do mapa.
 *
 * Nada de janela por cima de janela: no notebook o salão fica à esquerda e o formulário (adicionar
 * mesas ou a mesa tocada) num painel fixo à direita; no celular o formulário ocupa a folha, com
 * Voltar no rodapé.
 */
export function TableEditor({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose(): void;
  onChanged?(): void;
}) {
  const toast = useToast();
  const wide = useWide();
  const [tables, setTables] = useState<DiningTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await api<DiningTable[]>('/tables');
      setTables(
        t.sort(
          (a, b) =>
            (a.position ?? 0) - (b.position ?? 0) ||
            a.label.localeCompare(b.label, 'pt-BR', { numeric: true }),
        ),
      );
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (open) {
      setPanel(null);
      void load();
    }
  }, [open, load]);

  const changed = () => {
    void load();
    onChanged?.();
  };

  const active = (tables ?? []).filter((t) => t.active);
  const inactive = (tables ?? []).filter((t) => !t.active);
  const areas = useMemo(
    () =>
      [...new Set((tables ?? []).map((t) => t.area?.trim()).filter(Boolean) as string[])].sort(
        (a, b) => a.localeCompare(b, 'pt-BR'),
      ),
    [tables],
  );
  const groups = useMemo(() => {
    const m = new Map<string, DiningTable[]>();
    for (const t of active) {
      const k = t.area?.trim() || NO_AREA;
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()];
  }, [active]);
  const seats = active.reduce((s, t) => s + t.seats, 0);

  // No notebook o painel nunca fica vazio: sem mesa escolhida, mostra Adicionar mesas.
  const view: Panel | null = panel ?? (wide && tables !== null ? { kind: 'add' } : null);
  const editing = view?.kind === 'edit' ? view.table : null;

  const add = useAddForm({
    open: open && view?.kind === 'add',
    tables: tables ?? [],
    areas,
    onCreated(n) {
      toast(n === 1 ? '1 mesa criada' : `${n} mesas criadas`, 'success');
      if (!wide) setPanel(null);
      changed();
    },
  });
  const edit = useEditForm({
    table: editing,
    areas,
    onSaved(msg) {
      toast(msg, 'success');
      setPanel(null);
      changed();
    },
  });
  const form = view?.kind === 'edit' ? edit : view ? add : null;

  /** Solta a mesa arrastada no lugar de outra e grava a nova ordem. */
  async function drop(targetId: string) {
    if (!tables || !dragId || dragId === targetId) return;
    const ids = tables.map((t) => t.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    const target = tables.find((t) => t.id === targetId);
    const moved = tables.find((t) => t.id === dragId);
    setTables(ids.map((id, i) => ({ ...tables.find((t) => t.id === id)!, position: i })));
    setDragId(null);
    try {
      // Arrastar para outra área leva a mesa junto para aquela área.
      if (moved && target && (moved.area ?? '') !== (target.area ?? ''))
        await api(`/tables/${moved.id}`, { method: 'PATCH', json: { area: target.area } });
      await api('/tables/order', { method: 'POST', json: { ids } });
      changed();
    } catch (e) {
      toast((e as Error).message, 'danger');
      void load();
    }
  }

  const openAdd = () => setPanel({ kind: 'add' });
  const empty = tables !== null && active.length === 0;

  let footer: ReactNode;
  if (!wide && form)
    footer = (
      <>
        <Button variant="secondary" size="lg" onClick={() => setPanel(null)}>
          Voltar
        </Button>
        {form.action}
      </>
    );
  else if (!wide)
    footer = (
      <>
        <Button variant="secondary" size="lg" onClick={onClose}>
          Concluir
        </Button>
        <Button size="lg" icon={<Plus size={18} />} onClick={openAdd}>
          Adicionar mesas
        </Button>
      </>
    );
  else
    footer = (
      <>
        <Button variant="secondary" size="lg" className="te-done" onClick={onClose}>
          Concluir
        </Button>
        {form?.action}
      </>
    );

  const map = (
    <div className="te-map">
      {error && <Alert tone="danger">{error}</Alert>}
      {tables === null ? (
        <Skeleton variant="grid" />
      ) : empty ? (
        <EmptyState
          icon={<LayoutGrid size={20} />}
          title="Seu salão ainda está vazio"
          description={
            wide
              ? 'Diga ao lado quantas mesas você tem e o Comandou cria todas de uma vez.'
              : 'Diga quantas mesas você tem e o Comandou cria todas de uma vez.'
          }
        />
      ) : (
        <>
          <div className="te-stats">
            <div>
              <strong>{active.length}</strong> {active.length === 1 ? 'mesa' : 'mesas'}
            </div>
            <div>
              <strong>{seats}</strong> {seats === 1 ? 'lugar' : 'lugares'}
            </div>
            <div>
              <strong>{groups.length}</strong> {groups.length === 1 ? 'área' : 'áreas'}
            </div>
            <p className="te-tip">
              {wide
                ? 'Clique numa mesa para editar. Arraste para mudar a ordem.'
                : 'Toque numa mesa para editar.'}
            </p>
          </div>
          {groups.map(([area, list]) => (
            <section key={area} className="te-group">
              <header>
                <h3>{area}</h3>
                <span>
                  {list.length} {list.length === 1 ? 'mesa' : 'mesas'} ·{' '}
                  {list.reduce((s, t) => s + t.seats, 0)} lugares
                </span>
              </header>
              <div className="te-grid">
                {list.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="te-card"
                    data-shape={t.shape}
                    data-dragging={dragId === t.id || undefined}
                    aria-current={editing?.id === t.id || undefined}
                    draggable={wide}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      setDragId(t.id);
                    }}
                    onDragEnd={() => setDragId(null)}
                    onDragOver={(e) => {
                      if (dragId) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      void drop(t.id);
                    }}
                    onClick={() => setPanel({ kind: 'edit', table: t })}
                    aria-label={`Editar mesa ${t.label}, ${t.seats} lugares, ${SHAPE_LABEL[t.shape].toLowerCase()}`}
                  >
                    {wide && <GripVertical size={14} className="te-card__grip" aria-hidden />}
                    {t.tabId && <span className="te-card__busy" title="Com comanda aberta" />}
                    <TableDrawing shape={t.shape} seats={t.seats} label={t.label} size={72} />
                    <span className="te-card__name">Mesa {t.label}</span>
                    <span className="te-card__meta">
                      {t.seats} {t.seats === 1 ? 'lugar' : 'lugares'}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
      {inactive.length > 0 && (
        <section className="te-group te-group--off">
          <header>
            <h3>Desativadas</h3>
            <span>Não aparecem no salão nem no QR</span>
          </header>
          <div className="chips">
            {inactive.map((t) => (
              <button
                key={t.id}
                type="button"
                className="chip"
                aria-pressed={editing?.id === t.id}
                onClick={() => setPanel({ kind: 'edit', table: t })}
              >
                Mesa {t.label}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title="Personalizar salão" size="xl" footer={footer}>
      <div className="te" data-split={wide || undefined}>
        {(wide || !form) && map}
        {form && (
          <aside className="te-panel" aria-label={form.title}>
            <header className="te-panel__head">
              <h3>{form.title}</h3>
              {wide && view?.kind === 'edit' && (
                <button
                  type="button"
                  className="te-panel__close"
                  aria-label="Fechar a mesa"
                  title="Fechar a mesa"
                  onClick={() => setPanel(null)}
                >
                  <X size={16} />
                </button>
              )}
            </header>
            {form.body}
          </aside>
        )}
      </div>
    </Modal>
  );
}

/** Próximo número livre: com mesas 1 a 12, sugere começar na 13. */
function nextNumber(tables: DiningTable[]) {
  return Math.max(0, ...tables.map((t) => (/^\d+$/.test(t.label) ? Number(t.label) : 0))) + 1;
}

interface PanelForm {
  title: string;
  body: ReactNode;
  action: ReactNode;
}

function useAddForm({
  open,
  areas,
  tables,
  onCreated,
}: {
  open: boolean;
  areas: string[];
  tables: DiningTable[];
  onCreated(n: number): void;
}): PanelForm {
  const [count, setCount] = useState(10);
  const [seats, setSeats] = useState(4);
  const [shape, setShape] = useState<TableShape>('square');
  const [area, setArea] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = nextNumber(tables);
  const single = count === 1 && name.trim() ? name.trim() : null;
  useEffect(() => {
    if (open) {
      setError(null);
      setName('');
      setCount(tables.length ? 5 : 10);
    }
  }, [open, tables.length]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const json = { seats, shape, area: area.trim() || null };
      if (single) {
        await api('/tables', { method: 'POST', json: { ...json, label: single } });
        onCreated(1);
      } else {
        const rows = await api<DiningTable[]>('/tables/bulk', {
          method: 'POST',
          json: { ...json, count },
        });
        onCreated(rows.length);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const shown = Math.min(count, 4);
  return {
    title: 'Adicionar mesas',
    action: (
      <Button size="lg" icon={<Plus size={18} />} loading={busy} onClick={save}>
        Criar {count} {count === 1 ? 'mesa' : 'mesas'}
      </Button>
    ),
    body: (
      <div className="cm-form te-form">
        <figure className="te-preview" aria-hidden>
          <div className="te-preview__tables">
            {Array.from({ length: shown }, (_, i) => (
              <TableDrawing
                key={i}
                shape={shape}
                seats={seats}
                label={single ?? String(start + i)}
                size={shape === 'rect' ? 76 : 56}
              />
            ))}
            {count > shown && <span className="te-preview__more">+{count - shown}</span>}
          </div>
          <figcaption>
            {count === 1 ? `Mesa ${single ?? start}` : `Mesas ${start} a ${start + count - 1}`} ·{' '}
            {count * seats} lugares
          </figcaption>
        </figure>
        <div className="te-pair">
          <Stepper label="Quantas mesas" value={count} min={1} max={200} onChange={setCount} />
          <Stepper label="Lugares por mesa" value={seats} min={1} max={30} onChange={setSeats} />
        </div>
        <div className="te-quick" role="group" aria-label="Atalhos de quantidade">
          {[1, 5, 10, 20, 30].map((n) => (
            <button
              key={n}
              type="button"
              className="chip"
              aria-pressed={count === n}
              onClick={() => setCount(n)}
            >
              {n}
            </button>
          ))}
        </div>
        {count === 1 && (
          <TextField
            label="Nome da mesa (opcional)"
            placeholder={`Vazio = mesa ${start}. Ex.: VIP`}
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <ShapePicker value={shape} onChange={setShape} />
        <AreaField value={area} onChange={setArea} areas={areas} />
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    ),
  };
}

function useEditForm({
  table,
  areas,
  onSaved,
}: {
  table: DiningTable | null;
  areas: string[];
  onSaved(msg: string): void;
}): PanelForm {
  const [label, setLabel] = useState('');
  const [seats, setSeats] = useState(4);
  const [shape, setShape] = useState<TableShape>('square');
  const [area, setArea] = useState('');
  const [activeOn, setActiveOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!table) return;
    setLabel(table.label);
    setSeats(table.seats);
    setShape(table.shape);
    setArea(table.area ?? '');
    setActiveOn(table.active);
    setConfirmDelete(false);
    setError(null);
  }, [table]);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const save = () =>
    run(async () => {
      await api(`/tables/${table!.id}`, {
        method: 'PATCH',
        json: { label: label.trim(), seats, shape, area: area.trim() || null, active: activeOn },
      });
      return `Mesa ${label.trim()} salva`;
    });
  const remove = () =>
    run(async () => {
      const r = await api<{ deleted: boolean }>(`/tables/${table!.id}`, { method: 'DELETE' });
      return r.deleted
        ? `Mesa ${table!.label} excluída`
        : `Mesa ${table!.label} desativada (ela tem histórico de comandas)`;
    });

  const inUse = !!table?.tabId;
  return {
    title: table ? `Mesa ${table.label}` : 'Mesa',
    action: confirmDelete ? null : (
      <Button size="lg" loading={busy} disabled={!label.trim()} onClick={save}>
        Salvar mesa
      </Button>
    ),
    body: confirmDelete ? (
      <div className="te-confirm">
        <p>
          Excluir a <strong>mesa {table?.label}</strong>? Se ela já teve comandas, fica só
          desativada para não perder o histórico.
        </p>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="te-confirm__actions">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
            Voltar
          </Button>
          <Button variant="danger" loading={busy} onClick={remove}>
            Sim, excluir
          </Button>
        </div>
      </div>
    ) : (
      <div className="cm-form te-form">
        <figure className="te-preview" aria-hidden>
          <div className="te-preview__tables">
            <TableDrawing shape={shape} seats={seats} label={label || '?'} size={80} />
          </div>
        </figure>
        {inUse && (
          <Alert tone="info">
            Mesa com comanda aberta: dá para editar, mas não excluir nem desativar.
          </Alert>
        )}
        <div className="te-pair">
          <TextField
            label="Número ou nome"
            value={label}
            maxLength={20}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Stepper label="Lugares" value={seats} min={1} max={100} onChange={setSeats} />
        </div>
        <ShapePicker value={shape} onChange={setShape} />
        <AreaField value={area} onChange={setArea} areas={areas} />
        <label className="te-toggle">
          <span>
            <strong>Mesa ativa</strong>
            <small>Desativada some do salão, mas guarda o histórico.</small>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              role="switch"
              checked={activeOn}
              disabled={inUse}
              onChange={(e) => setActiveOn(e.target.checked)}
            />
            <span className="switch__track" aria-hidden />
          </span>
        </label>
        {error && <Alert tone="danger">{error}</Alert>}
        <button
          type="button"
          className="te-delete"
          disabled={inUse}
          title={inUse ? 'Feche a comanda antes de excluir' : undefined}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 size={15} aria-hidden /> Excluir mesa
        </button>
      </div>
    ),
  };
}
