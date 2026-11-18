import { CalendarClock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Button, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import type { Order } from '../lib/types';
import { addDays, dayKey, hhmm, joinLocal } from '../pages/agenda/agenda-utils';

/** Número guardado com o 55 do Brasil ("5511912345678") volta para o campo sem ele. */
export function localPhone(p?: string | null) {
  const d = (p ?? '').replace(/\D/g, '');
  return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d;
}

/** Amanhã às 10h (ou o dia combinado, se o pedido já é fiado). */
function initialDue(order: Order) {
  if (order.fiadoDueAt) return new Date(order.fiadoDueAt);
  const d = addDays(new Date(), 1);
  d.setHours(10, 0, 0, 0);
  return d;
}

/**
 * Vender fiado num pedido já lançado (menu de ações do pedido; na venda nova é a opção Fiado do
 * atendimento, em NewSaleModal): quem deve, o WhatsApp dele e o dia/hora combinados para pagar. Vai para a Agenda
 * pessoal (tag Fiado) e, no dia e hora, o WhatsApp do restaurante manda a cobrança para o cliente.
 */
export function FiadoForm({
  order,
  onCancel,
  onDone,
}: {
  order: Order;
  onCancel(): void;
  onDone(o: Order): void;
}) {
  const toast = useToast();
  const due = initialDue(order);
  const [name, setName] = useState(order.fiadoName ?? order.customerName ?? '');
  const [phone, setPhone] = useState(localPhone(order.fiadoPhone ?? order.customerPhone));
  const [day, setDay] = useState(dayKey(due));
  const [time, setTime] = useState(hhmm(due));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** O WhatsApp do restaurante está conectado pelo QR Code (null = ainda vendo). */
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    api<{ settings: { whatsappReady: boolean } }>('/agenda/setup')
      .then((s) => setReady(s.settings.whatsappReady))
      .catch(() => setReady(null));
  }, []);

  async function save() {
    if (!name.trim()) return setError('Informe quem está devendo.');
    if (phone.replace(/\D/g, '').length < 10)
      return setError('Informe o WhatsApp de quem deve, com DDD.');
    const when = joinLocal(day, time);
    if (Number.isNaN(when.getTime())) return setError('Confira o dia e a hora.');
    if (when.getTime() < Date.now() - 60_000)
      return setError('Esse dia e hora já passaram. Escolha quando o cliente vai pagar.');
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ order: Order; whatsappReady: boolean }>(`/orders/${order.id}/fiado`, {
        method: 'POST',
        json: { name: name.trim(), phone, dueAt: when.toISOString() },
      });
      toast(
        r.whatsappReady
          ? `Fiado de ${name.trim()} na sua Agenda pessoal. A cobrança sai no WhatsApp no dia.`
          : `Fiado de ${name.trim()} na sua Agenda pessoal. Conecte o WhatsApp para a cobrança sair.`,
        'success',
      );
      onDone(r.order);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="inline-form fiado-form">
      <p className="cm-hint">
        Fica devendo <strong>{brl(order.balance)}</strong>. Vai para a sua Agenda pessoal com a tag
        Fiado e, no dia e hora combinados, o WhatsApp do restaurante manda a cobrança para o cliente
        (se ele ainda não tiver pago).
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <TextField
        label="Quem está devendo"
        value={name}
        maxLength={80}
        autoFocus
        onChange={(e) => setName(e.target.value)}
      />
      <TextField
        label="WhatsApp de quem deve"
        type="tel"
        inputMode="tel"
        placeholder="(11) 91234-5678"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <div className="fiado-form__when">
        <TextField
          label="Dia para pagar"
          type="date"
          value={day}
          min={dayKey(new Date())}
          onChange={(e) => setDay(e.target.value)}
        />
        <TextField
          label="Hora da cobrança"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </div>
      {ready === false && (
        <Alert tone="warning">
          O WhatsApp do restaurante não está conectado pelo QR Code: o fiado vai para a agenda, mas
          a cobrança só sai com ele conectado (Sistema › WhatsApp).
        </Alert>
      )}
      <div className="actions-row">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Voltar
        </Button>
        <Button icon={<CalendarClock size={16} />} loading={busy} onClick={save}>
          {order.fiadoAt ? 'Salvar fiado' : 'Vender fiado'}
        </Button>
      </div>
    </div>
  );
}
