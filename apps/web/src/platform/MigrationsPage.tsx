import {
  ArrowRightLeft,
  Copy,
  ExternalLink,
  Inbox,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Server,
  Trash2,
} from 'lucide-react';
import { FormEvent, ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Modal, Select, Spinner, TextField, useToast } from '../design-system';
import { dateTime } from '../features/format';
import { api } from '../lib/api';
import { useLoad } from './OverviewPages';
import type { Migration, MigrationPhase, Migrations, Receiver, Reception, Stack } from './types';
import { ago, bytes, Dot, Level, MoreMenu, PageHead, Section, Tag, useInterval } from './ui';

const STATUS: Record<Migration['status'], [string, Level]> = {
  queued: ['na fila', 'info'],
  running: ['em andamento', 'info'],
  done: ['concluída', 'ok'],
  failed: ['falhou', 'bad'],
  cancelled: ['cancelada', 'off'],
};

const PHASE_STATUS: Record<MigrationPhase['status'], [string, Level]> = {
  pendente: ['pendente', 'off'],
  rodando: ['rodando', 'info'],
  ok: ['ok', 'ok'],
  falhou: ['falhou', 'bad'],
  pulada: ['pulada', 'off'],
  desfeita: ['desfeita', 'warn'],
};

const PHASE_TEXT: Record<MigrationPhase['name'], string> = {
  preparar: 'Confere o destino, põe em manutenção e gera o pacote',
  enviar: 'Manda o pacote em blocos',
  criar: 'O destino cria o cadastro e o banco',
  restaurar: 'O destino restaura, migra e confere',
  virar: 'O restaurante passa a rodar lá',
  encerrar: 'Limpa aqui e fecha',
};

const RECEPTION: Record<Reception['status'], [string, Level]> = {
  receiving: ['recebendo', 'info'],
  installing: ['instalando', 'info'],
  restored: ['esperando a virada', 'info'],
  active: ['instalado', 'ok'],
  failed: ['falhou', 'bad'],
  discarded: ['desfeito', 'off'],
};

/** Situação da stack de destino pela última conversa com o painel de lá. */
function stackHealth(s: Stack): [string, Level] {
  const c = s.check;
  if (!c) return ['conferindo…', 'info'];
  if (c.error) return ['sem conexão', 'bad'];
  if (c.missingMigrations) return ['versão mais antiga', 'warn'];
  if (!c.workerAlive) return ['backup parado lá', 'warn'];
  if (!c.sameKey) return ['chave diferente', 'warn'];
  return ['pronta', 'ok'];
}

const modeText = (m: Migration['mode']) => (m === 'move' ? 'Mover' : 'Só copiar');
const active = (m: Migration) => m.status === 'queued' || m.status === 'running';

/**
 * Aba "Migrações" da Infraestrutura: leva um restaurante inteiro para outra instalação do
 * Comandou (outro servidor, outra stack), em fases, como o "Movimento de Site" do Frappe.
 * Também é aqui que esta instalação aceita restaurantes vindos de outra.
 */
export function MigrationsPage() {
  const toast = useToast();
  const { data, error, reload } = useLoad<Migrations>('/platform/migrations');
  const receiver = useLoad<Receiver>('/platform/receiver');
  const [stackForm, setStackForm] = useState<Stack | 'new' | null>(null);
  const [creating, setCreating] = useState<string | true | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Stack | null>(null);
  const [busy, setBusy] = useState(false);
  const running =
    data?.list.some(active) ||
    receiver.data?.receptions.some((r) => ['receiving', 'installing'].includes(r.status)) ||
    false;
  useInterval(
    () => {
      reload();
      receiver.reload();
    },
    running ? 3_000 : 20_000,
  );

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <Spinner />;

  async function run<T>(fn: () => Promise<T>, ok: string) {
    setBusy(true);
    try {
      const r = await fn();
      toast(ok, 'success');
      reload();
      return r;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const opened = data.list.find((m) => m.id === openId) ?? null;

  return (
    <>
      <PageHead
        sub={
          <span>
            Leve um restaurante inteiro (banco, fotos, equipe, cadastro, domínios e assinatura) para
            outra instalação do Comandou, num servidor novo.
          </span>
        }
        actions={
          <>
            <button className="adm-action" onClick={() => setStackForm('new')}>
              <Plus size={15} /> Nova stack
            </button>
            <button
              className="adm-action adm-action--primary"
              disabled={!data.stacks.length}
              title={data.stacks.length ? undefined : 'Cadastre uma stack de destino antes'}
              onClick={() => setCreating(true)}
            >
              <ArrowRightLeft size={15} /> Migrar cliente
            </button>
          </>
        }
      />

      {!data.worker.alive && (
        <Alert tone="warning">
          O serviço de backup (<strong>comandou-backup</strong>) não está rodando
          {data.worker.lastSeenAt ? ` (visto ${ago(data.worker.lastSeenAt)})` : ''}. É ele que monta
          e envia o pacote: as migrações ficam na fila até ele voltar.
        </Alert>
      )}

      <Section title="Migrações" sub={data.list.length ? `${data.list.length}` : undefined}>
        {data.list.length === 0 ? (
          <div className="adm-panel adm-panel__body">
            <p className="adm-sub" style={{ margin: 0, whiteSpace: 'normal' }}>
              Nenhuma migração ainda. Cadastre a stack do servidor novo e use{' '}
              <strong>Migrar cliente</strong>.
            </p>
          </div>
        ) : (
          <div className="adm-panel" style={{ overflowX: 'auto' }}>
            <table className="cm-table cm-table--click">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Restaurante</th>
                  <th>Destino</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th>Fase</th>
                  <th>Início</th>
                </tr>
              </thead>
              <tbody>
                {data.list.map((m) => (
                  <tr key={m.id} onClick={() => setOpenId(m.id)}>
                    <td>
                      <code>{m.code}</code>
                    </td>
                    <td>
                      <strong>{m.tenantName}</strong>{' '}
                      <span className="cm-hint">{m.tenantSlug}</span>
                    </td>
                    <td>{m.stackName}</td>
                    <td>{modeText(m.mode)}</td>
                    <td>
                      <Tag level={STATUS[m.status][1]}>{STATUS[m.status][0]}</Tag>
                    </td>
                    <td>{m.phase ?? '—'}</td>
                    <td>{dateTime(m.startedAt ?? m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Stacks de destino" sub={`${data.stacks.length}`}>
        {data.stacks.length === 0 ? (
          <div className="adm-panel adm-panel__body">
            <p className="adm-sub" style={{ margin: 0, whiteSpace: 'normal' }}>
              Nenhuma stack cadastrada. Veja abaixo como preparar o servidor novo.
            </p>
          </div>
        ) : (
          <div className="adm-cards">
            {data.stacks.map((s) => {
              const [label, level] = stackHealth(s);
              const c = s.check;
              return (
                <div key={s.id} className="adm-card">
                  <span className="adm-card__head">
                    <Server size={16} />
                    {s.name}
                    <span style={{ marginLeft: 'auto' }}>
                      <Tag level={level}>{label}</Tag>
                    </span>
                  </span>
                  <dl className="adm-kv">
                    <dt>Painel</dt>
                    <dd>
                      <code>{s.url.replace(/^https?:\/\//, '')}</code>
                    </dd>
                    {c?.baseDomain && (
                      <>
                        <dt>Domínio</dt>
                        <dd>{c.baseDomain}</dd>
                      </>
                    )}
                    {c?.version && (
                      <>
                        <dt>Versão</dt>
                        <dd>
                          {c.version}
                          {c.ms !== undefined ? ` · ${c.ms} ms` : ''}
                        </dd>
                      </>
                    )}
                    <dt>Token</dt>
                    <dd>{s.tokenHint ?? '—'}</dd>
                    {c?.at && (
                      <>
                        <dt>Conferido</dt>
                        <dd>{ago(c.at)}</dd>
                      </>
                    )}
                  </dl>
                  <StackNotes s={s} />
                  <div className="adm-actions">
                    <button className="adm-action" onClick={() => setCreating(s.id)}>
                      <ArrowRightLeft size={14} /> Migrar para cá
                    </button>
                    <MoreMenu
                      items={[
                        {
                          label: 'Testar agora',
                          icon: <RefreshCw size={14} />,
                          onClick: () =>
                            void run(
                              () =>
                                api(`/platform/stacks/${s.id}/test`, { method: 'POST', json: {} }),
                              'Stack conferida',
                            ),
                        },
                        {
                          label: 'Editar',
                          icon: <Pencil size={14} />,
                          onClick: () => setStackForm(s),
                        },
                        {
                          label: 'Remover',
                          icon: <Trash2 size={14} />,
                          danger: true,
                          onClick: () => setRemoving(s),
                        },
                      ]}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <ReceiverSection receiver={receiver} />

      <Section title="Como preparar o servidor novo">
        <div className="adm-panel adm-panel__body" style={{ display: 'grid', gap: 8 }}>
          <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
            <li>
              No servidor novo, instale o Comandou com o instalador (<code>scripts/install.sh</code>
              ), com o domínio de lá. Use a mesma <code>INTEGRATIONS_KEY</code> daqui (secret{' '}
              <code>comandou_integrations_key</code>): assim os tokens do fiscal, WhatsApp, iFood e
              cartões continuam abrindo lá.
            </li>
            <li>
              No painel de lá: Infraestrutura → Migrações → <strong>Receber restaurantes</strong>.
              Copie o token que aparece.
            </li>
            <li>
              Aqui: <strong>Nova stack</strong>, com o endereço do painel de lá (
              <code>https://admin.dominio-novo</code>) e o token. Em segundos aparece “pronta”.
            </li>
            <li>
              <strong>Migrar cliente</strong>: escolha o restaurante e a stack. O restaurante fica
              sem acesso só durante o pacote e a instalação; se algo falhar, ele volta a funcionar
              aqui e o destino apaga o que criou.
            </li>
            <li>
              Depois da virada, o endereço antigo leva para o novo. Domínios próprios do restaurante
              precisam apontar (DNS) para o servidor novo.
            </li>
          </ol>
          <p className="adm-sub" style={{ margin: 0, whiteSpace: 'normal' }}>
            A sessão do WhatsApp (QR) não vai junto: leia o QR de novo no servidor novo. Faturas,
            contratos e chamados ficam aqui como histórico. Passo a passo em docs/migrar-cliente.md.
          </p>
        </div>
      </Section>

      {stackForm && (
        <StackForm
          stack={stackForm === 'new' ? null : stackForm}
          onClose={() => setStackForm(null)}
          onSaved={() => {
            setStackForm(null);
            reload();
          }}
        />
      )}

      {creating && (
        <NewMigration
          data={data}
          stackId={creating === true ? null : creating}
          onClose={() => setCreating(null)}
          onCreated={(m) => {
            setCreating(null);
            reload();
            setOpenId(m.id);
          }}
        />
      )}

      {opened && (
        <MigrationModal
          m={opened}
          busy={busy}
          onClose={() => setOpenId(null)}
          onCancel={() =>
            void run(
              () => api(`/platform/migrations/${opened.id}/cancel`, { method: 'POST', json: {} }),
              'Migração cancelada',
            )
          }
        />
      )}

      <Modal
        open={!!removing}
        title={removing ? `Remover ${removing.name}` : ''}
        onClose={() => setRemoving(null)}
        footer={
          <button
            className="adm-action adm-action--danger"
            disabled={busy}
            onClick={async () => {
              const r = await run(
                () => api(`/platform/stacks/${removing!.id}/remove`, { method: 'POST', json: {} }),
                'Stack removida',
              );
              if (r !== null) setRemoving(null);
            }}
          >
            <Trash2 size={14} /> Remover
          </button>
        }
      >
        <p style={{ margin: 0 }}>
          Tira a stack da lista e apaga o token guardado aqui. Nada muda no servidor de lá nem nas
          migrações já feitas.
        </p>
      </Modal>
    </>
  );
}

function StackNotes({ s }: { s: Stack }) {
  const c = s.check;
  if (!c) return null;
  const notes: ReactNode[] = [];
  if (c.error) notes.push(c.error);
  if (c.missingMigrations)
    notes.push(
      <>
        O destino está numa versão mais antiga (falta <code>{c.firstMissing}</code>): atualize lá
        antes.
      </>,
    );
  if (c.workerAlive === false)
    notes.push('O serviço de backup de lá não está rodando (é ele que instala o restaurante).');
  if (c.sameKey === false)
    notes.push(
      'A INTEGRATIONS_KEY de lá é diferente: tokens do fiscal, WhatsApp, iFood e cartões não abririam. Use a mesma chave lá.',
    );
  if (!notes.length) return null;
  return (
    <span
      className={`adm-card__note adm-card__note--${c.error ? 'bad' : 'warn'}`}
      style={{ whiteSpace: 'normal', display: 'grid', gap: 4 }}
    >
      {notes.map((n, i) => (
        <span key={i}>{n}</span>
      ))}
    </span>
  );
}

function MigrationModal({
  m,
  busy,
  onClose,
  onCancel,
}: {
  m: Migration;
  busy: boolean;
  onClose: () => void;
  onCancel: () => void;
}) {
  const p = m.package;
  const sentBytes =
    p.size && p.chunkSize && p.sent !== undefined ? Math.min(p.size, p.sent * p.chunkSize) : null;
  const dest = m.remoteUrl ?? m.result.url ?? null;
  const target =
    m.options.targetSlug && m.result.destination?.baseDomain
      ? `${m.options.targetSlug}.${m.result.destination.baseDomain}`
      : (m.options.targetSlug ?? m.tenantSlug);
  const banner =
    m.status === 'running' || m.status === 'queued'
      ? `${STATUS[m.status][0]}${m.phase ? ` — fase ${m.phase}` : ''} · ${m.tenantSlug} → ${target}`
      : null;
  return (
    <Modal
      open
      size="xl"
      title={
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <code>{m.code}</code> {m.tenantName}
          <Tag level={STATUS[m.status][1]}>{STATUS[m.status][0]}</Tag>
        </span>
      }
      onClose={onClose}
      footer={
        <>
          {dest && (
            <a className="adm-action" href={dest} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> Abrir no destino
            </a>
          )}
          {m.status === 'queued' && (
            <button className="adm-action adm-action--danger" disabled={busy} onClick={onCancel}>
              Cancelar
            </button>
          )}
        </>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        {banner && <Alert tone="info">{banner}</Alert>}
        {m.error && <Alert tone="danger">{m.error}</Alert>}
        {m.result.warning && <Alert tone="warning">{m.result.warning}</Alert>}

        <dl className="adm-kv">
          <dt>Tipo</dt>
          <dd>
            {modeText(m.mode)}
            {m.mode === 'copy' ? ' (o restaurante continua aqui; a cópia fica suspensa lá)' : ''}
          </dd>
          <dt>Restaurante</dt>
          <dd>
            <Link to={`/restaurantes/${m.tenantId}`}>{m.tenantName}</Link> ({m.tenantSlug})
          </dd>
          <dt>Destino</dt>
          <dd>
            {m.stackName} · {target}
          </dd>
          <dt>Opções</dt>
          <dd style={{ whiteSpace: 'normal' }}>
            {[
              m.options.backupBefore && 'backup antes',
              m.options.keepSuspended && 'suspenso no destino',
              m.options.dropAtOrigin && 'apaga o banco daqui no fim',
              m.options.ignoreKeyMismatch && 'segue com chave diferente',
            ]
              .filter(Boolean)
              .join(' · ') || 'nenhuma'}
          </dd>
          {m.result.destination && (
            <>
              <dt>Versão de lá</dt>
              <dd>{m.result.destination.version}</dd>
            </>
          )}
        </dl>

        <div>
          <h3 className="adm-label" style={{ margin: '0 0 6px' }}>
            Fases
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="cm-table">
              <thead>
                <tr>
                  <th className="cm-num">Nº</th>
                  <th>Fase</th>
                  <th>Estado</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th>Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {m.phases.map((ph, i) => (
                  <tr key={ph.name}>
                    <td className="cm-num">{i + 1}</td>
                    <td>
                      <strong>{ph.name}</strong>
                      <div className="cm-hint">{PHASE_TEXT[ph.name]}</div>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <Dot level={PHASE_STATUS[ph.status][1]} />
                        {PHASE_STATUS[ph.status][0]}
                      </span>
                    </td>
                    <td>{ph.startedAt ? dateTime(ph.startedAt) : '—'}</td>
                    <td>{ph.finishedAt ? dateTime(ph.finishedAt) : '—'}</td>
                    <td style={{ whiteSpace: 'normal', minWidth: 180 }}>{ph.detail ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {p.size !== undefined && (
          <div>
            <h3 className="adm-label" style={{ margin: '0 0 6px' }}>
              Pacote
            </h3>
            <dl className="adm-kv">
              <dt>Tamanho</dt>
              <dd>
                {bytes(p.size)} ({p.size.toLocaleString('pt-BR')} bytes)
              </dd>
              <dt>sha256</dt>
              <dd style={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                <code>{p.sha256}</code>
              </dd>
              <dt>Bloco</dt>
              <dd>{bytes(p.chunkSize ?? 0)}</dd>
              <dt>Enviado</dt>
              <dd>
                {p.sent ?? 0} de {p.chunks} blocos
                {sentBytes !== null ? ` (${bytes(sentBytes)})` : ''}
              </dd>
              {p.rows !== undefined && (
                <>
                  <dt>Conteúdo</dt>
                  <dd>
                    {p.tables} tabelas, {p.rows.toLocaleString('pt-BR')} linhas ({p.database})
                  </dd>
                </>
              )}
              {m.result.backupKey && (
                <>
                  <dt>Backup antes</dt>
                  <dd style={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                    {m.result.backupKey}
                  </dd>
                </>
              )}
              {m.result.finalBackupKey && (
                <>
                  <dt>Backup final</dt>
                  <dd style={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                    {m.result.finalBackupKey}
                  </dd>
                </>
              )}
            </dl>
          </div>
        )}
      </div>
    </Modal>
  );
}

function NewMigration({
  data,
  stackId,
  onClose,
  onCreated,
}: {
  data: Migrations;
  stackId: string | null;
  onClose: () => void;
  onCreated: (m: Migration) => void;
}) {
  const toast = useToast();
  const choices = data.tenants;
  const [tenantId, setTenantId] = useState(choices.find((t) => t.ready)?.id ?? '');
  const [stack, setStack] = useState(stackId ?? data.stacks[0]?.id ?? '');
  const [mode, setMode] = useState<'move' | 'copy'>('move');
  const [slug, setSlug] = useState('');
  const [backupBefore, setBackupBefore] = useState(true);
  const [keepSuspended, setKeepSuspended] = useState(false);
  const [dropAtOrigin, setDropAtOrigin] = useState(false);
  const [ignoreKey, setIgnoreKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const tenant = choices.find((t) => t.id === tenantId);
  const s = data.stacks.find((x) => x.id === stack);
  const keyDiffers = s?.check?.sameKey === false;
  const ok = !!tenant?.ready && !!s && (!keyDiffers || ignoreKey);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const m = await api<Migration>('/platform/migrations', {
        method: 'POST',
        json: {
          tenantId,
          stackId: stack,
          mode,
          targetSlug: slug.trim(),
          backupBefore,
          keepSuspended: mode === 'move' && keepSuspended,
          dropAtOrigin: mode === 'move' && dropAtOrigin,
          ignoreKeyMismatch: ignoreKey,
        },
      });
      toast(`${m.code} na fila`, 'success');
      onCreated(m);
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Migrar cliente para outro servidor"
      onClose={onClose}
      footer={
        <button
          className="adm-action adm-action--primary"
          type="submit"
          form="new-migration"
          disabled={busy || !ok}
        >
          <ArrowRightLeft size={14} /> {mode === 'move' ? 'Migrar agora' : 'Copiar agora'}
        </button>
      }
    >
      <form id="new-migration" onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <div className="cm-field">
          <label className="cm-label" htmlFor="mig-tenant">
            Restaurante
          </label>
          <Select id="mig-tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            {choices.map((t) => (
              <option key={t.id} value={t.id} disabled={!t.ready}>
                {t.name} ({t.slug}){t.ready ? '' : ' · ainda no banco central'}
              </option>
            ))}
          </Select>
        </div>
        <div className="cm-field">
          <label className="cm-label" htmlFor="mig-stack">
            Stack de destino
          </label>
          <Select id="mig-stack" value={stack} onChange={(e) => setStack(e.target.value)}>
            {data.stacks.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({x.url.replace(/^https?:\/\//, '')})
              </option>
            ))}
          </Select>
        </div>
        <div className="cm-field">
          <label className="cm-label" htmlFor="mig-mode">
            Tipo
          </label>
          <Select
            id="mig-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'move' | 'copy')}
          >
            <option value="move">Mover: o restaurante passa a rodar no servidor novo</option>
            <option value="copy">Só copiar: fica uma cópia suspensa lá, para conferir</option>
          </Select>
        </div>
        <TextField
          label="Endereço no destino"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          placeholder={tenant?.slug ?? ''}
          hint={
            s?.check?.baseDomain
              ? `${slug || tenant?.slug || '…'}.${s.check.baseDomain} (vazio = o mesmo de hoje)`
              : 'Vazio = o mesmo de hoje'
          }
          maxLength={40}
        />
        <Check checked={backupBefore} onChange={setBackupBefore}>
          Backup de segurança antes de sair
        </Check>
        {mode === 'move' && (
          <>
            <Check checked={keepSuspended} onChange={setKeepSuspended}>
              Deixar suspenso no destino (eu libero depois)
            </Check>
            <Check checked={dropAtOrigin} onChange={setDropAtOrigin}>
              Apagar o banco daqui no fim (com backup final). Sem marcar, ele fica guardado, sem
              acesso.
            </Check>
          </>
        )}
        {keyDiffers && (
          <Alert tone="warning">
            A INTEGRATIONS_KEY do destino é diferente. Os tokens do fiscal, WhatsApp, iFood e
            cartões não vão abrir lá e precisarão ser cadastrados de novo.
            <div style={{ marginTop: 8 }}>
              <Check checked={ignoreKey} onChange={setIgnoreKey}>
                Seguir mesmo assim
              </Check>
            </div>
          </Alert>
        )}
        <p className="adm-sub" style={{ margin: 0, whiteSpace: 'normal' }}>
          {mode === 'move'
            ? 'O restaurante fica sem acesso enquanto o pacote é gerado, enviado e instalado. Se algo falhar antes da virada, o destino apaga o que criou e ele volta a funcionar aqui.'
            : 'O restaurante segue funcionando aqui o tempo todo.'}
        </p>
      </form>
    </Modal>
  );
}

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3 }}
      />
      <span>{children}</span>
    </label>
  );
}

function StackForm({
  stack,
  onClose,
  onSaved,
}: {
  stack: Stack | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(stack?.name ?? '');
  const [url, setUrl] = useState(stack?.url ?? 'https://');
  const [token, setToken] = useState('');
  const [note, setNote] = useState(stack?.note ?? '');
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(stack ? `/platform/stacks/${stack.id}` : '/platform/stacks', {
        method: stack ? 'PUT' : 'POST',
        json: { name: name.trim(), url: url.trim(), token: token.trim(), note: note.trim() },
      });
      toast(stack ? 'Stack atualizada' : 'Stack cadastrada e conferida', 'success');
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={stack ? `Editar ${stack.name}` : 'Nova stack de destino'}
      onClose={onClose}
      footer={
        <button
          className="adm-action adm-action--primary"
          type="submit"
          form="stack-form"
          disabled={
            busy ||
            name.trim().length < 2 ||
            !/^https?:\/\/.+/.test(url) ||
            (!stack && !token.trim())
          }
        >
          Salvar
        </button>
      }
    >
      <form id="stack-form" onSubmit={save} style={{ display: 'grid', gap: 12 }}>
        <TextField
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Servidor 2 (Hetzner)"
          maxLength={60}
        />
        <TextField
          label="Endereço do painel de lá"
          value={url}
          onChange={(e) => setUrl(e.target.value.trim())}
          placeholder="https://admin.dominio-novo.com.br"
          autoComplete="off"
        />
        <TextField
          label="Token de recebimento"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={stack ? `${stack.tokenHint ?? ''} (vazio = mantém)` : 'cmr_…'}
          autoComplete="off"
          hint="Gerado no painel de lá: Infraestrutura → Migrações → Receber restaurantes"
        />
        <TextField
          label="Observação"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
        />
        <p className="adm-sub" style={{ margin: 0, whiteSpace: 'normal' }}>
          O token fica guardado cifrado e nunca volta para a tela.
        </p>
      </form>
    </Modal>
  );
}

/** Esta instalação recebendo restaurantes de outra: liga, mostra o token uma vez e o histórico. */
function ReceiverSection({ receiver }: { receiver: ReturnType<typeof useLoad<Receiver>> }) {
  const toast = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const r = receiver.data;
  if (!r) return null;

  async function set(enabled: boolean) {
    setBusy(true);
    try {
      const out = await api<Receiver>('/platform/receiver', { method: 'PUT', json: { enabled } });
      setToken(out.token ?? null);
      receiver.setData(out);
      toast(enabled ? 'Recebimento ligado: copie o token' : 'Recebimento desligado', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Receber restaurantes de outro servidor"
      actions={
        r.enabled ? (
          <MoreMenu
            items={[
              {
                label: 'Gerar token novo (o antigo para de valer)',
                icon: <RefreshCw size={14} />,
                onClick: () => void set(true),
              },
              {
                label: 'Desligar o recebimento',
                icon: <Power size={14} />,
                danger: true,
                onClick: () => void set(false),
              },
            ]}
          />
        ) : (
          <button className="adm-action" disabled={busy} onClick={() => void set(true)}>
            <Power size={14} /> Receber restaurantes
          </button>
        )
      }
    >
      <div className="adm-panel adm-panel__body" style={{ display: 'grid', gap: 10 }}>
        <p style={{ margin: 0, whiteSpace: 'normal' }}>
          {r.enabled ? (
            <>
              <Tag level="ok">ligado</Tag> Outra instalação pode mandar restaurantes para cá com o
              token {r.tokenHint}. Endereço para cadastrar lá: <code>{r.adminUrl}</code>
            </>
          ) : (
            <>
              <Tag level="off">desligado</Tag> Ligue aqui quando este for o servidor novo: o token
              gerado é colado na instalação de origem.
            </>
          )}
        </p>
        {token && (
          <Alert tone="info">
            Token (aparece só agora): <code style={{ wordBreak: 'break-all' }}>{token}</code>{' '}
            <button
              className="adm-icon-btn"
              title="Copiar"
              aria-label="Copiar token"
              onClick={() =>
                void navigator.clipboard
                  .writeText(token)
                  .then(() => toast('Token copiado', 'success'))
                  .catch(() => undefined)
              }
            >
              <Copy size={14} />
            </button>
          </Alert>
        )}
        {r.enabled && r.keyFingerprint && (
          <span className="adm-sub">
            Impressão da INTEGRATIONS_KEY daqui: <code>{r.keyFingerprint}</code> (a de lá precisa
            ser igual)
          </span>
        )}
        {r.receptions.length > 0 && (
          <div className="adm-rows" aria-label="Restaurantes recebidos">
            {r.receptions.map((x) => (
              <div key={x.id} className="adm-row">
                <Dot level={RECEPTION[x.status][1]} />
                <Inbox size={14} />
                <span className="adm-row__main">
                  <span className="adm-row__title">
                    {x.tenantName} ({x.tenantSlug}) · {RECEPTION[x.status][0]}
                  </span>
                  <span className="adm-row__meta">
                    {x.error ??
                      [x.source.code, x.mode === 'copy' ? 'cópia' : null, x.step]
                        .filter(Boolean)
                        .join(' · ')}
                    {x.size ? ` · ${bytes(Number(x.size))}` : ''}
                  </span>
                </span>
                <span className="adm-row__side">{dateTime(x.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
