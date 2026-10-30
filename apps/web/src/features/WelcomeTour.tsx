import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FrameItem } from '../design-system';
import { GuidedTour } from './tour/GuidedTour';
import { WELCOME_STOPS, welcomeEnds } from './tour/tours';

/**
 * Apresentação do primeiro acesso, em forma de tour guiado: passa pelas telas de verdade e
 * enquadra o botão que a pessoa deve tocar primeiro (e o lugar do menu onde a tela fica).
 * Na ordem de quem está começando: loja, cardápio, complementos, ajustes, equipe, caixa, venda,
 * salão, pedidos, cozinha e nota fiscal. Respeita as permissões (só entra no passo cuja tela a
 * pessoa pode abrir). Fica marcada como vista neste aparelho, por usuário; dá para rever em
 * Conta › Rever apresentação. O roteiro fica em tour/tours.tsx.
 */

const storageKey = (tenantId: string, userId: string) => `cm-tour:${tenantId}:${userId}`;

export function tourSeen(tenantId: string, userId: string) {
  try {
    return localStorage.getItem(storageKey(tenantId, userId)) === 'done';
  } catch {
    // Sem armazenamento não dá para lembrar: melhor não mostrar a cada recarga.
    return true;
  }
}

function markSeen(tenantId: string, userId: string) {
  try {
    localStorage.setItem(storageKey(tenantId, userId), 'done');
  } catch {
    /* sem armazenamento */
  }
}

const PHONE = '(max-width: 860px)';

export function WelcomeTour({
  open,
  onClose,
  tenantId,
  userId,
  userName,
  tenantName,
  items,
  tabs,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  userId: string;
  userName: string;
  tenantName: string;
  /** Itens do menu já filtrados pelas permissões (os mesmos da barra). */
  items: FrameItem[];
  /** Chaves que viram aba no celular (as outras ficam em "Mais"). */
  tabs: string[];
}) {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches);
  useEffect(() => {
    const m = window.matchMedia(PHONE);
    const f = () => setPhone(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  const firstName = userName.split(' ')[0] ?? userName;
  const ends = useMemo(
    () => welcomeEnds(firstName, tenantName, phone),
    [firstName, tenantName, phone],
  );
  const close = useCallback(() => {
    // Pular também conta como visto: não volta a cada recarga.
    markSeen(tenantId, userId);
    onClose();
  }, [tenantId, userId, onClose]);
  return (
    <GuidedTour
      open={open}
      onClose={close}
      stops={WELCOME_STOPS}
      ends={ends}
      items={items}
      tabs={tabs}
      label="Apresentação"
    />
  );
}
