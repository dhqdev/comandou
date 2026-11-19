import { channelInfo } from '@comandou/shared';
import { Plus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Button, TextField, useToast } from '../../design-system';
import { api } from '../../lib/api';

/** Canais em que a loja liga aqui, pelo código que o aplicativo deu (ADR 0015, Fase 10). */
export const CONNECT_HERE = new Set(['keeta', 'opendelivery']);

const HINT: Record<string, { field: string; help: string; pattern?: string }> = {
  keeta: {
    field: 'Código da loja na Keeta',
    help: 'Autorize o Comandou no portal da Keeta e copie o código numérico da loja (Loja › Informações).',
    pattern: '[0-9]{1,18}',
  },
  opendelivery: {
    field: 'Código da loja no aplicativo',
    help: 'Use o id que o aplicativo deu para a sua loja depois de autorizar o Comandou.',
  },
};

/**
 * Ligar uma loja da Keeta ou de um aplicativo Open Delivery: o código da loja e um nome para
 * achar na lista. Na Keeta, o Comandou já faz o cadastro da loja lá. Recebimento começa desligado.
 */
export function ConnectStore({ channel, onDone }: { channel: string; onDone(): void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const label = channelInfo(channel).label;
  const h = HINT[channel] ?? HINT.opendelivery!;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/channels/stores', { method: 'POST', json: { channel, storeId, name } });
      toast(`Loja ligada. Marque "Receber pedidos" para começar.`, 'success');
      setOpen(false);
      setStoreId('');
      setName('');
      onDone();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <div>
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => setOpen(true)}
        >
          Ligar loja do {label}
        </Button>
      </div>
    );
  return (
    <form className="intg-connect" onSubmit={(e) => void submit(e)}>
      <p className="intg-hint">{h.help}</p>
      <TextField
        label={h.field}
        value={storeId}
        required
        autoComplete="off"
        inputMode={channel === 'keeta' ? 'numeric' : undefined}
        pattern={h.pattern}
        maxLength={100}
        onChange={(e) => setStoreId(e.target.value.trim())}
      />
      <TextField
        label="Nome para achar na lista"
        value={name}
        maxLength={160}
        placeholder={`Loja ${label}`}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="intg-connect__actions">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" loading={busy} disabled={!storeId}>
          Ligar loja
        </Button>
      </div>
    </form>
  );
}
