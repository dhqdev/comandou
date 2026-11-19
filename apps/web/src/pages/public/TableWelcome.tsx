import { fromCents } from '@comandou/shared';
import { HandPlatter, ReceiptText, Send, Store, UtensilsCrossed } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { brl } from '../../lib/money';
import { WaiterArt } from './art';
import { useStore } from './context';
import { tableOrders } from './store';
import './table-welcome.css';

/**
 * Boas-vindas do cardápio da mesa (QR Code): a mesa em destaque e os três passos do pedido
 * (escolher, enviar, receber), que acendem conforme o cliente avança. É o único bloco extra do
 * início da mesa: nada de entrega, reserva, conversa ou fidelidade (store-rules.ts).
 */
export function TableWelcome({ onInfo }: { onInfo(): void }) {
  const { table, count, menu } = useStore();
  if (!table || !menu.store.isOpen) return null;
  const sent = tableOrders(table.id);
  const pickup = !!table.selfPickup;
  // Passo da vez: já pediu = esperando chegar; tem sacola = falta enviar; senão, escolher.
  const now = sent.length ? 2 : count > 0 ? 1 : 0;
  const steps = [
    { icon: UtensilsCrossed, label: 'Escolha' },
    { icon: Send, label: 'Envie' },
    { icon: pickup ? Store : HandPlatter, label: pickup ? 'Busque no balcão' : 'Chega na mesa' },
  ];
  const fee = table.serviceFeePercent ? Number(table.serviceFeePercent) : 0;
  const pay = menu.pix ? 'Pague pelo Pix aqui ou no fim.' : 'Você paga no fim, com o garçom.';
  const spent = sent.reduce((n, o) => n + (o.totalCents ?? 0), 0);
  return (
    <section className="tw" aria-label={`Mesa ${table.label}`}>
      <button type="button" className="tw__top" onClick={onInfo}>
        <span className="tw__badge" aria-hidden>
          <small>Mesa</small>
          <strong>{table.label}</strong>
        </span>
        <span className="tw__text">
          <strong>Peça direto por aqui</strong>
          <small>
            {pickup ? 'Avisamos quando estiver pronto.' : 'A gente leva até você.'} {pay}
            {fee > 0 && ` Serviço de ${fee.toLocaleString('pt-BR')}%.`}
          </small>
        </span>
        <WaiterArt live className="tw__art" />
      </button>
      <ol
        className="tw__steps"
        style={{ '--now': now } as CSSProperties}
        aria-label="Como pedir na mesa"
      >
        {steps.map((s, i) => (
          <li
            key={s.label}
            className="tw__step"
            data-state={i < now ? 'done' : i === now ? 'now' : 'next'}
            aria-current={i === now ? 'step' : undefined}
            style={{ '--i': i } as CSSProperties}
          >
            <span className="tw__dot">
              <s.icon size={16} aria-hidden />
            </span>
            <span className="tw__label">{s.label}</span>
          </li>
        ))}
      </ol>
      {sent.length > 0 && (
        <Link className="tw__sent" to="/pedir/pedidos">
          <ReceiptText size={16} aria-hidden />
          <span>
            {sent.length === 1 ? '1 pedido enviado' : `${sent.length} pedidos enviados`}
            {spent > 0 && ` · ${brl(fromCents(spent))}`}
          </span>
          <b>Acompanhar</b>
        </Link>
      )}
    </section>
  );
}
