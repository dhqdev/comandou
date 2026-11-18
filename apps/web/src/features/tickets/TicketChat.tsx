import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Flag,
  Headset,
  MessageCircle,
  Sparkles,
} from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { FileGrid } from './TicketParts';
import { type TicketEvent, type TicketFile } from './ticket-api';
import './ticket-chat.css';

/** Horário curto (10:01). */
export const hour = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const dayKey = (iso: string) => new Date(iso).toDateString();

/** "Hoje", "Ontem" ou "30 de setembro" (com o ano quando não é o deste ano). */
export function dayLabel(iso: string, now = new Date()) {
  const d = new Date(iso);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Hoje';
  if (d.toDateString() === y.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias" ou a data. */
export function ago(iso: string, now = Date.now()) {
  const min = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ontem';
  if (d < 7) return `há ${d} dias`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';

interface Line {
  id: string;
  at: string;
  mine: boolean;
  name: string;
  body: string;
  files: TicketFile[];
  system?: TicketEvent['kind'];
}

function sysIcon(kind: TicketEvent['kind'] | undefined, body: string): ReactNode {
  if (/conclu|resolvid|pronto/i.test(body)) return <CheckCircle2 size={14} />;
  if (kind === 'stage') return <ArrowRight size={14} />;
  if (kind === 'decision') return <Flag size={14} />;
  if (kind === 'activity') return <Sparkles size={14} />;
  return <CircleDot size={14} />;
}

/**
 * Conversa do chamado no jeito de um chat: o que o restaurante escreve fica à direita, a equipe do
 * Comandou à esquerda com o rosto do suporte, mensagens seguidas da mesma pessoa se juntam, um
 * separador por dia e os avisos do andamento no meio.
 */
export function TicketChat({
  description,
  openingFiles,
  openedBy,
  createdAt,
  events,
  files,
  footer,
}: {
  description: string;
  openingFiles: TicketFile[];
  openedBy: string;
  createdAt: string;
  events: TicketEvent[];
  files: TicketFile[];
  footer?: ReactNode;
}) {
  const lines: Line[] = [];
  if (description || openingFiles.length)
    lines.push({
      id: 'opening',
      at: createdAt,
      mine: true,
      name: openedBy,
      body: description,
      files: openingFiles,
    });
  let skippedEcho = false;
  for (const e of events) {
    if (e.kind === 'note') continue;
    // A primeira mensagem que só repete a descrição não aparece duas vezes.
    if (
      !skippedEcho &&
      e.kind === 'message' &&
      e.actor === 'client' &&
      description &&
      e.body.trim() === description.trim()
    ) {
      skippedEcho = true;
      continue;
    }
    const own = files.filter((f) => f.eventId === e.id);
    if (e.kind === 'message')
      lines.push({
        id: String(e.id),
        at: e.createdAt,
        mine: e.actor === 'client',
        name: e.actorName || (e.actor === 'client' ? 'Você' : 'Suporte Comandou'),
        body: e.body,
        files: own,
      });
    else
      lines.push({
        id: String(e.id),
        at: e.createdAt,
        mine: false,
        name: '',
        body: e.body,
        files: own,
        system: e.kind,
      });
  }
  lines.sort((a, z) => a.at.localeCompare(z.at));

  return (
    <ol className="tkc" aria-label="Conversa">
      {lines.length === 0 && (
        <li className="tkc__empty">
          <MessageCircle size={28} />
          <b>Nenhuma mensagem ainda</b>
          <span>Escreva abaixo. A equipe do Comandou responde por aqui mesmo.</span>
        </li>
      )}
      {lines.map((l, i) => {
        const prev = lines[i - 1];
        const next = lines[i + 1];
        const newDay = !prev || dayKey(prev.at) !== dayKey(l.at);
        const sameAs = (o?: Line) =>
          !!o &&
          !o.system &&
          !l.system &&
          o.mine === l.mine &&
          o.name === l.name &&
          dayKey(o.at) === dayKey(l.at) &&
          Math.abs(new Date(o.at).getTime() - new Date(l.at).getTime()) < 10 * 60_000;
        const first = !sameAs(prev) || newDay;
        const last = !sameAs(next) || (!!next && dayKey(next.at) !== dayKey(l.at));
        return (
          <Fragment key={l.id}>
            {newDay && (
              <li className="tkc__day" aria-label={dayLabel(l.at)}>
                <span>{dayLabel(l.at)}</span>
              </li>
            )}
            {l.system ? (
              <li className="tkc__sys">
                {sysIcon(l.system, l.body)}
                <span>{l.body}</span>
                <time dateTime={l.at}>{hour(l.at)}</time>
              </li>
            ) : (
              <li
                className={`tkc__row ${l.mine ? 'tkc__row--mine' : 'tkc__row--them'}`}
                data-first={first}
                data-last={last}
              >
                {!l.mine && (
                  <span className="tkc__avatar" aria-hidden>
                    {last ? <Headset size={16} /> : null}
                  </span>
                )}
                <div className="tkc__stack">
                  {first && (
                    <span className="tkc__name">
                      {l.mine ? l.name || 'Você' : l.name}
                      {l.id === 'opening' ? ' · abriu o chamado' : ''}
                    </span>
                  )}
                  <div className="tkc__bubble">
                    {l.body && <p className="tkc__text">{l.body}</p>}
                    {l.files.length > 0 && <FileGrid files={l.files} />}
                    <time className="tkc__time" dateTime={l.at}>
                      {hour(l.at)}
                    </time>
                  </div>
                </div>
                {l.mine && (
                  <span className="tkc__avatar tkc__avatar--mine" aria-hidden>
                    {last ? initials(l.name) : null}
                  </span>
                )}
              </li>
            )}
          </Fragment>
        );
      })}
      {footer}
    </ol>
  );
}
