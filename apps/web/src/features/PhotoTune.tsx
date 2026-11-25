import { Check, Lightbulb, RotateCcw, Sparkles, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert, Bone, Button, Modal, Segmented, useToast } from '../design-system';
import { uploadImage } from '../lib/media';
import {
  canvasOf,
  jpegOf,
  loadBitmap,
  photoClean,
  photoTips,
  tuned,
  useCatalogAi,
  type PhotoTips,
} from './item-ai';
import './photo-tune.css';

type Mode = 'tune' | 'clean';

/** Lado maior da foto mandada para a IA (basta para ela ver; a resposta é pequena). */
const SEND_SIDE = 1024;
/** Lado maior da prévia na tela. */
const PREVIEW_SIDE = 1200;

function useObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return setUrl(null);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/**
 * "Melhorar a foto" do item: a IA (modelo barato de visão, guiada pelo melhorar-foto.md da API)
 * olha a foto e sugere um retoque leve de luz, cor e corte, aplicado aqui mesmo; a pessoa compara
 * antes e depois e escolhe a força. Se quiser, pede a mesma foto com fundo limpo (IA de imagem).
 * Nada muda até tocar em "Usar esta foto"; depois é só salvar o item.
 */
export function PhotoTuneButton({
  imageId,
  itemName,
  disabled,
  onChange,
}: {
  imageId: string | null;
  itemName: string;
  disabled?: boolean;
  onChange(id: string): void;
}) {
  const ai = useCatalogAi(!!imageId && !disabled);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  if (!imageId || disabled || !ai?.photo) return null;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="ptune__open"
        icon={<Sparkles size={15} />}
        onClick={() => setOpen(true)}
      >
        Melhorar a foto
      </Button>
      {open && (
        <PhotoTuneModal
          imageId={imageId}
          itemName={itemName}
          onClose={() => setOpen(false)}
          onUse={(id) => {
            setOpen(false);
            onChange(id);
            // Aviso só depois de a janela fechar (nada de aviso por cima da janela).
            toast('Foto melhorada. Salve o item para publicar.', 'success');
          }}
        />
      )}
    </>
  );
}

function PhotoTuneModal({
  imageId,
  itemName,
  onClose,
  onUse,
}: {
  imageId: string;
  itemName: string;
  onClose(): void;
  onUse(id: string): void;
}) {
  const img = useRef<ImageBitmap | null>(null);
  const [tips, setTips] = useState<PhotoTips | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [strength, setStrength] = useState(100);
  const [cropOn, setCropOn] = useState(true);
  const [split, setSplit] = useState(50);
  const [mode, setMode] = useState<Mode>('tune');
  const [before, setBefore] = useState<Blob | null>(null);
  const [after, setAfter] = useState<Blob | null>(null);
  const [clean, setClean] = useState<Blob | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ratio, setRatio] = useState('1 / 1');
  const beforeUrl = useObjectUrl(before);
  const afterUrl = useObjectUrl(mode === 'clean' ? clean : after);

  // Abre a foto e pede a sugestão da IA.
  useEffect(() => {
    let alive = true;
    setError(null);
    setTips(null);
    (async () => {
      const bmp = img.current ?? (await loadBitmap(imageId));
      img.current = bmp;
      const send = await jpegOf(canvasOf(bmp, SEND_SIDE), 0.86);
      const t = await photoTips(send, itemName);
      if (alive) setTips(t);
    })().catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [imageId, itemName, attempt]);

  useEffect(
    () => () => {
      img.current?.close();
      img.current = null;
    },
    [],
  );

  // Antes e depois na mesma moldura (o corte vale para os dois, para a comparação alinhar).
  useEffect(() => {
    const bmp = img.current;
    if (!bmp || !tips) return;
    const crop = cropOn ? tips.crop : null;
    let alive = true;
    const t = setTimeout(() => {
      const base = canvasOf(bmp, PREVIEW_SIDE, crop);
      setRatio(`${base.width} / ${base.height}`);
      void Promise.all([
        jpegOf(base, 0.9),
        jpegOf(tuned(bmp, tips.adjust, { strength: strength / 100, crop, maxSide: PREVIEW_SIDE })),
      ]).then(([b, a]) => {
        if (!alive) return;
        setBefore(b);
        setAfter(a);
      });
    }, 90);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [tips, strength, cropOn]);

  async function cleanBackground() {
    const bmp = img.current;
    if (!bmp) return;
    setCleaning(true);
    setError(null);
    try {
      const send = await jpegOf(canvasOf(bmp, SEND_SIDE), 0.88);
      setClean(await photoClean(send, itemName));
      setMode('clean');
      setSplit(50);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCleaning(false);
    }
  }

  async function use() {
    const bmp = img.current;
    if (!bmp || !tips) return;
    setSaving(true);
    setError(null);
    try {
      const blob =
        mode === 'clean' && clean
          ? clean
          : await jpegOf(
              tuned(bmp, tips.adjust, {
                strength: strength / 100,
                crop: cropOn ? tips.crop : null,
                maxSide: 1600,
              }),
              0.92,
            );
      const file = new File([blob], 'foto-melhorada.jpg', { type: blob.type || 'image/jpeg' });
      const m = await uploadImage(file);
      onUse(m.id);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const ready = !!tips && !!beforeUrl && !!afterUrl;
  return (
    <Modal
      open
      size="lg"
      title={
        <span className="ptune__title">
          <Sparkles size={18} aria-hidden /> Melhorar a foto
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Manter a de antes
          </Button>
          <Button icon={<Check size={16} />} loading={saving} disabled={!ready} onClick={use}>
            Usar esta foto
          </Button>
        </>
      }
    >
      <div className="ptune">
        {error && (
          <Alert tone="danger">
            {error}
            {!tips && (
              <>
                {' '}
                <button
                  type="button"
                  className="ptune__retry"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  Tentar de novo
                </button>
              </>
            )}
          </Alert>
        )}
        <div className="ptune__grid">
          <div
            className="ptune__stage"
            style={{ aspectRatio: ratio }}
            data-ready={ready || undefined}
          >
            {ready ? (
              <>
                <img
                  className="ptune__img"
                  src={beforeUrl!}
                  alt="Foto de antes"
                  draggable={false}
                />
                <img
                  className="ptune__img ptune__img--after"
                  src={afterUrl!}
                  alt="Foto de depois"
                  draggable={false}
                  style={{ clipPath: `inset(0 0 0 ${split}%)` }}
                />
                <span className="ptune__line" style={{ left: `${split}%` }} aria-hidden />
                <span className="ptune__tag ptune__tag--before">Antes</span>
                <span className="ptune__tag ptune__tag--after">Depois</span>
                <input
                  className="ptune__split"
                  type="range"
                  min={0}
                  max={100}
                  value={split}
                  aria-label="Comparar antes e depois"
                  onChange={(e) => setSplit(Number(e.target.value))}
                />
              </>
            ) : (
              <div className="ptune__wait">
                <Bone w="100%" h="100%" r={12} />
                {!error && (
                  <span className="ptune__wait-text">
                    <Wand2 size={16} aria-hidden /> A IA está olhando a foto…
                  </span>
                )}
              </div>
            )}
          </div>

          <aside className="ptune__side">
            {tips ? (
              <>
                <p className="ptune__summary">{tips.summary}</p>
                {mode === 'tune' && (
                  <label className="ptune__strength">
                    <span>
                      Força do retoque <strong>{strength}%</strong>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={150}
                      step={10}
                      value={strength}
                      onChange={(e) => setStrength(Number(e.target.value))}
                    />
                  </label>
                )}
                {mode === 'tune' && tips.crop && (
                  <label className="ptune__check">
                    <input
                      type="checkbox"
                      checked={cropOn}
                      onChange={(e) => setCropOn(e.target.checked)}
                    />
                    Cortar as sobras em volta do prato
                  </label>
                )}
                {clean && (
                  <Segmented<Mode>
                    label="Qual versão usar"
                    block
                    value={mode}
                    onChange={(v) => {
                      setMode(v);
                      setSplit(50);
                    }}
                    options={[
                      { value: 'tune', label: 'Retoque leve' },
                      { value: 'clean', label: 'Fundo limpo' },
                    ]}
                  />
                )}
                {!clean && (
                  <div className="ptune__clean">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Wand2 size={15} />}
                      loading={cleaning}
                      onClick={cleanBackground}
                    >
                      Fundo limpo com IA
                    </Button>
                    <span className="cm-hint">
                      {tips.cleanWorth
                        ? 'O fundo está atrapalhando: vale a pena. A IA refaz só o fundo e a luz.'
                        : 'Opcional: a IA refaz só o fundo e a luz, mantendo o prato.'}
                    </span>
                  </div>
                )}
                {mode === 'tune' && strength !== 100 && (
                  <button type="button" className="ptune__reset" onClick={() => setStrength(100)}>
                    <RotateCcw size={13} aria-hidden /> Voltar ao sugerido
                  </button>
                )}
                {tips.tips.length > 0 && (
                  <section className="ptune__tips">
                    <h4>
                      <Lightbulb size={14} aria-hidden /> Para a próxima foto
                    </h4>
                    <ul>
                      {tips.tips.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            ) : (
              !error && (
                <div className="ptune__side-sk" aria-hidden>
                  <Bone w="90%" />
                  <Bone w="70%" />
                  <Bone w="80%" h={30} r={8} />
                </div>
              )
            )}
          </aside>
        </div>
      </div>
    </Modal>
  );
}
