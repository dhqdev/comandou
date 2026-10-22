import { Hammer } from 'lucide-react';
import { Card, EmptyState } from '../design-system';

export function ComingSoonPage({ title }: { title: string }) {
  return (
    <>
      <h1 className="page-title">{title}</h1>
      <Card>
        <EmptyState
          icon={<Hammer size={20} />}
          title="Em construção"
          description="Este módulo faz parte das próximas etapas do roadmap do Comandou."
        />
      </Card>
    </>
  );
}
