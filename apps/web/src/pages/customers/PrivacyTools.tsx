import { Download, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Button, Modal, TextField, useToast } from '../../design-system';
import { api } from '../../lib/api';
import { datedName, saveJson } from '../../lib/download';

/** O que o apagar mudou (a API devolve só números). */
interface EraseResult {
  account: boolean;
  orders: number;
  reservations: number;
  chats: number;
}
interface PrivacyRequest {
  id: string;
  kind: 'export' | 'erase';
  requestedBy: 'customer' | 'staff';
  actorName: string | null;
  createdAt: string;
}

const WORD = 'APAGAR';

function erasedText(r: EraseResult) {
  const parts = [
    r.account && 'a conta do cardápio',
    r.orders > 0 && `${r.orders} ${r.orders === 1 ? 'pedido ficou' : 'pedidos ficaram'} sem nome`,
    r.reservations > 0 &&
      `${r.reservations} ${r.reservations === 1 ? 'reserva ficou' : 'reservas ficaram'} sem nome`,
    r.chats > 0 && `${r.chats} ${r.chats === 1 ? 'conversa apagada' : 'conversas apagadas'}`,
  ].filter(Boolean);
  return parts.length ? `Feito: ${parts.join(', ')}.` : 'Feito. Não havia dados com esse telefone.';
}

/**
 * Baixar e apagar (com a confirmação APAGAR no próprio bloco, sem janela em cima de janela).
 * `target` diz de quem: a conta (`customers/:id`) ou um telefone (`phone`).
 */
function PrivacyActions({
  target,
  fileName,
  onErased,
}: {
  target: { customerId: string } | { phone: string };
  fileName: string;
  onErased(r: EraseResult): void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<'export' | 'erase' | null>(null);
  const [asking, setAsking] = useState(false);
  const [word, setWord] = useState('');
  const [error, setError] = useState<string | null>(null);
  const base =
    'customerId' in target ? `/privacy/customers/${target.customerId}` : '/privacy/phone';
  const body = 'phone' in target ? { phone: target.phone } : {};
  const ready = word.trim().toUpperCase() === WORD;

  async function run(kind: 'export' | 'erase') {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'export') {
        saveJson(
          await api<unknown>(`${base}/export`, { method: 'POST', json: body }),
          datedName(fileName),
        );
        toast('Arquivo baixado', 'success');
      } else {
        const r = await api<EraseResult>(`${base}/erase`, {
          method: 'POST',
          json: { ...body, confirm: word },
        });
        setAsking(false);
        setWord('');
        onErased(r);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="cl-privacy">
      <div className="cl-privacy__row">
        <Button
          variant="secondary"
          icon={<Download size={16} />}
          loading={busy === 'export'}
          onClick={() => void run('export')}
        >
          Baixar dados
        </Button>
        {!asking && (
          <Button
            variant="danger"
            icon={<Trash2 size={16} />}
            onClick={() => {
              setError(null);
              setAsking(true);
            }}
          >
            Apagar dados
          </Button>
        )}
      </div>
      {asking && (
        <div className="cl-privacy__confirm">
          <p className="cm-hint">
            Apaga a conta do cardápio, endereços, pontos, avaliações e conversas. Pedidos e notas
            ficam, sem nome, telefone e endereço (o CPF só fica se saiu nota com ele). Não dá para
            desfazer.
          </p>
          <TextField
            label={`Digite ${WORD} para confirmar`}
            value={word}
            autoComplete="off"
            onChange={(e) => setWord(e.target.value)}
          />
          <div className="cl-privacy__row">
            <Button variant="ghost" onClick={() => setAsking(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={busy === 'erase'}
              disabled={!ready}
              onClick={() => void run('erase')}
            >
              Apagar de vez
            </Button>
          </div>
        </div>
      )}
      {error && <Alert tone="warning">{error}</Alert>}
    </div>
  );
}

/** Bloco da ficha do cliente: Dados pessoais (LGPD). */
export function CustomerPrivacy({
  customerId,
  onErased,
}: {
  customerId: string;
  onErased(): void;
}) {
  const toast = useToast();
  return (
    <section className="cl-block">
      <header className="cl-block__head">
        <h3>Dados pessoais (LGPD)</h3>
      </header>
      <p className="cm-hint" style={{ margin: '0 0 8px' }}>
        Quando o cliente pedir para ver ou apagar os dados dele.
      </p>
      <PrivacyActions
        target={{ customerId }}
        fileName="dados-do-cliente"
        onErased={(r) => {
          toast(erasedText(r), 'success');
          onErased();
        }}
      />
    </section>
  );
}

/**
 * Pedido LGPD pelo telefone: atende quem pediu sem conta (pedido no balcão, telefone, WhatsApp).
 * Com conta no cardápio, o mesmo telefone acha a conta também. Embaixo, os pedidos já atendidos.
 */
export function PrivacyRequestModal({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose(): void;
  onChanged(): void;
}) {
  const [phone, setPhone] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [history, setHistory] = useState<PrivacyRequest[] | null>(null);
  const digits = phone.replace(/\D/g, '');
  const valid = digits.length >= 10 && digits.length <= 13;

  useEffect(() => {
    if (open) setDone(null);
  }, [open]);
  // Recarrega o histórico ao abrir e depois de cada atendimento.
  useEffect(() => {
    if (!open) return;
    api<PrivacyRequest[]>('/privacy/requests').then(setHistory, () => setHistory([]));
  }, [open, done]);

  return (
    <Modal open={open} title="Pedido LGPD" onClose={onClose}>
      <p className="cm-hint" style={{ marginTop: 0 }}>
        O cliente pediu para ver ou apagar os dados dele? Procure pelo telefone que ele usou nos
        pedidos, nas reservas ou no WhatsApp.
      </p>
      <TextField
        label="Telefone do cliente"
        inputMode="tel"
        autoComplete="off"
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value);
          setDone(null);
        }}
      />
      {valid && (
        <PrivacyActions
          key={digits}
          target={{ phone: digits }}
          fileName={`dados-${digits.slice(-4)}`}
          onErased={(r) => {
            setDone(erasedText(r));
            onChanged();
          }}
        />
      )}
      {done && <Alert tone="info">{done}</Alert>}
      {history && history.length > 0 && (
        <div className="cl-privacy__log">
          <h3 className="cm-form__section">Já atendidos</h3>
          <ul>
            {history.slice(0, 8).map((h) => (
              <li key={h.id}>
                <ShieldCheck size={14} aria-hidden />
                <span>
                  {h.kind === 'erase' ? 'Dados apagados' : 'Dados baixados'}
                  {' · '}
                  {h.requestedBy === 'customer'
                    ? 'pelo próprio cliente'
                    : (h.actorName ?? 'pela equipe')}
                </span>
                <time dateTime={h.createdAt}>
                  {new Date(h.createdAt).toLocaleDateString('pt-BR')}
                </time>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
