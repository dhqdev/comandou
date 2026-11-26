import { defaultOptionIds, fromCents, multiplyCents, toCents } from '@comandou/shared';
import {
  Check,
  CircleDot,
  CircleMinus,
  Layers,
  MessageSquareText,
  Minus,
  Plus,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ItemThumb, Modal } from '../design-system';
import { mediaUrl } from '../lib/media';
import { brl } from '../lib/money';
import type { MenuGroup, MenuProduct } from '../lib/types';
import { groupMode, groupHint, missingGroup, unitCents, type GroupMode } from './item-editor';

/** Máximo da observação do item (a mesma da linha do pedido aceita mais; aqui é a anotação rápida). */
export const ITEM_NOTE_MAX = 140;

export interface ItemDraft {
  optionIds: string[];
  quantity: number;
  notes: string;
}

interface Section {
  id: string;
  label: string;
  icon: LucideIcon;
  group?: MenuGroup;
  mode?: GroupMode;
}

const ICON: Record<GroupMode, LucideIcon> = {
  single: CircleDot,
  add: Plus,
  multi: Layers,
  remove: CircleMinus,
};

/**
 * Edição do item no app do garçom: cabeçalho com nome e preço, trilho à esquerda com um atalho
 * por seção (escolhas obrigatórias ganham visto quando resolvidas), escolha única, adicionais
 * com +, Retirar, observação com contador e o botão fixo com quantidade e total.
 * `initial` abre uma linha que já está no pedido para mudar.
 */
export function ItemEditor({
  product,
  initial,
  onClose,
  onConfirm,
}: {
  product: MenuProduct | null;
  initial?: ItemDraft | null;
  onClose(): void;
  onConfirm(draft: ItemDraft): void;
}) {
  return (
    <Modal
      open={!!product}
      onClose={onClose}
      size="lg"
      className="wt-ie-modal"
      title={product ? <ItemTitle product={product} /> : ''}
    >
      {product && (
        <EditorBody
          key={product.id}
          product={product}
          initial={initial ?? null}
          onConfirm={onConfirm}
        />
      )}
    </Modal>
  );
}

function ItemTitle({ product }: { product: MenuProduct }) {
  return (
    <span className="wt-ie__head">
      {product.imageId && (
        <ItemThumb src={mediaUrl(product.imageId)} name={product.name} size={44} />
      )}
      <span className="wt-ie__head-text">
        <span className="wt-ie__name">{product.name}</span>
        <span className="wt-ie__price">
          {brl(product.price)}
          {product.soldByWeight ? '/kg' : ''}
          {product.description && <span className="wt-ie__desc"> · {product.description}</span>}
        </span>
      </span>
    </span>
  );
}

function EditorBody({
  product,
  initial,
  onConfirm,
}: {
  product: MenuProduct;
  initial: ItemDraft | null;
  onConfirm(draft: ItemDraft): void;
}) {
  const groups = product.optionGroups;
  const [sel, setSel] = useState<Record<string, string[]>>(() => {
    const start = initial ? initial.optionIds : defaultOptionIds(groups);
    return Object.fromEntries(
      groups.map((g) => [g.id, g.options.filter((o) => start.includes(o.id)).map((o) => o.id)]),
    );
  });
  const [qty, setQty] = useState(initial?.quantity ?? 1);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [active, setActive] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const weight = !!product.soldByWeight;

  const sections = useMemo<Section[]>(
    () => [
      ...groups.map((g) => {
        const mode = groupMode(g);
        return { id: g.id, label: g.name, icon: ICON[mode], group: g, mode };
      }),
      { id: 'obs', label: 'Observação', icon: MessageSquareText },
    ],
    [groups],
  );
  const ids = Object.values(sel).flat();
  const missing = missingGroup(groups, sel);
  const unit = unitCents(product, ids);
  const total = weight ? unit : multiplyCents(unit, qty);

  // O atalho do trilho acompanha a rolagem.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const spy = () => {
      const secs = [...el.querySelectorAll<HTMLElement>('[data-sec]')];
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
      const cur = atEnd
        ? secs[secs.length - 1]
        : [...secs].reverse().find((s) => s.offsetTop <= el.scrollTop + 32);
      setActive(cur?.dataset.sec ?? secs[0]?.dataset.sec ?? null);
    };
    spy();
    el.addEventListener('scroll', spy, { passive: true });
    return () => el.removeEventListener('scroll', spy);
  }, [sections]);

  function jump(id: string) {
    const el = scroller.current;
    const sec = el?.querySelector<HTMLElement>(`[data-sec="${id}"]`);
    if (!el || !sec) return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: sec.offsetTop, behavior: smooth ? 'smooth' : 'auto' });
    setActive(id);
  }

  function pick(g: MenuGroup, oid: string) {
    const mode = groupMode(g);
    const cur = sel[g.id] ?? [];
    let next: string[];
    if (mode === 'single') {
      // Escolha única opcional desmarca no segundo toque; obrigatória só troca.
      next = cur.includes(oid) ? (g.minSelect > 0 ? cur : []) : [oid];
    } else if (cur.includes(oid)) next = cur.filter((x) => x !== oid);
    else if (cur.length >= g.maxSelect) return;
    else next = [...cur, oid];
    setSel((s) => ({ ...s, [g.id]: next }));
    // Primeira escolha de um grupo obrigatório de uma opção: segue para a próxima seção.
    if (mode === 'single' && g.minSelect > 0 && cur.length === 0) {
      const i = sections.findIndex((s) => s.id === g.id);
      const after = sections[i + 1];
      if (after) window.setTimeout(() => jump(after.id), 160);
    }
  }

  function confirm() {
    if (missing) {
      jump(missing.id);
      setFlash(missing.id);
      window.setTimeout(() => setFlash(null), 700);
      return;
    }
    onConfirm({ optionIds: ids, quantity: weight ? (initial?.quantity ?? 0) : qty, notes });
  }

  const action = initial ? 'Salvar' : weight ? 'Pesar' : 'Adicionar';

  return (
    <div className="wt-ie" data-rail={sections.length > 1 || undefined}>
      {sections.length > 1 && (
        <nav className="wt-ie__rail" aria-label="Seções do item">
          {sections.map((s) => {
            const n = sel[s.id]?.length ?? 0;
            const required = !!s.group && s.group.minSelect > 0;
            const done = s.group
              ? required
                ? n >= s.group.minSelect
                : n > 0
              : notes.trim().length > 0;
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                className="wt-ie__jump"
                aria-current={active === s.id || undefined}
                data-state={done ? 'done' : required ? 'todo' : undefined}
                onClick={() => jump(s.id)}
                aria-label={`${s.label}${done ? ' (feito)' : required ? ' (obrigatório)' : ''}`}
              >
                <Icon size={20} aria-hidden />
                <span className="wt-ie__jump-label">{s.label}</span>
                {done ? (
                  <span className="wt-ie__mark wt-ie__mark--done" aria-hidden>
                    <Check size={10} strokeWidth={3.5} />
                  </span>
                ) : (
                  required && <span className="wt-ie__mark wt-ie__mark--todo" aria-hidden />
                )}
              </button>
            );
          })}
        </nav>
      )}

      <div className="wt-ie__scroll" ref={scroller}>
        {groups.map((g) => (
          <GroupSection
            key={g.id}
            group={g}
            chosen={sel[g.id] ?? []}
            flash={flash === g.id}
            onPick={(oid) => pick(g, oid)}
          />
        ))}
        <section className="wt-ie__sec" data-sec="obs" aria-labelledby="wt-ie-obs">
          <header className="wt-ie__sec-head">
            <span>
              <h3 id="wt-ie-obs">Observação</h3>
              <p>Vai junto do item para a cozinha</p>
            </span>
            <span className="wt-ie__count" aria-live="polite">
              {notes.length}/{ITEM_NOTE_MAX}
            </span>
          </header>
          <textarea
            className="cm-input wt-ie__note"
            rows={3}
            maxLength={ITEM_NOTE_MAX}
            placeholder="Ex.: molho à parte, alergia a amendoim"
            aria-labelledby="wt-ie-obs"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </section>
      </div>

      <div className="wt-ie__foot">
        {!weight && (
          <span className="wt-ie__qty" aria-label={`Quantidade: ${qty}`}>
            <button
              type="button"
              aria-label="Diminuir quantidade"
              disabled={qty <= 1}
              onClick={() => setQty((q) => Math.max(1, q - 1))}
            >
              <Minus size={18} />
            </button>
            <span aria-hidden>{qty}</span>
            <button
              type="button"
              aria-label="Aumentar quantidade"
              disabled={qty >= 99}
              onClick={() => setQty((q) => Math.min(99, q + 1))}
            >
              <Plus size={18} />
            </button>
          </span>
        )}
        <Button size="lg" className="wt-ie__go" onClick={confirm}>
          {missing ? (
            <>Escolha {missing.name.toLowerCase()}</>
          ) : (
            <>
              {action}
              {!initial && !weight && <span className="wt-ie__long"> ao pedido</span>}
              {' · '}
              {brl(fromCents(total))}
              {weight ? '/kg' : ''}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function GroupSection({
  group: g,
  chosen,
  flash,
  onPick,
}: {
  group: MenuGroup;
  chosen: string[];
  flash: boolean;
  onPick(oid: string): void;
}) {
  const mode = groupMode(g);
  const required = g.minSelect > 0;
  const ok = chosen.length >= g.minSelect;
  const full = mode !== 'single' && chosen.length >= g.maxSelect;
  const headId = `wt-ie-${g.id}`;
  return (
    <section
      className="wt-ie__sec"
      data-sec={g.id}
      data-mode={mode}
      aria-labelledby={headId}
      role={mode === 'single' ? 'radiogroup' : 'group'}
    >
      <header className="wt-ie__sec-head">
        <span>
          <h3 id={headId}>{g.name}</h3>
          <p>{groupHint(g)}</p>
        </span>
        {required ? (
          <span className="wt-ie__pill" data-ok={ok || undefined} data-flash={flash || undefined}>
            {ok ? <Check size={14} strokeWidth={3} aria-label="Escolhido" /> : 'Obrigatório'}
          </span>
        ) : chosen.length > 0 && mode !== 'single' ? (
          <span className="wt-ie__count">
            {mode === 'remove'
              ? `${chosen.length} retirado${chosen.length > 1 ? 's' : ''}`
              : `${chosen.length}/${g.maxSelect}`}
          </span>
        ) : (
          mode !== 'remove' && <span className="wt-ie__opt-tag">Opcional</span>
        )}
      </header>
      <div className="wt-ie__opts">
        {g.options.map((o) => {
          const on = chosen.includes(o.id);
          const blocked = !on && full;
          const delta = toCents(o.priceDelta);
          return (
            <button
              key={o.id}
              type="button"
              className="wt-ie__opt"
              role={mode === 'single' ? 'radio' : 'checkbox'}
              aria-checked={on}
              disabled={blocked}
              onClick={() => onPick(o.id)}
            >
              <span className="wt-ie__opt-text">
                <span className="wt-ie__opt-name">{o.name}</span>
                {delta > 0 && mode !== 'remove' && (
                  <span className="wt-ie__opt-price">+ {brl(o.priceDelta)}</span>
                )}
              </span>
              <OptionMark mode={mode} on={on} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function OptionMark({ mode, on }: { mode: GroupMode; on: boolean }) {
  if (mode === 'single') return <span className="wt-ie__radio" aria-hidden />;
  if (mode === 'remove')
    return (
      <span className="wt-ie__remove" aria-hidden>
        {on ? (
          <>
            <X size={14} strokeWidth={3} /> Retirado
          </>
        ) : (
          'Retirar'
        )}
      </span>
    );
  if (mode === 'add')
    return (
      <span className="wt-ie__plus" aria-hidden>
        {on ? <Check size={18} strokeWidth={3} /> : <Plus size={18} strokeWidth={2.5} />}
      </span>
    );
  return (
    <span className="wt-ie__check" aria-hidden>
      {on && <Check size={14} strokeWidth={3.5} />}
    </span>
  );
}
