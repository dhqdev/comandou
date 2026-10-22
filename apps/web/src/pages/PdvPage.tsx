import { ClipboardList, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, EmptyState } from '../design-system';
import { useAuth, useCan } from '../app/auth';
import { NewSaleModal } from '../features/NewSaleModal';
import { OrderCard } from '../features/OrderCard';
import { OrderDetailModal } from '../features/OrderDetailModal';
import { api } from '../lib/api';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { Order } from '../lib/types';

const COLUMNS = [
  { key: ['new', 'cancel_requested'], label: 'Novos', color: 'var(--pm-info)' },
  { key: ['in_production'], label: 'Em produção', color: 'var(--pm-warning)' },
  { key: ['ready'], label: 'Prontos', color: 'var(--pm-success)' },
  { key: ['dispatched'], label: 'Saiu para entrega', color: 'var(--pm-brand-600)' },
];

export function PdvPage() {
  const { me } = useAuth();
  const canSell = useCan('orders:write');
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selling, setSelling] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOrders(await api<Order[]>('/orders?active=true&limit=200'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  const reload = useDebounced(load);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'order.changed' || e.type === 'kitchen.changed') reload();
  }, load);

  // F2 abre nova venda (atalho de caixa).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2' && canSell) {
        e.preventDefault();
        setSelling(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canSell]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Olá, {me?.user.name.split(' ')[0]}</h1>
          <p className="page-sub">Pedidos do {me?.tenant.name} em tempo real.</p>
        </div>
        {canSell && (
          <Button
            size="lg"
            icon={<Plus size={18} />}
            onClick={() => setSelling(true)}
            title="Atalho: F2"
          >
            Nova venda <kbd className="kbd">F2</kbd>
          </Button>
        )}
      </div>
      {error && <Alert tone="danger">Não foi possível carregar os pedidos: {error}</Alert>}
      <Card title="Pedidos" bodyless>
        <div className="kanban" style={{ padding: 16 }}>
          {COLUMNS.map((c) => {
            const list = (orders ?? []).filter((o) => c.key.includes(o.status));
            return (
              <div key={c.label} className="kanban__col" style={{ ['--col' as string]: c.color }}>
                <div className="kanban__head">
                  {c.label}
                  <span className="kanban__count">{list.length}</span>
                </div>
                {list.length === 0 ? (
                  <EmptyState icon={<ClipboardList size={20} />} title="Nenhum pedido" />
                ) : (
                  <div className="kanban__list">
                    {list.map((o) => (
                      <OrderCard key={o.id} order={o} onOpen={(x) => setOpenId(x.id)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
      <NewSaleModal
        open={selling}
        onClose={() => setSelling(false)}
        onCreated={() => {
          setSelling(false);
          void load();
        }}
      />
      <OrderDetailModal orderId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
