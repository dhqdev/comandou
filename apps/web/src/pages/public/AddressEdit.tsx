import { Check } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { maskCep } from '../../lib/cep';
import { AddressDraft, AddressFields, addressPayload } from './AddressFields';
import type { SavedAddress } from './store';

const LABELS = ['Casa', 'Trabalho', 'Outro'];

/** Rua, número, bairro ou CEP mudaram: o ponto salvo no mapa não vale mais. */
export function movedAddress(a: SavedAddress, d: AddressDraft) {
  const p = addressPayload(d);
  return (
    p.street !== a.street.trim() ||
    p.number !== a.number.trim() ||
    p.district !== a.district.trim() ||
    (p.cep ?? '') !== (a.cep ?? '').replace(/\D/g, '') ||
    (p.city ?? '') !== (a.city ?? '').trim()
  );
}

/**
 * Editar um endereço salvo sem sair da sacola. Mudou rua, número, bairro ou CEP: o ponto do mapa
 * é apagado e o mapa procura o endereço de novo.
 */
export function AddressEdit({
  address,
  city,
  state,
  onSaved,
  onCancel,
}: {
  address: SavedAddress;
  city?: string | null;
  state?: string | null;
  onSaved(a: SavedAddress): void;
  onCancel(): void;
}) {
  const [label, setLabel] = useState(address.label ?? '');
  const [form, setForm] = useState<AddressDraft>({
    cep: maskCep(address.cep ?? ''),
    street: address.street,
    number: address.number,
    district: address.district,
    city: address.city ?? '',
    state: address.state ?? '',
    complement: address.complement ?? '',
    reference: address.reference ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = !!(form.street.trim() && form.number.trim() && form.district.trim());

  async function save() {
    if (!ok || busy) return;
    const p = addressPayload(form);
    const moved = movedAddress(address, form);
    setBusy(true);
    setError(null);
    try {
      const a = await api<SavedAddress>(`/store/account/addresses/${address.id}`, {
        method: 'PATCH',
        json: {
          ...p,
          label: label.trim() || null,
          complement: p.complement ?? null,
          reference: p.reference ?? null,
          cep: p.cep ?? null,
          city: p.city ?? null,
          state: p.state ?? null,
          ...(moved ? { lat: null, lng: null } : {}),
        },
      });
      onSaved(a);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não deu para salvar agora. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="addr-edit">
      <div className="label-chips" role="radiogroup" aria-label="Tipo do endereço">
        {LABELS.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={label === l}
            className="pill"
            onClick={() => setLabel(l)}
          >
            {l}
          </button>
        ))}
      </div>
      <AddressFields
        value={form}
        onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        city={city}
        state={state}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="addr-edit__actions">
        <button type="button" className="cta cta--ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button type="button" className="cta" onClick={save} disabled={!ok || busy}>
          <Check size={18} /> {busy ? 'Salvando…' : 'Salvar endereço'}
        </button>
      </div>
    </div>
  );
}
