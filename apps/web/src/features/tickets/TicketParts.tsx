import { stageInfo } from '@comandou/shared';
import { Check, Paperclip, X } from 'lucide-react';
import { CSSProperties, useEffect, useRef, useState } from 'react';
import { useToast } from '../../design-system';
import { prepareFile, type Prepared } from '../store-chat/chat-media';
import { type TicketEvent, type TicketFile, when } from './ticket-api';
import './tickets.css';

/** Rosto do agente da etapa: inicial do nome num círculo na cor da etapa. */
export function AgentAvatar({
  stage,
  size = 26,
  done,
}: {
  stage: string;
  size?: number;
  done?: boolean;
}) {
  const s = stageInfo(stage);
  return (
    <span
      className="tk-avatar"
      style={
        { '--tk-c': s.color, width: size, height: size, fontSize: size * 0.42 } as CSSProperties
      }
      title={`${s.agent} · ${s.role}`}
      aria-hidden
    >
      {s.agent.slice(0, 1)}
      {done && (
        <i className="tk-avatar__ok">
          <Check size={Math.max(9, size * 0.32)} strokeWidth={3} />
        </i>
      )}
    </span>
  );
}

/** Fotos e vídeos escolhidos antes de enviar (com prévia e botão de tirar). */
export function AttachPicker({
  files,
  onChange,
  max = 8,
  label = 'Anexar foto ou vídeo',
}: {
  files: Prepared[];
  onChange: (f: Prepared[]) => void;
  max?: number;
  label?: string;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.previewUrl)), []);
  async function pick(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= max) {
        toast(`Até ${max} arquivos por vez`, 'danger');
        break;
      }
      try {
        next.push(await prepareFile(f));
      } catch (e) {
        toast((e as Error).message, 'danger');
      }
    }
    onChange(next);
    setBusy(false);
    if (input.current) input.current.value = '';
  }
  return (
    <div className="tk-attach">
      {files.length > 0 && (
        <ul className="tk-attach__list">
          {files.map((f, i) => (
            <li key={f.previewUrl}>
              {f.kind === 'video' ? (
                <video src={f.previewUrl} muted playsInline />
              ) : (
                <img src={f.previewUrl} alt="" />
              )}
              <button
                type="button"
                aria-label="Tirar"
                onClick={() => {
                  URL.revokeObjectURL(f.previewUrl);
                  onChange(files.filter((_, j) => j !== i));
                }}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="tk-attach__btn"
        onClick={() => input.current?.click()}
        disabled={busy}
      >
        <Paperclip size={15} /> {busy ? 'Preparando…' : label}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*,video/mp4,video/webm,video/quicktime,.mov"
        multiple
        hidden
        onChange={(e) => void pick(e.target.files)}
      />
      <span className="tk-attach__hint">Fotos e vídeos de até 20 MB (uns 30 segundos).</span>
    </div>
  );
}

/** Grade de anexos do chamado; foto abre em tamanho grande, vídeo toca ali mesmo. */
export function FileGrid({ files }: { files: TicketFile[] }) {
  const [big, setBig] = useState<TicketFile | null>(null);
  if (!files.length) return null;
  return (
    <>
      <ul className="tk-files">
        {files.map((f) => (
          <li key={f.id}>
            {f.kind === 'video' ? (
              <video src={f.url} controls playsInline preload="metadata" />
            ) : (
              <button
                type="button"
                onClick={() => setBig(f)}
                aria-label={`Abrir ${f.name || 'foto'}`}
              >
                <img src={f.url} alt={f.name} loading="lazy" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {big && (
        <div className="tk-lightbox" role="dialog" aria-label="Foto" onClick={() => setBig(null)}>
          <img src={big.url} alt={big.name} />
          <button type="button" aria-label="Fechar">
            <X size={20} />
          </button>
        </div>
      )}
    </>
  );
}

export function EventLine({
  e,
  files,
  mine,
}: {
  e: TicketEvent;
  files: TicketFile[];
  mine: boolean;
}) {
  if (e.kind === 'message' || e.kind === 'note')
    return (
      <li
        className={`tk-msg${mine ? ' tk-msg--mine' : ''}${e.kind === 'note' ? ' tk-msg--note' : ''}`}
      >
        <span className="tk-msg__meta">
          {e.kind === 'note' ? 'Nota interna · ' : ''}
          {e.actorName || (e.actor === 'client' ? 'Cliente' : 'Equipe Comandou')} ·{' '}
          {when(e.createdAt)}
        </span>
        {e.body && <div className="tk-msg__body">{e.body}</div>}
        <FileGrid files={files} />
      </li>
    );
  return (
    <li className="tk-sys">
      {e.body} · {when(e.createdAt)}
    </li>
  );
}
