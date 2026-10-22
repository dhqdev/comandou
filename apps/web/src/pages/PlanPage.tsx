import {
  FEATURE_LABELS,
  RESOURCE_LABELS,
  SUBSCRIPTION_LABELS,
  type PlanFeature,
  type PlanResource,
} from '@pedemais/shared';
import { Globe } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useCan } from '../app/auth';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../design-system';
import { dateTime } from '../features/format';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import type { TenantDomain, TenantSubscription } from '../lib/types';

const RESOURCES: PlanResource[] = ['users', 'products', 'orders_month'];
const FEATURES: PlanFeature[] = ['fiscal', 'whatsapp', 'custom_domain'];
const STATUS_TONE = {
  trialing: 'info',
  active: 'success',
  past_due: 'warning',
  cancelled: 'neutral',
} as const;

/** Plano do restaurante (limites e uso do mês) e domínio próprio. */
export function PlanPage() {
  const canPlan = useCan('plan:read');
  const canDomains = useCan('domains:manage');
  return (
    <>
      <div>
        <h1 className="page-title">Plano e domínio</h1>
        <p className="page-sub">O que o seu plano inclui, o uso do mês e o endereço próprio.</p>
      </div>
      {canPlan && <PlanCard />}
      {canDomains && <DomainsCard />}
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
            <div key={r} className="pm-card stat" data-testid={`usage-${r}`}>
              <div className="stat__label">{RESOURCE_LABELS[r]}</div>
              <div className="stat__value">
                {used}
                <span className="pm-hint"> / {limit ?? 'sem limite'}</span>
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
              {full && <div className="pm-hint">Limite atingido</div>}
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

function DomainsCard() {
  const toast = useToast();
  const [list, setList] = useState<TenantDomain[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hostname, setHostname] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TenantDomain | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api<TenantDomain[]>('/domains'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return false;
    } finally {
      setBusy(null);
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    void run('add', async () => {
      await api('/domains', { method: 'POST', json: { hostname } });
      setHostname('');
      toast('Domínio cadastrado. Agora crie os registros no DNS.', 'success');
    });
  }

  async function verify(d: TenantDomain) {
    await run(d.id, async () => {
      const r = await api<TenantDomain>(`/domains/${d.id}/verify`, { method: 'POST' });
      toast(
        r.verified ? 'Domínio verificado' : (r.lastError ?? 'Ainda não verificado'),
        r.verified ? 'success' : 'danger',
      );
    });
  }

  return (
    <Card title="Domínio próprio">
      <p style={{ marginTop: 0 }}>
        Use um endereço seu, como <strong>pedidos.seurestaurante.com.br</strong>. O endereço atual
        continua funcionando.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <form onSubmit={add} className="form-grid">
        <TextField
          label="Domínio"
          placeholder="pedidos.seurestaurante.com.br"
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          autoComplete="off"
        />
        <div style={{ alignSelf: 'end' }}>
          <Button type="submit" loading={busy === 'add'} disabled={!hostname.trim()}>
            Adicionar
          </Button>
        </div>
      </form>
      {list === null ? (
        <Spinner />
      ) : list.length === 0 ? (
        <EmptyState icon={<Globe size={20} />} title="Nenhum domínio próprio" />
      ) : (
        <ul className="plain-list" style={{ marginTop: 16 }}>
          {list.map((d) => (
            <li key={d.id} className="pm-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong className="mono-break">{d.hostname}</strong>
                <Badge tone={d.verified ? 'success' : 'warning'}>
                  {d.verified ? 'verificado' : 'aguardando DNS'}
                </Badge>
                <span style={{ flex: 1 }} />
                {!d.verified && (
                  <Button loading={busy === d.id} onClick={() => verify(d)}>
                    Verificar agora
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setRemoving(d)}>
                  Remover
                </Button>
              </div>
              {!d.verified && (
                <>
                  <p className="pm-hint">No painel do seu provedor de DNS, crie:</p>
                  <table className="pm-table">
                    <thead>
                      <tr>
                        <th>Tipo</th>
                        <th>Nome</th>
                        <th>Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>TXT</td>
                        <td className="mono-break">{d.dns.txtName}</td>
                        <td className="mono-break">{d.dns.txtValue}</td>
                      </tr>
                      <tr>
                        <td>CNAME</td>
                        <td className="mono-break">{d.hostname}</td>
                        <td className="mono-break">{d.dns.cnameTarget}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="pm-hint">
                    A propagação do DNS pode levar de minutos a algumas horas.
                    {d.lastError && <> Última verificação: {d.lastError}</>}
                  </p>
                </>
              )}
              {d.verified && d.verifiedAt && (
                <p className="pm-hint">
                  Verificado em {dateTime(d.verifiedAt)}. O certificado HTTPS é emitido no primeiro
                  acesso.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={!!removing}
        title="Remover domínio?"
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Manter
            </Button>
            <Button
              variant="danger"
              loading={busy === 'remove'}
              onClick={async () => {
                const d = removing!;
                if (await run('remove', () => api(`/domains/${d.id}/remove`, { method: 'POST' }))) {
                  toast('Domínio removido', 'success');
                  setRemoving(null);
                }
              }}
            >
              Remover
            </Button>
          </>
        }
      >
        <p>
          <strong>{removing?.hostname}</strong> deixa de abrir o restaurante imediatamente. O
          endereço {removing?.dns.cnameTarget} continua funcionando.
        </p>
      </Modal>
    </Card>
  );
}
