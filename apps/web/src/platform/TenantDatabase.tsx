import { Copy, Database, RotateCcw, Trash2, Truck } from 'lucide-react';
import { useState } from 'react';
import { Alert, Modal, Spinner, TextField, useToast } from '../design-system';
import { dateTime } from '../features/format';
import { api } from '../lib/api';
import type { DbJob, TenantDatabase, TenantDetail } from './types';
import { ago, bytes, Dot, Level, Tag } from './ui';

export const DB_STATUS: Record<TenantDatabase['status'], [string, Level]> = {
  creating: ['sendo criado', 'info'],
  ready: ['em uso', 'ok'],
  failed: ['falhou', 'bad'],
  moving: ['mudando', 'info'],
  deleting: ['sendo excluído', 'warn'],
};

const JOB_KIND: Record<DbJob['kind'], string> = {
  create: 'Criar banco',
  move: 'Mover para banco próprio',
  delete: 'Excluir restaurante e base',
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

export function DatabasePanel({
  t,
  onChanged,
}: {
  t: TenantDetail;
  onChanged: (d: TenantDetail) => void;
}) {
  const toast = useToast();
  const db = t.database;
  const [sheet, setSheet] = useState<'move' | 'delete' | null>(null);
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
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
      setConfirm('');
      setReason('');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  const canDelete = t.status === 'suspended' || t.status === 'failed';

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
            onClick={() => call('database/move', undefined, 'Mudança pedida')}
          >
            <Truck size={14} /> Mover agora
          </button>
        }
      >
        <p style={{ marginTop: 0 }}>
          O restaurante ganha o banco <code>comandou_{t.slug.replace(/-/g, '_')}</code>, só dele, e
          os backups passam a ir para a pasta dele no backup.
        </p>
        <p>
          Durante a cópia (de segundos a poucos minutos, conforme o tamanho) ninguém do restaurante
          consegue usar o sistema. Tudo é conferido antes da troca; se algo falhar, ele continua no
          banco central como está.
        </p>
      </Modal>

      <Modal
        open={sheet === 'delete'}
        title={`Excluir ${t.name}`}
        onClose={() => setSheet(null)}
        footer={
          <button
            className="adm-action adm-action--danger"
            disabled={busy || !canDelete || confirm.trim() !== t.slug || reason.trim().length < 3}
            onClick={() =>
              call('delete', { confirm: confirm.trim(), reason: reason.trim() }, 'Exclusão pedida')
            }
          >
            <Trash2 size={14} /> Excluir de vez
          </button>
        }
      >
        {!canDelete ? (
          <Alert tone="warning">
            Suspenda o restaurante antes (botão Suspender, no topo). Assim ninguém está usando na
            hora da exclusão.
          </Alert>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>
              Apaga o banco do restaurante (pedidos, caixa, cardápio, clientes, equipe, fotos), o
              endereço <strong>{t.slug}</strong> e a assinatura. Antes, o serviço de backup guarda
              um
              <strong> backup final</strong> na pasta <code>restaurantes/{t.slug}/final/</code> do
              backup (Backblaze ou servidor), que a retenção nunca apaga.
            </p>
            <div style={{ display: 'grid', gap: 10 }}>
              <TextField
                label={`Digite ${t.slug} para confirmar`}
                value={confirm}
                autoComplete="off"
                onChange={(e) => setConfirm(e.target.value.toLowerCase())}
              />
              <TextField
                label="Motivo (fica na auditoria)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
