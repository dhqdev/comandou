import { Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Mascot } from '../design-system';
import { brl } from '../lib/money';
import {
  contactHref,
  PRICING_FAQ,
  type PublicPlan,
  singlePlan,
  singlePlanList,
} from './pricing-data';
import './pricing.css';

interface PublicPlans {
  plans: PublicPlan[];
  salesContact: string;
}

/** www.<domínio>: página de vendas. No endereço do restaurante, o botão leva à Assinatura. */
const isSalesHost = () => {
  const h = window.location.hostname;
  return h.startsWith('www.') || h.split('.').length <= 2;
};

/**
 * Página pública de preços (/precos), sem login. O Comandou tem um valor único: o preço vem do
 * Super Admin → Preço (plano "comandou") e não muda com o número de pessoas, produtos ou pedidos.
 */
export function PricingPage() {
  const [data, setData] = useState<PublicPlans | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    document.title = 'Preço · Comandou';
    fetch('/api/v1/public/plans', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: PublicPlans) => setData(d))
      .catch(() => setError(true));
  }, []);
  const plan = useMemo(() => singlePlan(data?.plans ?? []), [data]);
  const sales = isSalesHost();
  const contact = contactHref(data?.salesContact ?? '');
  const trial = plan?.trialDays ?? 0;

  const cta: { href: string; label: string; external?: boolean } = !sales
    ? { href: '/plano', label: 'Ver minha assinatura' }
    : contact
      ? {
          href: contact,
          label: trial ? `Testar ${trial} dias grátis` : 'Quero o Comandou',
          external: true,
        }
      : { href: '#perguntas', label: 'Saiba mais' };

  const list = plan ? singlePlanList(plan) : [];

  return (
    <div className="pr-page">
      <nav className="pr-nav" aria-label="Navegação">
        <a className="pr-brand" href="#topo">
          <Mascot size={30} />
          <span>Comandou</span>
        </a>
        <div className="pr-nav__links">
          <a href="#preco">Preço</a>
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
        <h1>Um preço só. Tudo dentro.</h1>
        <p>
          O mesmo valor para qualquer restaurante: não importa quantas pessoas usam, quantos
          produtos ou quantos pedidos. Pague por Pix, boleto ou cartão automático.
        </p>
        <div className="pr-laurels">
          {trial > 0 && <Laurel top="teste grátis" big={`${trial} dias`} sub="sistema completo" />}
          <Laurel top="valor único" big="sem limite" sub="equipe, produtos e pedidos" />
          <Laurel top="tudo incluso" big="sem extras" sub="nota fiscal, WhatsApp e domínio" />
        </div>
      </header>

      <main className="pr-main">
        <section id="preco" aria-label="Preço">
          {error && <p className="pr-empty">Não deu para carregar o preço. Tente de novo.</p>}
          {!data && !error && <div className="pr-skeleton" aria-busy="true" />}
          {data && !plan && (
            <p className="pr-empty">O preço ainda está sendo preparado. Volte em breve.</p>
          )}
          {plan && (
            <article className="pr-card pr-single" data-featured>
              <div className="pr-single__left">
                <span className="pr-chip" data-tone={0}>
                  {plan.name}
                </span>
                <div className="pr-price">
                  {Number(plan.priceMonthly) === 0 ? 'Grátis' : brl(plan.priceMonthly)}
                  {Number(plan.priceMonthly) > 0 && <small>/mês</small>}
                </div>
                <p className="pr-tagline">
                  Valor único. Não muda com o número de pessoas, produtos ou pedidos.
                </p>
                <p className="pr-trial">
                  {trial ? `${trial} dias grátis para testar, sem cartão` : ' '}
                </p>
                <a
                  className="pr-btn pr-btn--brand pr-btn--block"
                  href={cta.href}
                  {...(cta.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                >
                  {cta.label}
                </a>
              </div>
              <ul className="pr-list pr-single__list">
                {list.map((b) => (
                  <li key={b}>
                    <Check size={16} aria-hidden />
                    {b}
                  </li>
                ))}
              </ul>
            </article>
          )}
        </section>

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
