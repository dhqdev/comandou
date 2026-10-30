import { ArrowRightLeft, Database, Pencil, Plus, RefreshCw, Server, Trash2 } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Modal, Select, Spinner, TextField, useToast } from '../design-system';
import { dateTime } from '../features/format';
import { api } from '../lib/api';
import { useLoad } from './OverviewPages';
import { DB_STATUS } from './TenantDatabase';
import type { DbJob, DbServer, DbServerCheck, DbServers } from './types';
import { ago, bytes, Dot, Level, MoreMenu, PageHead, Section, Tag, useInterval } from './ui';

type Card = {
  id: string;
  name: string;
  host: string;
  port: number;
  main: boolean;
  server: DbServer | null;
  acceptsNew: boolean;
  check: DbServerCheck | null;
  restaurants: DbServers['main']['restaurants'];
};

const JOB_STATUS: Record<DbJob['status'], [string, Level]> = {
  queued: ['na fila', 'info'],
  running: ['rodando', 'info'],
  done: ['concluído', 'ok'],
  failed: ['falhou', 'bad'],
};

/** Situação do servidor pelas conferências do serviço de backup e da API. */
function health(c: Card): [string, Level] {
  if (c.server?.status === 'retired') return ['desativado', 'off'];
  if (!c.check) return ['conferindo…', 'info'];
  if (c.check.error) return ['sem conexão', 'bad'];
  if (!c.check.ok) return ['falta permissão', 'warn'];
  if (c.server?.apiCheck && !c.server.apiCheck.ok) return ['senhas diferentes', 'bad'];
  return ['ok', 'ok'];
}

/**
 * Bancos: em qual servidor Postgres fica o banco de cada restaurante, e a troca com um clique
 * (de um restaurante ou de todos). Quem copia é o serviço de backup, um restaurante por vez.
 */
export function DbServersPage() {
  const toast = useToast();
  const { data, error, reload } = useLoad<DbServers>('/platform/db-servers');
  const jobs = useLoad<DbJob[]>('/platform/database-jobs?limit=30');
  const [form, setForm] = useState<DbServer | 'new' | null>(null);
  const [moveAll, setMoveAll] = useState<Card | null>(null);
  const [moveOne, setMoveOne] = useState<{ id: string; name: string; from: string } | null>(null);
  const [remove, setRemove] = useState<DbServer | null>(null);
  const [busy, setBusy] = useState(false);
  const running =
    jobs.data?.some((j) => j.status === 'queued' || j.status === 'running') ||
    data?.servers.some((s) => !s.check) ||
    false;
  useInterval(
    () => {
      reload();
      jobs.reload();
    },
    running ? 4_000 : 20_000,
  );

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <Spinner />;

  const cards: Card[] = [
    {
      id: 'main',
      name: data.main.name,
      host: data.main.host,
      port: data.main.port,
      main: true,
      server: null,
      acceptsNew: data.main.acceptsNew,
      check: data.main.check,
      restaurants: data.main.restaurants,
    },
    ...data.servers.map((s) => ({
      id: s.id,
      name: s.name,
      host: s.host,
      port: s.port,
      main: false,
      server: s,
      acceptsNew: s.acceptsNew,
      check: s.check,
      restaurants: s.restaurants,
    })),
  ];
  const targets = (from: string) =>
    cards.filter((c) => c.id !== from && (c.main || c.server?.status === 'active'));

  async function run<T>(fn: () => Promise<T>, ok: string) {
    setBusy(true);
    try {
      const r = await fn();
      toast(ok, 'success');
      reload();
      jobs.reload();
      return r;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const transfers = (jobs.data ?? []).filter((j) => j.kind === 'transfer' || j.kind === 'move');

  return (
    <>
      <PageHead
        page
        title="Bancos"
        sub={
          <span>
            Cada restaurante tem o próprio banco. Escolha em qual servidor ele fica e mude com um
            clique.
          </span>
        }
        actions={
          <button className="adm-action adm-action--primary" onClick={() => setForm('new')}>
            <Plus size={15} /> Novo servidor
          </button>
        }
      />

      {!data.worker.alive && (
        <Alert tone="warning">
          O serviço de backup (<strong>comandou-backup</strong>) não está rodando
          {data.worker.lastSeenAt ? ` (visto ${ago(data.worker.lastSeenAt)})` : ''}. É ele que
          confere os servidores e copia os bancos: as mudanças ficam na fila até ele voltar.
        </Alert>
      )}

      <Section title="Servidores" sub={`${cards.length}`}>
        <div className="adm-cards">
          {cards.map((c) => {
            const [label, level] = health(c);
            return (
              <div key={c.id} className="adm-card">
                <span className="adm-card__head">
                  {c.main ? <Server size={16} /> : <Database size={16} />}
                  {c.name}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    {c.acceptsNew && <Tag level="info">novos restaurantes</Tag>}
                    <Tag level={level}>{label}</Tag>
                  </span>
                </span>
                <span className="adm-card__big">
                  {c.restaurants.length}{' '}
                  {c.restaurants.length === 1 ? 'restaurante' : 'restaurantes'}
                </span>
                <dl className="adm-kv">
                  <dt>Endereço</dt>
                  <dd>
                    <code>
                      {c.host}:{c.port}
                    </code>
                    {c.server?.ssl === 'require' ? ' · SSL' : ''}
                  </dd>
                  {c.check?.version && (
                    <>
                      <dt>Postgres</dt>
                      <dd>
                        {c.check.version.split(' ')[0]}
                        {c.check.latencyMs !== undefined ? ` · ${c.check.latencyMs} ms` : ''}
                      </dd>
                    </>
                  )}
                  {c.check?.bytes !== undefined && (
                    <>
                      <dt>Espaço dos bancos</dt>
                      <dd>{bytes(c.check.bytes)}</dd>
                    </>
                  )}
                  {c.main && data.main.legacyTenants > 0 && (
                    <>
                      <dt>No banco central</dt>
                      <dd>{data.main.legacyTenants} antigo(s)</dd>
                    </>
                  )}
                  {c.check?.at && (
                    <>
                      <dt>Conferido</dt>
                      <dd>{ago(c.check.at)}</dd>
                    </>
                  )}
                </dl>
                <Checks c={c} />
                {c.restaurants.length > 0 && (
                  <div className="adm-rows" aria-label={`Restaurantes em ${c.name}`}>
                    {c.restaurants.slice(0, 8).map((r) => (
                      <div key={r.id} className="adm-row">
                        <Dot level={DB_STATUS[r.dbStatus]?.[1] ?? 'off'} />
                        <span className="adm-row__main">
                          <Link to={`/restaurantes/${r.id}`} className="adm-row__title">
                            {r.name}
                          </Link>
                          <span className="adm-row__meta">
                            {r.dbStatus === 'ready' ? r.slug : DB_STATUS[r.dbStatus]?.[0]}
                          </span>
                        </span>
                        {r.dbStatus === 'ready' &&
                          (r.status === 'provisioned' || r.status === 'suspended') &&
                          targets(c.id).length > 0 && (
                            <button
                              className="adm-icon-btn"
                              title="Trocar de servidor"
                              aria-label={`Trocar ${r.name} de servidor`}
                              onClick={() => setMoveOne({ id: r.id, name: r.name, from: c.id })}
                            >
                              <ArrowRightLeft size={14} />
                            </button>
                          )}
                      </div>
                    ))}
                    {c.restaurants.length > 8 && (
                      <span className="adm-sub">e mais {c.restaurants.length - 8}</span>
                    )}
                  </div>
                )}
                <div className="adm-actions">
                  {c.restaurants.length > 0 && targets(c.id).length > 0 && (
                    <button className="adm-action" onClick={() => setMoveAll(c)}>
                      <ArrowRightLeft size={14} /> Mover todos
                    </button>
                  )}
                  {c.server && (
                    <MoreMenu
                      items={[
                        {
                          label: 'Editar',
                          icon: <Pencil size={14} />,
                          onClick: () => setForm(c.server),
                        },
                        {
                          label: 'Testar conexão',
                          icon: <RefreshCw size={14} />,
                          onClick: () =>
                            void run(
                              () =>
                                api(`/platform/db-servers/${c.id}/test`, {
                                  method: 'POST',
                                  json: {},
                                }),
                              'Teste pedido',
                            ),
                        },
                        {
                          label: 'Restaurantes novos aqui',
                          hidden: c.acceptsNew || c.server.status !== 'active',
                          onClick: () =>
                            void run(
                              () =>
                                api(`/platform/db-servers/${c.id}`, {
                                  method: 'PUT',
                                  json: { acceptsNew: true },
                                }),
                              'Restaurantes novos vão para este servidor',
                            ),
                        },
                        {
                          label: 'Restaurantes novos no principal',
                          hidden: !c.acceptsNew,
                          onClick: () =>
                            void run(
                              () =>
                                api(`/platform/db-servers/${c.id}`, {
                                  method: 'PUT',
                                  json: { acceptsNew: false },
                                }),
                              'Restaurantes novos vão para o servidor principal',
                            ),
                        },
                        {
                          label:
                            c.server.status === 'active'
                              ? 'Desativar (não recebe restaurantes)'
                              : 'Reativar',
                          onClick: () =>
                            void run(
                              () =>
                                api(`/platform/db-servers/${c.id}`, {
                                  method: 'PUT',
                                  json: {
                                    status: c.server!.status === 'active' ? 'retired' : 'active',
                                  },
                                }),
                              'Servidor atualizado',
                            ),
                        },
                        {
                          label: 'Remover',
                          icon: <Trash2 size={14} />,
                          danger: true,
                          hidden: c.restaurants.length > 0,
                          onClick: () => setRemove(c.server),
                        },
                      ]}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {transfers.length > 0 && (
        <Section title="Mudanças recentes">
          <div className="adm-panel">
            <div className="adm-rows">
              {transfers.slice(0, 12).map((j) => (
                <div key={j.id} className="adm-row">
                  <Dot level={JOB_STATUS[j.status][1]} />
                  <span className="adm-row__main">
                    <span className="adm-row__title">
                      {j.tenantName} · {JOB_STATUS[j.status][0]}
                    </span>
                    <span className="adm-row__meta">
                      {j.error ??
                        j.result.warning ??
                        (j.status === 'done'
                          ? j.kind === 'transfer'
                            ? `${j.result.from} → ${j.result.to}`
                            : 'para banco próprio'
                          : (j.step ?? 'na fila do serviço de backup'))}
                      {j.result.rows ? ` · ${j.result.rows.toLocaleString('pt-BR')} linhas` : ''}
                    </span>
                  </span>
                  <span className="adm-row__side">{dateTime(j.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}

      <Section title="Como preparar um servidor novo">
        <div className="adm-panel adm-panel__body" style={{ display: 'grid', gap: 8 }}>
          <p style={{ margin: 0 }}>
            O servidor novo precisa dos mesmos papéis e senhas do principal (
            <code>comandou_owner</code>, <code>comandou_app</code>, <code>comandou_platform</code>).
            O jeito mais fácil:
          </p>
          <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
            <li>
              Ponha a VM nova no Swarm (<code>docker swarm join</code>) e marque o nó:{' '}
              <code>docker node update --label-add comandou.db=2 &lt;nó&gt;</code>.
            </li>
            <li>
              Suba a stack com o arquivo extra <code>infrastructure/swarm/db-server.yml</code>: ele
              cria o serviço <code>postgres-2</code> nesse nó com os mesmos secrets.
            </li>
            <li>
              Aqui: <strong>Novo servidor</strong>, endereço <code>postgres-2</code>, porta 5432,
              sem SSL. Em segundos aparece “ok”.
            </li>
            <li>
              <strong>Mover todos</strong> (ou um restaurante por vez). Cada um fica sem acesso só
              durante a cópia dele.
            </li>
          </ol>
          <p className="adm-sub" style={{ margin: 0, whiteSpace: 'normal' }}>
            Postgres fora do Swarm (outra nuvem, gerenciado): crie os três papéis com as mesmas
            senhas, dê <code>CREATEDB</code> e <code>pg_signal_backend</code> ao dono e use SSL.
            Passo a passo em docs/servidores-de-banco.md.
          </p>
        </div>
      </Section>

      {form && (
        <ServerForm
          server={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            reload();
          }}
        />
      )}

      <MoveModal
        open={!!moveAll}
        title={moveAll ? `Mover todos de ${moveAll.name}` : ''}
        targets={moveAll ? targets(moveAll.id) : []}
        busy={busy}
        onClose={() => setMoveAll(null)}
        text={
          moveAll
            ? `Os ${moveAll.restaurants.length} restaurante(s) vão para a fila e são copiados um por vez. Cada um fica sem acesso só durante a própria cópia; os outros seguem funcionando.`
            : ''
        }
        onConfirm={async (to) => {
          const r = await run(
            () =>
              api<{ queued: number; skipped: { slug: string; reason: string }[] }>(
                '/platform/db-servers/transfer-all',
                { method: 'POST', json: { from: moveAll!.id, to } },
              ),
            'Mudança pedida',
          );
          if (r?.skipped.length)
            toast(
              `${r.queued} na fila; ficaram de fora: ${r.skipped.map((s) => `${s.slug} (${s.reason})`).join(', ')}`,
              'neutral',
            );
          if (r) setMoveAll(null);
        }}
      />

      <MoveModal
        open={!!moveOne}
        title={moveOne ? `Trocar ${moveOne.name} de servidor` : ''}
        targets={moveOne ? targets(moveOne.from) : []}
        busy={busy}
        onClose={() => setMoveOne(null)}
        text="O banco é copiado inteiro, conferido tabela por tabela e só então o restaurante passa a usar o servidor novo. Com backup ligado, um backup é feito antes. Durante a cópia ninguém do restaurante consegue usar o sistema; se algo falhar, ele continua onde está."
        onConfirm={async (to) => {
          const r = await run(
            () =>
              api(`/platform/tenants/${moveOne!.id}/database/transfer`, {
                method: 'POST',
                json: { to },
              }),
            'Troca de servidor pedida',
          );
          if (r !== null) setMoveOne(null);
        }}
      />

      <Modal
        open={!!remove}
        title={remove ? `Remover ${remove.name}` : ''}
        onClose={() => setRemove(null)}
        footer={
          <button
            className="adm-action adm-action--danger"
            disabled={busy}
            onClick={async () => {
              const r = await run(
                () =>
                  api(`/platform/db-servers/${remove!.id}/remove`, { method: 'POST', json: {} }),
                'Servidor removido',
              );
              if (r !== null) setRemove(null);
            }}
          >
            <Trash2 size={14} /> Remover
          </button>
        }
      >
        <p style={{ margin: 0 }}>
          Tira o servidor da lista. Nenhum banco é apagado lá: depois disso dá para desligar a VM.
        </p>
      </Modal>
    </>
  );
}

function Checks({ c }: { c: Card }) {
  const k = c.check;
  if (!k) return null;
  if (k.error)
    return (
      <span className="adm-card__note adm-card__note--bad" style={{ whiteSpace: 'normal' }}>
        O serviço de backup não conectou: {k.error}
      </span>
    );
  const items: [boolean | undefined, string][] = [
    [k.canCreateDatabases && k.canTerminate, 'dono pode criar e apagar bancos'],
    [k.appRoles, 'papéis da aplicação e do painel existem'],
  ];
  if (c.server?.apiCheck) items.push([c.server.apiCheck.ok, 'a API entra com as mesmas senhas']);
  const bad = items.filter(([ok]) => !ok);
  if (!bad.length) return null;
  return (
    <span className="adm-card__note adm-card__note--warn" style={{ whiteSpace: 'normal' }}>
      Falta: {bad.map(([, t]) => t).join('; ')}.
      {c.server?.apiCheck && !c.server.apiCheck.ok && (
        <> {c.server.apiCheck.app.error ?? c.server.apiCheck.platform.error}</>
      )}
    </span>
  );
}

function MoveModal({
  open,
  title,
  text,
  targets,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  text: string;
  targets: Card[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (to: string) => void;
}) {
  const [to, setTo] = useState('');
  const value = targets.some((t) => t.id === to)
    ? to
    : ((targets.find((t) => t.acceptsNew) ?? targets[0])?.id ?? '');
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <button
          className="adm-action adm-action--primary"
          disabled={busy || !value}
          onClick={() => onConfirm(value)}
        >
          <ArrowRightLeft size={14} /> Mover agora
        </button>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="cm-field">
          <label className="cm-label" htmlFor="move-to">
            Para o servidor
          </label>
          <Select id="move-to" value={value} onChange={(e) => setTo(e.target.value)}>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.host})
              </option>
            ))}
          </Select>
        </div>
        <p style={{ margin: 0 }}>{text}</p>
      </div>
    </Modal>
  );
}

function ServerForm({
  server,
  onClose,
  onSaved,
}: {
  server: DbServer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(server?.name ?? '');
  const [host, setHost] = useState(server?.host ?? '');
  const [port, setPort] = useState(String(server?.port ?? 5432));
  const [ssl, setSsl] = useState<'disable' | 'require'>(server?.ssl ?? 'disable');
  const [acceptsNew, setAcceptsNew] = useState(server?.acceptsNew ?? false);
  const [note, setNote] = useState(server?.note ?? '');
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const json = {
        name: name.trim(),
        host: host.trim(),
        port: Number(port) || 5432,
        ssl,
        acceptsNew,
        note: note.trim(),
      };
      await api(server ? `/platform/db-servers/${server.id}` : '/platform/db-servers', {
        method: server ? 'PUT' : 'POST',
        json,
      });
      toast(
        server ? 'Servidor atualizado' : 'Servidor cadastrado; conferindo a conexão',
        'success',
      );
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
      title={server ? `Editar ${server.name}` : 'Novo servidor de banco'}
      onClose={onClose}
      footer={
        <button
          className="adm-action adm-action--primary"
          type="submit"
          form="db-server-form"
          disabled={busy || name.trim().length < 2 || !host.trim()}
        >
          Salvar
        </button>
      }
    >
      <form id="db-server-form" onSubmit={save} style={{ display: 'grid', gap: 12 }}>
        <TextField
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Banco 2 (Oracle São Paulo)"
          maxLength={60}
        />
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr) 110px' }}>
          <TextField
            label="Endereço"
            value={host}
            onChange={(e) => setHost(e.target.value.toLowerCase())}
            placeholder="postgres-2"
            autoComplete="off"
            hint="Nome do serviço no Swarm, IP ou domínio"
          />
          <TextField
            label="Porta"
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
          />
        </div>
        <div className="cm-field">
          <label className="cm-label" htmlFor="db-ssl">
            Conexão
          </label>
          <Select
            id="db-ssl"
            value={ssl}
            onChange={(e) => setSsl(e.target.value as 'disable' | 'require')}
          >
            <option value="disable">Rede interna do Swarm (sem SSL)</option>
            <option value="require">Pela internet (SSL obrigatório)</option>
          </Select>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={acceptsNew}
            onChange={(e) => setAcceptsNew(e.target.checked)}
          />
          Restaurantes novos são criados neste servidor
        </label>
        <TextField
          label="Observação"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
        />
        <p className="adm-sub" style={{ margin: 0, whiteSpace: 'normal' }}>
          Nenhuma senha é pedida nem guardada: o servidor usa os mesmos papéis e senhas do
          principal.
        </p>
      </form>
    </Modal>
  );
}
