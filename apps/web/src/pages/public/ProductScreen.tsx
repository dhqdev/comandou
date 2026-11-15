import {
  defaultOptionIds,
  fromCents,
  multiplyCents,
  optionsTotalCents,
  toCents,
} from '@comandou/shared';
import { Scale } from 'lucide-react';
import { Check, ChevronDown, ChevronLeft, Plus, Share2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { track } from './pixel';
import { Link, useNavigate, useParams } from 'react-router';
import { brl } from '../../lib/money';
import type { MenuGroup } from '../../lib/types';
import { SearchArt } from './art';
import { useStore } from './context';
import { Model3DButton } from './Model3D';
import { reducedMotion, takeMorph } from './morph';
import { ProductGallery } from './ProductGallery';
import { ProductReviews, RatingChip } from './ProductReviews';
import { HeartButton, Stepper } from './ui';

/** Curva de mola do sistema (tokens.css), lida na hora; reserva se o CSS não tiver carregado. */
const springEase = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** Grupo de escolha única e curto vira "pílulas" (Pequeno · Médio · Grande), se não tiver foto. */
const asChips = (g: MenuGroup) =>
  g.maxSelect === 1 &&
  g.options.length <= 4 &&
  g.options.every((o) => o.name.length <= 16 && !o.imageUrl && !o.description);

/** Linha embaixo do nome do grupo: quantas opções a pessoa pode (ou precisa) escolher. */
export function groupRule(g: Pick<MenuGroup, 'minSelect' | 'maxSelect'>) {
  const { minSelect: min, maxSelect: max } = g;
  const n = (k: number) => `${k} ${k === 1 ? 'opção' : 'opções'}`;
  if (max === 1) return 'Escolha 1 opção';
  if (min > 0 && min === max) return `Escolha ${n(min)}`;
  if (min > 0) return `Escolha de ${min} a ${n(max)}`;
  return `Escolha até ${n(max)}`;
}

/** Tela do produto: foto grande, personalização (tamanhos, adicionais) e barra de adicionar. */
export function ProductScreen() {
  const { id = '' } = useParams();
  const { product, addToCart, favs, toggleFav, menu } = useStore();
  const navigate = useNavigate();
  const p = product(id);
  const seen = !!p;
  useEffect(() => {
    if (seen) track('view_item', { productId: id });
  }, [id, seen]);
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
  // Cabeçalho compacto (fechar + nome): aparece quando o nome do item sai da tela.
  const head = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = head.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([e]) => setCompact(!!e && !e.isIntersecting && e.boundingClientRect.top < 80),
      { rootMargin: '-64px 0px 0px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

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
  const back = () =>
    window.history.state?.idx > 0 ? navigate(-1) : navigate('/pedir', { replace: true });
  const close = () => {
    const el = page.current;
    if (!el?.animate || reducedMotion() || leaving.current) return back();
    leaving.current = true;
    el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(24px)' }], {
      duration: 160,
      easing: 'cubic-bezier(.4,0,1,1)',
      fill: 'forwards',
    }).onfinish = back;
  };

  // Puxar para baixo no topo fecha a tela, como uma folha (só no toque, sem atrapalhar a rolagem).
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    const el = page.current;
    if (!el || reducedMotion()) return;
    let y0 = 0;
    let x0 = 0;
    let dy = 0;
    let mode: 'idle' | 'drag' | 'off' = 'off';
    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1 || window.scrollY > 0) return void (mode = 'off');
      if ((e.target as HTMLElement).closest('textarea, input[type="text"]'))
        return void (mode = 'off');
      y0 = t.clientY;
      x0 = t.clientX;
      dy = 0;
      mode = 'idle';
    };
    const move = (e: TouchEvent) => {
      const t = e.touches[0];
      if (mode === 'off' || !t) return;
      const ddy = t.clientY - y0;
      if (mode === 'idle') {
        if (Math.abs(t.clientX - x0) > Math.abs(ddy) || ddy <= 4) {
          if (Math.abs(t.clientX - x0) > 6 || ddy < -4) mode = 'off';
          return;
        }
        mode = 'drag';
        el.style.transition = 'none';
      }
      dy = Math.max(0, ddy);
      e.preventDefault();
      el.style.transform = `translateY(${dy * 0.55}px)`;
      el.style.opacity = String(1 - Math.min(dy / 900, 0.25));
    };
    const end = () => {
      if (mode !== 'drag') return void (mode = 'off');
      mode = 'off';
      if (dy > 110) {
        el.style.transition = 'transform .16s cubic-bezier(.4,0,1,1), opacity .16s';
        el.style.transform = 'translateY(40vh)';
        el.style.opacity = '0';
        leaving.current = true;
        window.setTimeout(() => backRef.current(), 150);
      } else {
        el.style.transition = `transform var(--cm-spring-snappy-dur) var(--cm-spring-snappy), opacity .2s`;
        el.style.transform = '';
        el.style.opacity = '';
      }
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [seen]);

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
        ?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
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
      <header className="pdp__bar" data-show={compact || undefined} aria-hidden={!compact}>
        <button
          type="button"
          className="iconbtn pdp__bar-close"
          aria-label="Fechar"
          tabIndex={compact ? 0 : -1}
          onClick={close}
        >
          <ChevronDown size={22} />
        </button>
        <strong className="pdp__bar-name">{p.name}</strong>
        <span className="pdp__bar-space" aria-hidden />
      </header>

      <div className="pdp__media">
        <div ref={hero} className="pdp__hero">
          <ProductGallery photos={[p.imageUrl, ...(p.photos ?? [])]} alt={p.name} />
        </div>
        <div className="pdp__topbar">
          <button
            type="button"
            className="iconbtn iconbtn--glass"
            aria-label="Fechar"
            onClick={close}
          >
            <ChevronDown size={22} className="pdp__ic-sheet" />
            <ChevronLeft size={22} className="pdp__ic-page" />
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
        <span className="pdp__grip" aria-hidden />
        {p.badge && <span className="badge-chip">{p.badge}</span>}
        <div ref={head} className="pdp__head">
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

        {p.optionGroups.map((g) => {
          const single = g.maxSelect === 1;
          const chosen = sel[g.id]?.length ?? 0;
          const required = g.minSelect > 0;
          const done = required && chosen >= g.minSelect;
          const late = shake && chosen < g.minSelect;
          return (
            <section
              key={g.id}
              id={`g-${g.id}`}
              role="group"
              aria-labelledby={`gl-${g.id}`}
              className="og"
              data-shake={late || undefined}
              data-missing={(required && !done) || undefined}
            >
              <div className="og__head">
                <span className="og__title">
                  <span className="og__name-g" id={`gl-${g.id}`}>
                    {g.name}
                  </span>
                  <span className="og__rule">{groupRule(g)}</span>
                </span>
                {required ? (
                  <span className={`og__tag ${done ? 'is-done' : 'is-req'}`}>
                    {done ? (
                      <>
                        <Check size={12} strokeWidth={3} /> Pronto
                      </>
                    ) : (
                      'Obrigatório'
                    )}
                  </span>
                ) : (
                  !single &&
                  chosen > 0 && (
                    <span className="og__tag is-count" key={chosen}>
                      {chosen}/{g.maxSelect}
                    </span>
                  )
                )}
              </div>
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
                    return (
                      <label
                        key={o.id}
                        className="og__row"
                        data-on={on || undefined}
                        data-full={full || undefined}
                      >
                        <span className="og__text">
                          <span className="og__name">{o.name}</span>
                          {o.description && <span className="og__desc">{o.description}</span>}
                          {toCents(o.priceDelta) > 0 && (
                            <span className="og__price">+ {brl(o.priceDelta)}</span>
                          )}
                        </span>
                        {o.imageUrl && (
                          <img className="og__img" src={o.imageUrl} alt="" loading="lazy" />
                        )}
                        {single ? (
                          <>
                            <input
                              type="radio"
                              name={g.id}
                              checked={on}
                              onChange={() => toggle(g.id, o.id, true, 1)}
                            />
                            <span className="og__radio" aria-hidden />
                          </>
                        ) : (
                          <>
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={full}
                              onChange={() => toggle(g.id, o.id, false, g.maxSelect)}
                            />
                            <span className="og__add" aria-hidden>
                              {on ? <Check size={16} strokeWidth={3} /> : <Plus size={18} />}
                            </span>
                          </>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </section>
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
