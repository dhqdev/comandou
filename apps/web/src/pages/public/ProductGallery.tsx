import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Photo } from './ui';

/**
 * Fotos do item: arrasta para o lado (encaixa uma por vez), bolinhas embaixo mostram onde está.
 * No computador, setas dos lados. Uma foto só: igual a antes, sem bolinhas.
 */
export function ProductGallery({ photos, alt }: { photos: (string | null)[]; alt: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const many = photos.length > 1;

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
            <Photo
              src={src}
              alt={i === 0 ? alt : `${alt}, foto ${i + 1}`}
              ratio="1 / 1"
              eager={i === 0}
            />
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
    </div>
  );
}
