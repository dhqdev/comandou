import {
  CHANNEL_ACTION_LABELS,
  channelInfo,
  withArticle,
  type ChannelAction,
} from '@comandou/shared';
import { ArrowRight, Check, ChevronDown, Link2, RotateCcw, Store } from 'lucide-react';
import { Link } from 'react-router';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Alert, Badge, Button, Card, EmptyState, Spinner, useToast } from '../design-system';
import { useCan } from '../app/auth';
import { AppReviewsCard } from '../features/channels/AppReviews';
import { ChannelBadge } from '../features/channels/ChannelBadge';
import { ConnectStore, connectsHere } from '../features/channels/ConnectStore';
import {
  StorePauseControls,
  StoreStateLine,
  type ChannelStoreStateView,
} from '../features/channels/StoreState';
import { dateTime } from '../features/format';
import { SelectField } from '../features/forms';
import { api, type Product } from '../lib/api';
import { useLinkParam } from '../lib/deep-link';
import { brl } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import '../app/home.css';
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
  if (!c.configured) return { tone: 'warn', text: 'Ainda não liberado' };
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
  // Volta da autorização do aiqfome: ?aiqfome=ok|erro|cancelado (&motivo=...).
  useLinkParam('aiqfome', (r) => {
    const reason = new URLSearchParams(window.location.search).get('motivo');
    if (r === 'ok')
      toast('Loja do aiqfome ligada. Marque "Receber pedidos" para começar.', 'success');
    else if (r === 'cancelado') toast('Autorização do aiqfome cancelada');
    else toast(reason ?? 'Não deu para ligar a loja do aiqfome', 'danger');
  });
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
  // Com loja: cartão grande. Disponível sem loja: cartão de ligar. O resto: "Em breve".
  const live = ordered.filter((c) => c.available && c.stores.length > 0);
  const setup = ordered.filter((c) => c.available && c.stores.length === 0);
  const soon = ordered.filter((c) => !c.available);

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
        <>
          <Overview channels={ordered} failures={failures} />

          {live.length > 0 && (
            <section className="intg-group" aria-labelledby="intg-live">
              <h2 id="intg-live" className="intg-group__title">
                Ligados
              </h2>
              <div className="intg-live">
                {live.map((c) => (
                  <LiveChannel
                    key={c.id}
                    channel={c}
                    canConfigure={canConfigure}
                    canPause={canPause}
                    onChanged={() => void load()}
                    onPatch={(id, json) => call(`/channels/stores/${id}`, json, 'PATCH')}
                  />
                ))}
              </div>
            </section>
          )}

          {setup.length > 0 && (
            <section className="intg-group" aria-labelledby="intg-setup">
              <h2 id="intg-setup" className="intg-group__title">
                {live.length ? 'Ligar mais um aplicativo' : 'Ligue o seu primeiro aplicativo'}
              </h2>
              <div className="intg-setup">
                {setup.map((c) => (
                  <SetupChannel
                    key={c.id}
                    channel={c}
                    canConfigure={canConfigure}
                    onDone={() => void load()}
                  />
                ))}
              </div>
            </section>
          )}

          {soon.length > 0 && (
            <p className="intg-soon">
              <span>Em breve:</span>
              {soon.map((c) => (
                <ChannelBadge key={c.id} channel={c.id} label={c.label} size="sm" />
              ))}
            </p>
          )}
        </>
      )}

      <AppReviewsCard canReply={canPause} />

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

/** Nome do aplicativo num bloco na cor da marca (cor de marca é dado: igual no claro e no escuro). */
function ChannelMark({ channel, label }: { channel: string; label: string }) {
  const info = channelInfo(channel, label);
  return (
    <span
      className="intg-mark"
      style={{ '--ch': info.color, '--ch-ink': info.ink } as CSSProperties}
    >
      {info.label}
    </span>
  );
}

/** Um quadro só com os números da tela, separados por linha fina. */
function Overview({ channels, failures }: { channels: ChannelView[]; failures: number }) {
  const available = channels.filter((c) => c.available);
  const receiving = available.filter((c) => situation(c).tone === 'ok').length;
  const stores = available.flatMap((c) => c.stores);
  const paused = stores.filter(
    (s) => s.pausedHere || s.channelState === 'paused' || s.channelState === 'closed',
  ).length;
  const items: { label: string; value: string; note: string; tone?: 'ok' | 'warn' | 'danger' }[] = [
    {
      label: 'Recebendo pedidos',
      value: `${receiving} de ${available.length}`,
      note: available.length === 1 ? 'aplicativo' : 'aplicativos',
      tone: receiving > 0 ? 'ok' : undefined,
    },
    {
      label: 'Lojas ligadas',
      value: String(stores.length),
      note: stores.length === 1 ? 'loja' : 'lojas',
    },
    {
      label: 'Pausadas agora',
      value: String(paused),
      note: paused ? 'nos aplicativos' : 'tudo aberto',
      tone: paused ? 'warn' : undefined,
    },
    {
      label: 'Falhas em 7 dias',
      value: String(failures),
      note: failures ? 'veja embaixo' : 'nada falhou',
      tone: failures ? 'danger' : undefined,
    },
  ];
  return (
    <div className="intg-overview">
      {items.map((i) => (
        <div key={i.label} className="intg-overview__item">
          <span className="intg-overview__label" data-tone={i.tone}>
            {i.label}
          </span>
          <strong>{i.value}</strong>
          <small>{i.note}</small>
        </div>
      ))}
    </div>
  );
}

/** Liga/desliga com nome e frase (a linha inteira é o toque). */
function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange(v: boolean): void;
}) {
  return (
    <label className="intg-toggle" data-disabled={disabled || undefined}>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className="switch">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="switch__track" aria-hidden />
      </span>
    </label>
  );
}

/** O que funciona com o aplicativo: o que tem com visto e, embaixo, o que ele não oferece. */
function Capabilities({ channel }: { channel: ChannelView }) {
  const on = channel.capabilities.filter((k) => k.on);
  const off = channel.capabilities.filter((k) => !k.on);
  return (
    <details className="intg-caps">
      <summary>
        O que funciona com {channel.label}
        <span className="intg-caps__count">
          {on.length} de {channel.capabilities.length}
        </span>
        <ChevronDown size={16} aria-hidden className="intg-caps__chev" />
      </summary>
      {on.length > 0 && (
        <ul className="intg-caps__on">
          {on.map((k) => (
            <li key={k.id}>
              <Check size={14} strokeWidth={2.4} aria-hidden />
              {k.label}
            </li>
          ))}
        </ul>
      )}
      {off.length > 0 && (
        <p className="intg-caps__off">
          {withArticle(channel.label, 'O')} não oferece: {off.map((k) => k.label).join(', ')}.
        </p>
      )}
    </details>
  );
}

/** Aplicativo com loja ligada: situação, cada loja com os ajustes e o que funciona. */
function LiveChannel({
  channel: c,
  canConfigure,
  canPause,
  onChanged,
  onPatch,
}: {
  channel: ChannelView;
  canConfigure: boolean;
  canPause: boolean;
  onChanged(): void;
  onPatch(storeId: string, json: object): Promise<boolean>;
}) {
  const st = situation(c);
  const has = (id: string) => c.capabilities.some((x) => x.id === id && x.on);
  return (
    <article className="intg-ch" data-search-id={`canal-${c.id}`}>
      <header className="intg-ch__head">
        <ChannelMark channel={c.id} label={c.label} />
        <span className="intg-state" data-tone={st.tone}>
          {st.text}
        </span>
        {(c.failedEvents > 0 || c.failedActions > 0 || c.pendingActions > 0) && (
          <span className="intg-counts">
            {c.pendingActions > 0 && <span>{c.pendingActions} enviando</span>}
            {c.failedActions > 0 && (
              <span data-tone="danger">
                {c.failedActions === 1 ? '1 ação falhou' : `${c.failedActions} ações falharam`}
              </span>
            )}
            {c.failedEvents > 0 && (
              <span data-tone="danger">
                {c.failedEvents === 1 ? '1 evento falhou' : `${c.failedEvents} eventos falharam`}
              </span>
            )}
          </span>
        )}
      </header>

      {c.stores.map((s) => (
        <div key={s.id} className="intg-store">
          <div className="intg-store__main">
            <div className="intg-store__name">
              <Store size={18} aria-hidden />
              <strong>{s.name}</strong>
              {s.status === 'revoked' && <Badge tone="danger">sem autorização</Badge>}
            </div>
            {has('storeStatus') && <StoreStateLine store={s} />}
            <dl className="intg-facts">
              <div>
                <dt>Último pedido</dt>
                <dd>{s.lastOrderAt ? dateTime(s.lastOrderAt) : 'nenhum ainda'}</dd>
              </div>
              <div>
                <dt>Último contato</dt>
                <dd>{s.lastEventAt ? dateTime(s.lastEventAt) : 'nenhum ainda'}</dd>
              </div>
            </dl>
            {s.lastError && <p className="intg-error">{s.lastError}</p>}
            {canPause && has('pause') && <StorePauseControls store={s} onChanged={onChanged} />}
          </div>
          <div className="intg-store__opts">
            <Toggle
              label="Receber pedidos"
              description="Busca os pedidos desta loja a cada 30 segundos."
              checked={s.receiveOrders}
              disabled={!canConfigure || s.status === 'revoked'}
              onChange={(v) => void onPatch(s.id, { receiveOrders: v })}
            />
            <Toggle
              label="Aceitar sozinho"
              description="Desligado, o pedido chega em análise e alguém aceita na tela de Pedidos."
              checked={s.autoAccept}
              disabled={!canConfigure}
              onChange={(v) => void onPatch(s.id, { autoAccept: v })}
            />
            {has('pause') && (
              <Toggle
                label="Fechar junto com a loja do Comandou"
                description={`"Loja fechada" no PDV pausa ${withArticle(c.label, 'o')} e "Loja aberta" tira a pausa.`}
                checked={s.followStoreOpen}
                disabled={!canConfigure}
                onChange={(v) => void onPatch(s.id, { followStoreOpen: v })}
              />
            )}
          </div>
        </div>
      ))}

      <footer className="intg-ch__foot">
        <Capabilities channel={c} />
        {connectsHere(c.id) && c.configured && canConfigure && (
          <ConnectStore channel={c.id} label={c.label} onDone={onChanged} />
        )}
      </footer>
    </article>
  );
}

/** Aplicativo disponível ainda sem loja: o que fazer para ligar. */
function SetupChannel({
  channel: c,
  canConfigure,
  onDone,
}: {
  channel: ChannelView;
  canConfigure: boolean;
  onDone(): void;
}) {
  const st = situation(c);
  const on = c.capabilities.filter((k) => k.on).length;
  const here = connectsHere(c.id) && c.configured;
  return (
    <article className="intg-new" data-search-id={`canal-${c.id}`}>
      <div className="intg-new__head">
        <ChannelMark channel={c.id} label={c.label} />
        <span className="intg-state" data-tone={st.tone}>
          {st.text}
        </span>
      </div>
      <p className="intg-new__text">
        {!c.configured
          ? `${withArticle(c.label, 'O')} ainda não foi liberado para o seu restaurante. Fale com o suporte do Comandou.`
          : c.id === 'ifood'
            ? 'A loja do iFood se liga no cardápio. Depois ela aparece aqui e você liga "Receber pedidos".'
            : here && !canConfigure
              ? 'Quem cuida dos ajustes do restaurante liga a loja aqui.'
              : `Pedidos ${withArticle(c.label, 'do')} entram na mesma fila da cozinha, com ${on} recursos funcionando daqui.`}
      </p>
      <div className="intg-new__foot">
        {c.configured && c.id === 'ifood' && (
          <Link className="cm-btn cm-btn--secondary cm-btn--sm" to="/cardapio/cardapios">
            Ligar no Cardápio
            <ArrowRight size={14} aria-hidden />
          </Link>
        )}
        {here && canConfigure && <ConnectStore channel={c.id} label={c.label} onDone={onDone} />}
        <Capabilities channel={c} />
      </div>
    </article>
  );
}
