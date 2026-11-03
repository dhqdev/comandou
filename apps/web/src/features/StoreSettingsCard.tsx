import { ExternalLink, Link2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import { parseBrlInput } from '../lib/money';
import type { StoreHour, StoreSettings } from '../lib/types';

const money = (v: string) => v.replace('.', ',');

/** Funcionamento da loja online: link, aberta/fechada, taxa, pedido mínimo, tempo e aceite automático. */
export function StoreSettingsCard({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const [s, setS] = useState<StoreSettings | null>(null);
  const [form, setForm] = useState({
    deliveryFee: '',
    minOrder: '',
    etaMin: '',
    etaMax: '',
    address: '',
    whatsapp: '',
    city: '',
    state: '',
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
      address: x.address ?? '',
      whatsapp: x.whatsapp ?? '',
      city: x.city ?? '',
      state: x.state ?? '',
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
      title="Funcionamento"
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
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {(
            [
              ['enabled', 'Cardápio online ligado'],
              ['isOpen', s.hoursEnabled ? 'Loja aberta (no horário)' : 'Loja aberta agora'],
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
              address: form.address.trim() || null,
              whatsapp: form.whatsapp.trim() || null,
              city: form.city.trim() || null,
              state: form.state.trim().toUpperCase() || null,
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
          <TextField
            label="Cidade da loja"
            value={form.city}
            onChange={set('city')}
            maxLength={80}
            hint="O cardápio acha o CEP do cliente pela rua nesta cidade"
            disabled={!canManage}
          />
          <TextField
            label="UF"
            value={form.state}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                state: e.target.value.replace(/[^A-Za-z]/g, '').slice(0, 2),
              }))
            }
            maxLength={2}
            disabled={!canManage}
          />
          {canManage && (
            <div>
              <Button type="submit" loading={busy} disabled={!fee || !min}>
                Salvar
              </Button>
            </div>
          )}
        </form>
        <HoursEditor
          key={JSON.stringify(s.hours) + s.hoursEnabled}
          settings={s}
          canManage={canManage}
          busy={busy}
          onSave={(patch) => save(patch, 'Horário salvo')}
        />
      </div>
    </Card>
  );
}

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Horário de funcionamento: com ele ligado, a loja fecha e abre sozinha. Um dia pode ter mais de
 * um turno (almoço e jantar); fechar antes de abrir (18:00 a 02:00) vira a meia-noite.
 */
function HoursEditor({
  settings,
  canManage,
  busy,
  onSave,
}: {
  settings: StoreSettings;
  canManage: boolean;
  busy: boolean;
  onSave(patch: Partial<StoreSettings>): Promise<void>;
}) {
  const [enabled, setEnabled] = useState(settings.hoursEnabled);
  const [hours, setHours] = useState<StoreHour[]>(
    settings.hours.length
      ? settings.hours
      : [1, 2, 3, 4, 5, 6, 0].map((day) => ({ day, open: '11:00', close: '23:00' })),
  );
  const valid = hours.every((h) => HHMM.test(h.open) && HHMM.test(h.close));
  const update = (i: number, patch: Partial<StoreHour>) =>
    setHours((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={!canManage || busy}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <strong>Abrir e fechar sozinha no horário</strong>
      </label>
      {settings.hoursEnabled && (
        <p className="cm-hint" style={{ margin: 0 }}>
          Agora: {settings.openNow ? 'recebendo pedidos' : 'fechada para pedidos'}
          {!settings.isOpen && ' (o botão "Loja aberta" está desligado)'}.
        </p>
      )}
      {enabled && (
        <div style={{ display: 'grid', gap: 6 }}>
          {order.map((day) => {
            const shifts = hours.map((h, i) => ({ h, i })).filter((x) => x.h.day === day);
            return (
              <div
                key={day}
                style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
              >
                <span style={{ width: 80 }}>{DAYS[day]}</span>
                {shifts.length === 0 && <span className="cm-hint">Fechado</span>}
                {shifts.map(({ h, i }) => (
                  <span key={i} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    <input
                      type="time"
                      aria-label={`${DAYS[day]}: abre`}
                      value={h.open}
                      disabled={!canManage}
                      onChange={(e) => update(i, { open: e.target.value })}
                    />
                    às
                    <input
                      type="time"
                      aria-label={`${DAYS[day]}: fecha`}
                      value={h.close}
                      disabled={!canManage}
                      onChange={(e) => update(i, { close: e.target.value })}
                    />
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Tirar turno de ${DAYS[day]}`}
                        onClick={() => setHours((hs) => hs.filter((_, j) => j !== i))}
                      >
                        ×
                      </Button>
                    )}
                  </span>
                ))}
                {canManage && shifts.length < 3 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setHours((hs) => [...hs, { day, open: '18:00', close: '23:00' }])
                    }
                  >
                    + turno
                  </Button>
                )}
              </div>
            );
          })}
          <span className="cm-hint">
            Fechar antes de abrir (ex.: 18:00 às 02:00) vale até a madrugada do dia seguinte.
          </span>
        </div>
      )}
      {canManage && (
        <div>
          <Button
            variant="secondary"
            loading={busy}
            disabled={!valid}
            onClick={() => void onSave({ hoursEnabled: enabled, hours })}
          >
            Salvar horário
          </Button>
        </div>
      )}
    </div>
  );
}
