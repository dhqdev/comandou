import { fromCents, qtyLabel, toCents } from '@comandou/shared';
import { Spinner } from '../../design-system';
import { ChevronRight, ReceiptText } from 'lucide-react';
import { CSSProperties, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { dateTime } from '../../features/format';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import { useStore } from './context';
import { AccountOrder, recentOrders, STEP_LABEL, tableOrders } from './store';
import { OrdersArt } from './art';
import { Photo } from './ui';
import './table-welcome.css';

const TONE: Record<AccountOrder['step'], string> = {
  awaiting: 'warn',
  accepted: 'brand',
  ready: 'info',
  dispatched: 'brand',
  completed: 'ok',
  cancelled: 'bad',
};

/** Como o pedido da mesa está (o servidor manda o mesmo passo do acompanhamento). */
interface TableOrderView {
  number: number;
  step: AccountOrder['step'];
  total: string;
  items: { name: string; quantity: string; unit?: string; imageUrl: string | null }[];
}
const TABLE_STEP: Record<AccountOrder['step'], string> = {
  ...STEP_LABEL,
  ready: 'Pronto',
  completed: 'Na mesa',
};

/**
 * Aba "Minha mesa" do cardápio da mesa: os pedidos que este aparelho mandou para ela, com o passo
 * de cada um (atualiza sozinho) e quanto já foi pedido. Sem conta e sem histórico de outras mesas.
 */
function TableOrdersScreen() {
  const { table } = useStore();
  const list = table ? tableOrders(table.id) : [];
  const tokens = list.map((o) => o.token).join(',');
  const [views, setViews] = useState<Record<string, TableOrderView>>({});

  useEffect(() => {
    if (!tokens) return;
    const load = () =>
      tokens.split(',').forEach((t) =>
        api<TableOrderView>(`/store/orders/${encodeURIComponent(t)}`)
          .then((v) => setViews((m) => ({ ...m, [t]: v })))
          .catch(() => undefined),
      );
    load();
    const id = window.setInterval(() => document.visibilityState === 'visible' && load(), 15_000);
    return () => window.clearInterval(id);
  }, [tokens]);

  const live = list.filter((o) => views[o.token]?.step !== 'cancelled');
  const totalCents = live.reduce(
    (n, o) => n + (views[o.token] ? toCents(views[o.token]!.total) : (o.totalCents ?? 0)),
    0,
  );
  return (
    <div className="sf-wrap sf-page">
      <h1 className="page-h1">Mesa {table?.label}</h1>
      {list.length === 0 ? (
        <div className="empty-state">
          <OrdersArt live className="empty-state__art" />
          <strong>Nada pedido ainda</strong>
          <p>Escolha no cardápio e envie: o pedido aparece aqui com o andamento.</p>
          <Link className="cta cta--inline" to="/pedir">
            Ver o cardápio
          </Link>
        </div>
      ) : (
        <>
          <p className="tw-total" role="status">
            <span>{live.length === 1 ? '1 pedido' : `${live.length} pedidos`} deste celular</span>
            <strong>{brl(fromCents(totalCents))}</strong>
          </p>
          <ul className="olist">
            {list.map((o, i) => {
              const v = views[o.token];
              return (
                <li key={o.token} style={{ '--i': i } as CSSProperties}>
                  <Link className="ocard" to={`/pedido/${o.token}`}>
                    <span className="ocard__top">
                      <strong>Pedido #{o.number}</strong>
                      {v && (
                        <span className="ostatus" data-tone={TONE[v.step]}>
                          {TABLE_STEP[v.step]}
                        </span>
                      )}
                    </span>
                    {v && v.items.length > 0 && (
                      <>
                        <span className="ocard__photos" aria-hidden>
                          {v.items.slice(0, 4).map((it, n) => (
                            <Photo key={n} src={it.imageUrl ?? null} alt={it.name} />
                          ))}
                          {v.items.length > 4 && <span>+{v.items.length - 4}</span>}
                        </span>
                        <span className="ocard__items">
                          {v.items
                            .map((it) => `${qtyLabel(it.quantity, it.unit)} ${it.name}`)
                            .join(' · ')}
                        </span>
                      </>
                    )}
                    <span className="ocard__foot">
                      <span>{dateTime(o.at)}</span>
                      {v ? <strong>{brl(v.total)}</strong> : <span>Acompanhar</span>}
                      <ChevronRight size={16} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="form-hint tw-total__hint">
            A conta da mesa fecha com o garçom ou no caixa (pedidos de outros celulares e do garçom
            entram nela também).
          </p>
          <Link className="cta cta--inline" to="/pedir">
            Pedir mais
          </Link>
        </>
      )}
    </div>
  );
}

/** Aba "Pedidos": histórico da conta; sem conta, os pedidos recentes deste aparelho. */
export function OrdersScreen() {
  const { rules } = useStore();
  return rules.mode === 'table' ? <TableOrdersScreen /> : <OnlineOrdersScreen />;
}

function OnlineOrdersScreen() {
  const { account, menu } = useStore();
  const me = account?.customer;
  const [orders, setOrders] = useState<AccountOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recent = recentOrders();

  useEffect(() => {
    if (!me) return;
    const load = () =>
      api<AccountOrder[]>('/store/account/orders')
        .then((o) => {
          setOrders(o);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    void load();
    // Status muda enquanto o cliente olha: atualiza a cada 20 s.
    const id = window.setInterval(() => document.visibilityState === 'visible' && load(), 20_000);
    return () => window.clearInterval(id);
  }, [me]);

  return (
    <div className="sf-wrap sf-page">
      <h1 className="page-h1">Pedidos</h1>
      {me ? (
        orders === null ? (
          error ? (
            <p className="form-error">{error}</p>
          ) : (
            <Spinner />
          )
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <OrdersArt live className="empty-state__art" />
            <strong>Nenhum pedido ainda</strong>
            <p>Quando você pedir com a conta aberta, o pedido aparece aqui.</p>
            <Link className="cta cta--inline" to="/pedir">
              Fazer um pedido
            </Link>
          </div>
        ) : (
          <ul className="olist">
            {orders.map((o, i) => (
              <li key={o.id} style={{ '--i': i } as CSSProperties}>
                <Link className="ocard" to={`/pedir/pedidos/${o.id}`}>
                  <span className="ocard__top">
                    <strong>Pedido #{o.number}</strong>
                    <span className="ostatus" data-tone={TONE[o.step]}>
                      {STEP_LABEL[o.step]}
                    </span>
                  </span>
                  <span className="ocard__photos" aria-hidden>
                    {o.items.slice(0, 4).map((it, n) => (
                      <Photo key={n} src={it.imageUrl ?? null} alt={it.name} />
                    ))}
                    {o.items.length > 4 && <span>+{o.items.length - 4}</span>}
                  </span>
                  <span className="ocard__items">
                    {o.items
                      .map((it) => `${qtyLabel(it.quantity, it.unit)} ${it.name}`)
                      .join(' · ')}
                  </span>
                  <span className="ocard__foot">
                    <span>{dateTime(o.createdAt)}</span>
                    <strong>{brl(o.total)}</strong>
                    <ChevronRight size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          {recent.length > 0 && (
            <ul className="olist">
              {recent.map((o, i) => (
                <li key={o.token} style={{ '--i': i } as CSSProperties}>
                  <Link className="ocard" to={`/pedido/${o.token}`}>
                    <span className="ocard__top">
                      <strong>Pedido #{o.number}</strong>
                    </span>
                    <span className="ocard__foot">
                      <span>{dateTime(o.at)}</span>
                      <span>Acompanhar</span>
                      <ChevronRight size={16} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="empty-state">
            {recent.length ? (
              <span className="empty-state__icon">
                <ReceiptText size={26} />
              </span>
            ) : (
              <OrdersArt live className="empty-state__art" />
            )}
            <strong>
              {recent.length ? 'Quer ver todos os seus pedidos?' : 'Nenhum pedido por aqui'}
            </strong>
            <p>
              {menu.appearance.accountsEnabled
                ? 'Entre na sua conta para guardar o histórico e pedir de novo mais rápido.'
                : 'Os pedidos feitos neste aparelho nos últimos 2 dias aparecem aqui.'}
            </p>
            {menu.appearance.accountsEnabled && (
              <Link className="cta cta--inline" to="/pedir/conta">
                Entrar ou criar conta
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
