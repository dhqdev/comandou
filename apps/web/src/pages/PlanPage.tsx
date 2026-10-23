import {
  FEATURE_LABELS,
  RESOURCE_LABELS,
  SUBSCRIPTION_LABELS,
  type PlanFeature,
  type PlanResource,
} from '@comandou/shared';
import { useEffect, useState } from 'react';
import { useCan } from '../app/auth';
import {
  Alert,
  Badge,
  Card,
  Spinner,
} from '../design-system';
import { dateTime } from '../features/format';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import type { TenantSubscription } from '../lib/types';

const RESOURCES: PlanResource[] = ['users', 'products', 'orders_month'];
const FEATURES: PlanFeature[] = ['fiscal', 'whatsapp'];
const STATUS_TONE = {
  trialing: 'info',
  active: 'success',
  past_due: 'warning',
  cancelled: 'neutral',
} as const;

/** Plano do restaurante (limites e uso do mês). */
export function PlanPage() {
  const canPlan = useCan('plan:read');
  return (
    <>
      <div>
        <h1 className="page-title">Plano</h1>
        <p className="page-sub">O que o seu plano inclui e o uso do mês.</p>
      </div>
      {canPlan && <PlanCard />}
    </>
  );
}

function PlanCard() {
  const [data, setData] = useState<TenantSubscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<TenantSubscription>('/subscription')
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <Spinner />;
  const cur = data.current;
  if (!cur)
    return (
      <Card title="Plano">
        <p style={{ margin: 0 }}>
          Este restaurante não tem assinatura ativa: nenhum limite de plano se aplica. Fale com o
          suporte para contratar um plano.
        </p>
      </Card>
    );
  const s = cur.subscription;
  return (
    <Card
      title={`Plano ${cur.plan.name}`}
      actions={<Badge tone={STATUS_TONE[s.status]}>{SUBSCRIPTION_LABELS[s.status]}</Badge>}
    >
      <p style={{ marginTop: 0 }}>
        {brl(cur.plan.priceMonthly)} por mês
        {s.status === 'trialing' && s.trialEndsAt && <> · teste até {dateTime(s.trialEndsAt)}</>}
        {s.currentPeriodEnd && <> · período atual até {dateTime(s.currentPeriodEnd)}</>}
      </p>
      {s.status === 'past_due' && (
        <Alert tone="warning">
          Pagamento pendente. Regularize com o suporte para evitar a suspensão do acesso.
        </Alert>
      )}
      <div className="stat-grid">
        {RESOURCES.map((r) => {
          const limit = cur.plan.limits[r];
          const used = data.usage[r];
          const full = limit !== null && used >= limit;
          return (
            <div key={r} className="cm-card stat" data-testid={`usage-${r}`}>
              <div className="stat__label">{RESOURCE_LABELS[r]}</div>
              <div className="stat__value">
                {used}
                <span className="cm-hint"> / {limit ?? 'sem limite'}</span>
              </div>
              {limit !== null && (
                <div
                  className="usage-bar"
                  role="progressbar"
                  aria-label={RESOURCE_LABELS[r]}
                  aria-valuemin={0}
                  aria-valuemax={limit}
                  aria-valuenow={Math.min(used, limit)}
                  data-full={full || undefined}
                >
                  <span style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
                </div>
              )}
              {full && <div className="cm-hint">Limite atingido</div>}
            </div>
          );
        })}
      </div>
      <ul className="plain-list" style={{ marginTop: 12 }}>
        {FEATURES.map((f) => (
          <li key={f}>
            <Badge tone={cur.plan.features[f] ? 'success' : 'neutral'}>
              {cur.plan.features[f] ? 'incluído' : 'não incluído'}
            </Badge>{' '}
            {FEATURE_LABELS[f]}
          </li>
        ))}
      </ul>
    </Card>
  );
}
