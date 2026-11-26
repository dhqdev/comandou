import { ArrowUpCircle, Play, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, ProgressBar, useToast } from '../design-system';
import { api } from '../lib/api';
import { freshReload } from '../lib/fresh-reload';
import { useLoad } from './OverviewPages';
import type { ServerService, UpdateInfo, UpdateJob, UpdateStep } from './types';
import { Dot, Level, Section, Tag, Tile, useInterval } from './ui';

const TAG_OF = (image: string) => image.slice(image.lastIndexOf(':') + 1);
/** Serviços do próprio Comandou: imagem comandou-* com tag de versão (v1.2.3) ou latest. */
const isOurs = (s: ServerService) => /\/comandou-[\w-]+:(v\d+\.\d+\.\d+|latest)$/.test(s.image);

const CLEAN_LABEL: Record<string, string> = {
  containers: 'contêineres parados',
  'unused-images': 'imagens sem uso',
  'build-cache': 'cache de build',
  volumes: 'volumes anônimos',
};

const STEP_LEVEL: Record<UpdateStep['status'], Level> = {
  pending: 'off',
  running: 'info',
  ok: 'ok',
  skipped: 'off',
  failed: 'bad',
};
const STEP_LABEL: Record<UpdateStep['status'], string> = {
  pending: 'aguardando',
  running: 'atualizando…',
  ok: 'ok',
  skipped: 'sem mudança',
  failed: 'falhou',
};

/**
 * Quanto tempo um serviço pode ficar trocando antes de a tela oferecer o destravar. Uma troca
 * normal leva 1 a 2 minutos (a migração pode passar dos 5, com muitos restaurantes).
 */
const STALL_MS = 3 * 60_000;
const STALL_MIGRATE_MS = 10 * 60_000;

/** Passo em andamento e há quanto tempo (pelo relógio do servidor). */
export function runningStep(job: UpdateJob | null | undefined, now: string | undefined) {
  if (!job || job.status !== 'running') return null;
  const step = job.steps.find((s) => s.status === 'running');
  if (!step) return null;
  const since = Date.parse(step.startedAt ?? job.startedAt);
  const ms = Math.max(0, (now ? Date.parse(now) : Date.now()) - since);
  const limit = /migrate/i.test(step.service) ? STALL_MIGRATE_MS : STALL_MS;
  return { step, ms, stalled: ms >= limit };
}

const minutes = (ms: number) => {
  const m = Math.floor(ms / 60_000);
  return m < 1 ? 'menos de 1 min' : `${m} min`;
};
/**
 * Barra da atualização do sistema: sem tarefa ainda (o clique acabou de sair), corre sem número;
 * com tarefa, enche pelos serviços já trocados. Fora de andamento, não aparece.
 */
export function updateProgress(job: UpdateJob | null | undefined, starting: boolean) {
  if (job?.status === 'running') {
    const total = job.steps.length;
    const done = job.steps.filter((s) => s.status === 'ok' || s.status === 'skipped').length;
    const current = job.steps.find((s) => s.status === 'running');
    return {
      title: `Atualizando para ${job.version}`,
      note: current
        ? `${done} de ${total} · ${shortName(current.service)}`
        : `${done} de ${total} serviços`,
      // Um pouco já cheio assim que começa: a barra mostra que andou.
      value: total ? Math.max(0.04, done / total) : null,
    };
  }
  if (starting)
    return { title: 'Iniciando a atualização…', note: 'pedindo ao servidor', value: null };
  return null;
}

/** "comandou_comandou-api" → "comandou-api" (nome curto para botão). */
const shortName = (service: string) => service.slice(service.indexOf('_') + 1);

function Steps({
  steps,
  current,
}: {
  steps: UpdateStep[];
  current: ReturnType<typeof runningStep>;
}) {
  return (
    <div className="adm-rows">
      {steps.map((s) => {
        const here = current?.step.service === s.service ? current : null;
        return (
          <div key={s.service} className="adm-row">
            <Dot level={here?.stalled ? 'warn' : STEP_LEVEL[s.status]} />
            <span className="adm-row__main">
              <span className="adm-row__title">{s.service}</span>
              <span className="adm-row__meta">
                {s.from} → {s.to}
                {s.message ? ` · ${s.message}` : ''}
              </span>
            </span>
            <span className="adm-row__side">
              {here
                ? here.stalled
                  ? `parado há ${minutes(here.ms)}`
                  : `atualizando… ${minutes(here.ms)}`
                : STEP_LABEL[s.status]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Destravar sem ir ao Portainer: "Destravar e continuar" larga a troca parada e segue de onde
 * ficou; "Reiniciar" sobe tarefas novas só daquele serviço (o mesmo que reiniciar no Portainer).
 */
function Unstick({
  job,
  service,
  stalledFor,
  onDone,
}: {
  job: UpdateJob;
  service: string | null;
  stalledFor: number | null;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<'resume' | 'restart' | null>(null);

  async function resume() {
    setBusy('resume');
    try {
      await api('/platform/server/update/resume', { method: 'POST', json: {} });
      toast('Continuando a atualização de onde parou', 'success');
      onDone();
    } catch (e) {
      const msg = (e as Error).message;
      // Agente de antes da 0.230 não tem essa ação: reiniciar o serviço resolve.
      toast(
        /rota não encontrada/.test(msg)
          ? 'O agente ainda é da versão antiga. Use Reiniciar o serviço; depois desta atualização, o Destravar passa a funcionar.'
          : msg,
        'danger',
      );
    } finally {
      setBusy(null);
    }
  }

  async function restart() {
    if (!service) return;
    setBusy('restart');
    try {
      await api(`/platform/server/services/${encodeURIComponent(service)}/restart`, {
        method: 'POST',
      });
      toast(`${shortName(service)} reiniciando`, 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="adm-panel__body adm-unstick">
      {stalledFor !== null && service ? (
        <p style={{ margin: 0 }}>
          {shortName(service)} está trocando de versão há {minutes(stalledFor)}, mais do que o
          normal. <strong>Destravar e continuar</strong> refaz a troca que ficou no meio e segue com
          os serviços que faltam. Se não andar, <strong>Reiniciar</strong> sobe o serviço de novo,
          como no Portainer.
        </p>
      ) : (
        <p style={{ margin: 0 }}>
          <strong>Continuar atualização</strong> segue de onde parou. Se não andar,{' '}
          <strong>Reiniciar</strong> sobe o serviço de novo, como no Portainer.
        </p>
      )}
      <div className="adm-actions">
        <button className="adm-action adm-action--primary" disabled={!!busy} onClick={resume}>
          <Play size={14} />{' '}
          {busy === 'resume'
            ? 'Destravando…'
            : job.status === 'running'
              ? 'Destravar e continuar'
              : 'Continuar atualização'}
        </button>
        {service && (
          <button className="adm-action" disabled={!!busy} onClick={restart}>
            <RotateCcw size={14} />{' '}
            {busy === 'restart' ? 'Reiniciando…' : `Reiniciar ${shortName(service)}`}
          </button>
        )}
      </div>
    </div>
  );
}

interface VersionsOverview {
  main: string | null;
  enabled: boolean;
  versions: {
    version: string;
    tenants: number;
    scheduled: number;
    main: boolean;
    running: boolean;
  }[];
}

/** Restaurantes em cada versão (versão por cliente). Cada um é atualizado na tela dele. */
function TenantVersions() {
  const { data } = useLoad<VersionsOverview>('/platform/server/versions');
  if (!data?.versions?.length) return null;
  return (
    <div className="adm-panel">
      <div className="adm-panel__head">Restaurantes por versão</div>
      <div className="adm-rows">
        {data.versions.map((v) => (
          <div key={v.version} className="adm-row">
            <Dot level={v.main ? 'ok' : v.running ? 'warn' : 'bad'} />
            <span className="adm-row__main">
              <span className="adm-row__title">
                {v.version} {v.main && <Tag level="ok">mais nova</Tag>}
              </span>
              <span className="adm-row__meta">
                {v.main
                  ? 'no sistema principal, com o Super Admin'
                  : v.running
                    ? 'versão anterior no ar; atualize cada restaurante em Clientes'
                    : 'versão anterior sem a cópia no ar: esses restaurantes estão no principal'}
                {v.scheduled ? ` · ${v.scheduled} agendado(s)` : ''}
              </span>
            </span>
            <span className="adm-row__side">
              {v.tenants} restaurante{v.tenants === 1 ? '' : 's'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Versão instalada x última publicada, com o botão que atualiza todos os serviços do Comandou. */
export function UpdatePanel({
  services,
  onChanged,
}: {
  services: ServerService[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const { data, reload } = useLoad<UpdateInfo>('/platform/server/update');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = data?.job?.status === 'running';
  // Enquanto atualiza, consulta a cada 3 s (o agente reinicia por último: falhas são normais).
  useInterval(
    () => {
      reload();
      onChanged();
    },
    running ? 3000 : null,
  );

  const ours = services.filter(isOurs);
  const tags = [...new Set(ours.map((s) => TAG_OF(s.image)))];
  const installed = tags.length === 1 ? tags[0]! : tags.length ? 'misturado' : '—';
  const latest = data?.latest?.version ?? null;
  const outdated = latest ? ours.filter((s) => TAG_OF(s.image) !== latest) : [];
  const upToDate = !!latest && ours.length > 0 && outdated.length === 0;
  // Terminou de atualizar com esta tela aberta: limpa o cache do navegador e abre a versão nova.
  // O agente reinicia por último e esquece a tarefa, então "sumiu e está tudo na última" também vale.
  const status = data?.job?.status;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (status === 'running') wasRunning.current = true;
    else if (wasRunning.current && (status === 'done' || (!status && upToDate))) {
      wasRunning.current = false;
      toast('Sistema atualizado. Limpando o cache e abrindo a versão nova…', 'success');
      setTimeout(() => void freshReload(), 1500);
    }
  }, [status, upToDate, toast]);

  // O clique fecha a janela na hora e a barra começa já, antes de o servidor responder.
  async function start() {
    if (!latest || busy) return;
    setOpen(false);
    setBusy(true);
    wasRunning.current = true;
    try {
      await api('/platform/server/update', { method: 'POST', json: { version: latest } });
      reload();
    } catch (e) {
      wasRunning.current = false;
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  if (ours.length === 0 && !data?.job) return null;
  const job = data?.job;
  const current = runningStep(job, data?.now);
  const failedStep = job?.status === 'failed' ? job.steps.find((s) => s.status === 'failed') : null;
  // Parou antes do fim e ainda falta serviço na versão dela: oferece continuar.
  const canContinue = job?.status === 'failed' && ours.some((s) => TAG_OF(s.image) !== job.version);
  const progress = updateProgress(job, busy);
  return (
    <Section
      title="Versão"
      sub={latest ? `última publicada: ${latest}` : undefined}
      actions={
        <button
          className="adm-action adm-action--primary"
          disabled={!latest || upToDate || running || busy}
          onClick={() => setOpen(true)}
        >
          <ArrowUpCircle size={14} /> {running || busy ? 'Atualizando…' : 'Atualizar sistema'}
        </button>
      }
    >
      {data?.error && <Alert tone="warning">{data.error}</Alert>}
      <div className="adm-grid">
        <Tile label="Instalada" value={installed} sub={`${ours.length} serviços do Comandou`} />
        <Tile
          label="Última publicada"
          value={latest ?? '—'}
          level={latest && !upToDate ? 'warn' : undefined}
          sub={
            upToDate ? (
              <Tag level="ok">atualizado</Tag>
            ) : latest && ours.length ? (
              `${outdated.length} serviço(s) para atualizar`
            ) : undefined
          }
        />
      </div>
      <TenantVersions />
      {progress && (
        <div className="adm-panel adm-update-progress" role="status" aria-live="polite">
          <div className="adm-update-progress__head">
            <strong>{progress.title}</strong>
            <span className="adm-sub">{progress.note}</span>
          </div>
          <ProgressBar value={progress.value} label="Andamento da atualização" />
        </div>
      )}
      {job && (
        <div className="adm-panel">
          <div className="adm-panel__head">
            Atualização para {job.version} ·{' '}
            {job.status === 'running'
              ? 'em andamento'
              : job.status === 'done'
                ? 'concluída'
                : 'interrompida'}
          </div>
          {job.message && job.status === 'failed' && (
            <div className="adm-panel__body">
              <Alert tone="danger">{job.message}</Alert>
            </div>
          )}
          {data?.agentDown && running && (
            <div className="adm-panel__body">
              <Alert tone="warning">
                O agente do servidor não respondeu agora. Se não voltar em 1 minuto, reinicie o
                serviço do agente em Serviços, logo abaixo.
              </Alert>
            </div>
          )}
          {(current?.stalled || canContinue) && (
            <Unstick
              job={job}
              service={current?.step.service ?? failedStep?.service ?? null}
              stalledFor={current?.stalled ? current.ms : null}
              onDone={() => {
                reload();
                onChanged();
              }}
            />
          )}
          <Steps steps={job.steps} current={current} />
          {job.cleanup && (
            <div className="adm-panel__body">
              Limpeza ao fim:{' '}
              {job.cleanup
                .map(
                  (c) => `${CLEAN_LABEL[c.target] ?? c.target} ${c.error ? 'falhou' : c.removed}`,
                )
                .join(' · ')}
            </div>
          )}
        </div>
      )}

      <Modal
        open={open}
        title={`Atualizar para ${latest ?? ''}`}
        onClose={() => setOpen(false)}
        size="lg"
        footer={
          <button className="adm-action adm-action--primary" disabled={busy} onClick={start}>
            Atualizar para {latest}
          </button>
        }
      >
        <p style={{ marginTop: 0 }}>
          Troca a versão destes serviços, nesta ordem: migração do banco primeiro, depois a API, o
          site, o WhatsApp e, por último, o próprio agente (a tela pode piscar).
        </p>
        <div className="adm-panel">
          <div className="adm-rows">
            {outdated.map((s) => (
              <div key={s.id} className="adm-row">
                <span className="adm-row__main">
                  <span className="adm-row__title">{s.name}</span>
                  <span className="adm-row__meta">
                    {TAG_OF(s.image)} → {latest}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <ul style={{ margin: '12px 0 0', paddingLeft: 18, display: 'grid', gap: 6 }}>
          <li>
            Ao terminar, limpa sozinho contêineres parados, imagens e volumes anônimos sem uso.
            Volumes com nome (banco, uploads, backups) nunca são apagados.
          </li>
          <li>
            Os caches somem junto: a API reinicia sem nada guardado em memória, e cada navegador
            (painel, garçom, cozinha, cardápio) se atualiza sozinho: apaga o cache do app e carrega
            a versão nova direto do servidor, sem aviso nem botão.
          </li>
          <li>
            Os restaurantes com banco próprio <strong>continuam na versão em que estão</strong>: a
            versão atual fica no ar ao lado da nova, e cada restaurante muda quando você clicar em
            &quot;Atualizar agora&quot; ou na hora agendada, na tela dele em Clientes. Quem ainda
            está no banco central acompanha o sistema.
          </li>
          <li>
            Se a migração falhar, nada mais é tocado. Se um serviço não subir, o Swarm volta sozinho
            para a versão anterior e a atualização para ali.
          </li>
          <li>Dados e volumes não são apagados. Faça um backup antes de versões grandes.</li>
          <li>
            Se você reaplicar a stack no Portainer depois, ela volta para a versão escrita nela.
          </li>
        </ul>
      </Modal>
    </Section>
  );
}
