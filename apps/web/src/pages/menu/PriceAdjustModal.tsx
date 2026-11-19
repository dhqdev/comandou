import { PRICE_ADJUST_MAX, PRICE_ADJUST_MIN, type PriceRounding } from '@comandou/shared';
import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Button, Modal, TextField, HelpScope } from '../../design-system';
import { SelectField } from '../../features/forms';
import { MENUS_HELP } from '../../features/help/menu-help';
import { api, type Category } from '../../lib/api';
import { brl } from '../../lib/money';

const ROUNDING: [PriceRounding, string][] = [
  ['none', 'Não arredondar'],
  ['x90', 'Terminar em ,90'],
  ['x99', 'Terminar em ,99'],
  ['x50', 'Terminar em ,00 ou ,50'],
  ['x00', 'Valor inteiro (,00)'],
];

interface Change {
  id: string;
  name: string;
  from: string;
  to: string;
}
interface Result {
  applied: boolean;
  items: Change[];
  options: Change[];
}

/** Percentual digitado ("15,5", "-10", "+8") ou null quando inválido. */
export function parsePercent(v: string): number | null {
  const t = v.trim().replace(',', '.').replace(/^\+/, '');
  if (!t) return 0;
  if (!/^-?\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= PRICE_ADJUST_MIN && n <= PRICE_ADJUST_MAX ? n : null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Reajustar preços do cardápio: percentual, arredondamento e categoria, com prévia do servidor.
 * O preço reajustado vira preço próprio deste cardápio; os complementos valem em todos.
 */
export function PriceAdjustModal({
  open,
  menuId,
  menuName,
  categories,
  blocked,
  initialCategoryId,
  onClose,
  onApplied,
}: {
  open: boolean;
  menuId: string;
  menuName: string;
  categories: Category[];
  /** Há alterações não salvas no cardápio: reajustar descartaria. */
  blocked?: boolean;
  /** Categoria aberta no editor: o reajuste começa só nela. */
  initialCategoryId?: string | null;
  onClose(): void;
  onApplied(r: Result): void;
}) {
  const [pct, setPct] = useState('');
  const [rounding, setRounding] = useState<PriceRounding>('none');
  const [categoryId, setCategoryId] = useState('');
  const [options, setOptions] = useState(false);
  const [preview, setPreview] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPct('');
    setRounding('none');
    setCategoryId(initialCategoryId ?? '');
    setOptions(false);
    setPreview(null);
    setError(null);
  }, [open, initialCategoryId]);

  const percent = parsePercent(pct);
  const ready = open && percent !== null && (percent !== 0 || rounding !== 'none');
  const body = { percent: percent ?? 0, rounding, categoryId: categoryId || null, options };
  const key = JSON.stringify(body);

  // Prévia do servidor (mesma conta que o aplicar), com uma pausa curta enquanto digita.
  useEffect(() => {
    if (!ready) {
      setPreview(null);
      return;
    }
    let off = false;
    setLoading(true);
    const t = setTimeout(() => {
      api<Result>(`/menus/${menuId}/price-adjust`, {
        method: 'POST',
        json: { ...JSON.parse(key), preview: true },
      })
        .then((r) => !off && (setPreview(r), setError(null)))
        .catch((e) => !off && setError((e as Error).message))
        .finally(() => !off && setLoading(false));
    }, 300);
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [ready, key, menuId]);

  const total = (preview?.items.length ?? 0) + (preview?.options.length ?? 0);
  async function apply() {
    setBusy(true);
    try {
      const r = await api<Result>(`/menus/${menuId}/price-adjust`, { method: 'POST', json: body });
      onApplied(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const label = [
    preview?.items.length ? plural(preview.items.length, 'item', 'itens') : '',
    preview?.options.length ? plural(preview.options.length, 'complemento', 'complementos') : '',
  ]
    .filter(Boolean)
    .join(' e ');
  const rows = [...(preview?.items ?? []), ...(preview?.options ?? [])];

  return (
    <HelpScope dict={MENUS_HELP}>
      <Modal
        open={open}
        title="Reajustar preços"
        onClose={onClose}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              loading={busy}
              disabled={!ready || !total || loading || blocked}
              onClick={apply}
            >
              {total ? `Aplicar em ${label}` : 'Aplicar'}
            </Button>
          </>
        }
      >
        <div className="mn-adjust">
          <div className="mn-adjust__fields">
            <TextField
              label="Percentual"
              placeholder="Ex.: 10 ou -5"
              inputMode="decimal"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              aria-invalid={percent === null || undefined}
              autoFocus
            />
            <SelectField
              label="Arredondar"
              value={rounding}
              onChange={(e) => setRounding(e.target.value as PriceRounding)}
            >
              {ROUNDING.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Categoria"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon ? `${c.icon} ` : ''}
                  {c.name}
                </option>
              ))}
            </SelectField>
          </div>
          <label className="mn-check">
            <input
              type="checkbox"
              checked={options}
              onChange={(e) => setOptions(e.target.checked)}
            />
            <span>
              Reajustar também os complementos dos itens
              <small className="cm-hint">
                {' '}
                (adicionais, tamanhos e sabores valem em todos os cardápios)
              </small>
            </span>
          </label>
          <p className="cm-hint" style={{ margin: 0 }}>
            O preço reajustado vira o preço do item no {menuName}. Os outros cardápios e o preço
            base do item não mudam. Item sem preço continua sem preço.
          </p>
          {percent === null && (
            <Alert tone="warning">
              Percentual entre {PRICE_ADJUST_MIN}% e +{PRICE_ADJUST_MAX}%, ex.: 10 ou -5.
            </Alert>
          )}
          {blocked && (
            <Alert tone="warning">Espere o cardápio terminar de salvar para reajustar.</Alert>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="mn-adjust__preview" aria-live="polite">
            {!ready ? (
              <span className="cm-hint">
                Informe o percentual ou o arredondamento para ver a prévia.
              </span>
            ) : loading && !preview ? (
              <span className="cm-hint">Calculando…</span>
            ) : !total ? (
              <span className="cm-hint">Nenhum preço muda com essas escolhas.</span>
            ) : (
              <>
                <strong>Prévia: {label} mudam de preço</strong>
                <ul>
                  {rows.slice(0, 8).map((r) => (
                    <li key={r.id}>
                      <span>{r.name}</span>
                      <span className="mn-adjust__price">
                        <s>{brl(r.from)}</s> <ArrowRight size={12} aria-hidden /> <b>{brl(r.to)}</b>
                      </span>
                    </li>
                  ))}
                </ul>
                {rows.length > 8 && (
                  <span className="cm-hint">
                    e mais {plural(rows.length - 8, 'preço', 'preços')}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </Modal>
    </HelpScope>
  );
}
