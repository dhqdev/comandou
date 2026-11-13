import type { CustomerAvatar as AvatarId } from '@comandou/shared';
import { BadgeCheck, Heart, Star } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useToast } from '../../design-system';
import { api, ApiError } from '../../lib/api';
import { AvatarArt } from './avatars';
import { useStore } from './context';

export interface ProductReview {
  id: string;
  name: string;
  avatar: AvatarId;
  rating: number;
  comment: string | null;
  createdAt: string;
  likes: number;
  liked: boolean;
  /** Quem avaliou já pediu este item na loja. */
  ordered: boolean;
  mine: boolean;
}
interface ReviewsState {
  average: number | null;
  count: number;
  /** Quantas de 1 a 5 estrelas (posição 0 = 1 estrela). */
  breakdown: number[];
  reviews: ProductReview[];
  mine: ProductReview | null;
  canReview: boolean;
}

const fmtNote = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "hoje", "ontem", "há 3 dias", "há 2 semanas" ou a data. */
export function when(iso: string, now = Date.now()) {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  if (days < 35) return `há ${plural(Math.floor(days / 7), 'semana', 'semanas')}`;
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Estrelas só para ver (nota em décimos vira estrela cheia ou vazia, arredondada). */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  const full = Math.round(value);
  return (
    <span className="stars" aria-label={`Nota ${fmtNote(value)} de 5`} role="img">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} aria-hidden data-on={i <= full || undefined} />
      ))}
    </span>
  );
}

/** Resumo curto ao lado do nome do item (toca e desce até as avaliações). */
export function RatingChip({ average, count }: { average: number; count: number }) {
  return (
    <a
      className="rchip"
      href="#avaliacoes"
      onClick={(e) => {
        e.preventDefault();
        document
          .getElementById('avaliacoes')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }}
    >
      <Star size={14} aria-hidden />
      <strong>{fmtNote(average)}</strong>
      <span>({plural(count, 'avaliação', 'avaliações')})</span>
    </a>
  );
}

/** Avaliações do item: média, barras por nota, avaliar e curtir (coração) as avaliações. */
export function ProductReviews({ productId }: { productId: string }) {
  const { account, menu } = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const me = account?.customer ?? null;
  const [data, setData] = useState<ReviewsState | null>(null);
  const [writing, setWriting] = useState(false);

  const load = useCallback(
    () =>
      api<ReviewsState>(`/store/products/${productId}/reviews`)
        .then(setData)
        .catch(() => setData((d) => d ?? null)),
    [productId],
  );
  // Recarrega ao entrar ou sair da conta (curtidas e "minha avaliação" mudam).
  useEffect(() => {
    void load();
  }, [load, me?.id]);

  const login = () => navigate('/pedir/conta');

  async function like(r: ProductReview) {
    if (!me) {
      toast('Entre na sua conta para curtir');
      return login();
    }
    const liked = !r.liked;
    const patch = (likes: number, on: boolean) =>
      setData(
        (d) =>
          d && {
            ...d,
            reviews: d.reviews.map((x) => (x.id === r.id ? { ...x, liked: on, likes } : x)),
          },
      );
    patch(r.likes + (liked ? 1 : -1), liked);
    try {
      const res = await api<{ liked: boolean; likes: number }>(
        `/store/products/${productId}/reviews/${r.id}/like`,
        { method: 'POST', json: { liked } },
      );
      patch(res.likes, res.liked);
    } catch (e) {
      patch(r.likes, r.liked);
      toast((e as Error).message, 'danger');
    }
  }

  if (!data) return <section id="avaliacoes" className="prv" aria-busy="true" />;
  const allowed = data.canReview && menu.appearance.accountsEnabled;
  const max = Math.max(1, ...data.breakdown);

  return (
    <section id="avaliacoes" className="prv" aria-labelledby="prv-title">
      <div className="prv__head">
        <h2 id="prv-title" className="pdp__section">
          Avaliações
        </h2>
        {allowed && !writing && (
          <button
            type="button"
            className="prv__write"
            onClick={() => (me ? setWriting(true) : login())}
          >
            {!me ? 'Entrar para avaliar' : data.mine ? 'Editar minha avaliação' : 'Avaliar'}
          </button>
        )}
      </div>

      {data.count > 0 && data.average !== null && (
        <div className="prv__summary">
          <div className="prv__avg">
            <strong>{fmtNote(data.average)}</strong>
            <Stars value={data.average} size={15} />
            <small>{plural(data.count, 'avaliação', 'avaliações')}</small>
          </div>
          <ol className="prv__bars" aria-label="Avaliações por nota">
            {[5, 4, 3, 2, 1].map((n) => (
              <li key={n}>
                <span>{n}</span>
                <span className="prv__bar" aria-hidden>
                  <i style={{ transform: `scaleX(${data.breakdown[n - 1]! / max})` }} />
                </span>
                <span className="cm-sr-only">
                  {plural(data.breakdown[n - 1]!, 'avaliação', 'avaliações')}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {writing && me && (
        <ReviewForm
          productId={productId}
          mine={data.mine}
          onCancel={() => setWriting(false)}
          onSaved={async (msg) => {
            setWriting(false);
            toast(msg, 'success');
            await load();
          }}
        />
      )}

      {data.count === 0 && !writing && (
        <p className="prv__empty">
          Ainda sem avaliações.{allowed ? ' Pediu este item? Conte o que achou.' : ''}
        </p>
      )}

      {data.reviews.length > 0 && (
        <ul className="prv__list">
          {data.reviews.map((r) => (
            <li key={r.id} className="prv__item">
              <span className="prv__avatar" aria-hidden>
                <AvatarArt id={r.avatar} />
              </span>
              <div className="prv__body">
                <div className="prv__who">
                  <strong>{r.mine ? 'Você' : r.name}</strong>
                  {r.ordered && (
                    <span className="prv__badge">
                      <BadgeCheck size={13} aria-hidden /> Pediu este item
                    </span>
                  )}
                </div>
                <div className="prv__meta">
                  <Stars value={r.rating} size={12} />
                  <span>{when(r.createdAt)}</span>
                </div>
                {r.comment && <p className="prv__text">{r.comment}</p>}
              </div>
              <button
                type="button"
                className="prv__like"
                data-on={r.liked || undefined}
                aria-pressed={r.liked}
                aria-label={r.liked ? 'Descurtir avaliação' : 'Curtir avaliação'}
                onClick={() => void like(r)}
              >
                <Heart size={18} aria-hidden key={String(r.liked)} />
                {r.likes > 0 && <span>{r.likes}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const LABELS = ['', 'Não gostei', 'Poderia ser melhor', 'Bom', 'Muito bom', 'Amei!'];

function ReviewForm({
  productId,
  mine,
  onCancel,
  onSaved,
}: {
  productId: string;
  mine: ProductReview | null;
  onCancel(): void;
  onSaved(msg: string): void | Promise<void>;
}) {
  const toast = useToast();
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [comment, setComment] = useState(mine?.comment ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!rating) return;
    setBusy(true);
    try {
      await api(`/store/products/${productId}/reviews`, {
        method: 'PUT',
        json: { rating, comment: comment.trim() || null },
      });
      await onSaved(mine ? 'Avaliação atualizada' : 'Obrigado pela avaliação!');
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : 'Não deu para enviar. Tente de novo.',
        'danger',
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/store/products/${productId}/reviews`, { method: 'DELETE' });
      await onSaved('Avaliação apagada');
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="prv__form" onSubmit={submit}>
      <div className="prv__rate" role="radiogroup" aria-label="Sua nota">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} ${n === 1 ? 'estrela' : 'estrelas'}`}
            data-on={n <= rating || undefined}
            onClick={() => setRating(n)}
          >
            <Star size={30} aria-hidden />
          </button>
        ))}
      </div>
      <p className="prv__rate-label" aria-live="polite">
        {rating ? LABELS[rating] : 'Toque nas estrelas para dar sua nota'}
      </p>
      <textarea
        rows={3}
        maxLength={500}
        placeholder="Conte o que achou (opcional)"
        aria-label="Comentário"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="prv__actions">
        {mine && (
          <button
            type="button"
            className="prv__ghost prv__ghost--danger"
            disabled={busy}
            onClick={remove}
          >
            Apagar
          </button>
        )}
        <span className="prv__spacer" />
        <button type="button" className="prv__ghost" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="prv__send" disabled={busy || !rating}>
          {busy ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
    </form>
  );
}
