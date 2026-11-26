import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Photo } from './ui';

/**
 * Fotos do item: arrasta para o lado (encaixa uma por vez), bolinhas embaixo mostram onde está.
 * No computador, setas dos lados. Uma foto só: igual a antes, sem bolinhas. Tocar na foto abre
 * ela em tela cheia (`PhotoViewer`).
 */
export function ProductGallery({ photos, alt }: { photos: (string | null)[]; alt: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const many = photos.length > 1;
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    const el = track.current;
    if (!el || !many) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setAt(Math.round(el.scrollLeft / (el.clientWidth || 1))));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [many]);

  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const n = Math.max(0, Math.min(photos.length - 1, i));
    el.scrollTo({ left: n * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <div className="pgal" data-many={many || undefined}>
      <div
        ref={track}
        className="pgal__track"
        tabIndex={many ? 0 : undefined}
        aria-roledescription={many ? 'carrossel' : undefined}
        aria-label={many ? `Fotos de ${alt}` : undefined}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') go(at + 1);
          if (e.key === 'ArrowLeft') go(at - 1);
        }}
      >
        {photos.map((src, i) => (
          <div
            key={`${src}-${i}`}
            className="pgal__slide"
            aria-label={many ? `Foto ${i + 1} de ${photos.length}` : undefined}
          >
            <button
              type="button"
              className="pgal__zoom"
              aria-label={`Ampliar foto${many ? ` ${i + 1}` : ''} de ${alt}`}
              disabled={!src}
              onClick={() => setOpen(i)}
            >
              <Photo
                src={src}
                alt={i === 0 ? alt : `${alt}, foto ${i + 1}`}
                ratio="1 / 1"
                eager={i === 0}
                w="full"
              />
            </button>
          </div>
        ))}
      </div>
      {many && (
        <>
          <div className="pgal__dots" aria-hidden>
            {photos.map((_, i) => (
              <span key={i} className="pgal__dot" data-on={i === at || undefined} />
            ))}
          </div>
          <button
            type="button"
            className="pgal__arrow pgal__arrow--prev iconbtn iconbtn--glass"
            aria-label="Foto anterior"
            disabled={at === 0}
            onClick={() => go(at - 1)}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            className="pgal__arrow pgal__arrow--next iconbtn iconbtn--glass"
            aria-label="Próxima foto"
            disabled={at === photos.length - 1}
            onClick={() => go(at + 1)}
          >
            <ChevronRight size={20} />
          </button>
        </>
      )}
      {open !== null && (
        <PhotoViewer
          photos={photos}
          alt={alt}
          start={open}
          onClose={(i) => {
            setOpen(null);
            // Volta para a foto que estava aberta em tela cheia.
            const el = track.current;
            if (el && many) el.scrollTo({ left: i * el.clientWidth });
          }}
        />
      )}
    </div>
  );
}

/**
 * Foto do item em tela cheia: inteira (sem cortar), arrasta ou setas para trocar, Esc, X ou
 * tocar fora da foto fecha.
 */
function PhotoViewer({
  photos: all,
  alt,
  start,
  onClose,
}: {
  photos: (string | null)[];
  alt: string;
  start: number;
  onClose(at: number): void;
}) {
  const photos = all.filter((p): p is string => !!p);
  const box = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(Math.min(start, photos.length - 1));
  const atRef = useRef(at);
  atRef.current = at;
  const many = photos.length > 1;

  useLayoutEffect(() => {
    const d = box.current;
    if (d && !d.open) d.showModal?.();
    const el = track.current;
    if (el) el.scrollLeft = at * el.clientWidth;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = prev;
    };
    // Só na abertura.
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el || !many) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setAt(Math.round(el.scrollLeft / (el.clientWidth || 1))));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [many]);

  const close = () => onClose(atRef.current);
  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const n = Math.max(0, Math.min(photos.length - 1, i));
    el.scrollTo({ left: n * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <dialog
      ref={box}
      className="pview"
      aria-label={`Fotos de ${alt}`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(at + 1);
        if (e.key === 'ArrowLeft') go(at - 1);
      }}
    >
      <div
        ref={track}
        className="pview__track"
        onClick={(e) => {
          // Fora da foto (no escuro em volta) fecha.
          if (!(e.target as HTMLElement).closest('img')) close();
        }}
      >
        {photos.map((src, i) => (
          <div key={`${src}-${i}`} className="pview__slide">
            <img src={src} alt={i === 0 ? alt : `${alt}, foto ${i + 1}`} decoding="async" />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="pview__close iconbtn iconbtn--glass"
        aria-label="Fechar foto"
        onClick={close}
        autoFocus
      >
        <X size={22} />
      </button>
      {many && (
        <>
          <span className="pview__count" aria-live="polite">
            {at + 1} / {photos.length}
          </span>
          <button
            type="button"
            className="pview__arrow pview__arrow--prev iconbtn iconbtn--glass"
            aria-label="Foto anterior"
            disabled={at === 0}
            onClick={() => go(at - 1)}
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            className="pview__arrow pview__arrow--next iconbtn iconbtn--glass"
            aria-label="Próxima foto"
            disabled={at === photos.length - 1}
            onClick={() => go(at + 1)}
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}
    </dialog>
  );
}
