import { ChevronRight, ReceiptText } from 'lucide-react';
import { CSSProperties, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { dateTime } from '../../features/format';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import { useStore } from './context';
import { AccountOrder, recentOrders, STEP_LABEL } from './store';

const TONE: Record<AccountOrder['step'], string> = {
  awaiting: 'warn',
  accepted: 'brand',
  ready: 'info',
  dispatched: 'brand',
  completed: 'ok',
  cancelled: 'bad',
};

/** Aba "Pedidos": histórico da conta; sem conta, os pedidos recentes deste aparelho. */
export function OrdersScreen() {
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
            <div className="olist">
              {[0, 1, 2].map((i) => (
                <div key={i} className="sk sk--order" />
              ))}
            </div>
          )
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__icon">
              <ReceiptText size={26} />
            </span>
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
                  <span className="ocard__items">
                    {o.items.map((it) => `${it.quantity}× ${it.name}`).join(' · ')}
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
            <span className="empty-state__icon">
              <ReceiptText size={26} />
            </span>
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
