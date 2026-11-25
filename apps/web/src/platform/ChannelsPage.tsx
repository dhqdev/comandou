import {
  channelInfo,
  type EndpointUsage,
  type HomologationStep,
  type UsageReport,
  type UsageTone,
} from '@comandou/shared';
import { Check, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, Segmented, useToast, Skeleton } from '../design-system';
import { api } from '../lib/api';
import { useLoad } from './OverviewPages';
import { ago, Dot, type Level, PageHead, Section, Tag, Tile, useInterval } from './ui';
import './channels-admin.css';

interface ChannelUsage {
  channel: string;
  credential: { configured: boolean; mode: string | null } | null;
  report: UsageReport;
  live: { credential: string; stores: number; lastPollAt: string | null }[];
}
interface UsageResponse {
  hours: number;
  rules: { ackMin: number; ackGoal: number; pollingErrorMax: number; lookupsMax: number };
  channels: ChannelUsage[];
}
interface Step extends HomologationStep {
  doneAt: string | null;
  doneBy: string | null;
  note: string | null;
  updatedAt: string | null;
}
interface ChannelSteps {
  channel: string;
  steps: Step[];
}

const PERIODS = [
  { value: '24', label: '24 horas' },
  { value: '168', label: '7 dias' },
  { value: '720', label: '30 dias' },
] as const;

const LEVEL: Record<UsageTone, Level> = { good: 'ok', warn: 'warn', bad: 'bad', none: 'off' };
const TONE_TEXT: Record<UsageTone, string> = {
  good: 'dentro das regras',
  warn: 'perto do limite',
  bad: 'fora das regras',
  none: 'sem uso no período',
};

/** Nome de cada chamada, em português (o rótulo técnico fica embaixo). */
const ENDPOINT: Record<string, string> = {
  'events:polling': 'Buscar eventos (polling)',
  'events:ack': 'Confirmar eventos (ack)',
  'orders:details': 'Detalhe do pedido',
  'orders:tracking': 'Rastreio da entrega',
  'orders:confirm': 'Aceitar pedido',
  'orders:startpreparation': 'Avisar preparo',
  'orders:readytopickup': 'Pronto para retirar',
  'orders:dispatch': 'Saiu para entrega',
  'orders:requestcancellation': 'Cancelar pedido',
  'orders:cancellationreasons': 'Motivos de cancelamento',
  'orders:requestdriver': 'Chamar entregador',
  'merchant:status': 'Situação da loja',
  'merchant:interruptions': 'Pausas da loja',
  'merchant:interruptions:create': 'Pausar a loja',
  'merchant:interruptions:delete': 'Reabrir a loja',
  'merchant:opening-hours': 'Horários da loja',
  'financial:sales': 'Vendas (financeiro)',
  'financial:settlements': 'Repasses (financeiro)',
  'review:list': 'Avaliações',
  'review:summary': 'Nota da loja',
  'review:answer': 'Responder avaliação',
  'disputes:accept': 'Negociação: aceitar',
  'disputes:reject': 'Negociação: recusar',
  'disputes:alternative': 'Negociação: contraproposta',
};

const pct = (n: number | null) =>
  n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const int = (n: number) => n.toLocaleString('pt-BR');
const RESULT_ORDER = ['2xx', '401', '403', '404', '4xx', '429', '5xx', 'network', 'timeout'];

/**
 * Super Admin › Aplicativos: o uso de cada aplicativo de delivery contra as regras que bloqueiam
 * o Comandou (ack, erro por chamada, consultas por pedido) e o roteiro de homologação.
 */
export function ChannelsPage() {
  const [hours, setHours] = useState<'24' | '168' | '720'>('24');
  const usage = useLoad<UsageResponse>(`/platform/channels/usage?hours=${hours}`);
  const homolog = useLoad<ChannelSteps[]>('/platform/channels/homologation');
  const pending = useLoad<PendingStore[]>('/platform/channels/stores/pending');
  useInterval(() => {
    usage.reload();
    pending.reload();
  }, 60_000);

  const error = usage.error ?? homolog.error;
  return (
    <>
      <PageHead
        page
        title="Aplicativos de delivery"
        sub="Uso dentro das regras de cada aplicativo e o roteiro de homologação"
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} />}
            onClick={() => {
              usage.reload();
              homolog.reload();
            }}
          >
            Atualizar
          </Button>
        }
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {!!pending.data?.length && (
        <PendingStores list={pending.data} onList={(l) => pending.setData(l)} />
      )}
      {!usage.data || !homolog.data
        ? !error && <Skeleton variant="page" />
        : usage.data.channels.map((c) => (
            <ChannelBlock
              key={c.channel}
              u={c}
              rules={usage.data!.rules}
              hours={hours}
              onHours={setHours}
              steps={homolog.data!.find((h) => h.channel === c.channel)?.steps ?? []}
              onSteps={(list) => homolog.setData(list)}
            />
          ))}
    </>
  );
}

interface PendingStore {
  channel: string;
  storeId: string;
  storeName: string | null;
  tenant: { id: string; name: string; slug: string };
  createdAt: string;
}

/**
 * Lojas ligadas só pelo código (sem provar que são do restaurante): ficam paradas até alguém
 * conferir com o restaurante (CNPJ, portal do aplicativo) e aprovar. Recusar solta a loja.
 */
function PendingStores({
  list,
  onList,
}: {
  list: PendingStore[];
  onList(l: PendingStore[]): void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function decide(p: PendingStore, decision: 'approve' | 'reject') {
    const key = `${p.channel}|${p.storeId}`;
    setBusy(key);
    try {
      onList(
        await api<PendingStore[]>(
          `/platform/channels/stores/${encodeURIComponent(p.channel)}/${encodeURIComponent(p.storeId)}/${decision}`,
          { method: 'POST' },
        ),
      );
      toast(decision === 'approve' ? 'Loja aprovada' : 'Loja recusada e liberada', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }
  return (
    <Section
      title="Lojas esperando aprovação"
      sub="Confira com o restaurante que a loja é dele antes de aprovar"
    >
      <div className="adm-panel">
        <div className="adm-rows">
          {list.map((p) => {
            const key = `${p.channel}|${p.storeId}`;
            return (
              <div key={key} className="adm-row">
                <Dot level="warn" />
                <span className="adm-row__main">
                  <span className="adm-row__title">
                    {p.tenant.name} · {p.channel} {p.storeId}
                  </span>
                  <span className="adm-row__meta">
                    {p.storeName ?? 'sem nome'} · {p.tenant.slug} · ligada {ago(p.createdAt)}
                  </span>
                </span>
                <span className="adm-row__side">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === key}
                    onClick={() => void decide(p, 'reject')}
                  >
                    Recusar
                  </Button>{' '}
                  <Button
                    size="sm"
                    disabled={busy === key}
                    onClick={() => void decide(p, 'approve')}
                  >
                    Aprovar
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

function ChannelBlock({
  u,
  rules,
  hours,
  onHours,
  steps,
  onSteps,
}: {
  u: ChannelUsage;
  rules: UsageResponse['rules'];
  hours: '24' | '168' | '720';
  onHours(h: '24' | '168' | '720'): void;
  steps: Step[];
  onSteps(list: ChannelSteps[]): void;
}) {
  const label = channelInfo(u.channel).label;
  const r = u.report;
  const stores = u.live.reduce((a, l) => a + l.stores, 0);
  const lastPoll = u.live
    .map((l) => l.lastPollAt)
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);
  const period = PERIODS.find((p) => p.value === hours)!.label;

  return (
    <>
      <Section title={`${label}: uso dentro das regras`} sub={`Últimas ${period}`}>
        <div className="adm-chs__bar">
          <p className="adm-chs__status">
            <Dot level={LEVEL[r.tone]} />
            <strong>{TONE_TEXT[r.tone]}</strong>
            <span>
              {u.credential?.configured
                ? `Chave do app cadastrada${u.credential.mode === 'distributed' ? ' (distribuído)' : ''}`
                : 'Sem chave do app em Credenciais'}
              {' · '}
              {stores
                ? `${stores} loja(s) recebendo pedidos · último polling ${lastPoll ? ago(lastPoll) : 'ainda não'}`
                : 'nenhuma loja recebendo pedidos'}
            </span>
          </p>
          <Segmented
            label="Período"
            value={hours}
            onChange={onHours}
            options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
          />
        </div>
        <div className="adm-grid adm-chs__grid">
          <Tile
            label="Ack dos eventos"
            value={pct(r.ackPct)}
            sub={`mínimo ${rules.ackMin}% · meta ${rules.ackGoal}%`}
            level={LEVEL[r.ackTone]}
          />
          <Tile
            label="Erro no polling"
            value={pct(r.pollErrorPct)}
            sub={`limite ${rules.pollingErrorMax}% · ${int(r.polls)} pollings`}
            level={LEVEL[r.pollTone]}
          />
          <Tile
            label="Consultas por pedido"
            value={
              r.ordersBlocked
                ? `${int(r.ordersBlocked)} no limite`
                : r.ordersOver5
                  ? `${int(r.ordersOver5)} com 6+`
                  : r.ordersLooked
                    ? 'ok'
                    : '—'
            }
            sub={`${int(r.ordersLooked)} pedidos · limite ${rules.lookupsMax}`}
            level={LEVEL[r.lookupTone]}
          />
          <Tile
            label="Erros 4xx"
            value={int(r.clientErrors)}
            sub="bloqueia se repetir"
            level={
              r.clientErrors > 50
                ? 'bad'
                : r.clientErrors
                  ? 'warn'
                  : r.endpoints.length
                    ? 'ok'
                    : 'off'
            }
          />
        </div>
        {r.events > 0 && (
          <p className="adm-chs__note">
            {int(r.eventsAcked)} de {int(r.events)} eventos confirmados
            {r.eventsHeld ? `, ${int(r.eventsHeld)} guardados para confirmar depois` : ''} ·{' '}
            {int(r.pollsWithEvents)} pollings trouxeram eventos
          </p>
        )}
      </Section>

      <Section title={`${label}: chamadas por endpoint`} sub="Todas as réplicas somadas">
        <EndpointTable list={r.endpoints} />
      </Section>

      <Homologation channel={u.channel} label={label} steps={steps} report={r} onSteps={onSteps} />
    </>
  );
}

function EndpointTable({ list }: { list: EndpointUsage[] }) {
  if (!list.length)
    return (
      <div className="adm-panel">
        <div className="adm-empty">Nenhuma chamada no período.</div>
      </div>
    );
  return (
    <div className="adm-panel adm-chs__table">
      <table className="cm-table">
        <thead>
          <tr>
            <th>Chamada</th>
            <th className="cm-num">Total</th>
            <th className="cm-num">Erro</th>
            <th className="adm-chs__hide">Limite</th>
            <th className="adm-chs__hide">Resultados</th>
          </tr>
        </thead>
        <tbody>
          {list.map((e) => (
            <tr key={e.endpoint}>
              <td>
                <strong>{ENDPOINT[e.endpoint] ?? e.endpoint}</strong>
                <div className="cm-hint">{e.endpoint}</div>
              </td>
              <td className="cm-num">{int(e.total)}</td>
              <td className="cm-num">
                <span className="adm-chs__err">
                  <Dot level={LEVEL[e.tone]} />
                  {pct(e.errorPct)}
                </span>
              </td>
              <td className="adm-chs__hide">
                {e.limitPct === null ? '—' : `até ${pct(e.limitPct)}`}
              </td>
              <td className="adm-chs__hide">
                <span className="adm-chs__results">
                  {Object.entries(e.results)
                    .sort(
                      ([a], [b]) =>
                        (RESULT_ORDER.indexOf(a) + 1 || 99) - (RESULT_ORDER.indexOf(b) + 1 || 99),
                    )
                    .map(([k, n]) => (
                      <Tag key={k} level={k === '2xx' ? undefined : k === '5xx' ? 'warn' : 'bad'}>
                        {k === '2xx' ? 'certo' : k} {int(n)}
                      </Tag>
                    ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Homologation({
  channel,
  label,
  steps,
  report,
  onSteps,
}: {
  channel: string;
  label: string;
  steps: Step[];
  report: UsageReport;
  onSteps(list: ChannelSteps[]): void;
}) {
  const done = steps.filter((s) => s.doneAt).length;
  const next = steps.find((s) => !s.doneAt);
  return (
    <Section
      title={`${label}: homologação`}
      sub={
        done === steps.length
          ? 'Todos os passos feitos'
          : `${done} de ${steps.length} passos · próximo: ${next?.title ?? ''}`
      }
    >
      <ol className="adm-panel adm-chs__steps">
        {steps.map((s, i) => (
          <StepRow
            key={s.id}
            n={i + 1}
            channel={channel}
            s={s}
            report={report}
            isNext={s === next}
            onSteps={onSteps}
          />
        ))}
      </ol>
    </Section>
  );
}

function StepRow({
  n,
  channel,
  s,
  report,
  isNext,
  onSteps,
}: {
  n: number;
  channel: string;
  s: Step;
  report: UsageReport;
  isNext: boolean;
  onSteps(list: ChannelSteps[]): void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(isNext);
  const [note, setNote] = useState(s.note ?? '');
  const [busy, setBusy] = useState(false);

  async function save(done: boolean) {
    setBusy(true);
    try {
      onSteps(
        await api<ChannelSteps[]>(`/platform/channels/homologation/${channel}/${s.id}`, {
          method: 'PUT',
          json: { done, note: note.trim() || null },
        }),
      );
      toast(done ? 'Passo marcado como feito' : 'Passo salvo', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  const auto = s.auto === 'metrics' ? report.tone : null;
  return (
    <li className="adm-chs__step" data-done={!!s.doneAt} data-open={open}>
      <button
        type="button"
        className="adm-chs__step-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="adm-chs__num" aria-hidden>
          {s.doneAt ? <Check size={14} /> : n}
        </span>
        <span className="adm-row__main">
          <span className="adm-row__title">{s.title}</span>
          <span className="adm-row__meta">
            {s.doneAt
              ? `Feito ${ago(s.doneAt)}${s.doneBy ? ` por ${s.doneBy}` : ''}`
              : isNext
                ? 'Próximo passo'
                : 'A fazer'}
            {s.note && !open ? ` · ${s.note}` : ''}
          </span>
        </span>
        {auto && (
          <span className="adm-chs__auto">
            <Dot level={LEVEL[auto]} />
            <span className="adm-chs__hide">{TONE_TEXT[auto]}</span>
          </span>
        )}
      </button>
      {open && (
        <div className="adm-chs__body">
          <ul className="adm-chs__how">
            {s.how.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <label className="cm-label" htmlFor={`note-${s.id}`}>
            Observação
          </label>
          <textarea
            id={`note-${s.id}`}
            className="cm-input"
            rows={2}
            maxLength={500}
            value={note}
            placeholder="Ex.: pedido de teste 1234 conferido, chamado 98765 aberto"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="adm-chs__actions">
            {s.doneAt ? (
              <>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save(false)}>
                  Desmarcar
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  disabled={note.trim() === (s.note ?? '')}
                  onClick={() => void save(true)}
                >
                  Salvar observação
                </Button>
              </>
            ) : (
              <>
                {note.trim() !== (s.note ?? '') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void save(false)}
                  >
                    Salvar observação
                  </Button>
                )}
                <Button size="sm" loading={busy} onClick={() => void save(true)}>
                  Marcar como feito
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
