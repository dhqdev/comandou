import { ArrowUpCircle } from 'lucide-react';
import { useState } from 'react';
import { Alert, Modal, useToast } from '../design-system';
import { api } from '../lib/api';
import { useLoad } from './OverviewPages';
import type { ServerService, UpdateInfo, UpdateStep } from './types';
import { Dot, Level, Section, Tag, Tile, useInterval } from './ui';

const TAG_OF = (image: string) => image.slice(image.lastIndexOf(':') + 1);
/** Serviços do próprio Comandou: imagem comandou-* com tag de versão (v1.2.3) ou latest. */
const isOurs = (s: ServerService) => /\/comandou-[\w-]+:(v\d+\.\d+\.\d+|latest)$/.test(s.image);

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

function Steps({ steps }: { steps: UpdateStep[] }) {
  return (
    <div className="adm-rows">
      {steps.map((s) => (
        <div key={s.service} className="adm-row">
          <Dot level={STEP_LEVEL[s.status]} />
          <span className="adm-row__main">
            <span className="adm-row__title">{s.service}</span>
            <span className="adm-row__meta">
              {s.from} → {s.to}
              {s.message ? ` · ${s.message}` : ''}
            </span>
          </span>
          <span className="adm-row__side">{STEP_LABEL[s.status]}</span>
        </div>
      ))}
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

  async function start() {
    if (!latest) return;
    setBusy(true);
    try {
      await api('/platform/server/update', { method: 'POST', json: { version: latest } });
      toast('Atualização iniciada', 'success');
      setOpen(false);
      reload();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  if (ours.length === 0 && !data?.job) return null;
  const job = data?.job;
  return (
    <Section
      title="Versão"
      sub={latest ? `última publicada: ${latest}` : undefined}
      actions={
        <button
          className="adm-action adm-action--primary"
          disabled={!latest || upToDate || running}
          onClick={() => setOpen(true)}
        >
          <ArrowUpCircle size={14} /> {running ? 'Atualizando…' : 'Atualizar sistema'}
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
          <Steps steps={job.steps} />
        </div>
      )}

      <Modal
        open={open}
        title={`Atualizar para ${latest ?? ''}`}
        onClose={() => setOpen(false)}
        size="lg"
        footer={
          <button className="adm-action adm-action--primary" disabled={busy} onClick={start}>
            {busy ? 'Iniciando…' : `Atualizar para ${latest}`}
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
            Os restaurantes podem ficar alguns segundos instáveis, sobretudo se a API tiver uma
            réplica só.
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
