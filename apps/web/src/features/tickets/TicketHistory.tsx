import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Flag,
  Headset,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
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

interface Entry {
  id: string;
  at: string;
  kind: 'open' | 'team' | 'client' | TicketEvent['kind'];
  name: string;
  body: string;
  files: TicketFile[];
}

function entryIcon(e: Entry): ReactNode {
  if (e.kind === 'open') return <CircleDot size={14} />;
  if (e.kind === 'team') return <Headset size={14} />;
  if (e.kind === 'client') return <UserRound size={14} />;
  if (/conclu|resolvid|pronto/i.test(e.body)) return <CheckCircle2 size={14} />;
  if (e.kind === 'stage') return <ArrowRight size={14} />;
  if (e.kind === 'decision') return <Flag size={14} />;
  if (e.kind === 'activity') return <Sparkles size={14} />;
  return <CircleDot size={14} />;
}

/** Quando foi, curto: "Hoje, 10:24", "Ontem, 18:02" ou "30 de setembro, 09:10". */
export const stamp = (iso: string) => `${dayLabel(iso)}, ${hour(iso)}`;

/**
 * Histórico do chamado (tela do restaurante), do mais novo para o mais antigo: os avisos do
 * andamento e as respostas antigas da equipe (de antes da conversa ir para o chat). Não é chat:
 * para conversar, o cliente usa o botão Falar no chat.
 */
export function TicketHistory({
  description,
  openedBy,
  createdAt,
  events,
  files,
  limit = 5,
}: {
  description: string;
  openedBy: string;
  createdAt: string;
  events: TicketEvent[];
  files: TicketFile[];
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  const list: Entry[] = [
    {
      id: 'open',
      at: createdAt,
      kind: 'open',
      name: '',
      body: openedBy ? `${openedBy} abriu o chamado` : 'Chamado aberto',
      files: [],
    },
  ];
  let skippedEcho = false;
  for (const e of events) {
    if (e.kind === 'note') continue;
    // A primeira mensagem que só repete a descrição já aparece em "O que você contou".
    if (
      !skippedEcho &&
      e.kind === 'message' &&
      e.actor === 'client' &&
      e.body.trim() === description.trim()
    ) {
      skippedEcho = true;
      continue;
    }
    const msg = e.kind === 'message';
    list.push({
      id: String(e.id),
      at: e.createdAt,
      kind: msg ? (e.actor === 'client' ? 'client' : 'team') : e.kind,
      name: msg ? e.actorName || (e.actor === 'client' ? 'Você' : 'Suporte Comandou') : '',
      body: e.body,
      files: files.filter((f) => f.eventId === e.id),
    });
  }
  list.sort((a, z) => z.at.localeCompare(a.at));
  const shown = all ? list : list.slice(0, limit);

  return (
    <>
      <ol className="tkh" aria-label="Histórico">
        {shown.map((e, i) => (
          <li key={e.id} className="tkh__item" data-kind={e.kind} data-first={i === 0}>
            <span className="tkh__dot" aria-hidden>
              {entryIcon(e)}
            </span>
            <div className="tkh__main">
              {e.name ? (
                <>
                  <span className="tkh__who">
                    {e.name}
                    {e.kind === 'team' ? ' respondeu' : ' escreveu'}
                  </span>
                  {e.body && <p className="tkh__quote">{e.body}</p>}
                </>
              ) : (
                <span className="tkh__text">{e.body}</span>
              )}
              {e.files.length > 0 && <FileGrid files={e.files} />}
              <time className="tkh__time" dateTime={e.at}>
                {stamp(e.at)}
              </time>
            </div>
          </li>
        ))}
      </ol>
      {list.length > limit && (
        <button type="button" className="tkh__more" onClick={() => setAll((v) => !v)}>
          {all ? 'Mostrar menos' : `Ver o histórico todo (${list.length})`}
        </button>
      )}
    </>
  );
}
