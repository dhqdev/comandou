import {
  challengeProgress,
  WAITER_DAILY_CHALLENGES,
  WAITER_SEALS,
  waiterLevel,
} from '@comandou/shared';
import { CircleCheck, Target } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Skeleton } from '../design-system';
import { brl } from '../lib/money';
import { Seal, useWaiterStats, WaiterHead } from './common';

/**
 * Desafios do garçom (como no Anota AI): trilha de selos por número de pedidos, metas do dia e
 * a coleção de selos. Os números vêm do servidor (pedidos não cancelados lançados por ele).
 */
export function WaiterChallenges() {
  const { stats } = useWaiterStats();
  const track = useRef<HTMLDivElement>(null);
  const total = stats?.totalOrders ?? 0;
  const level = waiterLevel(total);

  // Trilha rola até o selo atual.
  useEffect(() => {
    const el = track.current?.querySelector<HTMLElement>('[data-current]');
    el?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  }, [level.index, stats]);

  if (!stats) return <Skeleton variant="cards" />;
  const day = stats.today;
  const done = WAITER_DAILY_CHALLENGES.filter((c) => challengeProgress(c, day) >= 1).length;

  return (
    <div className="wt-page">
      <WaiterHead
        title="Desafios"
        sub="Lance pedidos para ganhar selos e subir de nível"
        back="/garcom/mesas"
      />

      <section className="wt-player-card" aria-label="Seu nível">
        <div className="wt-player-card__top">
          <Seal seal={level.seal} earned size={72} />
          <div>
            <span className="wt-eyebrow">Jogador</span>
            <h2>{stats.name}</h2>
            <p>
              <strong>{total}</strong> {total === 1 ? 'pedido' : 'pedidos'} · nível{' '}
              <strong>{level.seal.name}</strong>
            </p>
          </div>
        </div>
        <div className="wt-track" ref={track}>
          {WAITER_SEALS.map((s, i) => (
            <div
              key={s.orders}
              className="wt-track__step"
              data-earned={i <= level.index || undefined}
              data-current={i === level.index || undefined}
            >
              <Seal seal={s} earned={i <= level.index} size={34} />
            </div>
          ))}
        </div>
        <p className="wt-player-card__next">
          {level.next ? (
            <>
              Faltam <strong>{level.missing}</strong> {level.missing === 1 ? 'pedido' : 'pedidos'}{' '}
              para o selo <strong>{level.next.name}</strong>.
            </>
          ) : (
            'Você conquistou todos os selos. Lenda do salão!'
          )}
        </p>
        <span className="wt-bar wt-bar--lg" aria-hidden>
          <span style={{ width: `${Math.round(level.progress * 100)}%` }} />
        </span>
      </section>

      <section className="wt-section">
        <h2 className="wt-section__title">
          Desafios de hoje <span>{`${done}/${WAITER_DAILY_CHALLENGES.length}`}</span>
        </h2>
        <div className="wt-challenges">
          {WAITER_DAILY_CHALLENGES.map((c) => {
            const p = challengeProgress(c, day);
            const value =
              c.metric === 'sales'
                ? `${brl(day.sales)} de ${brl(c.target.toFixed(2))}`
                : `${day[c.metric]} de ${c.target}`;
            return (
              <article key={c.id} className="wt-challenge" data-done={p >= 1 || undefined}>
                <span className="wt-challenge__icon" aria-hidden>
                  {p >= 1 ? <CircleCheck size={22} /> : <Target size={22} />}
                </span>
                <div className="wt-challenge__body">
                  <strong>{c.title}</strong>
                  <span>{p >= 1 ? 'Concluído!' : c.hint}</span>
                  <span className="wt-bar" aria-hidden>
                    <span style={{ width: `${Math.round(p * 100)}%` }} />
                  </span>
                </div>
                <span className="wt-challenge__value">{value}</span>
              </article>
            );
          })}
        </div>
        <p className="cm-hint">Os desafios do dia recomeçam à meia-noite.</p>
      </section>

      <section className="wt-section">
        <h2 className="wt-section__title">
          Meus selos <span>{`${level.index + 1}/${WAITER_SEALS.length}`}</span>
        </h2>
        <div className="wt-seals">
          {WAITER_SEALS.map((s, i) => (
            <div
              key={s.orders}
              className="wt-seals__item"
              data-earned={i <= level.index || undefined}
            >
              <Seal seal={s} earned={i <= level.index} size={64} />
              <strong>{s.name}</strong>
              <span>{s.hint}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
