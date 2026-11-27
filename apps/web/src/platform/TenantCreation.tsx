import { Link } from 'react-router';
import { Alert, Skeleton } from '../design-system';
import { dateTime } from '../features/format';
import { useLoad } from './OverviewPages';
import { Tag, Tile, levelFor } from './ui';

/**
 * Aba Criação do restaurante (só para quem nasceu pelo site): quanto a IA gastou em cada etapa,
 * pela chave do sistema. No site, antes do cadastro: montar o site (com os "Refazer" da mesma
 * visita), ler o cardápio enviado e sugerir o estoque. No sistema, nos primeiros dias e até o
 * limite de Site com IA: os primeiros passos.
 */
interface CreationReport {
  createdAt: string;
  sourceKind: string;
  sourceValue: string;
  total: { calls: number; tokens: number; costUsd: number };
  steps: {
    step: string;
    label: string;
    where: 'site' | 'sistema';
    calls: number;
    tokens: number;
    costUsd: number;
    models: string[];
    lastAt: string;
  }[];
  firstSteps: { budget: number; used: number; until: string; open: boolean };
  clientsKey: boolean;
  calls: {
    id: string;
    step: string | null;
    label: string;
    model: string;
    tokens: number;
    costUsd: number;
    key: string | null;
    ref: string | null;
    createdAt: string;
  }[];
}

const SOURCE: Record<string, string> = {
  compose: 'Campo único (texto, links e arquivos)',
  site: 'Site',
  maps: 'Google Maps',
  text: 'Itens escritos',
  none: 'Sem cardápio informado',
};

const int = (n: number) => new Intl.NumberFormat('pt-BR').format(Math.round(n));
const compact = (n: number) =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const usd = (n: number, digits = 2) =>
  `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) })}`;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

export function CreationPanel({ id }: { id: string }) {
  const { data, error } = useLoad<CreationReport>(`/platform/site/creation/${id}`);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data)
    return (
      <div className="adm-panel adm-panel__body">
        <Skeleton variant="cards" />
      </div>
    );
  const onSite = data.steps.filter((s) => s.where === 'site');
  const sum = (list: { tokens: number; costUsd: number }[]) =>
    list.reduce((a, s) => ({ tokens: a.tokens + s.tokens, costUsd: a.costUsd + s.costUsd }), {
      tokens: 0,
      costUsd: 0,
    });
  const site = sum(onSite);
  const first = sum(data.steps.filter((s) => s.where === 'sistema'));
  const f = data.firstSteps;
  const firstPct = f.budget > 0 ? Math.min(100, Math.round((f.used / f.budget) * 1000) / 10) : null;
  const origin = `${SOURCE[data.sourceKind] ?? data.sourceKind}${data.sourceValue && data.sourceKind !== 'text' ? ` · ${data.sourceValue}` : ''}`;

  return (
    <div className="adm-stack">
      {data.clientsKey && (
        <Alert tone="warning">
          Alguma chamada saiu da chave dos restaurantes porque a chave do sistema não estava
          cadastrada.{' '}
          <Link to="/credenciais#cred-openrouter_owner">Cadastrar a chave do sistema</Link>
        </Alert>
      )}
      <div className="adm-grid">
        <Tile
          label="Gasto total da criação"
          value={usd(data.total.costUsd, 4)}
          sub={`${compact(data.total.tokens)} tokens · ${int(data.total.calls)} chamada(s)`}
        />
        <Tile
          label="No site, antes do cadastro"
          value={usd(site.costUsd, 4)}
          sub={`${compact(site.tokens)} tokens · montar o site, cardápio e estoque`}
        />
        <Tile
          label="Primeiros passos"
          value={usd(first.costUsd, 4)}
          sub={
            f.budget > 0
              ? `${compact(f.used)} de ${compact(f.budget)} tokens · ${f.open ? `até ${day(f.until)}` : 'encerrado'}`
              : 'desligado em Site com IA'
          }
          level={firstPct === null ? undefined : levelFor(firstPct, 70, 95)}
          meter={firstPct}
        />
      </div>

      <div className="adm-panel">
        <div className="adm-panel__head">Por etapa</div>
        {data.steps.length === 0 ? (
          <div className="adm-empty">A IA ainda não foi usada na criação deste restaurante.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cm-table">
              <thead>
                <tr>
                  <th>Etapa</th>
                  <th>Onde</th>
                  <th className="cm-num">Chamadas</th>
                  <th className="cm-num">Tokens</th>
                  <th className="cm-num">Custo</th>
                  <th>Modelo</th>
                  <th>Última</th>
                </tr>
              </thead>
              <tbody>
                {data.steps.map((s) => (
                  <tr key={s.step}>
                    <td>
                      <strong>{s.label}</strong>
                    </td>
                    <td>
                      <Tag level={s.where === 'site' ? 'info' : undefined}>
                        {s.where === 'site' ? 'No site' : 'No sistema'}
                      </Tag>
                    </td>
                    <td className="cm-num">{int(s.calls)}</td>
                    <td className="cm-num">{int(s.tokens)}</td>
                    <td className="cm-num">{usd(s.costUsd, 4)}</td>
                    <td className="cm-hint">{s.models.join(', ')}</td>
                    <td>{dateTime(s.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data.calls.length > 0 && (
        <div className="adm-panel">
          <div className="adm-panel__head">
            Chamadas{data.total.calls > data.calls.length ? ` (últimas ${data.calls.length})` : ''}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="cm-table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Etapa</th>
                  <th>Modelo</th>
                  <th className="cm-num">Tokens</th>
                  <th className="cm-num">Custo</th>
                  <th>Chave</th>
                </tr>
              </thead>
              <tbody>
                {data.calls.map((c) => (
                  <tr key={c.id}>
                    <td>{dateTime(c.createdAt)}</td>
                    <td>
                      {c.label}
                      {c.ref && <div className="cm-hint">{c.ref}</div>}
                    </td>
                    <td className="cm-hint">{c.model}</td>
                    <td className="cm-num">{int(c.tokens)}</td>
                    <td className="cm-num">{usd(c.costUsd, 4)}</td>
                    <td>
                      {c.key === 'clients' ? (
                        <Tag level="warn">Restaurantes</Tag>
                      ) : (
                        <Tag level="ok">Sistema</Tag>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="adm-sub" style={{ whiteSpace: 'normal' }}>
        Criado pelo site em {dateTime(data.createdAt)} · cardápio informado: {origin}. Os gastos
        saem da chave do sistema do OpenRouter e não contam no limite de IA do restaurante. Os
        primeiros passos valem por 7 dias e até o limite de Site com IA; depois, a IA conta no
        limite dele.
      </p>
    </div>
  );
}
