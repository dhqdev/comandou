import { ImagePlus, Loader2, RotateCw, Sparkles, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Bone, Button, Modal, useToast } from '../design-system';
import { mediaUrl, uploadImage } from '../lib/media';
import { photoCreate, useCatalogAi } from './item-ai';
import './image-picker.css';

/** O que a IA usa para criar a foto (o nome e a descrição do item ou da opção). */
export interface PhotoAiSource {
  name: string;
  description?: string | null;
}

/**
 * Janela que abre no clique da foto quando a IA das fotos está liberada: enviar uma foto do
 * aparelho ou pedir para a IA criar uma pelo nome e pela descrição (mostra antes de usar).
 */
function PhotoSource({
  label,
  ai,
  onUpload,
  onUse,
  onClose,
}: {
  label: string;
  ai: PhotoAiSource;
  onUpload(): void;
  onUse(blob: Blob): Promise<void>;
  onClose(): void;
}) {
  const [step, setStep] = useState<'pick' | 'making' | 'ready'>('pick');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!blob) return setUrl(null);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  async function make() {
    if (!ai.name.trim()) return setError('Dê um nome ao item antes de pedir a foto');
    setStep('making');
    setError(null);
    try {
      setBlob(await photoCreate(ai.name, ai.description));
      setStep('ready');
    } catch (e) {
      setError((e as Error).message);
      setStep(blob ? 'ready' : 'pick');
    }
  }
  async function apply() {
    if (!blob) return;
    setSaving(true);
    setError(null);
    try {
      await onUse(blob);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={step === 'pick' ? label : 'Foto criada com IA'}
      onClose={onClose}
      footer={
        step === 'pick' ? (
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              icon={<RotateCw size={16} />}
              disabled={step === 'making' || saving}
              onClick={make}
            >
              Gerar outra
            </Button>
            <Button disabled={step !== 'ready' || !blob} loading={saving} onClick={apply}>
              Usar esta foto
            </Button>
          </>
        )
      }
    >
      {step === 'pick' ? (
        <div className="imgsrc">
          <button type="button" className="imgsrc__opt" onClick={onUpload}>
            <Upload size={22} aria-hidden />
            <span>
              <strong>Enviar uma foto</strong>
              <small>Do celular ou do computador</small>
            </span>
          </button>
          <button type="button" className="imgsrc__opt" onClick={make}>
            <Sparkles size={22} aria-hidden />
            <span>
              <strong>Criar com IA</strong>
              <small>A IA faz a foto de “{ai.name.trim() || 'item sem nome'}” pela descrição</small>
            </span>
          </button>
        </div>
      ) : (
        <div className="imgsrc__result">
          {step === 'making' ? (
            <Bone className="imgsrc__photo" h="auto" r={12} />
          ) : (
            url && <img className="imgsrc__photo" src={url} alt={`Foto criada para ${ai.name}`} />
          )}
          <p className="cm-hint">
            {step === 'making'
              ? 'Criando a foto. Leva alguns segundos.'
              : 'Confira se a foto bate com o que a loja serve antes de usar.'}
          </p>
        </div>
      )}
      {error && <p className="form-error imgsrc__error">{error}</p>}
    </Modal>
  );
}

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
  ai,
}: {
  value: string | null | undefined;
  onChange(id: string | null): void | Promise<void>;
  label: string;
  ratio?: string;
  width?: number | string;
  disabled?: boolean;
  /** Item ou opção do cardápio: o clique oferece também "Criar com IA" (se liberada). */
  ai?: PhotoAiSource | null;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [source, setSource] = useState(false);
  const status = useCatalogAi(!!ai && !disabled);
  const withAi = !!ai && !!status?.photo;
  const src = mediaUrl(value);

  async function applyAi(blob: Blob) {
    const file = new File([blob], 'foto-ia.jpg', { type: blob.type || 'image/jpeg' });
    const m = await uploadImage(file);
    await onChange(m.id);
    setSource(false);
    toast('Foto criada com IA no item', 'success');
  }

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
    <div
      className="imgpick"
      style={{ width }}
      data-small={(typeof width === 'number' && width <= 64) || undefined}
    >
      <button
        type="button"
        className="imgpick__btn"
        data-over={over || undefined}
        style={{ aspectRatio: ratio }}
        disabled={disabled || busy}
        title={src ? `Trocar ${label.toLowerCase()}` : `Enviar ${label.toLowerCase()}`}
        aria-label={src ? `Trocar ${label.toLowerCase()}` : `Enviar ${label.toLowerCase()}`}
        onClick={() => (withAi ? setSource(true) : input.current?.click())}
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
      {source && ai && (
        <PhotoSource
          label={src ? `Trocar ${label.toLowerCase()}` : label}
          ai={ai}
          onUpload={() => {
            input.current?.click();
            setSource(false);
          }}
          onUse={applyAi}
          onClose={() => setSource(false)}
        />
      )}
    </div>
  );
}
