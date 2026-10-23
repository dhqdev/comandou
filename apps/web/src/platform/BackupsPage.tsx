import { CloudUpload, DatabaseBackup, PlugZap, RotateCcw } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Spinner, TextField, useToast } from '../design-system';
import { dateTime } from '../features/format';
import { SelectField } from '../features/forms';
import { api } from '../lib/api';
import { useLoad } from './OverviewPages';
import type { BackupFolders, BackupRun, BackupSettings, BackupTestResult, DbJob } from './types';
import { Link } from 'react-router';
import { ago, bytes, Dot, Level, Section } from './ui';

const WEEKDAYS = ['Nunca', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const TRIGGER: Record<string, string> = {
  agendado: 'agendado',
  painel: 'pelo painel',
  deploy: 'antes da atualização',
  manual: 'linha de comando',
};

type Form = {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  keyId: string;
  applicationKey: string;
  runAt: string;
  retentionDays: string;
  restoreTestWeekday: string;
};

const toForm = (s: BackupSettings): Form => ({
  enabled: s.enabled,
  endpoint: s.endpoint,
  region: s.region,
  bucket: s.bucket,
  prefix: s.prefix,
  keyId: s.keyId,
  applicationKey: '',
  runAt: s.runAt,
  retentionDays: String(s.retentionDays),
  restoreTestWeekday: String(s.restoreTestWeekday),
});

const toBody = (f: Form) => ({
  ...f,
  endpoint: f.endpoint.trim(),
  retentionDays: Number(f.retentionDays || 0),
  restoreTestWeekday: Number(f.restoreTestWeekday),
});

/**
 * Backups → Backblaze B2. O serviço de backup (comandou-backup) lê esta configuração, faz o
 * backup diário de TODOS os restaurantes (banco inteiro, inclusive fotos), cifra e envia ao bucket.
 */
export function BackupsPage() {
  const settings = useLoad<BackupSettings>('/platform/backups/settings');
  const runs = useLoad<BackupRun[]>('/platform/backups');
  const s = settings.data;
  const pending =
    !!s?.backupRequestedAt ||
    !!s?.restoreRequestedAt ||
    !!runs.data?.some((r) => r.status === 'running');

  // Enquanto há algo pedido ou rodando, atualiza sozinho.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      settings.reload();
      runs.reload();
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (settings.error) return <Alert tone="danger">{settings.error}</Alert>;
  if (!s) return <Spinner />;
  return (
    <>
      <StatusSection s={s} runs={runs.data} onChange={() => (settings.reload(), runs.reload())} />
      <FoldersSection />
      <SettingsSection s={s} onSaved={(n) => settings.setData(n)} />
      <DeletedSection />
      <HistorySection runs={runs.data} error={runs.error} />
    </>
  );
}

function StatusSection({
  s,
  runs,
  onChange,
}: {
  s: BackupSettings;
  runs: BackupRun[] | null;
  onChange(): void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const lastOk = runs?.find((r) => r.kind === 'backup' && r.status === 'ok');
  async function request(kind: 'backup' | 'restore_test') {
    setBusy(kind);
    try {
      await api('/platform/backups/run', { method: 'POST', json: { kind } });
      toast(
        kind === 'backup'
          ? 'Backup pedido: começa em até 15 segundos'
          : 'Teste de restauração pedido',
        'success',
      );
      onChange();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }
  const ready = s.enabled && s.configured;
  return (
    <Section title="Backups" sub="cada banco na sua pasta, cifrado, no Backblaze B2">
      {!s.worker.alive && (
        <Alert tone="warning">
          <span>
            O serviço de backup não está rodando
            {s.worker.lastSeenAt ? ` (visto ${ago(s.worker.lastSeenAt)})` : ''}. Adicione o serviço{' '}
            <strong>comandou-backup</strong> na stack (mesma conexão do dono do banco e a mesma
            INTEGRATIONS_KEY da API). Sem ele nada é enviado ao bucket.
          </span>
        </Alert>
      )}
      {!s.keyConfigured && (
        <Alert tone="danger">
          A API está sem INTEGRATIONS_KEY: não dá para guardar a chave do bucket com segurança.
        </Alert>
      )}
      <div className="adm-panel">
        <div className="adm-rows">
          <div className="adm-row">
            <Dot level={ready ? 'ok' : 'off'} />
            <span className="adm-row__main">
              <span className="adm-row__title">
                {ready ? 'Ligado' : s.configured ? 'Desligado' : 'Não configurado'}
              </span>
              <span className="adm-row__meta">
                {ready
                  ? `Todo dia às ${s.runAt} (Brasília) para ${s.bucket}/${s.prefix}`
                  : 'Preencha os dados do bucket abaixo, teste e ligue'}
              </span>
            </span>
          </div>
          <div className="adm-row">
            <Dot level={s.worker.alive ? 'ok' : 'bad'} />
            <span className="adm-row__main">
              <span className="adm-row__title">Serviço de backup</span>
              <span className="adm-row__meta">{s.worker.alive ? 'rodando' : 'não encontrado'}</span>
            </span>
          </div>
          <div className="adm-row">
            <Dot level={lastOk ? 'ok' : 'off'} />
            <span className="adm-row__main">
              <span className="adm-row__title">Último backup bom</span>
              <span className="adm-row__meta">
                {lastOk ? `${ago(lastOk.finishedAt)} · ${bytes(lastOk.sizeBytes)}` : 'nenhum ainda'}
              </span>
            </span>
          </div>
        </div>
      </div>
      <div className="adm-backup-actions">
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw size={15} />}
          disabled={!ready || !!s.restoreRequestedAt}
          loading={busy === 'restore_test'}
          onClick={() => request('restore_test')}
        >
          Testar restauração
        </Button>
        <Button
          size="sm"
          icon={<CloudUpload size={15} />}
          disabled={!ready || !!s.backupRequestedAt}
          loading={busy === 'backup'}
          onClick={() => request('backup')}
        >
          {s.backupRequestedAt ? 'Backup pedido…' : 'Fazer backup agora'}
        </Button>
      </div>
    </Section>
  );
}

function SettingsSection({ s, onSaved }: { s: BackupSettings; onSaved(n: BackupSettings): void }) {
  const toast = useToast();
  const [f, setF] = useState<Form>(() => toForm(s));
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<BackupTestResult | null>(null);
  const set = (k: keyof Form) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const keyOk = !!f.applicationKey || s.hasApplicationKey;
  const complete = !!(f.endpoint && f.bucket && f.keyId && keyOk);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setError(null);
    try {
      const n = await api<BackupSettings>('/platform/backups/settings', {
        method: 'PUT',
        json: toBody(f),
      });
      onSaved(n);
      setF(toForm(n));
      toast('Configuração do backup salva', 'success');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runTest() {
    setBusy('test');
    setError(null);
    setTest(null);
    try {
      setTest(
        await api<BackupTestResult>('/platform/backups/test', { method: 'POST', json: toBody(f) }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="Backblaze B2" sub="bucket, chave e agenda">
      <Card>
        <form onSubmit={save}>
          <div className="adm-backup-grid">
            <TextField
              label="Endereço S3 (Endpoint)"
              placeholder="https://s3.us-west-004.backblazeb2.com"
              value={f.endpoint}
              onChange={(e) => set('endpoint')(e.target.value)}
              hint={
                s.resolvedRegion && f.endpoint === s.endpoint
                  ? `Região: ${s.resolvedRegion}`
                  : 'Aparece nos detalhes do bucket, no site do B2'
              }
            />
            <TextField
              label="Nome do bucket"
              value={f.bucket}
              onChange={(e) => set('bucket')(e.target.value.trim())}
              hint="Bucket privado"
            />
            <TextField
              label="keyID"
              autoComplete="off"
              value={f.keyId}
              onChange={(e) => set('keyId')(e.target.value.trim())}
            />
            <TextField
              label="applicationKey"
              type="password"
              autoComplete="new-password"
              value={f.applicationKey}
              placeholder={s.hasApplicationKey ? '•••••••• (salva)' : ''}
              onChange={(e) => set('applicationKey')(e.target.value.trim())}
              hint={
                s.hasApplicationKey
                  ? 'Deixe em branco para manter a salva. Fica cifrada; nunca é mostrada.'
                  : 'Mostrada uma vez só no B2, ao criar a chave'
              }
            />
            <TextField
              label="Pasta no bucket"
              value={f.prefix}
              onChange={(e) => set('prefix')(e.target.value.trim())}
            />
            <TextField
              label="Horário (Brasília)"
              type="time"
              value={f.runAt}
              onChange={(e) => set('runAt')(e.target.value)}
            />
            <TextField
              label="Guardar por (dias)"
              inputMode="numeric"
              value={f.retentionDays}
              onChange={(e) => set('retentionDays')(e.target.value.replace(/\D/g, ''))}
              hint="Apaga os mais velhos (guarda sempre os 3 últimos). 0 = nunca apaga"
            />
            <SelectField
              label="Teste de restauração semanal"
              value={f.restoreTestWeekday}
              onChange={(e) => set('restoreTestWeekday')(e.target.value)}
            >
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {i === 0 ? 'Nunca' : `${d}, 2 h depois do backup`}
                </option>
              ))}
            </SelectField>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '16px 0' }}>
            <input
              type="checkbox"
              checked={f.enabled}
              onChange={(e) => set('enabled')(e.target.checked)}
            />
            Backup ligado (o primeiro sai logo depois de salvar)
          </label>
          {test && (
            <Alert tone={test.ok ? (test.canDelete ? 'info' : 'warning') : 'danger'}>
              <div>
                <strong>{test.ok ? 'Bucket funcionando' : 'Não funcionou'}</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {test.steps.map((st) => (
                    <li key={st.step}>
                      {st.ok ? '✓' : '✗'} {st.step}
                      {st.detail ? `: ${st.detail}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            </Alert>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
              marginTop: 12,
            }}
          >
            <Button
              type="button"
              variant="ghost"
              icon={<PlugZap size={16} />}
              loading={busy === 'test'}
              disabled={!complete}
              onClick={runTest}
            >
              Testar conexão
            </Button>
            <Button
              type="submit"
              icon={<DatabaseBackup size={16} />}
              loading={busy === 'save'}
              disabled={f.enabled && !complete}
            >
              Salvar
            </Button>
          </div>
        </form>
      </Card>
      <details className="adm-help" style={{ marginTop: 12 }}>
        <summary>Como criar o bucket e a chave no Backblaze</summary>
        <ol>
          <li>
            Em <strong>B2 Cloud Storage → Buckets → Create a Bucket</strong>: nome único, arquivos{' '}
            <strong>Private</strong>. Copie o <strong>Endpoint</strong> que aparece no bucket.
          </li>
          <li>
            Em <strong>Lifecycle Settings</strong> do bucket, escolha{' '}
            <em>Keep only the last version of the file</em> (assim o que a retenção apaga sai de
            vez).
          </li>
          <li>
            Em <strong>Application Keys → Add a New Application Key</strong>: acesso só a esse
            bucket, <em>Read and Write</em>. Copie o <strong>keyID</strong> e a{' '}
            <strong>applicationKey</strong> (ela só aparece uma vez).
          </li>
          <li>Cole aqui, clique em Testar conexão, marque “Backup ligado” e salve.</li>
        </ol>
        <p>
          Os arquivos vão cifrados (AES-256). Para abrir um backup é preciso a{' '}
          <strong>INTEGRATIONS_KEY</strong> da stack: guarde uma cópia dela fora do servidor.
        </p>
      </details>
    </Section>
  );
}

function HistorySection({ runs, error }: { runs: BackupRun[] | null; error: string | null }) {
  return (
    <Section title="Histórico" sub="últimas 100 execuções (uma por banco)">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="adm-panel">
        {!runs ? (
          <div className="adm-panel__body">
            <Spinner />
          </div>
        ) : runs.length === 0 ? (
          <div className="adm-empty">Nenhuma execução registrada</div>
        ) : (
          <div className="adm-rows">
            {runs.map((r) => {
              const trigger = TRIGGER[String(r.details?.trigger ?? '')];
              return (
                <div key={r.id} className="adm-row">
                  <Dot level={r.status === 'ok' ? 'ok' : r.status === 'failed' ? 'bad' : 'info'} />
                  <span className="adm-row__main">
                    <span className="adm-row__title">
                      {r.kind === 'backup' ? 'Backup' : 'Teste de restauração'}{' '}
                      {r.tenantName ?? (r.tenantId ? 'restaurante excluído' : 'banco central')}{' '}
                      {r.details?.final ? <Badge>final</Badge> : null}
                      {trigger && <Badge>{trigger}</Badge>}
                    </span>
                    <span className="adm-row__meta">
                      {r.error ?? r.objectKey ?? (r.status === 'running' ? 'rodando…' : '—')}
                    </span>
                  </span>
                  <span className="adm-row__side">
                    {dateTime(r.startedAt)}
                    <br />
                    {bytes(r.sizeBytes)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Section>
  );
}

function lastLevel(b: { status: string } | null): Level {
  return !b ? 'off' : b.status === 'ok' ? 'ok' : b.status === 'failed' ? 'bad' : 'info';
}

/**
 * Organização do bucket: uma pasta para o banco central (plataforma/) e uma por restaurante com
 * banco próprio (restaurantes/<endereço>/), cada uma com o seu último backup.
 */
function FoldersSection() {
  const { data, error } = useLoad<BackupFolders>('/platform/backups/folders');
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return null;
  const shared = data.tenants.filter((t) => !t.database);
  const own = data.tenants.filter((t) => t.database);
  const last = (b: BackupFolders['platform']['lastBackup']) =>
    !b
      ? 'nenhum backup ainda'
      : b.status === 'failed'
        ? `falhou ${ago(b.startedAt)}: ${b.error ?? ''}`
        : `${ago(b.finishedAt ?? b.startedAt)} · ${bytes(b.sizeBytes)}`;
  return (
    <Section title="Pastas no bucket" sub={`${own.length + 1} pastas`}>
      <div className="adm-panel">
        <div className="adm-rows">
          <div className="adm-row">
            <Dot level={lastLevel(data.platform.lastBackup)} />
            <span className="adm-row__main">
              <span className="adm-row__title">
                <code>{data.platform.folder}</code>
              </span>
              <span className="adm-row__meta">
                banco central (cadastros, planos, painel
                {shared.length ? ` e ${shared.length} restaurante(s) ainda no banco central` : ''})
              </span>
            </span>
            <span className="adm-row__side">{last(data.platform.lastBackup)}</span>
          </div>
          {own.map((t) => (
            <Link
              key={t.id}
              to={`/restaurantes/${t.id}`}
              className="adm-row"
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              <Dot level={lastLevel(t.lastBackup)} />
              <span className="adm-row__main">
                <span className="adm-row__title">
                  <code>{t.folder}</code>
                </span>
                <span className="adm-row__meta">
                  {t.name} · banco <code>{t.database}</code>
                </span>
              </span>
              <span className="adm-row__side">{last(t.lastBackup)}</span>
            </Link>
          ))}
        </div>
      </div>
      {shared.length > 0 && (
        <p className="adm-sub" style={{ whiteSpace: 'normal' }}>
          Restaurantes ainda no banco central: {shared.map((t) => t.name).join(', ')}. Para cada um
          ter banco e pasta próprios, abra o restaurante → Banco de dados → Mover para banco
          próprio.
        </p>
      )}
    </Section>
  );
}

/** Restaurantes excluídos e onde ficou o backup final de cada um. */
function DeletedSection() {
  const { data } = useLoad<DbJob[]>('/platform/database-jobs?limit=200');
  const deleted = data?.filter((j) => j.kind === 'delete' && j.status === 'done') ?? [];
  if (!deleted.length) return null;
  return (
    <Section title="Bases excluídas" sub={`${deleted.length}`}>
      <div className="adm-panel">
        <div className="adm-rows">
          {deleted.map((j) => (
            <div key={j.id} className="adm-row">
              <Dot level="off" />
              <span className="adm-row__main">
                <span className="adm-row__title">
                  {j.tenantName} ({j.tenantSlug})
                </span>
                <span className="adm-row__meta">
                  {j.result.finalBackupKey ? (
                    <>
                      backup final: <code>{j.result.finalBackupKey}</code>
                    </>
                  ) : (
                    'sem backup final (a base nunca ficou pronta)'
                  )}
                  {j.reason ? ` · motivo: ${j.reason}` : ''}
                </span>
              </span>
              <span className="adm-row__side">
                {dateTime(j.finishedAt ?? j.createdAt)}
                <br />
                {j.result.finalBackupSize ? bytes(j.result.finalBackupSize) : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
