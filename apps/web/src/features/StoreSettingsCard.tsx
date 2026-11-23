import { ExternalLink, Link2, Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { maskCep, useCepAutofill } from '../lib/cep';
import { StreetHits } from './StreetHits';
import { Alert, Button, Card, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import { parseBrlInput } from '../lib/money';
import type { StoreHour, StoreSettings } from '../lib/types';

const money = (v: string) => v.replace('.', ',');

/** Funcionamento da loja online: link, aberta/fechada, taxa, pedido mínimo, tempo e aceite automático. */
export function StoreSettingsCard({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const uid = useId();
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

  const toggle = (k: StoreFlag, label: string, hint?: string) => (
    <label key={k} className="os-toggle">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <span className="switch">
        <input
          type="checkbox"
          checked={s[k]}
          disabled={!canManage || busy}
          onChange={(e) => save({ [k]: e.target.checked })}
        />
        <span className="switch__track" aria-hidden />
      </span>
    </label>
  );

  return (
    <div className="os-stack">
      <Card
        title="Pedidos pelo cardápio"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="ghost"
              size="sm"
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
            <a
              className="cm-btn cm-btn--secondary cm-btn--sm"
              href="/pedir"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={16} /> Abrir
            </a>
          </div>
        }
      >
        <p className="cm-hint os-link">
          Link para divulgar no Instagram e no WhatsApp: <strong>{link}</strong>
        </p>
        <div className="os-flags">
          <div className="os-flags__grid">
            <section className="os-flags__group" aria-labelledby={`${uid}-loja`}>
              <h3 id={`${uid}-loja`} className="os-flags__title">
                Loja
              </h3>
              <div className="os-toggles os-toggles--lead">
                {toggle(
                  'enabled',
                  'Cardápio online ligado',
                  'Desligado, ninguém faz pedido pelo link.',
                )}
                {toggle(
                  'isOpen',
                  s.hoursEnabled ? 'Loja aberta (no horário)' : 'Loja aberta agora',
                  s.hoursEnabled
                    ? 'Abre e fecha sozinha pelo horário de funcionamento.'
                    : 'Fechada, o cliente vê o cardápio mas não consegue pedir.',
                )}
                {toggle(
                  'autoAccept',
                  'Aceitar pedidos automaticamente',
                  'O pedido entra direto na cozinha, sem esperar alguém aceitar.',
                )}
              </div>
            </section>
            <section className="os-flags__group" aria-labelledby={`${uid}-receber`}>
              <h3 id={`${uid}-receber`} className="os-flags__title">
                Como o cliente recebe
              </h3>
              <div className="os-toggles os-toggles--lead">
                {toggle('acceptsDelivery', 'Faz entrega', 'Leva o pedido no endereço do cliente.')}
                {toggle('acceptsPickup', 'Aceita retirada', 'O cliente busca o pedido no balcão.')}
              </div>
            </section>
          </div>
        </div>
      </Card>

      <Card title="Entrega, contato e endereço">
        <div className="os-form-host">
          <form
            className="cm-form os-form6"
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
              wrapClass="os-span2"
              disabled={!canManage}
            />
            <StoreAddressFields
              value={form}
              onChange={(p) => setForm((f) => ({ ...f, ...p }))}
              disabled={!canManage}
            />
            {canManage && (
              <div className="os-form-actions">
                <Button type="submit" variant="primary" loading={busy} disabled={!fee || !min}>
                  Salvar
                </Button>
              </div>
            )}
          </form>
        </div>
      </Card>

      <Card title="Horário de funcionamento">
        <HoursEditor
          key={JSON.stringify(s.hours) + s.hoursEnabled}
          settings={s}
          canManage={canManage}
          busy={busy}
          onSave={(patch) => save(patch, 'Horário salvo')}
        />
      </Card>

      <Card title="Pedido pela mesa (QR Code)">
        <div className="os-flags">
          <div className="os-toggles os-toggles--lead os-flags__grid">
            {toggle(
              'tableCheckLocation',
              'Conferir se o cliente está no restaurante',
              s.storeLat && s.storeLng
                ? 'Antes de pedir, o celular confirma a localização perto do ponto da loja no mapa.'
                : 'Marque o ponto da loja no mapa (Entregas › Áreas de entrega) para a conferência valer.',
            )}
            {toggle(
              'tableSelfPickup',
              'Cliente busca o pedido pronto no balcão',
              'Sem garçom levando: o cliente vê "Pronto" no celular, busca e toca em "Já peguei".',
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

type StoreFlag =
  | 'enabled'
  | 'isOpen'
  | 'autoAccept'
  | 'acceptsDelivery'
  | 'acceptsPickup'
  | 'tableCheckLocation'
  | 'tableSelfPickup';

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
    <div className="os-hours">
      <label className="os-toggle os-toggle--lead">
        <span>
          <strong>Abrir e fechar sozinha no horário</strong>
          <small>
            {settings.hoursEnabled
              ? `Agora: ${settings.openNow ? 'recebendo pedidos' : 'fechada para pedidos'}${
                  !settings.isOpen ? ' (o botão "Loja aberta" está desligado)' : ''
                }.`
              : 'Com isso ligado, a loja abre e fecha sozinha nos horários abaixo.'}
          </small>
        </span>
        <span className="switch">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canManage || busy}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className="switch__track" aria-hidden />
        </span>
      </label>
      {enabled && (
        <div className="os-days">
          {order.map((day) => {
            const shifts = hours.map((h, i) => ({ h, i })).filter((x) => x.h.day === day);
            return (
              <div key={day} className="os-day">
                <span className="os-day__name">{DAYS[day]}</span>
                <div className="os-day__shifts">
                  {shifts.length === 0 && <span className="cm-hint">Fechado</span>}
                  {shifts.map(({ h, i }) => (
                    <span key={i} className="os-shift">
                      <input
                        type="time"
                        className="cm-input os-time"
                        aria-label={`${DAYS[day]}: abre`}
                        value={h.open}
                        disabled={!canManage}
                        onChange={(e) => update(i, { open: e.target.value })}
                      />
                      <span className="os-muted">às</span>
                      <input
                        type="time"
                        className="cm-input os-time"
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
                          icon={<X size={16} />}
                          onClick={() => setHours((hs) => hs.filter((_, j) => j !== i))}
                        />
                      )}
                    </span>
                  ))}
                  {canManage && shifts.length < 3 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Plus size={16} />}
                      onClick={() =>
                        setHours((hs) => [...hs, { day, open: '18:00', close: '23:00' }])
                      }
                    >
                      Turno
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          <span className="cm-hint">
            Fechar antes de abrir (ex.: 18:00 às 02:00) vale até a madrugada do dia seguinte.
          </span>
        </div>
      )}
      {canManage && (
        <div className="os-form-actions">
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

type StoreAddress = { address: string; city: string; state: string };

/**
 * Endereço da loja: o CEP preenche rua, bairro, cidade e UF; o nome da rua (no começo do campo
 * Endereço) acha o CEP na cidade da loja. O endereço continua sendo uma linha livre.
 */
function StoreAddressFields({
  value,
  onChange,
  disabled,
}: {
  value: StoreAddress;
  onChange(p: Partial<StoreAddress>): void;
  disabled: boolean;
}) {
  const [cep, setCep] = useState('');
  const addressRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  // Só o nome da rua (antes da vírgula) vai para a busca do CEP.
  const street = value.address.split(/[,\-–]/)[0] ?? '';

  const fill = useCepAutofill({ cep, street, city: value.city, state: value.state }, (a) => {
    setCep(maskCep(a.cep));
    const head = a.street ? `${a.street}, ` : value.address;
    const tail = [a.district, `CEP ${maskCep(a.cep)}`].filter(Boolean).join(' - ');
    onChange({
      address: a.street ? `${head} - ${tail}` : value.address,
      city: a.city || value.city,
      state: a.state || value.state,
    });
    // Cursor logo depois da rua, para digitar o número.
    requestAnimationFrame(() => {
      const el = addressRef.current;
      if (!el || !a.street) return;
      el.focus();
      el.setSelectionRange(head.length, head.length);
    });
  });

  return (
    <>
      <TextField
        label="CEP da loja"
        inputMode="numeric"
        autoComplete="postal-code"
        placeholder="00000-000"
        maxLength={9}
        value={cep}
        hint={fill.cepHint}
        onChange={(e) => {
          fill.cepTyped();
          setCep(maskCep(e.target.value));
        }}
        disabled={disabled}
      />
      <div className="street-field os-span3">
        <TextField
          ref={addressRef}
          label="Endereço (aparece na retirada)"
          value={value.address}
          maxLength={300}
          hint={fill.streetHint}
          role="combobox"
          aria-expanded={fill.open}
          aria-controls={listId}
          aria-autocomplete="list"
          onChange={(e) => {
            fill.streetTyped();
            onChange({ address: e.target.value });
          }}
          onFocus={() => fill.hits.length && fill.setOpen(true)}
          onBlur={fill.streetLeft}
          onKeyDown={(e) => e.key === 'Escape' && fill.setOpen(false)}
          disabled={disabled}
        />
        {fill.open && <StreetHits id={listId} hits={fill.hits} onPick={fill.pick} />}
      </div>
      <TextField
        label="Cidade da loja"
        value={value.city}
        onChange={(e) => onChange({ city: e.target.value })}
        maxLength={80}
        hint="O cardápio acha o CEP do cliente pela rua nesta cidade"
        disabled={disabled}
      />
      <TextField
        label="UF"
        value={value.state}
        onChange={(e) => onChange({ state: e.target.value.replace(/[^A-Za-z]/g, '').slice(0, 2) })}
        maxLength={2}
        disabled={disabled}
      />
    </>
  );
}
