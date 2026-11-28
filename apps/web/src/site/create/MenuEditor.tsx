import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { fromBr } from './create-api';

/**
 * O cardápio que a IA leu, para conferir dentro da conversa: renomear categoria e item, mudar o
 * preço e a descrição, tirar e pôr itens. Cada mudança aparece na hora no cardápio de verdade ao
 * lado (a prévia). Item sem preço fica marcado: ele só entra quando ganhar o preço.
 */

export interface EditItem {
  key: string;
  name: string;
  description: string;
  /** Como a pessoa digita ("24,90"). */
  price: string;
  imageUrl: string | null;
  stock?: { qty: number; min: number } | null;
}
export interface EditCat {
  key: string;
  name: string;
  items: EditItem[];
}

let seq = 0;
export const newKey = (p: string) => `${p}${++seq}`;

export const countItems = (cats: EditCat[]) => cats.reduce((n, c) => n + c.items.length, 0);
export const missingPrice = (cats: EditCat[]) =>
  cats.reduce((n, c) => n + c.items.filter((i) => i.name.trim() && !fromBr(i.price)).length, 0);

export function MenuEditor({
  cats,
  onChange,
  disabled,
}: {
  cats: EditCat[];
  onChange: (cats: EditCat[]) => void;
  disabled?: boolean;
}) {
  // Abertas: a primeira categoria e as que a pessoa abriu.
  const [open, setOpen] = useState<Set<string>>(() => new Set(cats[0] ? [cats[0].key] : []));
  const [desc, setDesc] = useState<string | null>(null);
  const total = countItems(cats);
  const noPrice = missingPrice(cats);

  const setCat = (key: string, patch: Partial<EditCat>) =>
    onChange(cats.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const setItem = (ck: string, ik: string, patch: Partial<EditItem>) =>
    onChange(
      cats.map((c) =>
        c.key === ck
          ? { ...c, items: c.items.map((i) => (i.key === ik ? { ...i, ...patch } : i)) }
          : c,
      ),
    );
  const dropItem = (ck: string, ik: string) =>
    onChange(
      cats
        .map((c) => (c.key === ck ? { ...c, items: c.items.filter((i) => i.key !== ik) } : c))
        .filter((c) => c.items.length || c.key !== ck),
    );
  const addItem = (ck: string) => {
    const key = newKey('i');
    onChange(
      cats.map((c) =>
        c.key === ck
          ? {
              ...c,
              items: [...c.items, { key, name: '', description: '', price: '', imageUrl: null }],
            }
          : c,
      ),
    );
    window.setTimeout(() => document.getElementById(`it-${key}`)?.focus(), 30);
  };
  const addCat = () => {
    const key = newKey('c');
    const item = newKey('i');
    onChange([
      ...cats,
      {
        key,
        name: 'Nova categoria',
        items: [{ key: item, name: '', description: '', price: '', imageUrl: null }],
      },
    ]);
    setOpen((s) => new Set(s).add(key));
    window.setTimeout(() => document.getElementById(`it-${item}`)?.focus(), 30);
  };
  const toggle = (key: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (!n.delete(key)) n.add(key);
      return n;
    });

  return (
    <div className="stc-menu">
      <div className="stc-menu__head">
        <strong>Seu cardápio</strong>
        <span>
          {total} {total === 1 ? 'item' : 'itens'} em {cats.length}{' '}
          {cats.length === 1 ? 'categoria' : 'categorias'}
        </span>
      </div>
      {noPrice > 0 && (
        <p className="stc-menu__warn">
          {noPrice === 1 ? '1 item está' : `${noPrice} itens estão`} sem preço. Coloque o preço para
          ele entrar no cardápio.
        </p>
      )}
      {cats.map((c) => {
        const isOpen = open.has(c.key);
        return (
          <section key={c.key} className="stc-cat" data-open={isOpen || undefined}>
            <div className="stc-cat__head">
              <button
                type="button"
                className="stc-cat__toggle"
                aria-expanded={isOpen}
                aria-label={isOpen ? `Fechar ${c.name}` : `Abrir ${c.name}`}
                onClick={() => toggle(c.key)}
              >
                <ChevronDown size={18} aria-hidden />
              </button>
              <input
                className="stc-cat__name"
                aria-label="Nome da categoria"
                value={c.name}
                maxLength={60}
                disabled={disabled}
                onChange={(e) => setCat(c.key, { name: e.target.value })}
              />
              <span className="stc-cat__count">{c.items.length}</span>
            </div>
            {isOpen && (
              <ul className="stc-items">
                {c.items.map((i) => {
                  const priced = !!fromBr(i.price);
                  return (
                    <li key={i.key} className="stc-item" data-noprice={!priced || undefined}>
                      <span className="stc-item__photo" aria-hidden>
                        {i.imageUrl ? (
                          <img src={i.imageUrl} alt="" loading="lazy" />
                        ) : (
                          (i.name.trim()[0] ?? '·').toUpperCase()
                        )}
                      </span>
                      <div className="stc-item__fields">
                        <input
                          id={`it-${i.key}`}
                          className="stc-item__name"
                          aria-label="Nome do item"
                          placeholder="Nome do item"
                          value={i.name}
                          maxLength={120}
                          disabled={disabled}
                          onChange={(e) => setItem(c.key, i.key, { name: e.target.value })}
                        />
                        {desc === i.key ? (
                          <textarea
                            className="stc-item__desc"
                            aria-label="Descrição"
                            placeholder="Descrição (o que vem no item)"
                            rows={2}
                            autoFocus
                            value={i.description}
                            maxLength={400}
                            disabled={disabled}
                            onBlur={() => setDesc(null)}
                            onChange={(e) => setItem(c.key, i.key, { description: e.target.value })}
                          />
                        ) : (
                          <button
                            type="button"
                            className="stc-item__descbtn"
                            disabled={disabled}
                            onClick={() => setDesc(i.key)}
                          >
                            {i.description.trim() || 'Pôr descrição'}
                          </button>
                        )}
                      </div>
                      <label className="stc-item__price">
                        <span>R$</span>
                        <input
                          aria-label={`Preço de ${i.name || 'item'}`}
                          inputMode="decimal"
                          placeholder="0,00"
                          value={i.price}
                          maxLength={10}
                          disabled={disabled}
                          onChange={(e) =>
                            setItem(c.key, i.key, {
                              price: e.target.value.replace(/[^\d,.]/g, ''),
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="stc-item__drop"
                        aria-label={`Tirar ${i.name || 'item'}`}
                        disabled={disabled}
                        onClick={() => dropItem(c.key, i.key)}
                      >
                        <Trash2 size={16} aria-hidden />
                      </button>
                    </li>
                  );
                })}
                <li>
                  <button
                    type="button"
                    className="stc-add"
                    disabled={disabled}
                    onClick={() => addItem(c.key)}
                  >
                    <Plus size={15} aria-hidden /> Item em {c.name || 'esta categoria'}
                  </button>
                </li>
              </ul>
            )}
          </section>
        );
      })}
      <button type="button" className="stc-add stc-add--cat" disabled={disabled} onClick={addCat}>
        <Plus size={15} aria-hidden /> Nova categoria
      </button>
    </div>
  );
}
