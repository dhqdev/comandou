import { fromCents, multiplyCents, toCents } from '@comandou/shared';
import { Check, ChevronLeft, Share2 } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { brl } from '../../lib/money';
import type { MenuGroup } from '../../lib/types';
import { useStore } from './context';
import { reducedMotion, takeMorph } from './morph';
import { HeartButton, Photo, Stepper, Switch } from './ui';

/** Grupo de escolha única e curto vira "pílulas" (Pequeno · Médio · Grande). */
const asChips = (g: MenuGroup) =>
  g.maxSelect === 1 && g.options.length <= 4 && g.options.every((o) => o.name.length <= 16);

function groupTag(g: MenuGroup) {
  const single = g.maxSelect === 1;
  if (g.minSelect > 0)
    return single
      ? 'Obrigatório'
      : `Escolha ${g.minSelect}${g.maxSelect > g.minSelect ? ` a ${g.maxSelect}` : ''}`;
  return g.maxSelect > 1 ? `Opcional · até ${g.maxSelect}` : 'Opcional';
}

/** Tela do produto: foto grande, personalização (tamanhos, adicionais) e barra de adicionar. */
export function ProductScreen() {
  const { id = '' } = useParams();
  const { product, addToCart, favs, toggleFav, menu } = useStore();
  const navigate = useNavigate();
  const p = product(id);
  const hero = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<Record<string, string[]>>(() => {
    // Escolha única obrigatória já vem com a primeira opção marcada.
    const init: Record<string, string[]> = {};
    p?.optionGroups.forEach((g) => {
      if (g.maxSelect === 1 && g.minSelect === 1 && g.options[0]) init[g.id] = [g.options[0].id];
    });
    return init;
  });
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [shake, setShake] = useState(false);

  // A foto do cartão "cresce" até virar a foto grande.
  useLayoutEffect(() => {
    const from = takeMorph(id);
    const el = hero.current;
    if (!from || !el || reducedMotion() || !el.animate) return;
    const to = el.getBoundingClientRect();
    if (!to.width) return;
    el.animate(
      [
        {
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
          borderRadius: '18px',
        },
        { transform: 'none', borderRadius: '0px' },
      ],
      { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }, [id]);

  const close = () =>
    window.history.state?.idx > 0 ? navigate(-1) : navigate('/pedir', { replace: true });

  if (!p)
    return (
      <div className="sf-wrap sf-page empty-state">
        <strong>Produto não encontrado</strong>
        <p>Ele pode ter saído do cardápio.</p>
        <Link className="cta cta--inline" to="/pedir">
          Ver o cardápio
        </Link>
      </div>
    );

  const options = p.optionGroups.flatMap((g) => g.options);
  const ids = Object.values(sel).flat();
  const unit =
    toCents(p.price) +
    options.filter((o) => ids.includes(o.id)).reduce((s, o) => s + toCents(o.priceDelta), 0);
  const missing = p.optionGroups.filter((g) => (sel[g.id]?.length ?? 0) < g.minSelect);
  const closed = !menu.store.isOpen;

  function toggle(gid: string, oid: string, single: boolean, max: number) {
    setSel((s) => {
      const cur = s[gid] ?? [];
      if (single)
        return {
          ...s,
          [gid]:
            cur.includes(oid) && !p!.optionGroups.find((g) => g.id === gid)!.minSelect ? [] : [oid],
        };
      if (cur.includes(oid)) return { ...s, [gid]: cur.filter((x) => x !== oid) };
      if (cur.length >= max) return s;
      return { ...s, [gid]: [...cur, oid] };
    });
  }

  function add() {
    if (missing.length) {
      setShake(true);
      window.setTimeout(() => setShake(false), 500);
      document
        .getElementById(`g-${missing[0]!.id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    addToCart(
      {
        key: `${p!.id}:${[...ids].sort().join(',')}:${notes.trim()}`,
        productId: p!.id,
        name: p!.name,
        imageUrl: p!.imageUrl,
        unit: fromCents(unit),
        optionIds: ids,
        optionNames: options.filter((o) => ids.includes(o.id)).map((o) => o.name),
        quantity: qty,
        notes: notes.trim(),
      },
      hero.current,
    );
    close();
  }

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: p!.name, url });
      else await navigator.clipboard.writeText(url);
    } catch {
      /* cancelado */
    }
  }

  return (
    <article className="pdp">
      <div className="pdp__media">
        <div ref={hero} className="pdp__hero">
          <Photo src={p.imageUrl} alt={p.name} ratio="1 / 1" eager />
        </div>
        <div className="pdp__topbar">
          <button
            type="button"
            className="iconbtn iconbtn--glass"
            aria-label="Voltar"
            onClick={close}
          >
            <ChevronLeft size={22} />
          </button>
          <span className="pdp__topbar-space" />
          <button
            type="button"
            className="iconbtn iconbtn--glass"
            aria-label="Compartilhar"
            onClick={share}
          >
            <Share2 size={18} />
          </button>
          <HeartButton
            className="iconbtn iconbtn--glass"
            on={favs.includes(p.id)}
            onToggle={() => toggleFav(p.id)}
          />
        </div>
      </div>

      <div className="pdp__panel">
        {p.badge && <span className="badge-chip">{p.badge}</span>}
        <div className="pdp__head">
          <h1>{p.name}</h1>
          <strong>{brl(p.price)}</strong>
        </div>
        {p.description && <p className="pdp__desc">{p.description}</p>}

        {p.optionGroups.length > 0 && <h2 className="pdp__section">Personalize</h2>}
        {p.optionGroups.map((g) => {
          const single = g.maxSelect === 1;
          const chosen = sel[g.id]?.length ?? 0;
          const done = chosen >= g.minSelect && g.minSelect > 0;
          return (
            <fieldset
              key={g.id}
              id={`g-${g.id}`}
              className="og"
              data-shake={shake && chosen < g.minSelect ? '' : undefined}
            >
              <legend>
                <span>{g.name}</span>
                <span
                  className={`og__tag ${g.minSelect > 0 && !done ? 'is-req' : ''} ${done ? 'is-done' : ''}`}
                >
                  {done && <Check size={12} />} {groupTag(g)}
                </span>
              </legend>
              {asChips(g) ? (
                <div className="og__chips" role="radiogroup" aria-label={g.name}>
                  {g.options.map((o) => {
                    const on = sel[g.id]?.includes(o.id) ?? false;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className="og__chip"
                        onClick={() => toggle(g.id, o.id, true, 1)}
                      >
                        {o.name}
                        {toCents(o.priceDelta) > 0 && <small>+ {brl(o.priceDelta)}</small>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="og__list">
                  {g.options.map((o) => {
                    const on = sel[g.id]?.includes(o.id) ?? false;
                    const full = !single && !on && chosen >= g.maxSelect;
                    return single ? (
                      <label key={o.id} className="og__row" data-on={on || undefined}>
                        <span className="og__name">{o.name}</span>
                        {toCents(o.priceDelta) > 0 && (
                          <span className="og__price">+ {brl(o.priceDelta)}</span>
                        )}
                        <input
                          type="radio"
                          name={g.id}
                          checked={on}
                          onChange={() => toggle(g.id, o.id, true, 1)}
                        />
                        <span className="og__radio" aria-hidden />
                      </label>
                    ) : (
                      <label
                        key={o.id}
                        className="og__row"
                        data-on={on || undefined}
                        data-full={full || undefined}
                      >
                        <span className="og__name">{o.name}</span>
                        {toCents(o.priceDelta) > 0 && (
                          <span className="og__price">+ {brl(o.priceDelta)}</span>
                        )}
                        <Switch
                          label={o.name}
                          checked={on}
                          disabled={full}
                          onChange={() => toggle(g.id, o.id, false, g.maxSelect)}
                        />
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>
          );
        })}

        <label className="pdp__notes">
          <span>Alguma observação?</span>
          <textarea
            rows={2}
            maxLength={200}
            placeholder="Ex.: sem cebola, ponto da carne…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>

      <div className="addbar">
        <div className="addbar__inner">
          <Stepper value={qty} onChange={(n) => setQty(Math.max(1, n))} />
          <button
            className="cta addbar__cta"
            disabled={p.soldOut}
            data-pending={missing.length > 0 || undefined}
            onClick={add}
          >
            {p.soldOut ? (
              'Esgotado'
            ) : missing.length ? (
              `Escolha ${missing[0]!.name.toLowerCase()}`
            ) : (
              <>
                <span>{closed ? 'Adicionar (loja fechada)' : 'Adicionar'}</span>
                <span className="addbar__price" key={unit * qty}>
                  {brl(fromCents(multiplyCents(unit, qty)))}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
