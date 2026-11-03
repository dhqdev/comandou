import {
  CHANNEL_LABELS,
  KITCHEN_COLORS,
  KITCHEN_DISPLAY_INFO,
  ORDER_CHANNELS,
  type KitchenDisplay,
  type OrderChannel,
} from '@comandou/shared';
import { ChefHat, Palette, Plus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Alert, Button, Modal, Spinner, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import { useLoad } from './OverviewPages';
import type { TenantDetail } from './types';
import { Tag } from './ui';

export interface PlatformKitchen {
  id: string;
  name: string;
  channels: OrderChannel[];
  warnAfterMin: number;
  lateAfterMin: number;
  color: string | null;
  active: boolean;
  position: number;
}
interface KitchenSetup {
  kitchens: PlatformKitchen[];
  display: KitchenDisplay;
  updatedAt: string | null;
}

type Draft = Omit<PlatformKitchen, 'id' | 'warnAfterMin' | 'lateAfterMin' | 'position'> & {
  id?: string;
  warnAfterMin: string;
  lateAfterMin: string;
  position: string;
};

const blank = (n: number): Draft => ({
  name: '',
  channels: [...ORDER_CHANNELS],
  warnAfterMin: '10',
  lateAfterMin: '20',
  color: KITCHEN_COLORS[n % KITCHEN_COLORS.length]!,
  active: true,
  position: String(n),
});

/**
 * Aba "Cozinha" do restaurante: as cozinhas (Bar, Chapa...), que tipo de pedido cada uma
 * recebe e o que aparece nas telas da cozinha. Fica só aqui, no Super Admin.
 */
export function KitchenPanel({ t }: { t: TenantDetail }) {
  const toast = useToast();
  const { data, error, setData } = useLoad<KitchenSetup>(`/platform/tenants/${t.id}/kitchen`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <Spinner />;

  async function toggle(key: keyof KitchenDisplay, on: boolean) {
    setBusy(key);
    try {
      setData(
        await api<KitchenSetup>(`/platform/tenants/${t.id}/kitchen/display`, {
          method: 'PUT',
          json: { [key]: on },
        }),
      );
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="adm-kitchen">
      <div className="adm-panel">
        <div className="adm-panel__head">
          <ChefHat size={16} aria-hidden />
          <span style={{ flex: 1 }}>Cozinhas ({data.kitchens.length})</span>
          <Button
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => setDraft(blank(data.kitchens.length))}
          >
            Nova cozinha
          </Button>
        </div>
        {data.kitchens.length === 0 ? (
          <div className="adm-empty">
            Nenhuma cozinha. Sem cozinhas, a tela mostra todos os pedidos numa fila só.
          </div>
        ) : (
          <ul className="adm-rows">
            {data.kitchens.map((k) => (
              <li key={k.id}>
                <button
                  type="button"
                  className="adm-row"
                  onClick={() =>
                    setDraft({
                      ...k,
                      warnAfterMin: String(k.warnAfterMin),
                      lateAfterMin: String(k.lateAfterMin),
                      position: String(k.position),
                    })
                  }
                >
                  <span
                    className="adm-kitchen__dot"
                    style={{ background: k.color ?? 'var(--a-subtle)' }}
                    aria-hidden
                  />
                  <span className="adm-row__main">
                    <span className="adm-row__title">{k.name}</span>
                    <span className="adm-row__meta">
                      {k.channels.map((c) => CHANNEL_LABELS[c]).join(' · ')} · aviso{' '}
                      {k.warnAfterMin} min · atraso {k.lateAfterMin} min
                    </span>
                  </span>
                  <Tag level={k.active ? 'ok' : 'off'}>{k.active ? 'ativa' : 'pausada'}</Tag>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="adm-panel">
        <div className="adm-panel__head">O que aparece na tela da cozinha</div>
        <div className="adm-panel__body adm-kitchen__toggles">
          {KITCHEN_DISPLAY_INFO.map((i) => (
            <label key={i.key} className="adm-check">
              <input
                type="checkbox"
                checked={data.display[i.key]}
                disabled={busy !== null}
                onChange={(e) => void toggle(i.key, e.target.checked)}
              />
              <span>
                <strong>{i.label}</strong>
                <span className="adm-sub" style={{ whiteSpace: 'normal' }}>
                  {i.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
        <div className="adm-panel__body adm-sub" style={{ paddingTop: 0, whiteSpace: 'normal' }}>
          Vale na hora para todas as telas abertas. Tema, cor, layout e som ficam no ajuste de cada
          aparelho.
        </div>
      </div>

      {draft && (
        <KitchenModal
          tenantId={t.id}
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={(d) => {
            setData(d);
            setDraft(null);
          }}
        />
      )}
    </div>
  );
}

function KitchenModal({
  tenantId,
  draft,
  onClose,
  onSaved,
}: {
  tenantId: string;
  draft: Draft;
  onClose(): void;
  onSaved(d: KitchenSetup): void;
}) {
  const toast = useToast();
  const [f, setF] = useState(draft);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((x) => ({ ...x, [k]: v }));
  const warn = Number(f.warnAfterMin);
  const late = Number(f.lateAfterMin);
  const problem = !f.name.trim()
    ? 'Dê um nome para a cozinha'
    : !f.channels.length
      ? 'Escolha ao menos um tipo de pedido'
      : !Number.isInteger(warn) || !Number.isInteger(late) || warn < 0 || late < 0
        ? 'Tempos em minutos inteiros'
        : late < warn
          ? 'O atraso precisa ser maior ou igual ao aviso'
          : null;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (problem) return;
    setBusy(true);
    try {
      const body = {
        name: f.name.trim(),
        channels: f.channels,
        warnAfterMin: warn,
        lateAfterMin: late,
        color: f.color,
        active: f.active,
        position: Math.max(0, Number(f.position) || 0),
      };
      const r = await api<KitchenSetup>(
        f.id
          ? `/platform/tenants/${tenantId}/kitchen/sectors/${f.id}`
          : `/platform/tenants/${tenantId}/kitchen/sectors`,
        { method: f.id ? 'PUT' : 'POST', json: body },
      );
      toast(f.id ? 'Cozinha salva' : 'Cozinha criada', 'success');
      onSaved(r);
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={f.id ? `Cozinha ${draft.name}` : 'Nova cozinha'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="adm-kitchen-form" loading={busy} disabled={!!problem}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="adm-kitchen-form" className="cm-form" onSubmit={save} noValidate>
        <TextField
          label="Nome"
          value={f.name}
          maxLength={60}
          placeholder="Ex.: Bar, Chapa, Fritadeira"
          onChange={(e) => set('name', e.target.value)}
          autoFocus
        />
        <TextField
          label="Ordem na lista"
          type="number"
          min={0}
          value={f.position}
          onChange={(e) => set('position', e.target.value)}
        />
        <div className="cm-form__block">
          <span className="adm-kitchen__label">Cor da cozinha</span>
          <div className="adm-kitchen__swatches" role="radiogroup" aria-label="Cor da cozinha">
            {KITCHEN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={f.color === c}
                aria-label={c}
                className="adm-kitchen__swatch"
                style={{ background: c }}
                onClick={() => set('color', c)}
              />
            ))}
            <label
              className="adm-kitchen__custom"
              title="Outra cor"
              aria-checked={!!f.color && !(KITCHEN_COLORS as readonly string[]).includes(f.color)}
              style={
                f.color && !(KITCHEN_COLORS as readonly string[]).includes(f.color)
                  ? { background: f.color }
                  : undefined
              }
            >
              <Palette size={16} aria-hidden />
              <input
                type="color"
                value={f.color ?? '#475569'}
                onChange={(e) => set('color', e.target.value)}
                aria-label="Outra cor"
              />
            </label>
          </div>
        </div>
        <div className="cm-form__block">
          <span className="adm-kitchen__label">Recebe pedidos de</span>
          <div className="adm-chips">
            {ORDER_CHANNELS.map((c) => (
              <button
                key={c}
                type="button"
                className="adm-chip"
                aria-pressed={f.channels.includes(c)}
                onClick={() =>
                  set(
                    'channels',
                    f.channels.includes(c)
                      ? f.channels.filter((x) => x !== c)
                      : ORDER_CHANNELS.filter((x) => x === c || f.channels.includes(x)),
                  )
                }
              >
                {CHANNEL_LABELS[c]}
              </button>
            ))}
          </div>
        </div>
        <TextField
          label="Aviso (amarelo) depois de, em min"
          type="number"
          min={0}
          max={600}
          value={f.warnAfterMin}
          onChange={(e) => set('warnAfterMin', e.target.value)}
        />
        <TextField
          label="Atraso (vermelho) depois de, em min"
          type="number"
          min={0}
          max={600}
          value={f.lateAfterMin}
          onChange={(e) => set('lateAfterMin', e.target.value)}
        />
        <label className="adm-check cm-form__block">
          <input
            type="checkbox"
            checked={f.active}
            onChange={(e) => set('active', e.target.checked)}
          />
          <span>
            <strong>Cozinha ativa</strong>
            <span className="adm-sub" style={{ whiteSpace: 'normal' }}>
              Pausada, some da escolha nos aparelhos. Os produtos continuam ligados a ela.
            </span>
          </span>
        </label>
        {problem && f.name && <Alert tone="warning">{problem}</Alert>}
      </form>
    </Modal>
  );
}
