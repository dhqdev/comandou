import { Check, Minus, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Mascot } from '../design-system';
import { brl } from '../lib/money';
import {
  contactHref,
  INCLUDED_IN_ALL,
  limitLabel,
  planBullets,
  PRICING_FAQ,
  type PublicPlan,
} from './pricing-data';
import './pricing.css';

interface PublicPlans {
  plans: PublicPlan[];
  salesContact: string;
}

const n = (v: number) => v.toLocaleString('pt-BR');
const limitCell = (v: number | null) => (v === null ? 'Sem limite' : n(v));

/** www.<domínio>: página de vendas. No endereço do restaurante, o botão leva à Assinatura. */
const isSalesHost = () => {
  const h = window.location.hostname;
  return h.startsWith('www.') || h.split('.').length <= 2;
};

/**
 * Página pública de preços (/precos), sem login. Os planos vêm do Super Admin → Planos: preço,
 * limites, extras, frase, destaques, "mais escolhido" e a ordem. Mudou lá, muda aqui.
 */
export function PricingPage() {
  const [data, setData] = useState<PublicPlans | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    document.title = 'Planos e preços · Comandou';
    fetch('/api/v1/public/plans', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: PublicPlans) => setData(d))
      .catch(() => setError(true));
  }, []);
  const plans = data?.plans ?? [];
  const sales = isSalesHost();
  const contact = contactHref(data?.salesContact ?? '');
  const trial = useMemo(() => Math.max(0, ...plans.map((p) => p.trialDays ?? 0)), [plans]);

  function cta(p: PublicPlan): { href: string; label: string; external?: boolean } {
    if (!sales) return { href: `/plano?plano=${p.id}`, label: 'Escolher este plano' };
    if (contact)
      return {
        href: contact,
        label: p.trialDays ? `Testar ${p.trialDays} dias grátis` : 'Quero este plano',
        external: true,
      };
    return { href: '#perguntas', label: 'Saiba mais' };
  }

  return (
    <div className="pr-page">
      <nav className="pr-nav" aria-label="Navegação">
        <a className="pr-brand" href="#topo">
          <Mascot size={30} />
          <span>Comandou</span>
        </a>
        <div className="pr-nav__links">
          <a href="#planos">Planos</a>
          <a href="#comparar">Comparar</a>
          <a href="#perguntas">Perguntas</a>
        </div>
        <div className="pr-nav__cta">
          <a className="pr-btn pr-btn--ghost" href="/">
            Entrar
          </a>
          {contact && sales && (
            <a className="pr-btn pr-btn--light" href={contact} target="_blank" rel="noreferrer">
              Falar com a gente
            </a>
          )}
        </div>
      </nav>

      <header className="pr-hero" id="topo">
        <h1>Planos que cabem no seu restaurante</h1>
        <p>
          {trial > 0
            ? `Comece com ${trial} dias grátis, sem cartão. Depois, pague por Pix, boleto ou cartão automático.`
            : 'Pague por Pix, boleto ou cartão automático. Troque de plano quando quiser.'}
        </p>
        <div className="pr-laurels">
          {trial > 0 && <Laurel top="teste grátis" big={`${trial} dias`} sub="sistema completo" />}
          <Laurel top="todo plano tem" big="tudo incluso" sub="PDV, mesas, cozinha e delivery" />
          <Laurel top="troque quando quiser" big="sem multa" sub="subir vale na hora" />
        </div>
      </header>

      <main className="pr-main">
        <section id="planos" aria-label="Planos">
          {error && <p className="pr-empty">Não deu para carregar os planos. Tente de novo.</p>}
          {!data && !error && <div className="pr-skeleton" aria-busy="true" />}
          {data && plans.length === 0 && (
            <p className="pr-empty">Os planos ainda estão sendo preparados. Volte em breve.</p>
          )}
          <div className="pr-cards" data-count={Math.min(plans.length, 4)}>
            {plans.map((p, i) => {
              const c = cta(p);
              return (
                <article key={p.id} className="pr-card" data-featured={p.featured || undefined}>
                  {p.featured && <span className="pr-ribbon">Mais escolhido</span>}
                  <span className="pr-chip" data-tone={i % 4}>
                    {p.name}
                  </span>
                  <div className="pr-price">
                    {Number(p.priceMonthly) === 0 ? 'Grátis' : brl(p.priceMonthly)}
                    {Number(p.priceMonthly) > 0 && <small>/mês</small>}
                  </div>
                  <p className="pr-tagline">
                    {p.tagline || limitLabel(p.maxOrdersMonth, 'pedidos por mês')}
                  </p>
                  {p.trialDays ? (
                    <p className="pr-trial">{p.trialDays} dias grátis para testar</p>
                  ) : (
                    <p className="pr-trial">&nbsp;</p>
                  )}
                  <a
                    className={`pr-btn ${p.featured ? 'pr-btn--brand' : 'pr-btn--light'} pr-btn--block`}
                    href={c.href}
                    {...(c.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                  >
                    {c.label}
                  </a>
                  <ul className="pr-list">
                    {planBullets(p).map((b) => (
                      <li key={b}>
                        <Check size={16} aria-hidden />
                        {b}
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
          <p className="pr-all">
            <strong>
              <Sparkles size={15} aria-hidden /> Em todos os planos:
            </strong>{' '}
            {INCLUDED_IN_ALL.join(', ')}.
          </p>
        </section>

        {plans.length > 0 && (
          <section id="comparar" aria-label="Comparar planos" className="pr-section">
            <h2>Compare os planos</h2>
            <div className="pr-table-wrap">
              <table className="pr-table">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Recurso</span>
                    </th>
                    {plans.map((p) => (
                      <th key={p.id} scope="col" data-featured={p.featured || undefined}>
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <Row
                    label="Preço"
                    plans={plans}
                    cell={(p) =>
                      Number(p.priceMonthly) === 0 ? 'R$ 0' : `${brl(p.priceMonthly)}/mês`
                    }
                  />
                  <Row
                    label="Teste grátis"
                    plans={plans}
                    cell={(p) => (p.trialDays ? `${p.trialDays} dias` : '—')}
                  />
                  <Row
                    label="Pessoas na equipe"
                    plans={plans}
                    cell={(p) => limitCell(p.maxUsers)}
                  />
                  <Row
                    label="Produtos ativos"
                    plans={plans}
                    cell={(p) => limitCell(p.maxProducts)}
                  />
                  <Row
                    label="Pedidos por mês"
                    plans={plans}
                    cell={(p) => limitCell(p.maxOrdersMonth)}
                  />
                  <Row label="Nota fiscal (NFC-e)" plans={plans} cell={(p) => p.featureFiscal} />
                  <Row label="Avisos no WhatsApp" plans={plans} cell={(p) => p.featureWhatsapp} />
                  <Row label="Domínio próprio" plans={plans} cell={(p) => p.featureCustomDomain} />
                  {INCLUDED_IN_ALL.map((f) => (
                    <Row key={f} label={f} plans={plans} cell={() => true} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section id="perguntas" aria-label="Perguntas frequentes" className="pr-section">
          <h2>Perguntas</h2>
          <div className="pr-faq">
            {PRICING_FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <footer className="pr-foot">
        <span>Comandou · sistema para restaurantes</span>
        {contact && (
          <a href={contact} target="_blank" rel="noreferrer">
            Falar com a gente
          </a>
        )}
      </footer>
    </div>
  );
}

function Laurel({ top, big, sub }: { top: string; big: string; sub: string }) {
  return (
    <div className="pr-laurel">
      <span>{top}</span>
      <strong>{big}</strong>
      <span>{sub}</span>
    </div>
  );
}

function Row({
  label,
  plans,
  cell,
}: {
  label: string;
  plans: PublicPlan[];
  cell(p: PublicPlan): string | boolean;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {plans.map((p) => {
        const v = cell(p);
        return (
          <td key={p.id} data-featured={p.featured || undefined}>
            {v === true ? (
              <Check size={18} aria-label="incluído" className="pr-yes" />
            ) : v === false ? (
              <Minus size={18} aria-label="não incluído" className="pr-no" />
            ) : (
              v
            )}
          </td>
        );
      })}
    </tr>
  );
}
