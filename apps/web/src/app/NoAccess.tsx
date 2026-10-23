import { Link } from 'react-router';
import { Card, EmptyState } from '../design-system';

/** Link direto para uma tela que o papel da pessoa não usa. */
export function NoAccess() {
  return (
    <Card>
      <EmptyState
        mascot="sleep"
        title="Esta tela não faz parte do seu acesso"
        description="Peça ao administrador do restaurante se precisar dela. Suas telas estão no menu."
        action={
          <Link className="cm-btn cm-btn--primary" to="/">
            Ir para o início
          </Link>
        }
      />
    </Card>
  );
}
