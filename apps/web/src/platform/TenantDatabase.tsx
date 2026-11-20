import { ArrowRightLeft, Copy, Database, RotateCcw, Trash2, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Modal, Select, Spinner, TextField, useToast, Skeleton } from '../design-system';
import { dateTime } from '../features/format';
import { api } from '../lib/api';
import { useLoad } from './OverviewPages';
import type { BackupSettings, DbJob, DbServers, TenantDatabase, TenantDetail } from './types';
import { ago, bytes, Dot, Level, Tag } from './ui';

export const DB_STATUS: Record<TenantDatabase['status'], [string, Level]> = {
  creating: ['sendo criado', 'info'],
  ready: ['em uso', 'ok'],
  failed: ['falhou', 'bad'],
  moving: ['mudando', 'info'],
  deleting: ['sendo excluído', 'warn'],
  transferring: ['trocando de servidor', 'info'],
  receiving: ['chegando de outro servidor', 'info'],
};

const JOB_KIND: Record<DbJob['kind'], string> = {
  create: 'Criar banco',
  move: 'Mover para banco próprio',
  delete: 'Excluir restaurante e base',
  transfer: 'Trocar de servidor',
  migrate: 'Migrar para outro servidor',
  receive: 'Receber de outro servidor',
};
const JOB_STATUS: Record<DbJob['status'], [string, Level]> = {
  queued: ['na fila', 'info'],
  running: ['rodando', 'info'],
  done: ['concluído', 'ok'],
  failed: ['falhou', 'bad'],
};

/** Há trabalho de banco em andamento? (a tela se atualiza sozinha enquanto houver) */
export function dbBusy(t: TenantDetail) {
  return (
    ['provisioning', 'moving', 'deleting'].includes(t.status) ||
    t.database.jobs.some((j) => j.status === 'queued' || j.status === 'running')
  );
}

/** Faixa no topo do restaurante enquanto o banco é criado, mudado ou excluído. */
export function DatabaseProgress({ t }: { t: TenantDetail }) {
  const job = t.database.jobs.find((j) => j.status === 'queued' || j.status === 'running');
  if (!job) return null;
  return (
    <div className="adm-progress" role="status" aria-live="polite">
      <Spinner />
      <div>
        <strong>{JOB_KIND[job.kind]}</strong>
        <div className="adm-sub" style={{ whiteSpace: 'normal' }}>
          {job.step ?? (job.status === 'queued' ? 'Na fila do serviço de backup…' : 'Começando…')}
          {job.startedAt ? ` · começou ${ago(job.startedAt)}` : ''}
        </div>
      </div>
    </div>
  );
}

/** Avisos sobre o serviço que executa os trabalhos de banco (comandou-backup). */
function WorkerAlerts({ db }: { db: TenantDatabase }) {
  return (
    <>
      {!db.worker.alive && (
        <Alert tone="warning">
          O serviço de backup (<strong>comandou-backup</strong>) não está rodando
          {db.worker.lastSeenAt ? ` (visto ${ago(db.worker.lastSeenAt)})` : ''}. É ele que cria,
          muda e exclui os bancos: os pedidos ficam na fila até ele voltar.
        </Alert>
      )}
      {db.worker.alive && db.worker.canCreateDatabases === false && (
        <Alert tone="danger">
          O banco ainda não deu ao serviço de backup a permissão de criar bancos. Uma vez só, no
          console do contêiner <strong>comandou-db</strong> (Portainer → Containers → Console):{' '}
          <code>
            psql -U postgres -c "ALTER ROLE comandou_owner CREATEDB" -c "GRANT pg_signal_backend TO
            comandou_owner"
          </code>
        </Alert>
      )}
    </>
  );
}

/** Servidores para onde dá para levar o banco (o principal e os ativos), menos o atual. */
function useTargets(open: boolean, current: string) {
  const [data, setData] = useState<DbServers | null>(null);
  useEffect(() => {
    if (!open) return;
    api<DbServers>('/platform/db-servers')
      .then(setData)
      .catch(() => setData(null));
  }, [open]);
  const all = data
    ? [
        { id: 'main', label: `${data.main.name} (${data.main.host})`, def: data.main.acceptsNew },
        ...data.servers
          .filter((s) => s.status === 'active')
          .map((s) => ({ id: s.id, label: `${s.name} (${s.host})`, def: s.acceptsNew })),
      ]
    : [];
  return { loaded: !!data, targets: all.filter((x) => x.id !== current) };
}

function ServerSelect({
  value,
  onChange,
  targets,
}: {
  value: string;
  onChange: (v: string) => void;
  targets: { id: string; label: string }[];
}) {
  return (
    <div className="cm-field">
      <label className="cm-label" htmlFor="db-target">
        Servidor de destino
      </label>
      <Select id="db-target" value={value} onChange={(e) => onChange(e.target.value)}>
        {targets.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function DatabasePanel({
  t,
  onChanged,
}: {
  t: TenantDetail;
  onChanged: (d: TenantDetail) => void;
}) {
  const toast = useToast();
  const db = t.database;
  const [sheet, setSheet] = useState<'move' | 'delete' | 'transfer' | null>(null);
  const current = db.kind === 'dedicated' ? (db.server?.id ?? 'main') : '';
  const { loaded, targets } = useTargets(sheet === 'move' || sheet === 'transfer', current);
  const [target, setTarget] = useState('');
  useEffect(() => {
    if (loaded && !targets.some((x) => x.id === target))
      setTarget((targets.find((x) => x.def) ?? targets[0])?.id ?? '');
  }, [loaded, targets, target]);
  const [busy, setBusy] = useState(false);
  const active = db.jobs.some((j) => j.status === 'queued' || j.status === 'running');
  const [label, level] =
    db.kind === 'shared' && db.status === 'ready'
      ? ['em uso', 'ok' as Level]
      : DB_STATUS[db.status];

  async function call(path: string, json: object | undefined, ok: string) {
    setBusy(true);
    try {
      const r = await api<TenantDetail>(`/platform/tenants/${t.id}/${path}`, {
        method: 'POST',
        json: json ?? {},
      });
      toast(ok, 'success');
      onChanged(r);
      setSheet(null);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-panel adm-panel__body" style={{ display: 'grid', gap: 12 }}>
      <WorkerAlerts db={db} />
      <dl className="adm-kv">
        <dt>Banco</dt>
        <dd>
          <Database size={14} style={{ verticalAlign: '-2px' }} />{' '}
          {db.kind === 'dedicated' ? (
            <>
              próprio: <code>{db.name}</code>
            </>
          ) : (
            'banco central (compartilhado com outros restaurantes antigos)'
          )}{' '}
          <Tag level={level}>{label}</Tag>
        </dd>
        {db.kind === 'dedicated' && (
          <>
            <dt>Servidor</dt>
            <dd>
              {db.server ? (
                <>
                  {db.server.name} <code>{db.server.host}</code>
                </>
              ) : (
                'servidor principal'
              )}{' '}
              <Link to="/bancos" className="adm-sub">
                ver servidores
              </Link>
            </dd>
          </>
        )}
        {db.sizeBytes !== null && (
          <>
            <dt>Tamanho</dt>
            <dd>{bytes(db.sizeBytes)}</dd>
          </>
        )}
        {db.readyAt && (
          <>
            <dt>Pronto desde</dt>
            <dd>{dateTime(db.readyAt)}</dd>
          </>
        )}
        <dt>Pasta do backup</dt>
        <dd>
          {db.kind === 'dedicated' && db.backupFolder ? (
            <>
              <code>{db.backupFolder}</code>{' '}
              <button
                className="adm-icon-btn"
                title="Copiar"
                aria-label="Copiar pasta"
                onClick={() =>
                  navigator.clipboard
                    ?.writeText(db.backupFolder!)
                    .then(() => toast('Pasta copiada', 'success'))
                }
              >
                <Copy size={14} />
              </button>
            </>
          ) : (
            'junto do banco central (pasta plataforma/)'
          )}
        </dd>
        <dt>Último backup</dt>
        <dd>
          {db.lastBackup ? (
            <>
              <Dot
                level={
                  db.lastBackup.status === 'ok'
                    ? 'ok'
                    : db.lastBackup.status === 'failed'
                      ? 'bad'
                      : 'info'
                }
              />{' '}
              {db.lastBackup.status === 'failed'
                ? `falhou ${ago(db.lastBackup.startedAt)}: ${db.lastBackup.error ?? ''}`
                : `${ago(db.lastBackup.finishedAt ?? db.lastBackup.startedAt)} · ${bytes(db.lastBackup.sizeBytes)}`}
            </>
          ) : db.kind === 'dedicated' ? (
            'nenhum ainda (o diário roda no horário do painel Backups)'
          ) : (
            'no backup do banco central'
          )}
        </dd>
      </dl>

      {db.status === 'failed' && db.lastError && (
        <Alert tone="danger">
          <span style={{ whiteSpace: 'normal' }}>A criação do banco falhou: {db.lastError}</span>
        </Alert>
      )}

      <div className="adm-actions">
        {db.status === 'failed' && !active && (
          <button
            className="adm-action adm-action--primary"
            disabled={busy}
            onClick={() => call('database/retry', undefined, 'Criação pedida de novo')}
          >
            <RotateCcw size={14} /> Tentar de novo
          </button>
        )}
        {db.kind === 'shared' &&
          !active &&
          (t.status === 'provisioned' || t.status === 'suspended') && (
            <button className="adm-action" onClick={() => setSheet('move')}>
              <Truck size={14} /> Mover para banco próprio
            </button>
          )}
        {db.kind === 'dedicated' &&
          db.status === 'ready' &&
          !active &&
          (t.status === 'provisioned' || t.status === 'suspended') && (
            <button className="adm-action" onClick={() => setSheet('transfer')}>
              <ArrowRightLeft size={14} /> Trocar de servidor
            </button>
          )}
        {!active && t.status !== 'deleting' && (
          <button className="adm-action adm-action--danger" onClick={() => setSheet('delete')}>
            <Trash2 size={14} /> Excluir restaurante
          </button>
        )}
      </div>

      {db.jobs.length > 0 && (
        <div className="adm-rows" aria-label="Trabalhos de banco">
          {db.jobs.map((j) => (
            <div key={j.id} className="adm-row">
              <Dot level={JOB_STATUS[j.status][1]} />
              <span className="adm-row__main">
                <span className="adm-row__title">
                  {JOB_KIND[j.kind]} · {JOB_STATUS[j.status][0]}
                </span>
                <span className="adm-row__meta">
                  {j.error ?? j.result.warning ?? j.step ?? ''}
                  {j.result.rows
                    ? ` · ${j.result.rows.toLocaleString('pt-BR')} linhas copiadas`
                    : ''}
                </span>
              </span>
              <span className="adm-row__side">{dateTime(j.createdAt)}</span>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={sheet === 'move'}
        title="Mover para banco próprio"
        onClose={() => setSheet(null)}
        footer={
          <button
            className="adm-action adm-action--primary"
            disabled={busy}
            onClick={() =>
              target
                ? call('database/transfer', { to: target }, 'Mudança pedida')
                : call('database/move', undefined, 'Mudança pedida')
            }
          >
            <Truck size={14} /> Mover agora
          </button>
        }
      >
        <p style={{ marginTop: 0 }}>
          O restaurante ganha o banco <code>comandou_{t.slug.replace(/-/g, '_')}</code>, só dele, e
          os backups passam a ir para a pasta dele no backup.
        </p>
        {targets.length > 1 && (
          <ServerSelect value={target} onChange={setTarget} targets={targets} />
        )}
        <p>
          Durante a cópia (de segundos a poucos minutos, conforme o tamanho) ninguém do restaurante
          consegue usar o sistema. Tudo é conferido antes da troca; se algo falhar, ele continua no
          banco central como está.
        </p>
      </Modal>

      <Modal
        open={sheet === 'transfer'}
        title="Trocar de servidor"
        onClose={() => setSheet(null)}
        footer={
          <button
            className="adm-action adm-action--primary"
            disabled={busy || !target}
            onClick={() => call('database/transfer', { to: target }, 'Troca de servidor pedida')}
          >
            <ArrowRightLeft size={14} /> Trocar agora
          </button>
        }
      >
        {!loaded ? (
          <Skeleton />
        ) : targets.length === 0 ? (
          <Alert tone="info">
            Não há outro servidor cadastrado. Cadastre um em <Link to="/bancos">Bancos</Link>.
          </Alert>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <ServerSelect value={target} onChange={setTarget} targets={targets} />
            <p style={{ margin: 0 }}>
              O banco <code>{db.name}</code> é copiado inteiro para o servidor escolhido, conferido
              tabela por tabela e só então o restaurante passa a usar o novo. Com backup ligado, um
              backup é feito antes. Depois da troca o banco antigo é apagado.
            </p>
            <p className="adm-sub" style={{ margin: 0, whiteSpace: 'normal' }}>
              Durante a cópia (de segundos a poucos minutos, conforme o tamanho) ninguém do
              restaurante consegue usar o sistema. Se algo falhar, ele continua onde está.
            </p>
          </div>
        )}
      </Modal>

      <DeleteTenantModal
        t={t}
        open={sheet === 'delete'}
        onClose={() => setSheet(null)}
        onChanged={onChanged}
      />
    </div>
  );
}

/**
 * Excluir restaurante: pede o código do autenticador (mesmo em navegador confiável, porque não
 * dá para desfazer) e já vem com "Guardar um backup final" marcado quando o backup está ligado.
 * Não pede para suspender antes (entrar na fila de exclusão já tira o restaurante do ar).
 * Usado no menu do topo do restaurante e na aba Banco de dados.
 */
export function DeleteTenantModal({
  t,
  open,
  onClose,
  onChanged,
}: {
  t: TenantDetail;
  open: boolean;
  onClose: () => void;
  onChanged: (d: TenantDetail) => void;
}) {
  const toast = useToast();
  const settings = useLoad<BackupSettings>(open ? '/platform/backups/settings' : null);
  const backupReady = !!settings.data?.enabled && !!settings.data?.configured;
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setCode('');
  }, [open]);
  useEffect(() => {
    if (open) setBackup(backupReady);
  }, [open, backupReady]);
  const can = ['provisioned', 'suspended', 'failed'].includes(t.status);

  async function remove() {
    setBusy(true);
    try {
      const r = await api<TenantDetail>(`/platform/tenants/${t.id}/delete`, {
        method: 'POST',
        json: { backup, code },
      });
      toast('Excluindo o restaurante', 'success');
      onChanged(r);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`Excluir ${t.name}?`}
      onClose={onClose}
      footer={
        <>
          <button className="adm-action" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="adm-action adm-action--danger"
            disabled={busy || !can || code.length !== 6}
            onClick={() => void remove()}
          >
            <Trash2 size={14} /> Excluir de vez
          </button>
        </>
      }
    >
      {!can ? (
        <Alert tone="warning">
          Este restaurante está no meio de outra operação. Espere terminar para excluir.
        </Alert>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            Apaga tudo de <strong>{t.name}</strong> ({t.slug}): pedidos, caixa, cardápio, clientes,
            equipe, fotos, o endereço e a assinatura. O restaurante sai do ar na hora e{' '}
            <strong>não dá para desfazer</strong>.
          </p>
          <label className="adm-check">
            <input
              type="checkbox"
              checked={backup}
              disabled={!backupReady}
              onChange={(e) => setBackup(e.target.checked)}
            />
            <span>
              <strong>Guardar um backup final antes</strong>
              <span className="adm-sub">
                {backupReady
                  ? 'Vai para Backups › Bases excluídas. Desmarcado, nada é guardado.'
                  : 'O backup não está ligado em Backups, então nada será guardado.'}
              </span>
            </span>
          </label>
          <TextField
            label="Código do autenticador"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            hint="Os 6 números do aplicativo, pedidos sempre que você exclui um restaurante."
          />
        </>
      )}
    </Modal>
  );
}
