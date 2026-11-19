import { CHANNEL_ACTION_LABELS, type ChannelAction } from '@comandou/shared';
import { Link2, RotateCcw, Store } from 'lucide-react';
import { Link } from 'react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, EmptyState, Spinner, useToast } from '../design-system';
import { useCan } from '../app/auth';
import { ChannelBadge } from '../features/channels/ChannelBadge';
import {
  StorePauseControls,
  StoreStateLine,
  type ChannelStoreStateView,
} from '../features/channels/StoreState';
import { dateTime } from '../features/format';
import { CheckField, SelectField } from '../features/forms';
import { api, type Product } from '../lib/api';
import { brl } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import './integrations.css';

interface StoreView extends ChannelStoreStateView {
  storeId: string;
  receiveOrders: boolean;
  autoAccept: boolean;
  lastError: string | null;
  lastEventAt: string | null;
  lastOrderAt: string | null;
}

interface ChannelView {
  id: string;
  label: string;
  available: boolean;
  configured: boolean;
  capabilities: { id: string; label: string; on: boolean }[];
  stores: StoreView[];
  failedEvents: number;
  failedActions: number;
  pendingActions: number;
}

interface Problems {
  events: {
    id: string;
    channel: string;
    kind: string;
    externalOrderId: string | null;
    lastError: string | null;
    at: string;
  }[];
  actions: {
    id: string;
    channel: string;
    action: ChannelAction;
    orderNumber: number | null;
    externalCode: string | null;
    lastError: string | null;
    at: string;
  }[];
}

interface Unlinked {
  channel: string;
  itemKey: string;
  externalCode: string | null;
  name: string;
  lastPrice: string;
  orders: number;
  lastAt: string;
}

interface LinkRow {
  channel: string;
  itemKey: string;
  productName: string;
  channelName: string | null;
}

/** Situação do aplicativo em uma frase, com a bolinha de cor. */
function situation(c: ChannelView): { tone: 'ok' | 'warn' | 'off'; text: string } {
  if (!c.available) return { tone: 'off', text: 'Em breve no Comandou' };
  if (!c.configured) return { tone: 'warn', text: 'Falta a credencial no Super Admin' };
  if (!c.stores.length) return { tone: 'warn', text: 'Nenhuma loja ligada' };
  if (c.stores.some((s) => s.status === 'revoked'))
    return { tone: 'warn', text: 'Loja sem autorização' };
  if (!c.stores.some((s) => s.receiveOrders))
    return { tone: 'warn', text: 'Recebimento de pedidos desligado' };
  return { tone: 'ok', text: 'Recebendo pedidos' };
}

/**
 * Integrações › Aplicativos de delivery: um cartão por aplicativo (situação, lojas, último evento,
 * erros e ajustes), o que falhou e os itens que chegaram sem vínculo com o cardápio.
 */
export function IntegrationsPage() {
  const toast = useToast();
  const canConfigure = useCan('settings:manage');
  const canLink = useCan('catalog:write');
  const canPause = useCan('orders:manage');
  const [channels, setChannels] = useState<ChannelView[] | null>(null);
  const [problems, setProblems] = useState<Problems | null>(null);
  const [unlinked, setUnlinked] = useState<Unlinked[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, p, u, l] = await Promise.all([
        api<{ channels: ChannelView[] }>('/channels'),
        api<Problems>('/channels/problems'),
        api<Unlinked[]>('/channels/unlinked'),
        api<LinkRow[]>('/channels/links'),
      ]);
      setChannels(o.channels);
      setProblems(p);
      setUnlinked(u);
      setLinks(l);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!canLink) return;
    api<Product[]>('/products')
      .then((p) => setProducts(p.filter((x) => x.active)))
      .catch(() => undefined);
  }, [canLink]);
  const reload = useDebounced(load);
  useRealtime((e) => {
    if (e.type === 'channels.changed' || e.type === 'order.changed') reload();
  }, load);

  async function call(url: string, json: object = {}, method: 'POST' | 'PATCH' = 'POST') {
    try {
      await api(url, { method, json });
      await load();
      return true;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return false;
    }
  }

  // Os aplicativos com loja ou já disponíveis primeiro; os que ainda vêm depois.
  const ordered = useMemo(
    () =>
      [...(channels ?? [])].sort(
        (a, b) => Number(b.available) - Number(a.available) || b.stores.length - a.stores.length,
      ),
    [channels],
  );
  const failures = (problems?.events.length ?? 0) + (problems?.actions.length ?? 0);

  return (
    <>
      <div>
        <h1 className="page-title">Aplicativos de delivery</h1>
        <p className="page-sub">
          Pedidos do iFood e dos outros aplicativos chegam sozinhos e seguem o caminho de sempre:
          cozinha, impressão, entrega, caixa e estoque.
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {unlinked.length > 0 && (
        <Alert tone="warning">
          {unlinked.length === 1
            ? '1 item chegou sem vínculo com o cardápio.'
            : `${unlinked.length} itens chegaram sem vínculo com o cardápio.`}{' '}
          Os pedidos entraram normalmente; ligue cada item a um produto lá embaixo para a baixa de
          estoque e os relatórios ficarem certos.
        </Alert>
      )}

      {channels === null ? (
        <Spinner />
      ) : (
        <div className="intg-grid">
          {ordered.map((c) => {
            const st = situation(c);
            return (
              <section key={c.id} className="intg-card" data-search-id={`canal-${c.id}`}>
                <header className="intg-card__head">
                  <ChannelBadge channel={c.id} />
                  <span className="intg-state" data-tone={st.tone}>
                    {st.text}
                  </span>
                </header>
                {c.id === 'ifood' && c.available && c.stores.length === 0 && (
                  <p className="intg-hint">
                    Ligue a loja do iFood em{' '}
                    <Link to="/cardapio/cardapios">Cardápio › Cardápios</Link>. Ela aparece aqui e
                    você marca "Receber pedidos".
                  </p>
                )}
                {c.stores.length > 0 && (
                  <ul className="intg-stores">
                    {c.stores.map((s) => (
                      <li key={s.id} className="intg-store">
                        <div className="intg-store__name">
                          <Store size={16} aria-hidden />
                          <strong>{s.name}</strong>
                          {s.status === 'revoked' && <Badge tone="danger">sem autorização</Badge>}
                        </div>
                        {c.capabilities.some((x) => x.id === 'storeStatus' && x.on) && (
                          <StoreStateLine store={s} />
                        )}
                        {canPause && c.capabilities.some((x) => x.id === 'pause' && x.on) && (
                          <StorePauseControls store={s} onChanged={() => void load()} />
                        )}
                        <dl className="intg-facts">
                          <dt>Último evento</dt>
                          <dd>{s.lastEventAt ? dateTime(s.lastEventAt) : 'nenhum ainda'}</dd>
                          <dt>Último pedido</dt>
                          <dd>{s.lastOrderAt ? dateTime(s.lastOrderAt) : 'nenhum ainda'}</dd>
                        </dl>
                        {s.lastError && <p className="intg-error">{s.lastError}</p>}
                        <div className="intg-store__opts">
                          <CheckField
                            label="Receber pedidos"
                            description="Busca os pedidos desta loja a cada 30 segundos."
                            checked={s.receiveOrders}
                            disabled={!canConfigure || s.status === 'revoked'}
                            onChange={(v) =>
                              void call(`/channels/stores/${s.id}`, { receiveOrders: v }, 'PATCH')
                            }
                          />
                          <CheckField
                            label="Aceitar sozinho"
                            description="Sem isso, o pedido chega em análise e alguém aceita na tela de Pedidos."
                            checked={s.autoAccept}
                            disabled={!canConfigure}
                            onChange={(v) =>
                              void call(`/channels/stores/${s.id}`, { autoAccept: v }, 'PATCH')
                            }
                          />
                          {c.capabilities.some((x) => x.id === 'pause' && x.on) && (
                            <CheckField
                              label="Fechar junto com a loja do Comandou"
                              description={`"Loja fechada" no PDV pausa o ${c.label} e "Loja aberta" tira a pausa.`}
                              checked={s.followStoreOpen}
                              disabled={!canConfigure}
                              onChange={(v) =>
                                void call(
                                  `/channels/stores/${s.id}`,
                                  { followStoreOpen: v },
                                  'PATCH',
                                )
                              }
                            />
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {(c.failedEvents > 0 || c.failedActions > 0 || c.pendingActions > 0) && (
                  <p className="intg-counts">
                    {c.pendingActions > 0 && <span>{c.pendingActions} enviando</span>}
                    {c.failedActions > 0 && (
                      <span data-tone="danger">{c.failedActions} ações falharam</span>
                    )}
                    {c.failedEvents > 0 && (
                      <span data-tone="danger">{c.failedEvents} eventos falharam</span>
                    )}
                  </p>
                )}
                <details className="intg-caps">
                  <summary>O que funciona com {c.label}</summary>
                  <ul>
                    {c.capabilities.map((k) => (
                      <li key={k.id} data-on={k.on || undefined}>
                        {k.label}
                      </li>
                    ))}
                  </ul>
                </details>
              </section>
            );
          })}
        </div>
      )}

      {failures > 0 && problems && (
        <Card title="O que falhou nos últimos 7 dias" searchId="secao-falhas">
          <ul className="plain-list">
            {problems.actions.map((a) => (
              <li key={a.id} className="intg-fail">
                <span>
                  <ChannelBadge channel={a.channel} code={a.externalCode} size="sm" />{' '}
                  <strong>{CHANNEL_ACTION_LABELS[a.action] ?? a.action}</strong>
                  {a.orderNumber && ` · pedido #${a.orderNumber}`}
                  <span className="cm-hint"> · {a.lastError ?? 'sem resposta'}</span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RotateCcw size={14} />}
                  onClick={() => void call(`/channels/actions/${a.id}/retry`)}
                >
                  Tentar de novo
                </Button>
              </li>
            ))}
            {problems.events.map((e) => (
              <li key={e.id} className="intg-fail">
                <span>
                  <ChannelBadge channel={e.channel} size="sm" /> Evento recebido
                  {e.externalOrderId && ` do pedido ${e.externalOrderId}`}
                  <span className="cm-hint"> · {e.lastError ?? 'falhou'}</span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RotateCcw size={14} />}
                  onClick={() => void call(`/channels/events/${e.id}/retry`)}
                >
                  Tentar de novo
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Itens sem vínculo" searchId="secao-sem-vinculo">
        {unlinked.length === 0 ? (
          <EmptyState
            icon={<Link2 size={20} />}
            title="Tudo ligado"
            description="Quando um item do aplicativo não bater com o cardápio, ele aparece aqui."
          />
        ) : (
          <ul className="plain-list">
            {unlinked.map((u) => (
              <UnlinkedRow
                key={`${u.channel}:${u.itemKey}`}
                item={u}
                products={products}
                canLink={canLink}
                onLink={(productId) =>
                  call('/channels/links', { channel: u.channel, itemKey: u.itemKey, productId })
                }
              />
            ))}
          </ul>
        )}
      </Card>

      {links.length > 0 && (
        <Card title="Itens ligados" searchId="secao-vinculos">
          <ul className="plain-list">
            {links.map((l) => (
              <li key={`${l.channel}:${l.itemKey}`} className="intg-fail">
                <span>
                  <ChannelBadge channel={l.channel} size="sm" /> {l.channelName ?? l.itemKey}
                  <span className="cm-hint"> → {l.productName}</span>
                </span>
                {canLink && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void call('/channels/links/remove', {
                        channel: l.channel,
                        itemKey: l.itemKey,
                      })
                    }
                  >
                    Desfazer
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function UnlinkedRow({
  item,
  products,
  canLink,
  onLink,
}: {
  item: Unlinked;
  products: Product[];
  canLink: boolean;
  onLink(productId: string): Promise<boolean>;
}) {
  const [productId, setProductId] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <li className="intg-unlinked">
      <div className="intg-unlinked__what">
        <ChannelBadge channel={item.channel} size="sm" /> <strong>{item.name}</strong>
        <span className="cm-hint">
          {item.externalCode ? ` · código ${item.externalCode}` : ''} · {brl(item.lastPrice)} ·{' '}
          {item.orders === 1 ? '1 pedido' : `${item.orders} pedidos`}
        </span>
      </div>
      {canLink && (
        <div className="intg-unlinked__form">
          <SelectField
            label="Produto do cardápio"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">Escolha…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <Button
            variant="secondary"
            disabled={!productId || busy}
            onClick={async () => {
              setBusy(true);
              await onLink(productId);
              setBusy(false);
            }}
          >
            Ligar
          </Button>
        </div>
      )}
    </li>
  );
}
