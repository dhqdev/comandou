import {
  defaultOptionIds,
  fromCents,
  multiplyCents,
  optionsTotalCents,
  toCents,
} from '@comandou/shared';
import { Scale } from 'lucide-react';
import { Check, ChevronLeft, Share2 } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { brl } from '../../lib/money';
import type { MenuGroup } from '../../lib/types';
import { SearchArt } from './art';
import { useStore } from './context';
import { Model3DButton } from './Model3D';
import { reducedMotion, takeMorph } from './morph';
import { ProductGallery } from './ProductGallery';
import { ProductReviews, RatingChip } from './ProductReviews';
import { HeartButton, Stepper, Switch } from './ui';

/** Curva de mola do sistema (tokens.css), lida na hora; reserva se o CSS não tiver carregado. */
const springEase = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

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
  const page = useRef<HTMLElement>(null);
  const [sel, setSel] = useState<Record<string, string[]>>(() => {
    // Opções marcadas como padrão já vêm escolhidas; escolha única obrigatória sem padrão
    // vem com a primeira opção.
    const init: Record<string, string[]> = {};
    const defaults = defaultOptionIds(p?.optionGroups ?? []);
    p?.optionGroups.forEach((g) => {
      const mine = g.options.filter((o) => defaults.includes(o.id)).map((o) => o.id);
      if (mine.length) init[g.id] = mine;
      else if (g.maxSelect === 1 && g.minSelect === 1 && g.options[0])
        init[g.id] = [g.options[0].id];
    });
    return init;
  });
  // Item por peso: a quantidade é o peso em kg (começa em 500 g).
  const [qty, setQty] = useState(() => (p?.soldByWeight ? 0.5 : 1));
  const [notes, setNotes] = useState('');
  const [shake, setShake] = useState(false);

  // A foto do cartão "cresce" até virar a foto grande, com a mola do sistema (sem pulo). Sem
  // cartão de origem (link direto), a foto entra com um leve zoom.
  useLayoutEffect(() => {
    const from = takeMorph(id);
    const el = hero.current;
    if (!el || reducedMotion() || !el.animate) return;
    const easing = springEase('--cm-spring-smooth', 'cubic-bezier(.32,.72,0,1)');
    const to = el.getBoundingClientRect();
    if (from && to.width) {
      el.animate(
        [
          {
            transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
            borderRadius: '18px',
          },
          { transform: 'none', borderRadius: '0px' },
        ],
        { duration: 300, easing },
      );
    } else {
      el.animate(
        [
          { opacity: 0, transform: 'scale(1.04)' },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: 260,
          easing,
        },
      );
    }
  }, [id]);

  // Fechar: a tela desce um pouco e some (rápido), e só então volta.
  const leaving = useRef(false);
  const close = () => {
    const back = () =>
      window.history.state?.idx > 0 ? navigate(-1) : navigate('/pedir', { replace: true });
    const el = page.current;
    if (!el?.animate || reducedMotion() || leaving.current) return back();
    leaving.current = true;
    el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(24px)' }], {
      duration: 160,
      easing: 'cubic-bezier(.4,0,1,1)',
      fill: 'forwards',
    }).onfinish = back;
  };

  if (!p)
    return (
      <div className="sf-wrap sf-page empty-state">
        <SearchArt live className="empty-state__art" />
        <strong>Produto não encontrado</strong>
        <p>Ele pode ter saído do cardápio.</p>
        <Link className="cta cta--inline" to="/pedir">
          Ver o cardápio
        </Link>
      </div>
    );

  const options = p.optionGroups.flatMap((g) => g.options);
  const ids = Object.values(sel).flat();
  const unit = toCents(p.price) + optionsTotalCents(p.optionGroups, ids);
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
        weight: p!.soldByWeight || undefined,
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
    <article ref={page} className="pdp">
      <div className="pdp__media">
        <div ref={hero} className="pdp__hero">
          <ProductGallery photos={[p.imageUrl, ...(p.photos ?? [])]} alt={p.name} />
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
          <strong>
            {brl(p.price)}
            {p.soldByWeight && <small className="pdp__per">/kg</small>}
          </strong>
        </div>
        {p.rating && p.rating.count > 0 && (
          <RatingChip average={p.rating.average} count={p.rating.count} />
        )}
        {p.description && <p className="pdp__desc">{p.description}</p>}
        {p.model && <Model3DButton model={p.model} name={p.name} poster={p.imageUrl} />}
        {p.soldByWeight && (
          <p className="pdp__weight">
            <Scale size={16} aria-hidden />
            Vendido por peso: escolha quanto quer embaixo, de 100 g a 5 kg. O preço é do quilo.
          </p>
        )}

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

        <ProductReviews productId={p.id} />
      </div>

      <div className="addbar">
        <div className="addbar__inner">
          {p.soldByWeight ? (
            <Stepper grams value={qty} onChange={setQty} />
          ) : (
            <Stepper value={qty} onChange={(n) => setQty(Math.max(1, n))} />
          )}
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
