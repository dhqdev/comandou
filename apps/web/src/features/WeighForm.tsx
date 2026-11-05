import {
  formatGrams,
  fromCents,
  multiplyCents,
  netGrams,
  parseWeightGrams,
} from '@comandou/shared';
import { Scale } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../design-system';
import { brl } from '../lib/money';
import type { MenuProduct } from '../lib/types';
import './weigh.css';

/** Atalhos de peso mais comuns no balcão (gramas). */
const QUICK = [100, 250, 500, 1000];

/**
 * Pesar um item vendido por peso (sorveteria, comida por quilo): digita o que a balança mostra
 * (0,350 · 350 g · 1,2 kg), desconta a tara do cadastro (pote, prato) e mostra o valor.
 * Confirma com Enter. Devolve o peso líquido em kg.
 */
export function WeighForm({
  product,
  /** Preço do kg já com os complementos escolhidos, em centavos. */
  kgCents,
  initialKg,
  confirmLabel = 'Adicionar',
  onCancel,
  onConfirm,
}: {
  product: Pick<MenuProduct, 'name' | 'weightTare'>;
  kgCents: number;
  initialKg?: number;
  confirmLabel?: string;
  onCancel(): void;
  onConfirm(kg: number): void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const tareG = Math.round(Number(product.weightTare ?? 0) * 1000);
  const [text, setText] = useState(() =>
    initialKg ? String(Math.round(initialKg * 1000) + tareG) + ' g' : '',
  );
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const gross = parseWeightGrams(text);
  const net = gross === null ? null : netGrams(gross, product.weightTare);
  const ok = net !== null && net > 0;
  const total = ok ? multiplyCents(kgCents, net / 1000) : 0;
  const confirm = () => ok && onConfirm(net / 1000);

  return (
    <form
      className="weigh"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        confirm();
      }}
    >
      <div className="weigh__head">
        <span className="weigh__icon" aria-hidden>
          <Scale size={20} />
        </span>
        <div>
          <h3 className="weigh__title">{product.name}</h3>
          <span className="cm-hint">{brl(fromCents(kgCents))} o kg</span>
        </div>
      </div>
      <label htmlFor={id} className="weigh__label">
        Peso na balança
      </label>
      <input
        id={id}
        ref={input}
        className="cm-input cm-num weigh__input"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,350 ou 350 g"
        value={text}
        aria-describedby={`${id}-sum`}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="weigh__quick" role="group" aria-label="Pesos rápidos">
        {QUICK.map((g) => (
          <button
            key={g}
            type="button"
            className="weigh__chip"
            onClick={() => setText(`${g + tareG} g`)}
          >
            {formatGrams(g)}
          </button>
        ))}
      </div>
      <div id={`${id}-sum`} className="weigh__sum" aria-live="polite">
        {tareG > 0 && (
          <span>
            Tara (pote/prato): − {formatGrams(tareG)}
            {gross !== null ? ` · líquido ${formatGrams(net ?? 0)}` : ''}
          </span>
        )}
        {text && gross === null && <span className="weigh__err">Peso inválido</span>}
        {gross !== null && !ok && <span className="weigh__err">O peso é menor que a tara</span>}
        <strong>{ok ? brl(fromCents(total)) : '—'}</strong>
      </div>
      <div className="weigh__actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!ok}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}
