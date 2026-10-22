import { ExternalLink, Link2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import { parseBrlInput } from '../lib/money';
import type { StoreSettings } from '../lib/types';
import { ImagePicker } from './ImagePicker';

const money = (v: string) => v.replace('.', ',');

/** Ajustes da loja online: link, capa, logo, taxa, pedido mínimo, tempo e aceite automático. */
export function StoreSettingsCard({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const [s, setS] = useState<StoreSettings | null>(null);
  const [form, setForm] = useState({
    deliveryFee: '',
    minOrder: '',
    etaMin: '',
    etaMax: '',
    about: '',
    address: '',
    whatsapp: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fill(x: StoreSettings) {
    setS(x);
    setForm({
      deliveryFee: money(x.deliveryFee),
      minOrder: money(x.minOrder),
      etaMin: String(x.etaMin),
      etaMax: String(x.etaMax),
      about: x.about ?? '',
      address: x.address ?? '',
      whatsapp: x.whatsapp ?? '',
    });
  }
  useEffect(() => {
    api<StoreSettings>('/store/settings')
      .then(fill)
      .catch((e) => setError((e as Error).message));
  }, []);

  async function save(patch: Partial<StoreSettings>, ok = 'Loja online atualizada') {
    setBusy(true);
    try {
      fill(await api<StoreSettings>('/store/settings', { method: 'PATCH', json: patch }));
      toast(ok, 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!s) return null;
  const fee = parseBrlInput(form.deliveryFee);
  const min = parseBrlInput(form.minOrder);
  const link = `${window.location.origin}/pedir`;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Card
      title="Loja online (cardápio para o cliente pedir)"
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant="ghost"
            icon={<Link2 size={16} />}
            onClick={() =>
              navigator.clipboard
                ?.writeText(link)
                .then(() => toast('Link copiado', 'success'))
                .catch(() => toast(link))
            }
          >
            Copiar link
          </Button>
          <a className="cm-btn cm-btn--secondary" href="/pedir" target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> Abrir
          </a>
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <p className="cm-hint" style={{ margin: 0 }}>
          Link para divulgar no Instagram e no WhatsApp: <strong>{link}</strong>
        </p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <span className="cm-label">Capa (formato largo)</span>
            <ImagePicker
              label="Capa"
              ratio="16 / 6"
              width={260}
              value={s.coverImageId}
              disabled={!canManage || busy}
              onChange={(id) => save({ coverImageId: id }, id ? 'Capa salva' : 'Capa removida')}
            />
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <span className="cm-label">Logo</span>
            <ImagePicker
              label="Logo"
              width={98}
              value={s.logoImageId}
              disabled={!canManage || busy}
              onChange={(id) => save({ logoImageId: id }, id ? 'Logo salvo' : 'Logo removido')}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {(
            [
              ['enabled', 'Cardápio online ligado'],
              ['isOpen', 'Loja aberta agora'],
              ['autoAccept', 'Aceitar pedidos automaticamente'],
              ['acceptsDelivery', 'Faz entrega'],
              ['acceptsPickup', 'Aceita retirada'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={s[k]}
                disabled={!canManage || busy}
                onChange={(e) => save({ [k]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!fee || !min) return;
            void save({
              deliveryFee: fee,
              minOrder: min,
              etaMin: Number(form.etaMin),
              etaMax: Number(form.etaMax),
              about: form.about.trim() || null,
              address: form.address.trim() || null,
              whatsapp: form.whatsapp.trim() || null,
            });
          }}
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          }}
        >
          <TextField
            label="Taxa de entrega"
            inputMode="decimal"
            value={form.deliveryFee}
            onChange={set('deliveryFee')}
            error={!fee ? 'Use o formato 5,00' : undefined}
            disabled={!canManage}
          />
          <TextField
            label="Pedido mínimo"
            inputMode="decimal"
            value={form.minOrder}
            onChange={set('minOrder')}
            error={!min ? 'Use o formato 20,00' : undefined}
            disabled={!canManage}
          />
          <TextField
            label="Tempo mínimo (min)"
            type="number"
            min={1}
            max={600}
            value={form.etaMin}
            onChange={set('etaMin')}
            disabled={!canManage}
          />
          <TextField
            label="Tempo máximo (min)"
            type="number"
            min={1}
            max={600}
            value={form.etaMax}
            onChange={set('etaMax')}
            disabled={!canManage}
          />
          <TextField
            label="WhatsApp da loja"
            inputMode="tel"
            value={form.whatsapp}
            onChange={set('whatsapp')}
            maxLength={30}
            disabled={!canManage}
          />
          <TextField
            label="Endereço (aparece na retirada)"
            value={form.address}
            onChange={set('address')}
            maxLength={300}
            disabled={!canManage}
          />
          <div style={{ gridColumn: '1 / -1' }}>
            <TextField
              label="Sobre a loja (aparece no topo do cardápio)"
              value={form.about}
              onChange={set('about')}
              maxLength={500}
              disabled={!canManage}
            />
          </div>
          {canManage && (
            <div>
              <Button type="submit" loading={busy} disabled={!fee || !min}>
                Salvar
              </Button>
            </div>
          )}
        </form>
      </div>
    </Card>
  );
}
