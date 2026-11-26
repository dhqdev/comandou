import { CalendarClock, RefreshCw, Rocket } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Button, Modal, ProgressBar, TextField, useToast } from '../design-system';
import { dateTime } from '../features/format';
import { api } from '../lib/api';
import { useLoad } from './OverviewPages';
import { Dot, Tag } from './ui';

export interface TenantVersionInfo {
  version: string | null;
  main: string | null;
  separable: boolean;
  reason: string | null;
  scheduled: { to: string; at: string } | null;
  lastUpgrade: {
    status: 'queued' | 'running' | 'done' | 'failed';
    step: string | null;
    error: string | null;
    createdAt: string;
    finishedAt: string | null;
  } | null;
}

/** Valor de <input type="datetime-local"> daqui a uma hora, na hora local. */
function inAnHour() {
  const d = new Date(Date.now() + 3600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

/**
 * Versão do sistema deste restaurante (docs/versao-por-cliente.md). O Super Admin fica sempre na
 * versão mais nova; o restaurante só muda quando alguém clica em "Atualizar agora" ou na hora
 * agendada. Durante a atualização a tela se atualiza sozinha.
 */
export function TenantVersionCard({ tenantId }: { tenantId: string }) {
  const toast = useToast();
  const {
    data: v,
    setData,
    reload,
  } = useLoad<TenantVersionInfo>(`/platform/tenants/${tenantId}/version`);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [when, setWhen] = useState(inAnHour);

  /** O clique em Atualizar agora já fecha a janela e mostra a barra, antes de o servidor responder. */
  const [starting, setStarting] = useState(false);
  const working =
    starting || v?.lastUpgrade?.status === 'queued' || v?.lastUpgrade?.status === 'running';
  useEffect(() => {
    if (!working) return;
    const t = setInterval(reload, 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working]);

  if (!v)
    return (
      <div className="adm-card">
        <span className="adm-card__head">
          <Rocket size={16} />
          Versão do sistema
        </span>
        <span className="adm-card__note">Carregando…</span>
      </div>
    );

  const behind = !!v.version && !!v.main && v.version !== v.main;

  async function send(path: string, body?: unknown) {
    setBusy(true);
    try {
      setData(
        await api<TenantVersionInfo>(`/platform/tenants/${tenantId}/version/${path}`, {
          method: 'POST',
          json: body ?? {},
        }),
      );
      return true;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-card">
      <span className="adm-card__head">
        <Rocket size={16} />
        Versão do sistema
      </span>
      <span className="adm-card__big" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {v.version ?? '—'}
        {working ? (
          <Tag level="info">atualizando</Tag>
        ) : behind ? (
          <Tag level="warn">versão anterior</Tag>
        ) : (
          <Tag level="ok">atualizado</Tag>
        )}
      </span>
      <dl className="adm-kv">
        <dt>Mais nova</dt>
        <dd>{v.main ?? '—'}</dd>
        {v.scheduled && (
          <>
            <dt>Agendada</dt>
            <dd>
              <CalendarClock size={13} /> {dateTime(v.scheduled.at)} para a {v.scheduled.to}
            </dd>
          </>
        )}
        {v.lastUpgrade && (
          <>
            <dt>Última atualização</dt>
            <dd>
              <Dot
                level={
                  v.lastUpgrade.status === 'done'
                    ? 'ok'
                    : v.lastUpgrade.status === 'failed'
                      ? 'bad'
                      : 'info'
                }
              />{' '}
              {working
                ? (v.lastUpgrade.step ?? 'na fila')
                : `${v.lastUpgrade.status === 'failed' ? 'falhou' : 'concluída'} em ${dateTime(v.lastUpgrade.finishedAt ?? v.lastUpgrade.createdAt)}`}
            </dd>
          </>
        )}
      </dl>
      {working && (
        <div role="status" aria-live="polite" style={{ display: 'grid', gap: 6 }}>
          <ProgressBar label="Andamento da atualização" />
          <span className="adm-card__note">
            {starting
              ? 'Iniciando a atualização…'
              : (v.lastUpgrade?.step ?? 'Na fila, começa em instantes…')}
          </span>
        </div>
      )}
      {v.lastUpgrade?.status === 'failed' && v.lastUpgrade.error && !working && (
        <span className="adm-card__note adm-card__note--bad">{v.lastUpgrade.error}</span>
      )}
      {!v.separable && v.reason && <span className="adm-card__note">{v.reason}</span>}
      {v.separable && behind && !working && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button size="sm" icon={<RefreshCw size={14} />} onClick={() => setConfirm(true)}>
            Atualizar agora
          </Button>
          {v.scheduled ? (
            <Button
              size="sm"
              variant="ghost"
              loading={busy}
              onClick={() => void send('schedule', { at: null })}
            >
              Cancelar agendamento
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              icon={<CalendarClock size={14} />}
              onClick={() => setScheduling(true)}
            >
              Agendar
            </Button>
          )}
        </div>
      )}

      <Modal
        open={confirm}
        title={`Atualizar para a ${v.main}?`}
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Voltar
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setConfirm(false);
                setStarting(true);
                await send('upgrade');
                setStarting(false);
              }}
            >
              Atualizar agora
            </Button>
          </>
        }
      >
        <p>
          O restaurante sai da {v.version} e passa para a {v.main}. Primeiro é feito um backup do
          banco dele (se o backup estiver ligado), depois as migrações da versão nova. Leva poucos
          minutos; quem estiver usando tem a tela atualizada sozinha, sem aviso nem botão.
        </p>
        <Alert tone="warning">
          Não dá para voltar para a versão anterior depois de atualizar. Prefira um horário com
          pouco movimento.
        </Alert>
      </Modal>

      <Modal
        open={scheduling}
        title="Agendar atualização"
        onClose={() => setScheduling(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setScheduling(false)}>
              Voltar
            </Button>
            <Button
              loading={busy}
              disabled={!when}
              onClick={async () => {
                if (await send('schedule', { at: new Date(when).toISOString() })) {
                  setScheduling(false);
                  toast('Atualização agendada', 'success');
                }
              }}
            >
              Agendar
            </Button>
          </>
        }
      >
        <TextField
          label="Quando atualizar"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          hint={`O restaurante vai para a versão mais nova que estiver no ar nessa hora (hoje, ${v.main}).`}
        />
      </Modal>
    </div>
  );
}
