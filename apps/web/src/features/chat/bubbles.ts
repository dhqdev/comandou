import { useRef } from 'react';

/**
 * Regras comuns das conversas em balões (chat da equipe, suporte, clientes e cardápio), sem React
 * de tela: quem junta com quem (sequência da mesma pessoa, como no WhatsApp) e quais mensagens
 * acabaram de chegar (só elas ganham o efeito de entrada).
 */

/** Mensagens seguidas da mesma pessoa em até 3 minutos ficam juntas, sem repetir o nome. */
export const RUN_GAP_MS = 180_000;

export interface RunItem {
  /** Quem escreveu (nulo: sistema ou sem autor). */
  author: string | null;
  at: string;
  /** Aviso do sistema: quebra a sequência. */
  system?: boolean;
}

export interface RunInfo {
  /** Primeira do dia: o separador do dia vem antes dela. */
  newDay: boolean;
  /** Primeira da sequência da pessoa: canto do balão e nome (em grupo). */
  first: boolean;
  /** Última da sequência: o avatar (em grupo) fica nela. */
  last: boolean;
}

const dayOf = (iso: string) => new Date(iso).toDateString();

export function runInfo(list: RunItem[], gapMs = RUN_GAP_MS): RunInfo[] {
  const joins = (a: RunItem | undefined, b: RunItem | undefined) =>
    !!a &&
    !!b &&
    !a.system &&
    !b.system &&
    a.author === b.author &&
    dayOf(a.at) === dayOf(b.at) &&
    new Date(b.at).getTime() - new Date(a.at).getTime() < gapMs;
  return list.map((m, i) => {
    const prev = list[i - 1];
    const next = list[i + 1];
    return {
      newDay: !prev || dayOf(prev.at) !== dayOf(m.at),
      first: !joins(prev, m),
      last: !joins(m, next),
    };
  });
}

/**
 * Chaves das mensagens que chegaram depois da primeira carga (enviadas agora ou recebidas com a
 * conversa aberta): as que entram no fim da lista. Mensagens antigas carregadas ao rolar para cima
 * entram no começo e não contam. `scope` troca de conversa (zera tudo); `ready` diz que a primeira
 * carga já chegou. A chave de uma mensagem enviada continua a mesma depois que o servidor responde
 * (ver `keyOf` do ChatKit e do chat da equipe), então o efeito não roda duas vezes.
 */
export function useFreshKeys(keys: string[], ready: boolean, scope: string): ReadonlySet<string> {
  const state = useRef<{ scope: string; base: Set<string> | null; fresh: Set<string> }>({
    scope,
    base: null,
    fresh: new Set(),
  });
  const s = state.current;
  if (s.scope !== scope) {
    s.scope = scope;
    s.base = null;
    s.fresh = new Set();
  }
  if (!ready) return s.fresh;
  if (!s.base) {
    s.base = new Set(keys);
    return s.fresh;
  }
  let lastKnown = -1;
  keys.forEach((k, i) => {
    if (s.base!.has(k)) lastKnown = i;
  });
  keys.forEach((k, i) => {
    if (s.base!.has(k)) return;
    s.base!.add(k);
    if (i > lastKnown) s.fresh.add(k);
  });
  return s.fresh;
}
