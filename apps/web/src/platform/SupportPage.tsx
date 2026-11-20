import { SUBSCRIPTION_LABELS } from '@comandou/shared';
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Globe,
  LogIn,
  MessageCircle,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useToast, Skeleton } from '../design-system';
import { SlideTabs } from '../features/SlideTabs';
import { ChatMessage, ChatPane, mergeMessages } from '../features/store-chat/ChatKit';
import type { ChatTicket } from '../features/store-chat/chat-media';
import { HelpMessage, HelpState, helpToKit } from '../features/store-chat/help-chat';
import '../features/store-chat/support-inbox.css';
import { api } from '../lib/api';
import { TENANT_STATUS, tenantUrl, useOpenTenant } from './TenantsPages';
import { Level, Monogram, Tag } from './ui';

/**
 * Super Admin › Conversas: os restaurantes escrevem pela aba "Suporte" do chat do sistema e a
 * resposta sai daqui. Dá para começar uma conversa pela tela do restaurante.
 */

interface ChatRow {
  tenantId: string;
  name: string;
  slug: string;
  tenantStatus: string;
  planName: string | null;
  subscriptionStatus: string | null;
  status: 'open' | 'closed';
  lastMessageAt: string | null;
  lastPreview: string | null;
  lastSender: 'tenant' | 'admin' | 'system' | null;
  unread: number;
}

interface Detail extends HelpState {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    createdAt?: string;
    planName?: string | null;
    subscriptionStatus?: string | null;
    trialEndsAt?: string | null;
  };
}

const SUB_LEVEL: Record<string, Level> = {
  trialing: 'info',
  active: 'ok',
  past_due: 'warn',
  cancelled: 'off',
};
const subLabel = (s: string) => SUBSCRIPTION_LABELS[s as keyof typeof SUBSCRIPTION_LABELS] ?? s;
const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const host = (slug: string) =>
  tenantUrl(slug)
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');

const POLL_MS = 8000;
export const SUPPORT_CHANGED_EVENT = 'cm:admin-support-changed';
const changed = () => window.dispatchEvent(new Event(SUPPORT_CHANGED_EVENT));

const when = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const diff = (today.getTime() - d.getTime()) / 86_400_000;
  if (diff < 6) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

interface BoardTicket {
  id: string;
  code: string;
  title: string;
  state: string;
  tenant: { id: string };
}

function Conversation({
  tenantId,
  ticketId,
  onBack,
}: {
  tenantId: string;
  /** Veio do chamado ("Conversar sobre este chamado"): ele já vem citado. */
  ticketId: string | null;
  onBack(): void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  // Chamados abertos deste restaurante, para citar pelo clipe.
  const [tickets, setTickets] = useState<ChatTicket[] | undefined>(undefined);
  useEffect(() => {
    let live = true;
    api<{ tickets: BoardTicket[] }>('/platform/tickets')
      .then((b) => {
        if (!live) return;
        setTickets(
          b.tickets
            .filter((x) => x.tenant.id === tenantId)
            .map((x) => ({ id: x.id, code: x.code, title: x.title })),
        );
      })
      .catch(() => live && setTickets(undefined));
    return () => {
      live = false;
    };
  }, [tenantId]);
  const [initialTicket, setInitialTicket] = useState<ChatTicket | null>(null);
  useEffect(() => {
    if (!ticketId) return;
    let live = true;
    api<{ id: string; code: string; title: string }>(`/platform/tickets/${ticketId}`)
      .then((x) => live && setInitialTicket({ id: x.id, code: x.code, title: x.title }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ticketId]);
  const { open, busy, sheet } = useOpenTenant();
  const [d, setD] = useState<(Omit<Detail, 'messages'> & { messages: ChatMessage[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<Detail>(`/platform/support/${tenantId}`);
      setError(null);
      setD((x) => ({
        ...r,
        messages: mergeMessages(
          x && x.tenant.id === tenantId ? x.messages : [],
          r.messages.map(helpToKit),
        ),
        hasMore: x && x.messages.length > r.messages.length ? x.hasMore : r.hasMore,
      }));
      if (r.unread > 0) {
        await api(`/platform/support/${tenantId}/read`, { method: 'POST' }).catch(() => 0);
        changed();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [tenantId]);

  useEffect(() => {
    setD(null);
    void load();
    const t = setInterval(() => !document.hidden && void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  async function setStatus(status: 'open' | 'closed') {
    try {
      await api(`/platform/support/${tenantId}`, { method: 'PATCH', json: { status } });
      toast(status === 'closed' ? 'Conversa encerrada' : 'Conversa reaberta', 'success');
      changed();
      void load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  if (!d)
    return (
      <div className="sinbox__empty">{error ? <p>{error}</p> : <Skeleton variant="chat" />}</div>
    );
  const t = d.tenant;
  const [tenantLabel, tenantLevel] = TENANT_STATUS[t.status] ?? [t.status, 'off' as Level];
  const closed = d.status === 'closed';
  return (
    <div className="sinbox__conv">
      <header className="sinbox__head">
        <button type="button" className="sinbox__back" aria-label="Voltar" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <Monogram name={t.name} size={38} />
        <div className="sinbox__who">
          <strong>{t.name}</strong>
          <small>
            <span className="sinbox__state" data-closed={closed || undefined}>
              {closed ? 'Conversa encerrada' : 'Conversa aberta'}
            </span>
            {t.planName && <span className="sinbox__plan">{t.planName}</span>}
            <span className="sinbox__host">{host(t.slug)}</span>
          </small>
        </div>
        <div className="sinbox__actions">
          <Link
            className="sinbox__btn sinbox__btn--narrow"
            to={`/restaurantes/${t.id}`}
            title="Abrir o restaurante"
          >
            <ExternalLink size={15} />
            <span className="sinbox__btn-text">Restaurante</span>
          </Link>
          {d.messages.length > 0 &&
            (!closed ? (
              <button
                type="button"
                className="sinbox__btn"
                onClick={() => setStatus('closed')}
                title="Encerrar (volta a abrir se o restaurante escrever)"
              >
                <CheckCircle2 size={15} />
                <span className="sinbox__btn-text">Encerrar</span>
              </button>
            ) : (
              <button type="button" className="sinbox__btn" onClick={() => setStatus('open')}>
                <RotateCcw size={15} />
                <span className="sinbox__btn-text">Reabrir</span>
              </button>
            ))}
        </div>
      </header>
      <div className="sinbox__body">
        <ChatPane
          key={tenantId}
          bubbles
          side="staff"
          names={{ customer: t.name, staff: 'Suporte Comandou' }}
          messages={d.messages}
          hasMore={d.hasMore}
          otherReadAt={d.otherReadAt}
          autoFocus
          onLoadMore={async () => {
            const first = d.messages[0];
            if (!first) return;
            const older = await api<{ messages: HelpMessage[]; hasMore: boolean }>(
              `/platform/support/${tenantId}/messages?before=${encodeURIComponent(first.createdAt)}`,
            );
            setD((x) =>
              x
                ? {
                    ...x,
                    messages: mergeMessages(older.messages.map(helpToKit), x.messages),
                    hasMore: older.hasMore,
                  }
                : x,
            );
          }}
          uploadPath={`/platform/support/${tenantId}/files`}
          tickets={tickets}
          initialTicket={initialTicket}
          onTicket={(x) => navigate(`/chamados?chamado=${x.id}`)}
          send={async (input) =>
            helpToKit(
              await api<HelpMessage>(`/platform/support/${tenantId}/messages`, {
                method: 'POST',
                json: {
                  body: input.body,
                  fileId: input.fileId ?? null,
                  ticketId: input.ticketId ?? null,
                },
              }),
            )
          }
          onSent={(m) => {
            setD((x) => (x ? { ...x, messages: mergeMessages(x.messages, [m]) } : x));
            changed();
          }}
          onError={(m) => toast(m, 'danger')}
          placeholder="Escreva a resposta"
          empty={
            <div className="sinbox__start">
              <MessageCircle size={28} aria-hidden />
              <strong>Nenhuma mensagem ainda</strong>
              <p>
                Escreva para começar a conversa. A mensagem chega na aba Suporte do chat do sistema
                de {t.name}.
              </p>
            </div>
          }
        />
        <aside className="sdesk" aria-label="Sobre o restaurante">
          <div className="sdesk__card sdesk__who">
            <Monogram name={t.name} size={52} />
            <strong>{t.name}</strong>
            <a href={tenantUrl(t.slug)} target="_blank" rel="noreferrer noopener">
              <Globe size={13} aria-hidden /> {host(t.slug)}
            </a>
            <div className="sdesk__btns">
              <button
                type="button"
                className="sinbox__btn"
                onClick={() => void open(t.id)}
                disabled={!!busy}
                title="Abre o sistema do restaurante já entrado, numa nova aba"
              >
                <LogIn size={15} /> {busy ? 'Abrindo…' : 'Entrar no sistema'}
              </button>
              <Link className="sinbox__btn" to={`/restaurantes/${t.id}`}>
                <ExternalLink size={15} /> Ver cadastro
              </Link>
            </div>
          </div>
          <div className="sdesk__card">
            <h3>Detalhes</h3>
            <dl className="sdesk__facts">
              <div>
                <dt>Situação</dt>
                <dd>
                  <Tag level={tenantLevel}>{tenantLabel}</Tag>
                </dd>
              </div>
              <div>
                <dt>Plano</dt>
                <dd>{t.planName ?? 'sem plano'}</dd>
              </div>
              {t.subscriptionStatus && (
                <div>
                  <dt>Assinatura</dt>
                  <dd>
                    <Tag level={SUB_LEVEL[t.subscriptionStatus] ?? 'off'}>
                      {subLabel(t.subscriptionStatus)}
                    </Tag>
                  </dd>
                </div>
              )}
              {t.subscriptionStatus === 'trialing' && t.trialEndsAt && (
                <div>
                  <dt>Teste até</dt>
                  <dd>{longDate(t.trialEndsAt)}</dd>
                </div>
              )}
              {t.createdAt && (
                <div>
                  <dt>Cliente desde</dt>
                  <dd>{longDate(t.createdAt)}</dd>
                </div>
              )}
              <div>
                <dt>Mensagens</dt>
                <dd>
                  {d.messages.length}
                  {d.hasMore ? '+' : ''}
                </dd>
              </div>
            </dl>
          </div>
          <p className="sdesk__hint">
            Encerrar só arruma a lista: se o restaurante escrever de novo, a conversa volta para
            Abertas.
          </p>
        </aside>
      </div>
      {sheet}
    </div>
  );
}

export function SupportPage() {
  const [params, setParams] = useSearchParams();
  const current = params.get('r');
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open');
  const [q, setQ] = useState('');
  const [list, setList] = useState<ChatRow[] | null>(null);
  const qRef = useRef(q);
  qRef.current = q;

  const setCurrent = (id: string | null) =>
    setParams(id ? { r: id } : {}, { replace: !!current && !!id });

  const load = useCallback(() => {
    const qs = new URLSearchParams({ status });
    if (qRef.current.trim()) qs.set('q', qRef.current.trim());
    void api<ChatRow[]>(`/platform/support?${qs}`)
      .then(setList)
      .catch(() => setList((l) => l ?? []));
  }, [status]);

  useEffect(() => {
    const t = window.setTimeout(load, q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    const t = setInterval(() => !document.hidden && load(), POLL_MS);
    window.addEventListener(SUPPORT_CHANGED_EVENT, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(SUPPORT_CHANGED_EVENT, load);
    };
  }, [load]);

  return (
    <div className="adm-support-page">
      <h1 className="cm-sr-only">Conversas</h1>
      <div className="adm-support">
        <div className="sinbox" data-open={current ? '' : undefined}>
          <aside className="sinbox__list" aria-label="Conversas">
            <div className="sinbox__tools">
              <label className="sinbox__search">
                <Search size={15} aria-hidden />
                <input
                  placeholder="Buscar restaurante"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  aria-label="Buscar restaurante"
                />
              </label>
              <SlideTabs
                size="sm"
                label="Filtrar conversas"
                value={status}
                onChange={(v) => setStatus(v as 'open' | 'closed' | 'all')}
                tabs={[
                  { value: 'open', label: 'Abertas' },
                  { value: 'closed', label: 'Encerradas' },
                  { value: 'all', label: 'Todas' },
                ]}
              />
            </div>
            {!list ? (
              <div className="sinbox__empty">
                <Skeleton />
              </div>
            ) : list.length === 0 ? (
              <div className="sinbox__empty">
                <MessageCircle size={28} />
                <p>
                  {status === 'open'
                    ? 'Nenhuma conversa aberta. Quando um restaurante escrever pela aba Suporte, ela aparece aqui.'
                    : 'Nada por aqui.'}
                </p>
              </div>
            ) : (
              <ul>
                {list.map((c) => (
                  <li key={c.tenantId}>
                    <button
                      type="button"
                      className="sinbox__item"
                      aria-current={c.tenantId === current || undefined}
                      data-unread={c.unread > 0 || undefined}
                      onClick={() => setCurrent(c.tenantId)}
                    >
                      <Monogram name={c.name} size={38} />
                      <span className="sinbox__item-text">
                        <span className="sinbox__item-top">
                          <strong>{c.name}</strong>
                          <time>{when(c.lastMessageAt)}</time>
                        </span>
                        <span className="sinbox__item-bottom">
                          <span className="sinbox__preview">
                            {c.lastSender === 'admin' && 'Você: '}
                            {c.lastPreview}
                          </span>
                          {c.unread > 0 && <b className="sinbox__count">{c.unread}</b>}
                          {c.status === 'closed' && (
                            <small className="sinbox__closed">encerrada</small>
                          )}
                        </span>
                        {c.planName && <small className="adm-support__plan">{c.planName}</small>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
          <section className="sinbox__main">
            {current ? (
              <Conversation
                tenantId={current}
                ticketId={params.get('chamado')}
                onBack={() => setCurrent(null)}
              />
            ) : (
              <div className="sinbox__empty sinbox__empty--main">
                <MessageCircle size={34} />
                <p>Escolha uma conversa para responder.</p>
                <small>
                  Para falar com um restaurante que ainda não escreveu, abra ele em Restaurantes e
                  toque em <strong>Conversar</strong>.
                </small>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
