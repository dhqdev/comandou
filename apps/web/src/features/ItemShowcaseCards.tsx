import { Eye, EyeOff, Heart, Images, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, useToast } from '../design-system';
import { api } from '../lib/api';
import { ImagePicker } from './ImagePicker';
import './item-showcase.css';

const MAX_PHOTOS = 8;

/**
 * Mais fotos do item no cardápio online: o cliente arrasta para o lado na tela do produto. A foto
 * principal continua no topo do cadastro; aqui ficam as extras. Grava na hora.
 */
export function ItemPhotosCard({ productId, canWrite }: { productId: string; canWrite: boolean }) {
  const toast = useToast();
  const [ids, setIds] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ imageIds: string[] }>(`/products/${productId}/photos`).then(
      (r) => alive && setIds(r.imageIds),
      () => alive && setIds([]),
    );
    return () => {
      alive = false;
    };
  }, [productId]);

  async function save(next: string[]) {
    const prev = ids;
    setIds(next);
    try {
      await api(`/products/${productId}/photos`, { method: 'PUT', json: { imageIds: next } });
    } catch (e) {
      setIds(prev);
      toast((e as Error).message, 'danger');
    }
  }

  return (
    <Card
      title={
        <span className="ishow__title">
          <Images size={17} aria-hidden /> Mais fotos
        </span>
      }
    >
      <p className="cm-hint ishow__lead">
        Aparecem depois da foto principal no cardápio online; o cliente passa de uma para outra
        arrastando para o lado. Até {MAX_PHOTOS} fotos.
      </p>
      <div className="ishow__photos">
        {(ids ?? []).map((id, i) => (
          <ImagePicker
            key={id}
            label={`Foto ${i + 2}`}
            width={88}
            value={id}
            disabled={!canWrite}
            onChange={(img) =>
              save(img ? ids!.map((x, j) => (j === i ? img : x)) : ids!.filter((_, j) => j !== i))
            }
          />
        ))}
        {ids && canWrite && ids.length < MAX_PHOTOS && (
          <ImagePicker
            key={`novo-${ids.length}`}
            label="Mais uma foto"
            width={88}
            value={null}
            onChange={(img) => (img ? save([...ids, img]) : undefined)}
          />
        )}
      </div>
    </Card>
  );
}

interface StaffReview {
  id: string;
  name: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  hidden: boolean;
  likes: number;
}

/** Avaliações que os clientes deixaram no item; a equipe esconde as que não devem aparecer. */
export function ItemReviewsCard({ productId, canWrite }: { productId: string; canWrite: boolean }) {
  const toast = useToast();
  const [list, setList] = useState<StaffReview[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<StaffReview[]>(`/products/${productId}/reviews`).then(
      (r) => alive && setList(r),
      () => alive && setList([]),
    );
    return () => {
      alive = false;
    };
  }, [productId]);

  async function toggle(r: StaffReview) {
    setBusy(r.id);
    try {
      await api(`/product-reviews/${r.id}`, { method: 'PATCH', json: { hidden: !r.hidden } });
      setList((l) => l && l.map((x) => (x.id === r.id ? { ...x, hidden: !r.hidden } : x)));
      toast(r.hidden ? 'Avaliação aparece no cardápio' : 'Avaliação escondida', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  const shown = list?.filter((r) => !r.hidden) ?? [];
  const avg = shown.length ? shown.reduce((a, r) => a + r.rating, 0) / shown.length : null;

  return (
    <Card
      title={
        <span className="ishow__title">
          <Star size={17} aria-hidden /> Avaliações dos clientes
          {avg !== null && (
            <span className="ishow__avg">
              {avg.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}{' '}
              · {shown.length}
            </span>
          )}
        </span>
      }
    >
      {list === null ? null : list.length === 0 ? (
        <p className="cm-hint ishow__lead">
          Ainda sem avaliações. Os clientes com conta no cardápio online avaliam o item na tela
          dele.
        </p>
      ) : (
        <ul className="ishow__reviews">
          {list.map((r) => (
            <li key={r.id} data-hidden={r.hidden || undefined}>
              <div className="ishow__rv">
                <div className="ishow__rv-head">
                  <strong>{r.name}</strong>
                  <span className="ishow__stars" aria-label={`Nota ${r.rating} de 5`}>
                    {'★'.repeat(r.rating)}
                    <span aria-hidden>{'★'.repeat(5 - r.rating)}</span>
                  </span>
                  {r.likes > 0 && (
                    <span className="ishow__likes">
                      <Heart size={12} aria-hidden /> {r.likes}
                    </span>
                  )}
                  {r.hidden && <span className="ishow__hidden">Escondida</span>}
                </div>
                {r.comment && <p>{r.comment}</p>}
                <small>{new Date(r.createdAt).toLocaleDateString('pt-BR')}</small>
              </div>
              {canWrite && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={r.hidden ? <Eye size={15} /> : <EyeOff size={15} />}
                  loading={busy === r.id}
                  disabled={busy !== null}
                  onClick={() => toggle(r)}
                >
                  {r.hidden ? 'Mostrar' : 'Esconder'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
