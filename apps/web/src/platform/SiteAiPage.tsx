import { ExternalLink, Sparkles } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  LivePanda,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../design-system';
import { CheckField, SelectField } from '../features/forms';
import { api } from '../lib/api';
import { useLoad } from './OverviewPages';
import { ago, levelFor, PageHead, Section, Sparkline, Tag, Tile, type Level } from './ui';

type Kind = 'site' | 'maps' | 'text';
type Off = 'disabled' | 'no_key' | 'daily' | 'monthly' | null;

interface Overview {
  settings: {
    enabled: boolean;
    hasOwnKey: boolean;
    keyConfigured: boolean;
    usingKey: 'site' | 'owner' | 'clients' | null;
    model: string;
    maxTokensPerSite: number;
    dailyTokens: number;
    monthlyTokens: number;
    perIpDaily: number;
    updatedAt: string;
  };
  off: Off;
  usage: {
    dayTokens: number;
    monthTokens: number;
    todaySites: number;
    todayCostUsd: number;
    monthSites: number;
    monthOk: number;
    monthFailed: number;
    monthClaimed: number;
    monthCostUsd: number;
    allSites: number;
    allTokens: number;
    allCostUsd: number;
  };
  days: { day: string; tokens: number; sites: number }[];
  log: {
    id: string;
    sourceKind: Kind;
    sourceValue: string;
    fromPanel: boolean;
    model: string;
    status: 'ok' | 'failed';
    error: string | null;
    items: number;
    tokens: number;
    costUsd: number;
    siteName: string | null;
    createdAt: string;
    tenantId: string | null;
    tenantName: string | null;
    tenantSlug: string | null;
  }[];
  clients: {
    tenantId: string;
    name: string;
    slug: string;
    status: string;
    subscription: string | null;
    sites: number;
    tokens: number;
    costUsd: number;
    lastAt: string;
  }[];
}

interface Draft {
  store: {
    name: string | null;
    about: string | null;
    brandColor: string | null;
    accentColor: string | null;
  };
  tagline: string | null;
  suggested: boolean;
  categories: {
    name: string;
    items: { name: string; description: string | null; price: string | null }[];
  }[];
}

const SOURCE: Record<Kind, string> = { site: 'Site', maps: 'Google Maps', text: 'Descrição' };
const KEY_LABEL = {
  site: 'a chave desta seção',
  owner: 'a sua chave (Tokens)',
  clients: 'a chave dos restaurantes (Tokens)',
};
const OFF_TEXT: Record<Exclude<Off, null>, string> = {
  disabled: 'Desligado: o site funciona sem IA, como antes.',
  no_key: 'Sem chave do OpenRouter: o site funciona sem IA até você colocar uma chave.',
  daily: 'O limite de tokens do dia acabou: o site segue sem IA até as próximas 24 horas.',
  monthly: 'O limite de tokens do mês acabou: o site segue sem IA até o mês virar.',
};

const int = (n: number) => new Intl.NumberFormat('pt-BR').format(Math.round(n));
const compact = (n: number) =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const usd = (n: number, digits = 2) =>
  `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) })}`;
const pct = (used: number, limit: number) =>
  limit > 0 ? Math.round((used / limit) * 1000) / 10 : null;

/**
 * Super Admin › Sites com IA: o site do restaurante montado pela IA no comandou.com. Liga só com
 * uma chave do OpenRouter; aqui ficam a chave (opcional, senão vale a de Tokens), o modelo, os
 * limites de tokens e de sites por visitante, o consumo de cada site e de cada cliente.
 */
export function SiteAiPage() {
  const { data, error, reload } = useLoad<Overview>('/platform/site-ai');
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageHead
        page
        title="Sites com IA"
        sub="Quem chega pelo site cola o link ou descreve o cardápio e a IA monta a loja na hora. Aqui você controla a chave, o modelo e quantos tokens isso pode gastar."
        actions={
          <Link className="adm-action" to="/site">
            <ExternalLink size={15} /> Cadastro pelo site
          </Link>
        }
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {!data ? (
        <Card>
          <Spinner />
        </Card>
      ) : (
        <>
          <Summary o={data} />
          <SettingsForm o={data} onSaved={reload} />
          <TryIt onDone={reload} onOpen={setOpen} />
          <Clients o={data} />
          <Log o={data} onOpen={setOpen} />
        </>
      )}
      <DraftModal id={open} onClose={() => setOpen(null)} />
    </>
  );
}

function Summary({ o }: { o: Overview }) {
  const s = o.settings;
  const u = o.usage;
  const dayPct = pct(u.dayTokens, s.dailyTokens);
  const monthPct = pct(u.monthTokens, s.monthlyTokens);
  const conv = u.monthOk ? Math.round((u.monthClaimed / u.monthOk) * 100) : null;
  return (
    <Section title="Agora">
      <div className="adm-ai-hero">
        <LivePanda size={64} mood={o.off ? 'sleep' : 'happy'} />
        <div>
          <strong>
            {o.off ? 'Site com IA parado' : 'A IA está montando os sites de quem chega'}
          </strong>
          <span className="adm-sub">
            {o.off
              ? OFF_TEXT[o.off]
              : `Usando ${KEY_LABEL[s.usingKey ?? 'owner']} e o modelo ${s.model}.`}
          </span>
        </div>
      </div>
      {!s.keyConfigured && (
        <Alert tone="danger">
          A API está sem INTEGRATIONS_KEY: não dá para guardar nem abrir a chave do OpenRouter.
        </Alert>
      )}
      <div className="adm-grid">
        <Tile
          label="Tokens nas últimas 24 h"
          value={compact(u.dayTokens)}
          sub={s.dailyTokens ? `de ${compact(s.dailyTokens)} por dia` : 'sem limite por dia'}
          level={levelFor(dayPct, 70, 95)}
          meter={dayPct}
        />
        <Tile
          label="Tokens no mês"
          value={compact(u.monthTokens)}
          sub={s.monthlyTokens ? `de ${compact(s.monthlyTokens)} por mês` : 'sem limite por mês'}
          level={levelFor(monthPct, 70, 95)}
          meter={monthPct}
        />
        <Tile
          label="Gasto no mês"
          value={usd(u.monthCostUsd)}
          sub={`${int(u.todaySites)} site(s) hoje · ${usd(u.todayCostUsd)}`}
        />
        <Tile
          label="Viraram restaurante"
          value={conv === null ? '—' : `${conv}%`}
          sub={`${int(u.monthClaimed)} de ${int(u.monthOk)} site(s) no mês${u.monthFailed ? ` · ${int(u.monthFailed)} falha(s)` : ''}`}
        />
      </div>
      <div className="adm-panel adm-ai-chart">
        <div className="adm-row__meta">Tokens por dia nos sites · últimos 30 dias</div>
        <Sparkline
          values={o.days.map((d) => d.tokens)}
          color="var(--a-accent)"
          label="Tokens por dia nos sites nos últimos 30 dias"
        />
        <div className="adm-ai-chart__axis">
          <span>{o.days[0]?.day.slice(5).split('-').reverse().join('/')}</span>
          <span>hoje</span>
        </div>
      </div>
    </Section>
  );
}

function SettingsForm({ o, onSaved }: { o: Overview; onSaved(): void }) {
  const toast = useToast();
  const s = o.settings;
  const [f, setF] = useState({
    enabled: s.enabled,
    apiKey: '',
    clearKey: false,
    model: s.model,
    maxTokensPerSite: String(s.maxTokensPerSite),
    dailyTokens: String(s.dailyTokens),
    monthlyTokens: String(s.monthlyTokens),
    perIpDaily: String(s.perIpDaily),
  });
  const [busy, setBusy] = useState(false);
  const digits = (v: string) => v.replace(/\D/g, '');

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/platform/site-ai/settings', {
        method: 'PUT',
        json: {
          enabled: f.enabled,
          model: f.model.trim(),
          maxTokensPerSite: Number(f.maxTokensPerSite) || 6000,
          dailyTokens: Number(f.dailyTokens) || 0,
          monthlyTokens: Number(f.monthlyTokens) || 0,
          perIpDaily: Number(f.perIpDaily) || 4,
          ...(f.clearKey ? { apiKey: '' } : f.apiKey.trim() ? { apiKey: f.apiKey.trim() } : {}),
        },
      });
      toast('Sites com IA salvo', 'success');
      setF((cur) => ({ ...cur, apiKey: '', clearKey: false }));
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Configuração">
      <Card>
        <form className="cm-form" onSubmit={save}>
          <div className="cm-form__block">
            <CheckField
              label="Montar o site com IA no comandou.com"
              description="Só funciona com uma chave do OpenRouter. Desligado ou sem chave, o site segue como antes, sem IA."
              checked={f.enabled}
              onChange={(v) => setF({ ...f, enabled: v })}
            />
          </div>
          <TextField
            label="Chave do OpenRouter só para os sites (opcional)"
            wrapClass="cm-form__wide"
            type="password"
            autoComplete="new-password"
            placeholder={s.hasOwnKey ? 'Salva. Digite para trocar.' : 'sk-or-v1-...'}
            hint={
              s.hasOwnKey
                ? 'Os sites usam esta chave. Sem ela, usam a sua chave de Super Admin › Tokens.'
                : 'Vazia: os sites usam a sua chave de Super Admin › Tokens. Uma chave própria com limite no OpenRouter separa o gasto.'
            }
            value={f.apiKey}
            onChange={(e) => setF({ ...f, apiKey: e.target.value, clearKey: false })}
          />
          {s.hasOwnKey && (
            <div className="cm-form__block">
              <CheckField
                label="Apagar a chave desta seção"
                description="Os sites voltam a usar a sua chave de Tokens."
                checked={f.clearKey}
                onChange={(v) => setF({ ...f, clearKey: v, apiKey: '' })}
              />
            </div>
          )}
          <TextField
            label="Modelo"
            hint="Precisa responder em JSON. Ex.: google/gemini-2.5-flash ou google/gemini-2.5-flash-lite (mais barato)."
            value={f.model}
            onChange={(e) => setF({ ...f, model: e.target.value })}
          />
          <TextField
            label="Teto de tokens de resposta por site"
            inputMode="numeric"
            hint="De 500 a 32.000. Cardápio grande precisa de mais; 6.000 dá uns 60 itens."
            value={f.maxTokensPerSite}
            onChange={(e) => setF({ ...f, maxTokensPerSite: digits(e.target.value) })}
          />
          <h3 className="cm-form__section">Limites</h3>
          <TextField
            label="Tokens por dia (todos os sites)"
            inputMode="numeric"
            hint="Passou disso nas últimas 24 horas, o site segue sem IA. 0 = sem limite."
            value={f.dailyTokens}
            onChange={(e) => setF({ ...f, dailyTokens: digits(e.target.value) })}
          />
          <TextField
            label="Tokens por mês (todos os sites)"
            inputMode="numeric"
            hint="0 = sem limite."
            value={f.monthlyTokens}
            onChange={(e) => setF({ ...f, monthlyTokens: digits(e.target.value) })}
          />
          <TextField
            label="Sites por visitante por dia"
            inputMode="numeric"
            hint="Cada pessoa (IP) monta no máximo esta quantidade em 24 horas."
            value={f.perIpDaily}
            onChange={(e) => setF({ ...f, perIpDaily: digits(e.target.value) })}
          />
          <div className="cm-form__block">
            <Button type="submit" loading={busy}>
              Salvar
            </Button>
          </div>
        </form>
      </Card>
    </Section>
  );
}

function TryIt({ onDone, onOpen }: { onDone(): void; onOpen(id: string): void }) {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('text');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = kind === 'text' ? value.trim().length >= 10 : value.trim().length >= 4;
  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{
        id: string;
        tokens: number;
        site: { name: string | null; items: number };
      }>('/platform/site-ai/try', { method: 'POST', json: { kind, value: value.trim() } });
      toast(
        `${r.site.name ?? 'Site'} montado: ${r.site.items} itens, ${int(r.tokens)} tokens`,
        'success',
      );
      onDone();
      onOpen(r.id);
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section
      title="Testar"
      sub="Monta um site como o visitante veria e conta nos limites de tokens"
    >
      <Card>
        <form className="cm-form" onSubmit={run}>
          <SelectField
            label="De onde"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            <option value="text">Descrição dos itens</option>
            <option value="site">Site do restaurante</option>
            <option value="maps">Link do Google Maps</option>
          </SelectField>
          {kind === 'text' ? (
            <div className="cm-form__wide">
              <label className="cm-label" htmlFor="sia-text">
                O que o restaurante vende
              </label>
              <textarea
                id="sia-text"
                className="cm-input"
                rows={4}
                placeholder={'X-Burger 28,90\nBatata frita 18\nRefrigerante 7'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
          ) : (
            <TextField
              label={kind === 'site' ? 'Endereço do site' : 'Link do Google Maps'}
              wrapClass="cm-form__wide"
              inputMode="url"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
          <div className="cm-form__block">
            <Button
              type="submit"
              variant="secondary"
              loading={busy}
              disabled={!ok}
              icon={<Sparkles size={15} />}
            >
              Montar site de teste
            </Button>
          </div>
        </form>
      </Card>
    </Section>
  );
}

function situation(c: Overview['clients'][number]): [string, Level] {
  if (c.subscription === 'active') return ['Fechou', 'ok'];
  if (c.status === 'suspended') return ['Venceu', 'off'];
  if (c.status !== 'provisioned') return ['Criando', 'info'];
  return ['Em teste', 'info'];
}

function Clients({ o }: { o: Overview }) {
  return (
    <Section title="Por cliente" sub={o.clients.length ? `${o.clients.length}` : undefined}>
      <Card bodyless>
        {o.clients.length === 0 ? (
          <EmptyState
            title="Nenhum restaurante nasceu de um site com IA ainda"
            description="Quando alguém criar o restaurante depois de ver o site montado, ele aparece aqui com o que gastou."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cm-table">
              <thead>
                <tr>
                  <th>Restaurante</th>
                  <th>Situação</th>
                  <th className="cm-num">Sites</th>
                  <th className="cm-num">Tokens</th>
                  <th className="cm-num">Custo</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {o.clients.map((c) => {
                  const [label, level] = situation(c);
                  return (
                    <tr key={c.tenantId}>
                      <td>
                        <Link to={`/restaurantes/${c.tenantId}`}>
                          <strong>{c.name}</strong>
                        </Link>
                        <div className="cm-hint">{c.slug}</div>
                      </td>
                      <td>
                        <Tag level={level}>{label}</Tag>
                      </td>
                      <td className="cm-num">{int(c.sites)}</td>
                      <td className="cm-num">{int(c.tokens)}</td>
                      <td className="cm-num">{usd(c.costUsd, 4)}</td>
                      <td>{ago(c.lastAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Section>
  );
}

function Log({ o, onOpen }: { o: Overview; onOpen(id: string): void }) {
  const u = o.usage;
  return (
    <Section
      title="Sites montados"
      sub={`${int(u.allSites)} no total · ${compact(u.allTokens)} tokens · ${usd(u.allCostUsd)}`}
    >
      <Card bodyless>
        {o.log.length === 0 ? (
          <EmptyState
            title="Nenhum site montado ainda"
            description="Use o teste acima ou abra o site e cole um link."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cm-table">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Veio de</th>
                  <th>Resultado</th>
                  <th className="cm-num">Tokens</th>
                  <th className="cm-num">Custo</th>
                  <th>Virou</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {o.log.map((g) => (
                  <tr key={g.id}>
                    <td>
                      {g.status === 'ok' ? (
                        <button type="button" className="adm-linkish" onClick={() => onOpen(g.id)}>
                          <strong>{g.siteName ?? 'Sem nome'}</strong>
                        </button>
                      ) : (
                        <strong>{g.siteName ?? '—'}</strong>
                      )}
                      <div className="cm-hint">{g.fromPanel ? 'Teste no painel' : g.model}</div>
                    </td>
                    <td title={g.sourceValue}>
                      {SOURCE[g.sourceKind]}
                      <div className="cm-hint adm-clip">{g.sourceValue}</div>
                    </td>
                    <td>
                      {g.status === 'ok' ? (
                        <Tag level="ok">{g.items} itens</Tag>
                      ) : (
                        <span title={g.error ?? ''}>
                          <Tag level="bad">Falhou</Tag>
                        </span>
                      )}
                    </td>
                    <td className="cm-num">{int(g.tokens)}</td>
                    <td className="cm-num">{usd(g.costUsd, 4)}</td>
                    <td>
                      {g.tenantId ? (
                        <Link to={`/restaurantes/${g.tenantId}`}>{g.tenantName}</Link>
                      ) : (
                        <span className="cm-hint">—</span>
                      )}
                    </td>
                    <td>{ago(g.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Section>
  );
}

/** O que a IA montou: loja, cores e cardápio. */
function DraftModal({ id, onClose }: { id: string | null; onClose(): void }) {
  const { data } = useLoad<{ draft: Draft | null }>(
    id ? `/platform/site-ai/generations/${id}` : null,
    [id],
  );
  const d = id ? data?.draft : null;
  return (
    <Modal
      open={!!id}
      onClose={onClose}
      title={d?.store.name ?? 'Site montado'}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      {!d ? (
        <Spinner />
      ) : (
        <div className="adm-sia">
          {d.tagline && <p className="adm-sia__tag">{d.tagline}</p>}
          {d.store.about && d.store.about !== d.tagline && (
            <p className="cm-hint">{d.store.about}</p>
          )}
          <div className="adm-sia__colors">
            {[d.store.brandColor, d.store.accentColor].filter(Boolean).map((c) => (
              <span key={c}>
                <i style={{ background: c! }} />
                {c}
              </span>
            ))}
            {d.suggested && <Tag level="warn">Itens sugeridos, sem preço</Tag>}
          </div>
          {d.categories.map((c) => (
            <div key={c.name} className="adm-sia__cat">
              <h4>{c.name}</h4>
              <ul>
                {c.items.map((i) => (
                  <li key={i.name}>
                    <span>
                      {i.name}
                      {i.description && <small>{i.description}</small>}
                    </span>
                    <em>{i.price ? `R$ ${i.price.replace('.', ',')}` : '—'}</em>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
