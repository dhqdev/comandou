import { Clock, MapPin, MessageCircle, ShoppingBag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Mascot, Spinner } from '../../design-system';
import { api, ApiError } from '../../lib/api';
import { brl } from '../../lib/money';
import './restaurant-site.css';

interface SiteData {
  restaurant: {
    name: string;
    address: string | null;
    whatsapp: string | null;
    city: string | null;
    state: string | null;
    coverUrl: string | null;
    logoUrl: string | null;
  };
  copy: {
    headline: string;
    tagline: string;
    about: string;
    highlights: { title: string; text: string }[];
    cta: string;
  };
  ordering: boolean;
  isOpen: boolean;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  hours: { day: number; open: string; close: string }[];
  products: {
    id: string;
    name: string;
    description: string | null;
    price: string;
    imageUrl: string | null;
  }[];
}

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const waLink = (p: string) => {
  const d = p.replace(/\D/g, '');
  return `https://wa.me/${d.length >= 12 ? d : `55${d}`}`;
};

/**
 * Página do restaurante (<endereço>/site): a landing page que a IA escreve nos primeiros passos.
 * Título, frase, destaques e "sobre" vêm dos textos guardados; logo, capa, cores, contato,
 * horário e itens vêm do cadastro da loja na hora. O botão leva ao cardápio online (/pedir).
 */
export function RestaurantSite() {
  const [data, setData] = useState<SiteData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SiteData>('/store/site').then(
      (d) => {
        setData(d);
        document.title = d.restaurant.name;
      },
      (e: ApiError) =>
        setError(e.status === 404 ? e.message : 'Não foi possível abrir a página agora.'),
    );
  }, []);

  if (error)
    return (
      <main className="rs rs--empty">
        <Mascot size={72} mood="sleep" />
        <p>{error}</p>
      </main>
    );
  if (!data) return <Spinner />;

  const { restaurant: r, copy: c } = data;
  const where = [r.city, r.state].filter(Boolean).join(' · ');
  const order = data.ordering && (
    <a className="cm-btn cm-btn--primary cm-btn--lg rs-cta" href="/pedir">
      <ShoppingBag size={18} aria-hidden /> {c.cta}
    </a>
  );
  const byDay = DAYS.map((label, day) => ({
    label,
    slots: data.hours.filter((h) => h.day === day).map((h) => `${h.open}–${h.close}`),
  }));
  const serve = [data.acceptsDelivery && 'Entrega', data.acceptsPickup && 'Retirada']
    .filter(Boolean)
    .join(' e ');

  return (
    <main className="rs">
      <header className="rs-top">
        <div className="rs-top__in">
          <span className="rs-brand">
            {r.logoUrl ? <img src={r.logoUrl} alt="" /> : null}
            <strong>{r.name}</strong>
          </span>
          {data.ordering && (
            <a className="cm-btn cm-btn--secondary" href="/pedir">
              Cardápio
            </a>
          )}
        </div>
      </header>

      <section className="rs-hero" data-cover={r.coverUrl ? true : undefined}>
        {r.coverUrl && <img className="rs-hero__bg" src={r.coverUrl} alt="" />}
        <div className="rs-hero__in">
          {data.ordering && (
            <span className="rs-status" data-open={data.isOpen || undefined}>
              <i aria-hidden /> {data.isOpen ? 'Aberto agora' : 'Fechado agora'}
              {serve && ` · ${serve}`}
            </span>
          )}
          <h1>{c.headline}</h1>
          {c.tagline && <p className="rs-hero__tag">{c.tagline}</p>}
          <div className="rs-hero__btns">
            {order}
            {r.whatsapp && (
              <a
                className="cm-btn cm-btn--secondary cm-btn--lg"
                href={waLink(r.whatsapp)}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle size={18} aria-hidden /> WhatsApp
              </a>
            )}
          </div>
        </div>
      </section>

      {c.highlights.length > 0 && (
        <section className="rs-sec">
          <ul className="rs-highlights">
            {c.highlights.map((h) => (
              <li key={h.title}>
                <strong>{h.title}</strong>
                {h.text && <span>{h.text}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.products.length > 0 && (
        <section className="rs-sec">
          <h2>Do nosso cardápio</h2>
          <ul className="rs-products">
            {data.products.map((p) => (
              <li key={p.id}>
                <a href={data.ordering ? `/pedir/produto/${p.id}` : undefined}>
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="rs-products__ph" aria-hidden />
                  )}
                  <strong>{p.name}</strong>
                  {p.description && <span>{p.description}</span>}
                  <em>{brl(p.price)}</em>
                </a>
              </li>
            ))}
          </ul>
          {order && <div className="rs-center">{order}</div>}
        </section>
      )}

      {c.about && (
        <section className="rs-sec rs-about">
          <h2>Sobre</h2>
          <p>{c.about}</p>
        </section>
      )}

      {(r.address || where || data.hours.length > 0) && (
        <section className="rs-sec rs-info">
          {(r.address || where) && (
            <div>
              <h2>
                <MapPin size={18} aria-hidden /> Onde estamos
              </h2>
              {r.address && <p>{r.address}</p>}
              {where && <p className="rs-muted">{where}</p>}
              {r.address && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    [r.address, r.city, r.state].filter(Boolean).join(', '),
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ver no mapa
                </a>
              )}
            </div>
          )}
          {data.hours.length > 0 && (
            <div>
              <h2>
                <Clock size={18} aria-hidden /> Horário
              </h2>
              <dl className="rs-hours">
                {[...byDay.slice(1), byDay[0]!].map((d) => (
                  <div key={d.label}>
                    <dt>{d.label}</dt>
                    <dd>{d.slots.length ? d.slots.join(', ') : 'Fechado'}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>
      )}

      <footer className="rs-foot">
        <span>{r.name}</span>
        <a href="https://comandou.com" target="_blank" rel="noreferrer">
          Feito com Comandou
        </a>
      </footer>
    </main>
  );
}
