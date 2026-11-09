import {
  formatPixKey,
  normalizePixKey,
  PIX_CITY_MAX,
  PIX_KEY_TYPE_LABELS,
  PIX_KEY_TYPES,
  PIX_NAME_MAX,
  pixBrCode,
  pixText,
  type PixKeyType,
} from '@comandou/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '../app/auth';
import { Alert, Badge, Button, Card, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import type { StoreSettings } from '../lib/types';
import { CheckField, SelectField } from './forms';
import { PixQr } from './PixQr';
import './pix.css';

const PLACEHOLDER: Record<PixKeyType, string> = {
  cpf: '000.000.000-00',
  cnpj: '00.000.000/0000-00',
  phone: '(11) 98888-7777',
  email: 'financeiro@seurestaurante.com.br',
  random: '123e4567-e89b-12d3-a456-426614174000',
};

/**
 * Pix pelo cardápio: a chave do restaurante (sem banco nem intermediário). Ligado, quem escolhe
 * Pix no checkout vê o QR Code e o copia e cola com o valor do pedido e manda o comprovante; a
 * equipe aprova ou recusa no PDV.
 */
export function PixSettingsCard({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const { me } = useAuth();
  const [s, setS] = useState<StoreSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    keyType: 'cnpj' as PixKeyType,
    key: '',
    name: '',
    city: '',
    enabled: false,
  });

  function fill(x: StoreSettings) {
    setS(x);
    setForm({
      keyType: x.pixKeyType ?? 'cnpj',
      key: x.pixKey && x.pixKeyType ? formatPixKey(x.pixKeyType, x.pixKey) : '',
      // Primeira vez: o nome do restaurante e a cidade da loja já vêm sugeridos.
      name: x.pixName ?? (me?.tenant.name ?? '').slice(0, PIX_NAME_MAX),
      city: x.pixCity ?? (x.city ?? '').slice(0, PIX_CITY_MAX),
      enabled: x.pixEnabled,
    });
  }
  useEffect(() => {
    api<StoreSettings>('/store/settings')
      .then(fill)
      .catch((e) => setError((e as Error).message));
    // Só ao abrir.
  }, []);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!s) return null;

  const key = form.key.trim() ? normalizePixKey(form.keyType, form.key) : null;
  const keyError = form.key.trim() && !key ? `${PIX_KEY_TYPE_LABELS[form.keyType]} inválido` : '';
  const complete = !!key && !!form.name.trim() && !!form.city.trim();
  const test = complete ? pixBrCode({ key: key!, name: form.name, city: form.city }, '1.00') : null;
  const dirty =
    form.enabled !== s.pixEnabled ||
    form.keyType !== (s.pixKeyType ?? 'cnpj') ||
    (key ?? form.key.trim()) !== (s.pixKey ?? '') ||
    form.name.trim() !== (s.pixName ?? '') ||
    form.city.trim() !== (s.pixCity ?? '');

  async function save() {
    setBusy(true);
    try {
      fill(
        await api<StoreSettings>('/store/settings', {
          method: 'PATCH',
          json: {
            pixKeyType: form.key.trim() ? form.keyType : null,
            pixKey: form.key.trim() || null,
            pixName: form.name.trim() || null,
            pixCity: form.city.trim() || null,
            pixEnabled: form.enabled,
          },
        }),
      );
      toast(form.enabled ? 'Pix ligado no cardápio' : 'Pix salvo', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      searchId="secao-pix"
      title={
        <span className="pix-set__title">
          Pix pelo cardápio{' '}
          <Badge tone={s.pixEnabled ? 'success' : 'neutral'}>
            {s.pixEnabled ? 'ligado' : 'desligado'}
          </Badge>
        </span>
      }
    >
      <div className="pix-set">
        <div className="pix-set__main">
          <p className="cm-hint pix-set__intro">
            Quem escolher Pix no checkout vê o QR Code e o Pix copia e cola já com o valor do
            pedido, paga no app do banco e anexa o comprovante. O pedido chega no PDV com o
            comprovante para você aprovar ou recusar. O dinheiro cai direto na sua conta, sem
            intermediário. Só quem entrou na conta paga assim (o cardápio pede o login antes).
          </p>
          {!s.accountsEnabled && (
            <Alert tone="warning">
              As contas de cliente estão desligadas (Aparência › O que aparece). Sem elas, o Pix
              pelo cardápio não aparece.
            </Alert>
          )}
          <form
            className="cm-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <SelectField
              label="Tipo da chave"
              value={form.keyType}
              disabled={!canManage}
              onChange={(e) => setForm((f) => ({ ...f, keyType: e.target.value as PixKeyType }))}
            >
              {PIX_KEY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PIX_KEY_TYPE_LABELS[t]}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Chave Pix"
              wrapClass="pix-set__key"
              value={form.key}
              placeholder={PLACEHOLDER[form.keyType]}
              inputMode={
                form.keyType === 'email' || form.keyType === 'random'
                  ? form.keyType === 'email'
                    ? 'email'
                    : 'text'
                  : form.keyType === 'phone'
                    ? 'tel'
                    : 'numeric'
              }
              autoComplete="off"
              maxLength={77}
              disabled={!canManage}
              error={keyError || undefined}
              onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
            />
            <TextField
              label="Nome de quem recebe"
              value={form.name}
              maxLength={PIX_NAME_MAX}
              disabled={!canManage}
              hint={`Como está no banco, até ${PIX_NAME_MAX} letras`}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <TextField
              label="Cidade"
              value={form.city}
              maxLength={PIX_CITY_MAX}
              disabled={!canManage}
              hint={`Até ${PIX_CITY_MAX} letras (abrevie se for maior)`}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
            />
            <div className="cm-form__wide">
              <CheckField
                label="Receber Pix pelo cardápio"
                description={
                  complete
                    ? 'O cliente paga na hora e manda o comprovante. Desligado, Pix vira "paga na entrega".'
                    : 'Preencha a chave, o nome e a cidade para ligar.'
                }
                checked={form.enabled}
                disabled={!canManage || (!complete && !form.enabled)}
                onChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
              />
            </div>
            {canManage && (
              <div className="cm-form__wide">
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  disabled={!dirty || !!keyError || (form.enabled && !complete)}
                >
                  Salvar Pix
                </Button>
              </div>
            )}
          </form>
        </div>
        {test && (
          <aside className="pix-set__test" aria-label="Pix de teste">
            <PixQr code={test} size={148} label="QR Code de teste de R$ 1,00" />
            <p className="cm-hint">
              <strong>Confira antes de ligar:</strong> leia este Pix de teste de R$ 1,00 no app do
              banco. Deve aparecer <strong>{pixText(form.name, PIX_NAME_MAX)}</strong>. Não precisa
              pagar.
            </p>
          </aside>
        )}
      </div>
    </Card>
  );
}
