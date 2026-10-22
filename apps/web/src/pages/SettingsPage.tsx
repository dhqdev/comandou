import { CHANNEL_LABELS, ORDER_CHANNELS, type OrderChannel } from '@pedemais/shared';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, EmptyState, TextField, useToast } from '../design-system';
import { useCan } from '../app/auth';
import { api } from '../lib/api';
import type { CashRegister, DiningTable, Sector } from '../lib/types';

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
        <h1 className="page-title">Ajustes</h1>
        <p className="page-sub">Setores de produção, mesas e terminais de caixa.</p>
      </div>
      {!canManage && <Alert tone="info">Somente gerentes alteram estes cadastros.</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <Card title="Setores de produção (cozinha)">
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
          <table className="pm-table">
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
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong> {!s.active && <Badge>inativo</Badge>}
                  </td>
                  <td>{s.channels.map((c) => CHANNEL_LABELS[c]).join(', ')}</td>
                  <td>
                    {s.warnAfterMin} / {s.lateAfterMin} min
                  </td>
                  <td className="pm-num">
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
      <Card title="Mesas">
        <SimpleForm
          label="Número/nome da mesa"
          max={20}
          disabled={!canManage}
          onSave={(v) => call('/tables', 'POST', { label: v }, 'Mesa criada')}
        />
        <div className="chips" style={{ marginTop: 12 }}>
          {tables.map((t) => (
            <span key={t.id} className="chip" aria-disabled={!t.active}>
              Mesa {t.label}
              {canManage && !t.tabId && (
                <button
                  className="link-btn"
                  onClick={() =>
                    call(`/tables/${t.id}`, 'PATCH', { active: !t.active }, 'Mesa atualizada')
                  }
                >
                  {t.active ? 'desativar' : 'ativar'}
                </button>
              )}
            </span>
          ))}
        </div>
      </Card>
      <Card title="Terminais de caixa">
        <SimpleForm
          label="Nome do terminal"
          max={40}
          disabled={!canManage}
          onSave={(v) => call('/cash-registers', 'POST', { name: v }, 'Terminal criado')}
        />
        <ul className="plain-list">
          {registers.map((r) => (
            <li key={r.id}>
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
