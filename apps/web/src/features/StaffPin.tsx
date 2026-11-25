import { isPinFormat, isWeakPin, PIN_LENGTH } from '@comandou/shared';
import { Copy, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, Modal, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import './staff-pin.css';

/** Campo de PIN opcional do cadastro: vazio sorteia. Devolve a mensagem de erro, se houver. */
export function pinFieldError(pin: string): string | undefined {
  if (!pin) return undefined;
  if (!isPinFormat(pin)) return `Use ${PIN_LENGTH} números`;
  if (isWeakPin(pin)) return 'Fácil demais (repetido ou em sequência)';
  return undefined;
}

export function PinField({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <TextField
      label={`PIN de ${PIN_LENGTH} números`}
      inputMode="numeric"
      autoComplete="off"
      maxLength={PIN_LENGTH}
      placeholder="Vazio = sortear"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
      error={value.length === PIN_LENGTH ? pinFieldError(value) : undefined}
      hint="É com ele que a pessoa entra no app. Deixe vazio para o sistema sortear."
    />
  );
}

/** PIN em destaque, mostrado uma vez para o gerente passar à pessoa. */
export function PinReveal({ name, pin }: { name: string; pin: string }) {
  const toast = useToast();
  return (
    <div className="staff-pin">
      <span className="staff-pin__label">PIN de {name}</span>
      <strong className="staff-pin__value" data-testid="staff-pin">
        {pin}
      </strong>
      <p className="cm-hint">
        Passe este PIN pessoalmente. Ele aparece só agora: se esquecer, gere outro em Equipe.
      </p>
      <Button
        variant="secondary"
        size="sm"
        icon={<Copy size={14} />}
        onClick={() =>
          navigator.clipboard
            ?.writeText(pin)
            .then(() => toast('PIN copiado', 'success'))
            .catch(() => undefined)
        }
      >
        Copiar
      </Button>
    </div>
  );
}

/**
 * Novo PIN para o garçom ou o entregador (esqueceu, ou outra pessoa ficou sabendo). Sorteia ou
 * usa o escolhido; se já tinha PIN, a pessoa sai dos aparelhos e entra com o novo.
 */
export function PinModal({
  person,
  onClose,
  onDone,
}: {
  person: { id: string; name: string; hasPin?: boolean } | null;
  onClose(): void;
  onDone?(): void;
}) {
  const [wanted, setWanted] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(person);
  if (person && person !== shown) {
    setShown(person);
    setWanted('');
    setResult(null);
    setError(null);
  }
  const p = person ?? shown;
  const invalid = wanted.length > 0 && (wanted.length < PIN_LENGTH || !!pinFieldError(wanted));

  async function save() {
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ pin: string }>(`/users/${p.id}/pin`, {
        method: 'POST',
        json: wanted ? { pin: wanted } : {},
      });
      setResult(r.pin);
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!person}
      title={p?.hasPin ? 'Novo PIN' : 'Criar PIN'}
      onClose={onClose}
      footer={
        result ? (
          <Button onClick={onClose}>Pronto</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button icon={<KeyRound size={16} />} loading={busy} disabled={invalid} onClick={save}>
              {wanted ? 'Salvar PIN' : 'Sortear PIN'}
            </Button>
          </>
        )
      }
    >
      {p && result ? (
        <PinReveal name={p.name} pin={result} />
      ) : (
        <>
          {error && <Alert tone="danger">{error}</Alert>}
          <PinField value={wanted} onChange={setWanted} />
          {p?.hasPin && (
            <p className="cm-hint">
              Ao salvar, {p.name.split(' ')[0]} sai dos aparelhos e entra de novo com o PIN novo.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
