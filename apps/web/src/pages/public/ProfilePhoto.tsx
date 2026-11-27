import { CUSTOMER_AVATARS, type CustomerAvatar as AvatarId } from '@comandou/shared';
import { Camera, Check, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Modal, useToast } from '../../design-system';
import { api, ApiError } from '../../lib/api';
import { AVATAR_LOOKS, AvatarArt, avatarOf, CustomerAvatar } from './avatars';
import { useStore } from './context';
import { squarePhoto } from '../../lib/square-photo';
import type { AccountState, CustomerAccount } from './store';

async function uploadPhoto(blob: Blob): Promise<AccountState> {
  let res: Response;
  try {
    res = await fetch('/api/v1/store/account/photo', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': blob.type, 'X-Comandou-Request': '1', Accept: 'application/json' },
      body: blob,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão. Tente de novo.');
  }
  const body = await res.json().catch(() => undefined);
  if (!res.ok)
    throw new ApiError(
      res.status,
      (body as { message?: string } | undefined)?.message ?? `Erro ${res.status}`,
    );
  return body as AccountState;
}

/**
 * Foto do perfil com o botão de câmera. Tocar abre a escolha: enviar ou tirar uma foto, ou um
 * dos avatares desenhados. Escolher avatar troca a foto por ele.
 */
export function ProfilePhoto({ me, size = 72 }: { me: CustomerAccount; size?: number }) {
  const { setAccount } = useStore();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const current = me.photoUrl ? null : avatarOf(me);

  async function run(key: string, fn: () => Promise<AccountState>, ok: string) {
    setBusy(key);
    try {
      setAccount(await fn());
      toast(ok, 'success');
      setOpen(false);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  }

  const pick = (file: File | undefined) =>
    file && run('photo', async () => uploadPhoto(await squarePhoto(file)), 'Foto do perfil salva');
  const choose = (id: AvatarId) =>
    run(
      id,
      () => api<AccountState>('/store/account', { method: 'PATCH', json: { avatar: id } }),
      'Avatar escolhido',
    );
  const remove = () =>
    run(
      'remove',
      () => api<AccountState>('/store/account/photo', { method: 'DELETE' }),
      'Foto removida',
    );

  return (
    <>
      <button
        type="button"
        className="pphoto"
        onClick={() => setOpen(true)}
        aria-label="Trocar foto do perfil"
      >
        <CustomerAvatar customer={me} size={size} decorative />
        <span className="pphoto__cam" aria-hidden>
          <Camera size={14} />
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <Modal open={open} title="Foto do perfil" onClose={() => !busy && setOpen(false)}>
        <div className="pphoto-sheet">
          <div className="pphoto-sheet__now">
            <CustomerAvatar customer={me} size={96} />
            <p>Aparece no seu perfil e na sua ficha de cliente na loja.</p>
          </div>
          <div className="pphoto-sheet__actions">
            <button
              type="button"
              className="cta"
              disabled={!!busy}
              onClick={() => input.current?.click()}
            >
              {busy === 'photo' ? (
                <Loader2 size={18} className="ck-send__spin" aria-hidden />
              ) : (
                <ImagePlus size={18} aria-hidden />
              )}
              {me.photoUrl ? 'Trocar foto' : 'Enviar uma foto'}
            </button>
            {me.photoUrl && (
              <button
                type="button"
                className="btn-line btn-line--danger"
                disabled={!!busy}
                onClick={() => void remove()}
              >
                <Trash2 size={16} aria-hidden /> Tirar a foto
              </button>
            )}
          </div>
          <h3 className="pphoto-sheet__title">Ou escolha um avatar</h3>
          <div className="pphoto-grid" role="radiogroup" aria-label="Avatares">
            {CUSTOMER_AVATARS.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={current === id}
                aria-label={AVATAR_LOOKS[id].label}
                className="pphoto-grid__opt"
                disabled={!!busy}
                onClick={() => void choose(id)}
              >
                <AvatarArt id={id} />
                {current === id && (
                  <span className="pphoto-grid__on" aria-hidden>
                    <Check size={14} strokeWidth={3} />
                  </span>
                )}
                {busy === id && (
                  <span className="pphoto-grid__busy" aria-hidden>
                    <Loader2 size={20} className="ck-send__spin" />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </Modal>
    </>
  );
}
