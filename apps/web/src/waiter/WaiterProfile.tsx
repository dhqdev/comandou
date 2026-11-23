import { waiterLevel, type Role } from '@comandou/shared';
import { CalendarDays, ChevronRight, Medal } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Skeleton } from '../design-system';
import { useAuth } from '../app/auth';
import {
  dayLabel,
  PayBreakdown,
  PayoutList,
  RoleAvatar,
  type StaffDraft,
  type StaffPayout,
} from '../features/staff-pay';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useLiveData } from '../lib/realtime';
import { Seal, useWaiterStats, WaiterHead } from './common';

interface Profile {
  name: string;
  role: Role;
  roleLabel: string;
  since: string;
  pending: StaffDraft | null;
  month: { from: string; to: string; days: number; orders: number; sales: string; service: string };
  allTime: { orders: number; sales: string; received: string; scheduled: string };
  workdays: { day: string; first: string; last: string }[];
  payouts: StaffPayout[];
}

const hour = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * Perfil do garçom: quem ele é, o nível dos desafios, quanto vai receber desde o último
 * pagamento (salário, diárias, comissão e taxa de serviço, pela regra que o restaurante
 * cadastrou), os números do mês, os dias trabalhados e os pagamentos já recebidos.
 */
export function WaiterProfile() {
  const { me } = useAuth();
  const { stats } = useWaiterStats();
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Profile>('/staff-pay/me').then(
      (r) => (setP(r), setError(null)),
      (e: Error) => setError(e.message),
    );
  }, []);
  useEffect(load, [load]);
  useLiveData(['team', 'finance'], load, ['order.changed']);
  const level = waiterLevel(stats?.totalOrders ?? 0);

  if (error && !p)
    return (
      <div className="wt-page">
        <WaiterHead title="Meu perfil" />
        <Alert tone="danger">{error}</Alert>
      </div>
    );
  if (!p) return <Skeleton variant="cards" />;
  const d = p.pending;

  return (
    <div className="wt-page wt-profile">
      <WaiterHead title="Meu perfil" sub={me?.tenant.name} />

      <section className="wt-player-card wt-profile__who" aria-label="Quem sou">
        <div className="wt-player-card__top">
          <RoleAvatar role={p.role} size={60} />
          <div>
            <h2>{p.name}</h2>
            <p>
              {p.roleLabel} · na equipe desde {dayLabel(p.since)}
            </p>
          </div>
        </div>
        <Link to="/garcom/desafios" className="wt-profile__level">
          <Seal seal={level.seal} earned size={34} />
          <span>
            <strong>Nível {level.seal.name}</strong>
            <span>
              {stats?.totalOrders ?? 0} pedidos
              {level.next
                ? ` · ${level.missing === 1 ? 'falta' : 'faltam'} ${level.missing} para ${level.next.name}`
                : ''}
            </span>
          </span>
          <ChevronRight size={18} aria-hidden />
        </Link>
      </section>

      <section className="wt-profile__money" aria-label="Quanto vou receber">
        <span className="wt-profile__label">Vou receber</span>
        <strong className="wt-profile__big">{brl(d && Number(d.gross) > 0 ? d.gross : '0')}</strong>
        {d && (
          <span className="cm-hint">
            {d.from > d.to
              ? 'Tudo pago até hoje.'
              : `De ${dayLabel(d.from)} até hoje${d.paidUntil ? `, desde o último pagamento` : ''}.`}
          </span>
        )}
        {d?.hasRule ? (
          <>
            <PayBreakdown d={d} total="Total até agora" />
            <p className="wt-profile__rule">
              <b>Como você ganha:</b> {d.ruleText}.
            </p>
          </>
        ) : (
          <p className="wt-profile__rule">
            O restaurante ainda não cadastrou como você ganha. Fale com o gerente: ele cadastra em
            Equipe › Pagamentos.
          </p>
        )}
      </section>

      <section className="wt-section">
        <h2 className="wt-section__title">Este mês</h2>
        <dl className="wt-profile__stats">
          <div>
            <dt>Dias trabalhados</dt>
            <dd>{p.month.days}</dd>
          </div>
          <div>
            <dt>Pedidos lançados</dt>
            <dd>{p.month.orders}</dd>
          </div>
          <div>
            <dt>Vendas</dt>
            <dd>{brl(p.month.sales)}</dd>
          </div>
          <div>
            <dt>Taxa de serviço</dt>
            <dd>{brl(p.month.service)}</dd>
          </div>
        </dl>
      </section>

      <section className="wt-section">
        <h2 className="wt-section__title">Desde que entrou</h2>
        <dl className="wt-profile__stats">
          <div>
            <dt>Pedidos</dt>
            <dd>{p.allTime.orders}</dd>
          </div>
          <div>
            <dt>Vendas</dt>
            <dd>{brl(p.allTime.sales)}</dd>
          </div>
          <div>
            <dt>Já recebi</dt>
            <dd>{brl(p.allTime.received)}</dd>
          </div>
          {Number(p.allTime.scheduled) > 0 && (
            <div>
              <dt>Agendado</dt>
              <dd>{brl(p.allTime.scheduled)}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="wt-section">
        <h2 className="wt-section__title">
          Pagamentos <span>{p.payouts.length || ''}</span>
        </h2>
        {p.payouts.length ? (
          <PayoutList items={p.payouts} />
        ) : (
          <p className="cm-hint">Nenhum pagamento lançado ainda.</p>
        )}
      </section>

      {p.workdays.length > 0 && (
        <section className="wt-section">
          <h2 className="wt-section__title">
            Dias trabalhados no mês <span>{p.workdays.length}</span>
          </h2>
          <ul className="wt-profile__days">
            {p.workdays.map((w) => (
              <li key={w.day}>
                <CalendarDays size={16} aria-hidden />
                <strong>{dayLabel(w.day)}</strong>
                <span className="cm-hint">
                  {hour(w.first)} às {hour(w.last)}
                </span>
              </li>
            ))}
          </ul>
          <p className="cm-hint">Conta como dia trabalhado o dia em que você entrou no app.</p>
        </section>
      )}

      <Link to="/garcom/desafios" className="wt-profile__link">
        <Medal size={18} aria-hidden /> Ver meus desafios e selos
      </Link>
    </div>
  );
}
