import { Camera, Trash2 } from 'lucide-react';
import { ChangeEvent, useRef, useState } from 'react';
import { useAuth } from '../app/auth';
import { Alert, Button } from '../design-system';
import { api } from '../lib/api';
import { squarePhoto } from '../lib/square-photo';
import './my-photo.css';

/**
 * Foto do perfil de quem está usando o sistema (Conta › Meus dados, `member_photos`). A URL leva
 * a versão (`?v=`), então o navegador guarda a foto e troca sozinho quando ela muda.
 */
export const myPhotoUrl = (photoAt?: string | null) =>
  photoAt ? `/api/v1/account/photo?v=${encodeURIComponent(photoAt)}` : null;

/** Iniciais do nome (duas primeiras palavras), no lugar da foto. */
export const nameInitials = (name?: string | null) =>
  (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

/** Foto (ou iniciais) num círculo. Foto que não carrega (sem internet) volta para as iniciais. */
export function PersonPhoto({
  name,
  src,
  size,
  className,
}: {
  name?: string | null;
  src?: string | null;
  /** Lado em px; sem ele, quem usa dá o tamanho pelo CSS. */
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const show = !!src && broken !== src;
  return (
    <span
      className={`cm-person ${className ?? ''}`}
      style={size ? { width: size, height: size, fontSize: Math.round(size * 0.36) } : undefined}
      data-photo={show || undefined}
      aria-hidden
    >
      {show ? (
        <img src={src} alt="" draggable={false} onError={() => setBroken(src)} />
      ) : (
        nameInitials(name)
      )}
    </span>
  );
}

/** A foto de quem entrou (ou as iniciais do nome). */
export function MyPhoto({ size, className }: { size?: number; className?: string }) {
  const { me } = useAuth();
  return (
    <PersonPhoto
      name={me?.user.name}
      src={myPhotoUrl(me?.user.photoAt)}
      size={size}
      className={className}
    />
  );
}

/**
 * Pôr, trocar ou tirar a foto do perfil (dentro de Meus dados). Salva na hora, sem esperar o
 * Salvar da janela; o resultado aparece na própria foto (sem aviso flutuante com a janela aberta).
 */
export function MyPhotoField() {
  const { me, refresh } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'put' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const has = !!me?.user.photoAt;

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('put');
    setError(null);
    try {
      const blob = await squarePhoto(file);
      await api('/account/photo', {
        method: 'PUT',
        headers: { 'Content-Type': blob.type },
        body: blob,
      });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    setError(null);
    try {
      await api('/account/photo', { method: 'DELETE' });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="my-photo cm-form__block">
      <button
        type="button"
        className="my-photo__pic"
        onClick={() => input.current?.click()}
        disabled={!!busy}
        aria-label={has ? 'Trocar a foto' : 'Pôr uma foto'}
      >
        <MyPhoto size={72} />
        <span className="my-photo__cam" aria-hidden>
          <Camera size={14} />
        </span>
      </button>
      <div className="my-photo__text">
        <strong>Foto do perfil</strong>
        <small>Aparece na conversa com o assistente e no menu.</small>
        <div className="my-photo__actions">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={busy === 'put'}
            disabled={!!busy}
            onClick={() => input.current?.click()}
          >
            {has ? 'Trocar foto' : 'Pôr foto'}
          </Button>
          {has && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              icon={<Trash2 size={15} />}
              loading={busy === 'delete'}
              disabled={!!busy}
              onClick={() => void remove()}
            >
              Tirar
            </Button>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        hidden
        onChange={(e) => void pick(e)}
      />
      {error && (
        <div className="my-photo__error">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </div>
  );
}
