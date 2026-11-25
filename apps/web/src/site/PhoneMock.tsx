import { Plus, ShoppingBag, Sparkles, Star } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import type { MockItem } from './site-data';

/** O que o celular do topo mostra agora. */
export interface Look {
  name: string;
  color: string | null;
  icon: string | null;
  cover: string | null;
  items: MockItem[];
  /** Itens digitados pela pessoa (sem foto). */
  typed: boolean;
  /** Frase do topo da loja (site montado pela IA ou a loja de exemplo). */
  tagline?: string | null;
  /** Categorias da loja (as da IA; sem elas, as de exemplo). */
  chips?: string[];
  /** A IA está montando o site agora. */
  building?: boolean;
  /** Site montado pela IA (o celular comemora). */
  ai?: boolean;
}

/** O que o celular conta enquanto a IA monta o site. */
export const AI_STEPS = [
  'Lendo o que você mandou',
  'Escolhendo as cores',
  'Montando o cardápio',
  'Escrevendo as descrições',
];

const price = (p?: string) => (p ? `R$ ${p}` : 'Preço a definir');

/**
 * Celular com a loja online: a mesma cara do cardápio de verdade, em miniatura. Com fotos, os dois
 * primeiros itens vão em destaque (foto grande) e o resto em linhas; itens digitados (sem foto)
 * aparecem em linhas com a inicial. Decorativo (`aria-hidden`): o que importa está no formulário.
 */
export function PhoneMock({ look, className = '' }: { look: Look; className?: string }) {
  const initial = look.name.trim()[0]?.toUpperCase() ?? 'C';
  const chips = look.chips?.length ? look.chips : ['Mais pedidos', 'Combos', 'Bebidas'];
  const rich = !look.typed && look.items.slice(0, 2).every((i) => !!i.photo);
  const featured = rich ? look.items.slice(0, 2) : [];
  const rows = rich ? look.items.slice(2, 5) : look.items.slice(0, 4);
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!look.building) return;
    setStep(0);
    const t = window.setInterval(() => setStep((n) => (n + 1) % AI_STEPS.length), 1500);
    return () => window.clearInterval(t);
  }, [look.building]);
  // Uma "versão" por loja montada: os itens entram de novo, um atrás do outro.
  const stamp = `${look.ai ? 'ai' : 'base'}-${look.name}-${look.items[0]?.name ?? ''}`;
  return (
    <div
      className={`st-phone ${look.building ? 'is-building' : ''} ${look.ai ? 'is-ai' : ''} ${className}`}
      style={look.color ? ({ '--st-brand': look.color } as CSSProperties) : undefined}
      aria-hidden
    >
      <div className="st-phone__screen">
        <div className="st-phone__status">
          <b>9:41</b>
          <span className="st-phone__island" />
          <span className="st-phone__sig">
            <i />
            <i />
            <i />
          </span>
        </div>
        <div
          className="st-phone__cover"
          style={{ backgroundImage: `url(${look.cover ?? '/site/food/capa-sm.webp'})` }}
        />
        <div className="st-phone__head">
          <div className="st-phone__logo">
            {look.icon ? <img src={look.icon} alt="" /> : <span>{initial}</span>}
          </div>
          <div className="st-phone__id">
            <div className="st-phone__name" key={look.name}>
              {look.name}
            </div>
            {look.tagline ? (
              <div className="st-phone__tag" key={look.tagline}>
                {look.tagline}
              </div>
            ) : null}
            <div className="st-phone__meta">
              <span className="st-phone__open">
                <i /> Aberto
              </span>
              <span>30–45 min</span>
              <span className="st-phone__rate">
                <Star size={10} strokeWidth={0} fill="currentColor" /> 4,9
              </span>
            </div>
          </div>
        </div>
        <div className="st-phone__chips" key={`c-${stamp}`}>
          {chips.map((c, i) => (
            <span
              key={c}
              className={i === 0 ? 'is-on' : ''}
              style={{ animationDelay: `${i * 50}ms` }}
            >
              {c}
            </span>
          ))}
        </div>
        <div className="st-phone__body" key={stamp}>
          {featured.length > 0 && (
            <div className="st-phone__feat">
              {featured.map((it, i) => (
                <div
                  key={`${it.name}-${i}`}
                  className="st-phone__card"
                  style={{ animationDelay: `${look.ai ? 120 + i * 110 : i * 60}ms` }}
                >
                  <div className="st-phone__pic">
                    <img src={it.photo} alt="" />
                    {it.badge && <em>{it.badge}</em>}
                  </div>
                  <strong>{it.name}</strong>
                  <span className="st-phone__row-end">
                    <b>{price(it.price)}</b>
                    <i className="st-phone__add">
                      <Plus size={12} strokeWidth={2.6} />
                    </i>
                  </span>
                </div>
              ))}
            </div>
          )}
          <ul className="st-phone__items">
            {rows.map((it, i) => (
              <li
                key={`${it.name}-${i}`}
                style={{
                  animationDelay: `${look.ai ? 340 + i * 110 : (featured.length + i) * 60}ms`,
                }}
              >
                <div>
                  <strong>{it.name}</strong>
                  {it.desc && <span>{it.desc}</span>}
                  <em>{price(it.price)}</em>
                </div>
                {it.photo ? (
                  <img src={it.photo} alt="" loading="lazy" />
                ) : (
                  <b className="st-phone__ph">{it.name[0]?.toUpperCase()}</b>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="st-phone__bag">
          <span className="st-phone__bag-ic">
            <ShoppingBag size={14} strokeWidth={2.2} />
            <i>2</i>
          </span>
          <span>Ver sacola</span>
          <b>R$ 71,80</b>
        </div>
        {look.building && (
          <div className="st-phone__ai">
            <span className="st-phone__scan" />
            <div className="st-phone__ai-card">
              <Sparkles size={18} />
              <span key={step}>{AI_STEPS[step]}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
