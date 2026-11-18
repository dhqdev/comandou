import { FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Card, Spinner, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useLoad } from './OverviewPages';
import { CredentialsNote } from './credentials/CredentialsNote';
import { ago, Dot, PageHead, Section, Tag, Tile } from './ui';

interface Fee {
  percent: string;
  fixed: string;
  note?: string | null;
}

interface Overview {
  settings: {
    enabled: boolean;
    environment: 'sandbox' | 'production';
    hasPlatformToken: boolean;
    clientId: string | null;
    hasClientSecret: boolean;
    receiverAccountId: string | null;
    feePercent: string;
    feeFixed: string;
    redirectUri: string;
    keyConfigured: boolean;
    updatedAt: string | null;
  };
  month: { n: number; amount: string; fees: string };
  tenants: {
    id: string;
    name: string;
    slug: string | null;
    connected: boolean;
    environment: 'sandbox' | 'production' | null;
    sellerAccountId: string | null;
    cardEnabled: boolean;
    pixEnabled: boolean;
    lastError: string | null;
    fee: Fee | null;
    month: { n: number; amount: string; fees: string };
  }[];
  warning?: string;
}

const pct = (v: string) => `${Number(v).toLocaleString('pt-BR')}%`;
const feeText = (f: { percent: string; fixed: string }) =>
  `${pct(f.percent)}${Number(f.fixed) > 0 ? ` + ${brl(f.fixed)}` : ''}`;
/** "1,5" ou "1.5" → "1.5" (a API recebe ponto). */
const dec = (v: string) => v.trim().replace(',', '.');

/**
 * Super Admin → Pagamentos pelo app (PagBank Connect): a conta da Comandou, a aplicação do
 * Connect, a conta que recebe a taxa, a taxa padrão e a de cada restaurante.
 */
export function OnlinePayPage() {
  const data = useLoad<Overview>('/platform/online-pay');
  const o = data.data;
  if (data.error) return <Alert tone="danger">{data.error}</Alert>;
  if (!o) return <Spinner />;
  return (
    <>
      <PageHead
        page
        title="Pagamentos pelo app"
        sub={<span>Cartão e Pix no cardápio, com a taxa da Comandou separada pelo PagBank</span>}
      />
      <StatusSection o={o} />
      <TenantsSection o={o} onSaved={(n) => data.setData(n)} />
      <SettingsSection o={o} onSaved={(n) => data.setData(n)} />
    </>
  );
}

function StatusSection({ o }: { o: Overview }) {
  const s = o.settings;
  const ready =
    s.enabled && s.hasPlatformToken && !!s.clientId && s.hasClientSecret && !!s.receiverAccountId;
  const connected = o.tenants.filter((t) => t.connected).length;
  return (
    <Section title="Resumo" sub="Este mês, em todos os restaurantes">
      <div className="adm-grid">
        <Tile
          label="Situação"
          value={!s.enabled ? 'desligado' : ready ? 'ligado' : 'incompleto'}
          sub={s.environment === 'sandbox' ? 'ambiente de testes' : 'produção'}
          level={!s.enabled ? 'off' : ready ? 'ok' : 'warn'}
        />
        <Tile label="Restaurantes conectados" value={connected} level={connected ? 'ok' : 'off'} />
        <Tile label="Pago pelo app" value={brl(o.month.amount)} sub={`${o.month.n} pagamento(s)`} />
        <Tile
          label="Taxa da Comandou"
          value={brl(o.month.fees)}
          sub={`padrão ${feeText({ percent: s.feePercent, fixed: s.feeFixed })}`}
          level={Number(o.month.fees) > 0 ? 'ok' : 'off'}
        />
      </div>
      {o.warning && (
        <div style={{ marginTop: 12 }}>
          <Alert tone="warning">{o.warning}</Alert>
        </div>
      )}
    </Section>
  );
}

function TenantsSection({ o, onSaved }: { o: Overview; onSaved(n: Overview): void }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Section title="Restaurantes" sub={`${o.tenants.length} com conta PagBank ou taxa própria`}>
      <div className="adm-panel">
        <div className="adm-rows">
          {o.tenants.map((t) => (
            <div key={t.id} className="adm-row" style={{ flexWrap: 'wrap' }}>
              <Dot level={t.lastError ? 'warn' : t.connected ? 'ok' : 'off'} />
              <span className="adm-row__main">
                <span className="adm-row__title">
                  <Link
                    to={`/restaurantes/${t.id}`}
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    {t.name}
                  </Link>{' '}
                  {t.fee && <Tag level="info">taxa própria {feeText(t.fee)}</Tag>}
                </span>
                <span className="adm-row__meta">
                  {t.connected
                    ? [
                        t.sellerAccountId,
                        t.cardEnabled && 'cartão',
                        t.pixEnabled && 'Pix',
                        !t.cardEnabled && !t.pixEnabled && 'conectado, nada ligado',
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : t.environment
                      ? 'conectado em outro ambiente'
                      : 'não conectado'}
                  {t.lastError ? ` · ${t.lastError}` : ''}
                </span>
              </span>
              <span className="adm-row__side">
                {brl(t.month.fees)}
                <br />
                <small>
                  {t.month.n} pag. · {brl(t.month.amount)}
                </small>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(editing === t.id ? null : t.id)}
              >
                Taxa
              </Button>
              {editing === t.id && (
                <TenantFeeForm
                  tenant={t}
                  base={o.settings}
                  onSaved={(n) => {
                    onSaved(n);
                    setEditing(null);
                  }}
                />
              )}
            </div>
          ))}
          {o.tenants.length === 0 && (
            <div className="adm-empty">
              Nenhum restaurante conectou a conta PagBank ainda. O administrador do restaurante
              conecta em Loja online › Pagamentos.
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function TenantFeeForm({
  tenant,
  base,
  onSaved,
}: {
  tenant: Overview['tenants'][number];
  base: Overview['settings'];
  onSaved(n: Overview): void;
}) {
  const toast = useToast();
  const [percent, setPercent] = useState(tenant.fee?.percent ?? base.feePercent);
  const [fixed, setFixed] = useState(tenant.fee?.fixed ?? base.feeFixed);
  const [note, setNote] = useState(tenant.fee?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(fee: Fee | null) {
    setBusy(true);
    setError(null);
    try {
      const n = await api<Overview>(`/platform/online-pay/tenants/${tenant.id}/fee`, {
        method: 'PUT',
        json: { fee },
      });
      toast(fee ? 'Taxa do restaurante salva' : 'Voltou para a taxa padrão', 'success');
      onSaved(n);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="cm-form"
      style={{ flexBasis: '100%', marginTop: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        void save({ percent: dec(percent), fixed: dec(fixed), note: note.trim() || undefined });
      }}
    >
      <TextField
        label="Percentual (%)"
        inputMode="decimal"
        value={percent}
        onChange={(e) => setPercent(e.target.value)}
      />
      <TextField
        label="Valor fixo por pagamento (R$)"
        inputMode="decimal"
        value={fixed}
        onChange={(e) => setFixed(e.target.value)}
      />
      <TextField
        label="Motivo (só você vê)"
        wrapClass="cm-form__wide"
        value={note}
        placeholder="Ex.: negociado no contrato"
        onChange={(e) => setNote(e.target.value)}
      />
      {error && (
        <div className="cm-form__wide">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <div className="cm-form__block" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          Salvar taxa
        </Button>
        {tenant.fee && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void save(null)}
          >
            Usar a taxa padrão
          </Button>
        )}
      </div>
    </form>
  );
}

type Form = {
  enabled: boolean;
  feePercent: string;
  feeFixed: string;
};

const toForm = (s: Overview['settings']): Form => ({
  enabled: s.enabled,
  feePercent: s.feePercent,
  feeFixed: s.feeFixed,
});

function SettingsSection({ o, onSaved }: { o: Overview; onSaved(n: Overview): void }) {
  const toast = useToast();
  const s = o.settings;
  const [f, setF] = useState<Form>(() => toForm(s));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = s.hasPlatformToken && !!s.clientId && s.hasClientSecret && !!s.receiverAccountId;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setError(null);
    try {
      const n = await api<Overview>('/platform/online-pay/settings', {
        method: 'PUT',
        json: {
          enabled: f.enabled,
          // Conta, token e aplicação do PagBank ficam em Super Admin › Credenciais.
          environment: s.environment,
          receiverAccountId: s.receiverAccountId ?? '',
          feePercent: dec(f.feePercent),
          feeFixed: dec(f.feeFixed),
        },
      });
      onSaved(n);
      setF(toForm(n.settings));
      toast('Pagamentos pelo app salvos', 'success');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section
      title="Configurações"
      sub={s.updatedAt ? `alterado ${ago(s.updatedAt)}` : 'nunca configurado'}
    >
      <Card>
        <form onSubmit={save}>
          <div className="adm-form-group">
            <h3 className="adm-form-group__title">1. Conta PagBank da Comandou</h3>
            <p className="adm-form-group__lead">
              A sua conta não recebe o dinheiro do pedido: só a taxa, que o PagBank separa na hora
              de cada pagamento. O restaurante recebe o resto direto na conta dele.
            </p>
            <CredentialsNote id="pagbank" level={ready ? 'ok' : 'bad'}>
              {ready
                ? `PagBank ${s.environment === 'production' ? 'em produção' : 'no sandbox'} · conta ${s.receiverAccountId}.`
                : 'Faltam o token, a conta ou a aplicação do PagBank.'}{' '}
              Ambiente, token e aplicação do Connect ficam em Credenciais.
            </CredentialsNote>
          </div>

          <div className="adm-form-group">
            <h3 className="adm-form-group__title">2. Taxa da Comandou</h3>
            <p className="adm-form-group__lead">
              Vale para todo restaurante que não tem taxa própria (troque na lista acima). A taxa do
              PagBank continua sendo do restaurante, como numa maquininha.
            </p>
            <div className="adm-backup-grid">
              <TextField
                label="Percentual por pagamento (%)"
                inputMode="decimal"
                value={f.feePercent}
                onChange={(e) => set('feePercent', e.target.value)}
                hint="De 0 a 20. Ex.: 1 = R$ 1,00 num pedido de R$ 100."
              />
              <TextField
                label="Valor fixo por pagamento (R$)"
                inputMode="decimal"
                value={f.feeFixed}
                onChange={(e) => set('feeFixed', e.target.value)}
                hint="Somado ao percentual. 0 = só o percentual."
              />
            </div>
          </div>

          <label className="adm-check">
            <input
              type="checkbox"
              checked={f.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
            />
            Liberar pagamento pelo app para os restaurantes
          </label>
          <p className="adm-form-group__note">
            <strong>Ligado:</strong> o administrador do restaurante vê Loja online › Pagamentos e
            conecta a conta PagBank dele. <strong>Desligado:</strong> ninguém cobra pelo app e o
            cardápio volta ao Pix com comprovante e pagamento na entrega.
          </p>

          {error && <Alert tone="danger">{error}</Alert>}
          <div className="adm-form-actions">
            <Button type="submit" loading={busy === 'save'} disabled={!!busy}>
              Salvar
            </Button>
          </div>
        </form>
      </Card>
    </Section>
  );
}
