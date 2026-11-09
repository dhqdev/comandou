import { CHANNEL_LABELS, ORDER_CHANNELS, type OrderChannel } from '@comandou/shared';
import { ChevronRight, LayoutGrid, Plus, Smartphone } from 'lucide-react';
import { Link } from 'react-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, EmptyState, TextField, useToast } from '../design-system';
import { useCan } from '../app/auth';
import { api } from '../lib/api';
import { DeviceSettings } from '../features/DeviceSettings';
import type { CashRegister, DiningTable, Sector } from '../lib/types';
import './online-store.css';
import { TourButton } from '../features/tour/PageTour';

export function SettingsPage() {
  const toast = useToast();
  const canManage = useCan('settings:manage');
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, t, r] = await Promise.all([
        api<Sector[]>('/sectors'),
        api<DiningTable[]>('/tables'),
        api<CashRegister[]>('/cash-registers').catch(() => []),
      ]);
      setSectors(s);
      setTables(t);
      setRegisters(r);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function call(url: string, method: 'POST' | 'PATCH', json: object, ok: string) {
    try {
      await api(url, { method, json });
      toast(ok, 'success');
      await load();
      return true;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return false;
    }
  }

  return (
    <>
      <div>
        <div className="page-title-row">
          <h1 className="page-title">Ajustes</h1>
          <TourButton tour="ajustes" />
        </div>
        <p className="page-sub">
          Setores de produção, mesas, terminais de caixa e os ajustes deste aparelho (maquininha).
        </p>
      </div>
      {!canManage && <Alert tone="info">Somente gerentes alteram estes cadastros.</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <DeviceSettings />
      <Card searchId="secao-loja" title="Loja online">
        <Link to="/loja-online" className="settings-link">
          <Smartphone size={20} aria-hidden />
          <span>
            <strong>Cardápio online, banners, destaques e horários</strong>
            <small>Agora tudo da loja online fica numa página só, com prévia do celular.</small>
          </span>
          <ChevronRight size={18} aria-hidden />
        </Link>
      </Card>
      <Card searchId="secao-setores" title="Setores de produção (cozinha)">
        <SectorForm
          disabled={!canManage}
          onSave={(b) => call('/sectors', 'POST', b, 'Setor criado')}
        />
        {sectors.length === 0 ? (
          <EmptyState
            title="Nenhum setor"
            description="Sem setores, todos os itens aparecem em 'Sem setor' na cozinha."
          />
        ) : (
          <table className="cm-table">
            <thead>
              <tr>
                <th>Setor</th>
                <th>Canais</th>
                <th>Aviso / atraso</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sectors.map((s) => (
                <tr key={s.id} data-search-id={`setor-${s.id}`}>
                  <td>
                    <strong>{s.name}</strong> {!s.active && <Badge>inativo</Badge>}
                  </td>
                  <td>{s.channels.map((c) => CHANNEL_LABELS[c]).join(', ')}</td>
                  <td>
                    {s.warnAfterMin} / {s.lateAfterMin} min
                  </td>
                  <td className="cm-num">
                    {canManage && (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          call(
                            `/sectors/${s.id}`,
                            'PATCH',
                            { active: !s.active },
                            'Setor atualizado',
                          )
                        }
                      >
                        {s.active ? 'Desativar' : 'Ativar'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card searchId="secao-mesas" title="Mesas do salão">
        <Link to="/mesas?editar=1" className="settings-link">
          <LayoutGrid size={20} aria-hidden />
          <span>
            <strong>
              {tables.filter((t) => t.active).length} mesas ·{' '}
              {tables.filter((t) => t.active).reduce((s, t) => s + t.seats, 0)} lugares
            </strong>
            <small>
              Crie várias mesas de uma vez, escolha formato, lugares e área (varanda, mezanino) no
              editor visual do salão.
            </small>
          </span>
          <ChevronRight size={18} aria-hidden />
        </Link>
        <ServiceFeeForm disabled={!canManage} />
      </Card>
      <Card searchId="secao-caixas" title="Terminais de caixa">
        <SimpleForm
          label="Nome do terminal"
          max={40}
          disabled={!canManage}
          onSave={(v) => call('/cash-registers', 'POST', { name: v }, 'Terminal criado')}
        />
        <ul className="plain-list">
          {registers.map((r) => (
            <li key={r.id} data-search-id={`caixa-${r.id}`}>
              <span>{r.name}</span>
              <Badge tone={r.openSessionId ? 'success' : 'neutral'}>
                {r.openSessionId ? 'aberto' : 'fechado'}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

/** Taxa de serviço que entra sozinha nas comandas novas (0 = desligada). */
function ServiceFeeForm({ disabled }: { disabled?: boolean }) {
  const toast = useToast();
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ serviceFeePercent: string }>('/salon/settings')
      .then((r) => setV(String(Number(r.serviceFeePercent)).replace('.', ',')))
      .catch(() => undefined);
  }, []);
  const value = v.trim().replace(',', '.') || '0';
  const valid = /^\d{1,2}(\.\d{1,2})?$/.test(value) && Number(value) <= 30;
  return (
    <form
      className="inline-add"
      data-search-id="taxa-servico"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api('/salon/settings', { method: 'PATCH', json: { serviceFeePercent: value } });
          toast(
            Number(value) > 0
              ? `Taxa de serviço de ${v}% nas comandas novas`
              : 'Taxa de serviço desligada',
            'success',
          );
        } catch (err) {
          toast((err as Error).message, 'danger');
        } finally {
          setBusy(false);
        }
      }}
    >
      <TextField
        label="Taxa de serviço (%)"
        inputMode="decimal"
        value={v}
        onChange={(e) => setV(e.target.value.replace(/[^\d,.]/g, ''))}
        maxLength={5}
        disabled={disabled}
        hint="Entra sozinha nas comandas novas (ex.: 10). Na comanda dá para tirar. 0 desliga."
      />
      <Button type="submit" loading={busy} disabled={disabled || !valid}>
        Salvar
      </Button>
    </form>
  );
}

function SimpleForm({
  label,
  max,
  disabled,
  onSave,
}: {
  label: string;
  max: number;
  disabled?: boolean;
  onSave(v: string): Promise<boolean>;
}) {
  const [v, setV] = useState('');
  return (
    <form
      className="inline-add"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave(v.trim())) setV('');
      }}
    >
      <TextField
        label={label}
        value={v}
        onChange={(e) => setV(e.target.value)}
        maxLength={max}
        disabled={disabled}
      />
      <Button type="submit" icon={<Plus size={16} />} disabled={disabled || !v.trim()}>
        Adicionar
      </Button>
    </form>
  );
}

function SectorForm({
  disabled,
  onSave,
}: {
  disabled?: boolean;
  onSave(b: object): Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [warn, setWarn] = useState('10');
  const [late, setLate] = useState('20');
  const [channels, setChannels] = useState<OrderChannel[]>([...ORDER_CHANNELS]);
  return (
    <form
      className="inline-add"
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await onSave({
            name: name.trim(),
            warnAfterMin: Number(warn),
            lateAfterMin: Number(late),
            channels,
          })
        )
          setName('');
      }}
    >
      <TextField
        label="Nome do setor"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        disabled={disabled}
      />
      <TextField
        label="Aviso (min)"
        type="number"
        min={0}
        max={600}
        value={warn}
        onChange={(e) => setWarn(e.target.value)}
        disabled={disabled}
      />
      <TextField
        label="Atraso (min)"
        type="number"
        min={0}
        max={600}
        value={late}
        onChange={(e) => setLate(e.target.value)}
        disabled={disabled}
      />
      <div className="chips" aria-label="Canais do setor">
        {ORDER_CHANNELS.map((c) => (
          <button
            type="button"
            key={c}
            className="chip"
            aria-pressed={channels.includes(c)}
            disabled={disabled}
            onClick={() =>
              setChannels((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))
            }
          >
            {CHANNEL_LABELS[c]}
          </button>
        ))}
      </div>
      <Button
        type="submit"
        icon={<Plus size={16} />}
        disabled={disabled || !name.trim() || !channels.length}
      >
        Adicionar
      </Button>
    </form>
  );
}
