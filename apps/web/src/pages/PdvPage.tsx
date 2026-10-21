import { ClipboardList, Plus } from 'lucide-react';
import { Alert, Button, Card, EmptyState } from '../design-system';
import { useAuth } from '../app/auth';

const COLUMNS = [
  { key: 'new', label: 'Novos', color: 'var(--pm-info)' },
  { key: 'in_production', label: 'Em produção', color: 'var(--pm-warning)' },
  { key: 'ready', label: 'Prontos', color: 'var(--pm-success)' },
  { key: 'dispatched', label: 'Saiu / Entregue', color: 'var(--pm-gray-600)' },
];

export function PdvPage() {
  const { me } = useAuth();
  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'end',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 className="page-title">Olá, {me?.user.name.split(' ')[0]}</h1>
          <p className="page-sub">Acompanhe os pedidos do {me?.tenant.name} em tempo real.</p>
        </div>
        <Button
          size="lg"
          icon={<Plus size={18} />}
          disabled
          title="Disponível na Etapa 3 (pedidos)"
        >
          Nova venda
        </Button>
      </div>
      <Alert tone="info">
        Fundação técnica pronta. O fluxo de pedidos, salão, KDS e caixa chega na Etapa 3 do roadmap.
      </Alert>
      <Card title="Pedidos" bodyless>
        <div className="kanban" style={{ padding: 16 }}>
          {COLUMNS.map((c) => (
            <div key={c.key} className="kanban__col" style={{ ['--col' as string]: c.color }}>
              <div className="kanban__head">
                {c.label}
                <span className="kanban__count">0</span>
              </div>
              <EmptyState icon={<ClipboardList size={20} />} title="Nenhum pedido" />
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
