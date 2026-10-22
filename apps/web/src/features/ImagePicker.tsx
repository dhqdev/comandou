import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useToast } from '../design-system';
import { mediaUrl, uploadImage } from '../lib/media';
import './image-picker.css';

/**
 * Escolher/trocar uma foto. Reduz no navegador, envia e devolve o id (ou null ao remover).
 * Aceita arrastar e soltar. `ratio` define o formato da miniatura (1/1 produto, 16/6 capa…).
 */
export function ImagePicker({
  value,
  onChange,
  label,
  ratio = '1 / 1',
  width = 64,
  disabled,
}: {
  value: string | null | undefined;
  onChange(id: string | null): void | Promise<void>;
  label: string;
  ratio?: string;
  width?: number | string;
  disabled?: boolean;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const src = mediaUrl(value);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const m = await uploadImage(file);
      await onChange(m.id);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="imgpick" style={{ width }}>
      <button
        type="button"
        className="imgpick__btn"
        data-over={over || undefined}
        style={{ aspectRatio: ratio }}
        disabled={disabled || busy}
        title={src ? `Trocar ${label.toLowerCase()}` : `Enviar ${label.toLowerCase()}`}
        aria-label={src ? `Trocar ${label.toLowerCase()}` : `Enviar ${label.toLowerCase()}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void pick(e.dataTransfer.files[0]);
        }}
      >
        {src ? <img src={src} alt="" loading="lazy" /> : <ImagePlus size={18} />}
        {busy && (
          <span className="imgpick__busy">
            <Loader2 size={18} className="imgpick__spin" />
          </span>
        )}
      </button>
      {src && !disabled && !busy && (
        <button
          type="button"
          className="imgpick__remove"
          aria-label={`Remover ${label.toLowerCase()}`}
          title="Remover foto"
          onClick={() => void onChange(null)}
        >
          <Trash2 size={12} />
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </div>
  );
}
