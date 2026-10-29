import { ArrowRight } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Link, useInRouterContext } from 'react-router';
import { findFixHint, type FixHint } from '@comandou/shared';

/**
 * Quando algo impede a operação (caixa fechado, comanda fechada, item esgotado…), mostra o que
 * fazer e um botão que leva à tela que resolve. Os caminhos ficam em @comandou/shared
 * (fix-hints), os mesmos que o assistente de IA usa.
 *
 * Só aparece para a equipe logada: o cardápio do cliente e o painel da plataforma não têm
 * acesso definido e mostram o erro como sempre.
 */
interface Access {
  perms: string[];
  role: string;
}

let access: Access | null = null;
const subs = new Set<() => void>();

/** Chamado pelo login: permissões e papel de quem está usando (só em memória). */
export function setGuideAccess(next: Access | null) {
  access = next;
  subs.forEach((f) => f());
}

function useAccess() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => access,
    () => null,
  );
}

/** Garçom, entregador e cozinha têm apps próprios: só levamos ao que existe no app de cada um. */
function destination(h: FixHint, a: Access): string | null {
  if (!h.to || !h.perms?.some((p) => a.perms.includes(p))) return null;
  if (a.role === 'waiter') return h.to.startsWith('/mesas') ? '/garcom/mesas' : null;
  if (a.role === 'driver') return h.to.startsWith('/entregas') ? h.to : null;
  if (a.role === 'kitchen') return h.to.startsWith('/cozinha') ? h.to : null;
  return h.to;
}

export interface FixPlan {
  hint: FixHint;
  /** Tela para ir; null quando a pessoa já está nela ou não tem acesso. */
  to: string | null;
}

export function planFor(message: string | null | undefined, a: Access | null): FixPlan | null {
  if (!a) return null;
  const hint = findFixHint(message);
  if (!hint) return null;
  let to = destination(hint, a);
  if (to && typeof window !== 'undefined' && to.split('?')[0] === window.location.pathname)
    to = to.includes('?') ? to : null;
  return { hint, to };
}

export function useFixPlan(message: string | null | undefined): FixPlan | null {
  return planFor(message, useAccess());
}

/** Lê o acesso atual sem assinar (para o toast, que decide na hora em que aparece). */
export const currentFixPlan = (message: string | null | undefined) => planFor(message, access);

/** "O que fazer" + botão para a tela. Sem botão, diz a quem pedir. */
export function FixSteps({ plan, onGo }: { plan: FixPlan; onGo?: () => void }) {
  const inRouter = useInRouterContext();
  const { hint, to } = plan;
  const canGo = !!to && inRouter;
  const tip = !canGo && hint.ask && !hint.what.includes(hint.ask) ? ` ${hint.ask}` : '';
  return (
    <div className="cm-fix">
      <p className="cm-fix__what">
        {hint.what}
        {tip}
      </p>
      {canGo && (
        <Link className="cm-fix__go" to={to} onClick={onGo}>
          {hint.label ?? 'Resolver'}
          <ArrowRight size={14} aria-hidden />
        </Link>
      )}
    </div>
  );
}
