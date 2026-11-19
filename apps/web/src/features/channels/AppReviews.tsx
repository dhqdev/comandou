import { channelInfo } from '@comandou/shared';
import { MessageSquareQuote, RefreshCw, Star } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { Button, Card, Segmented, useToast } from '../../design-system';
import { api } from '../../lib/api';
import { useRealtime } from '../../lib/realtime';
import './app-reviews.css';

export interface AppReview {
  id: string;
  channel: string;
  storeName: string | null;
  orderId: string | null;
  displayCode: string | null;
  score: number;
  comment: string | null;
  customerName: string | null;
  canReply: boolean;
  reviewedAt: string;
  reply: string | null;
  repliedAt: string | null;
  replyFrom: 'comandou' | 'portal' | null;
  repliedByName: string | null;
}
interface StoreScore {
  id: string;
  channel: string;
  name: string;
  score: number | null;
  count: number | null;
  score30: number | null;
  pending: number;
  readAt: string | null;
  error: string | null;
}

const MIN = 10;
const MAX = 300;
const nf = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const when = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
/** Nota boa, média ou ruim (a cor da estrela). */
const tone = (s: number) => (s >= 4 ? 'good' : s >= 3 ? 'warn' : 'bad');

/** Nota com uma estrela e o número: "★ 4,5". */
export function ScorePill({ score }: { score: number }) {
  return (
    <span className="arv-score" data-tone={tone(score)} title={`Nota ${nf(score)} de 5`}>
      <Star size={13} aria-hidden fill="currentColor" />
      {nf(score)}
    </span>
  );
}

/** Uma avaliação: nota, quem, quando, pedido, comentário e a resposta (ou o campo de responder). */
function ReviewItem({
  r,
  canReply,
  onReplied,
}: {
  r: AppReview;
  canReply: boolean;
  onReplied(): void;
}) {
  const toast = useToast();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const label = channelInfo(r.channel).label;
  const len = text.trim().length;

  async function send() {
    setBusy(true);
    try {
      await api(`/channels/reviews/${r.id}/reply`, { method: 'POST', json: { text: text.trim() } });
      toast(`Resposta publicada no ${label}`, 'success');
      setOpen(false);
      setText('');
      onReplied();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="arv-item">
      <div className="arv-item__head">
        <ScorePill score={r.score} />
        <strong>{r.customerName ?? 'Cliente'}</strong>
        <span className="cm-hint">
          {when(r.reviewedAt)}
          {r.displayCode && ` · pedido ${label} ${r.displayCode}`}
        </span>
      </div>
      {r.comment ? (
        <p className="arv-item__comment">{r.comment}</p>
      ) : (
        <p className="cm-hint">Sem comentário, só a nota.</p>
      )}
      {r.reply ? (
        <div className="arv-reply">
          <MessageSquareQuote size={14} aria-hidden />
          <div>
            <span className="cm-hint">
              {r.replyFrom === 'comandou'
                ? `Respondida por ${r.repliedByName ?? 'alguém da equipe'}`
                : `Respondida no portal do ${label}`}
              {r.repliedAt && ` · ${when(r.repliedAt)}`}
            </span>
            <p>{r.reply}</p>
          </div>
        </div>
      ) : r.canReply && canReply ? (
        open ? (
          <div className="arv-form">
            <label className="cm-label" htmlFor={id}>
              Sua resposta
            </label>
            <textarea
              id={id}
              className="cm-input"
              rows={3}
              maxLength={MAX}
              value={text}
              placeholder="Agradeça, peça desculpas se for o caso e diga o que vai fazer."
              onChange={(e) => setText(e.target.value)}
            />
            <span className="arv-form__count" data-short={len > 0 && len < MIN}>
              {len < MIN ? `Mínimo ${MIN} letras` : `${len} de ${MAX}`}
            </span>
            <p className="cm-hint">
              A resposta aparece no {label} junto com a avaliação, para todo mundo ver, e não dá
              para mudar depois.
            </p>
            <div className="arv-form__actions">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button size="sm" loading={busy} disabled={len < MIN} onClick={() => void send()}>
                Publicar resposta
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              Responder
            </Button>
          </div>
        )
      ) : null}
    </li>
  );
}

/**
 * Avaliações dos clientes nos aplicativos (tela Aplicativos de delivery): a nota de cada loja, as
 * avaliações sem resposta primeiro e a resposta, sempre escrita por uma pessoa.
 */
export function AppReviewsCard({ canReply }: { canReply: boolean }) {
  const toast = useToast();
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [d, setD] = useState<{ reviews: AppReview[]; stores: StoreScore[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setD(await api(`/channels/reviews${filter === 'pending' ? '?pending=1' : ''}`));
    } catch {
      /* sem permissão ou sem loja: o cartão some */
    }
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'channels.reviews') void load();
  }, load);

  async function refresh() {
    setBusy(true);
    try {
      const r = await api<{ read: number }>('/channels/reviews/refresh', {
        method: 'POST',
        json: {},
      });
      if (!r.read) toast('Já foi lido há pouco. Tente de novo em alguns minutos.');
      await load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  if (!d || d.stores.length === 0) return null;
  const pending = d.stores.reduce((a, s) => a + s.pending, 0);
  return (
    <Card
      title="Avaliações dos clientes"
      searchId="secao-avaliacoes"
      actions={
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          icon={<RefreshCw size={14} />}
          onClick={() => void refresh()}
        >
          Atualizar
        </Button>
      }
    >
      <ul className="arv-stores">
        {d.stores.map((s) => (
          <li key={s.id}>
            {s.score !== null ? <ScorePill score={s.score} /> : <span className="cm-hint">—</span>}
            <span>
              <strong>{channelInfo(s.channel).label}</strong> · {s.name}
              <span className="cm-hint">
                {s.count !== null && ` · ${s.count} avaliações`}
                {s.score30 !== null && ` · últimos 30 dias ${nf(s.score30)}`}
                {s.error
                  ? ` · ${s.error}`
                  : s.readAt
                    ? ` · lido às ${when(s.readAt)}`
                    : ' · ainda não lido'}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <Segmented
        label="Quais avaliações"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'pending', label: pending ? `Sem resposta (${pending})` : 'Sem resposta' },
          { value: 'all', label: 'Todas' },
        ]}
      />
      {d.reviews.length === 0 ? (
        <p className="cm-hint arv-empty">
          {filter === 'pending'
            ? 'Nenhuma avaliação esperando resposta.'
            : 'Nenhuma avaliação nos últimos dias.'}
        </p>
      ) : (
        <ul className="arv-list">
          {d.reviews.map((r) => (
            <ReviewItem key={r.id} r={r} canReply={canReply} onReplied={() => void load()} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Na gaveta do pedido: a avaliação que o cliente deixou no aplicativo. */
export function OrderReviewNote({ orderId }: { orderId: string }) {
  const [list, setList] = useState<AppReview[] | null>(null);
  useEffect(() => {
    let alive = true;
    api<AppReview[]>(`/channels/orders/${orderId}/reviews`)
      .then((r) => alive && setList(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [orderId]);
  const r = list?.[0];
  if (!r) return null;
  const label = channelInfo(r.channel).label;
  return (
    <div className="od-note" data-hue={tone(r.score) === 'bad' ? 'rose' : 'amber'}>
      <Star size={15} aria-hidden />
      <div>
        <span>
          Avaliação no {label}: nota {nf(r.score)}
          {r.reply ? ' · respondida' : r.canReply ? ' · sem resposta' : ''}
        </span>
        <strong>{r.comment ?? 'Sem comentário, só a nota.'}</strong>
      </div>
    </div>
  );
}
