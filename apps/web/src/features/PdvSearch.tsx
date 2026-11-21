import { Clock, Search, Star, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** Quantas buscas recentes e favoritas ficam guardadas. */
const MAX_RECENT = 8;
const MAX_FAV = 12;

type Saved = { recent: string[]; fav: string[] };

function storageKey(userId: string | undefined) {
  return `cm.pdv.search.${userId ?? 'anon'}`;
}

function readSaved(key: string): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Saved> | null;
    const list = (x: unknown) =>
      Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(0, 20) : [];
    return { recent: list(v?.recent), fav: list(v?.fav) };
  } catch {
    return { recent: [], fav: [] };
  }
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Busca do PDV com a lista que abre ao tocar: as últimas buscas (Recentes) e as que a pessoa
 * marcou com a estrela (Favoritos). Fica guardado neste aparelho, separado por pessoa.
 */
export function PdvSearch({
  value,
  onChange,
  userId,
}: {
  value: string;
  onChange(v: string): void;
  userId: string | undefined;
}) {
  const key = storageKey(userId);
  const [saved, setSaved] = useState<Saved>(() => readSaved(key));
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'recent' | 'fav'>('recent');
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setSaved(readSaved(key)), [key]);

  function persist(next: Saved) {
    setSaved(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  }

  /** Guarda a busca no topo das recentes (sem repetir). */
  function remember(term: string) {
    const t = term.trim();
    if (t.length < 2) return;
    persist({
      ...saved,
      recent: [t, ...saved.recent.filter((r) => !same(r, t))].slice(0, MAX_RECENT),
    });
  }

  function toggleFav(term: string) {
    const t = term.trim();
    if (!t) return;
    const has = saved.fav.some((f) => same(f, t));
    persist({
      ...saved,
      fav: has ? saved.fav.filter((f) => !same(f, t)) : [t, ...saved.fav].slice(0, MAX_FAV),
    });
  }

  function pick(term: string) {
    onChange(term);
    remember(term);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (wrap.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);

  const isFav = (t: string) => saved.fav.some((f) => same(f, t));
  const list = tab === 'recent' ? saved.recent : saved.fav;
  const current = value.trim();

  return (
    <div
      ref={wrap}
      className="pdv__find"
      onBlur={(e) => {
        // Saiu da busca (e da lista): a busca digitada vira recente. Só fecha quando o foco foi
        // para outro lugar (no Safari o clique num botão da lista não leva o foco junto).
        const to = e.relatedTarget as Node | null;
        if (to && wrap.current?.contains(to)) return;
        remember(value);
        if (to) setOpen(false);
      }}
    >
      <label className="pdv__search">
        <Search size={18} aria-hidden />
        <input
          ref={input}
          placeholder="Buscar pedido, cliente ou mesa…"
          aria-label="Buscar pedido"
          aria-expanded={open}
          aria-controls="pdv-find-list"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            setTab(saved.recent.length === 0 && saved.fav.length > 0 ? 'fav' : 'recent');
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              remember(value);
              setOpen(false);
            } else if (e.key === 'Escape') {
              if (open) setOpen(false);
              else if (value) onChange('');
            } else if (e.key === 'ArrowDown' && open) {
              e.preventDefault();
              wrap.current?.querySelector<HTMLButtonElement>('.pdv-find__term')?.focus();
            }
          }}
        />
        {current && (
          <button
            type="button"
            className="pdv-find__star"
            data-on={isFav(current) || undefined}
            aria-label={isFav(current) ? 'Tirar dos favoritos' : 'Salvar nos favoritos'}
            title={isFav(current) ? 'Tirar dos favoritos' : 'Salvar nos favoritos'}
            onClick={(e) => {
              e.preventDefault();
              toggleFav(current);
            }}
          >
            <Star size={16} />
          </button>
        )}
        {value && (
          <button
            type="button"
            className="pdv-find__clear"
            aria-label="Limpar a busca"
            onClick={(e) => {
              e.preventDefault();
              remember(value);
              onChange('');
              input.current?.focus();
            }}
          >
            <X size={16} />
          </button>
        )}
      </label>
      {open && (
        <div className="pdv-find" id="pdv-find-list">
          <div className="pdv-find__tabs" role="tablist" aria-label="Buscas guardadas">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'recent'}
              onClick={() => setTab('recent')}
            >
              <Clock size={14} aria-hidden /> Recentes
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'fav'}
              onClick={() => setTab('fav')}
            >
              <Star size={14} aria-hidden /> Favoritos
              {saved.fav.length > 0 && <b>{saved.fav.length}</b>}
            </button>
          </div>
          {list.length === 0 ? (
            <p className="pdv-find__empty">
              {tab === 'recent'
                ? 'As suas últimas buscas aparecem aqui.'
                : 'Toque na estrela de uma busca para ela ficar sempre aqui.'}
            </p>
          ) : (
            <ul className="pdv-find__list" role="tabpanel">
              {list.map((t) => (
                <li key={t}>
                  <button
                    type="button"
                    className="pdv-find__term"
                    onClick={() => pick(t)}
                    onKeyDown={(e) => {
                      const items = [
                        ...(wrap.current?.querySelectorAll<HTMLButtonElement>('.pdv-find__term') ??
                          []),
                      ];
                      const i = items.indexOf(e.currentTarget);
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        items[Math.min(i + 1, items.length - 1)]?.focus();
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        if (i === 0) input.current?.focus();
                        else items[i - 1]?.focus();
                      } else if (e.key === 'Escape') {
                        setOpen(false);
                        input.current?.focus();
                      }
                    }}
                  >
                    {tab === 'recent' ? (
                      <Clock size={15} aria-hidden />
                    ) : (
                      <Star size={15} aria-hidden />
                    )}
                    <span>{t}</span>
                  </button>
                  <button
                    type="button"
                    className="pdv-find__star"
                    data-on={isFav(t) || undefined}
                    aria-label={isFav(t) ? `Tirar "${t}" dos favoritos` : `Favoritar "${t}"`}
                    title={isFav(t) ? 'Tirar dos favoritos' : 'Salvar nos favoritos'}
                    onClick={() => toggleFav(t)}
                  >
                    <Star size={15} />
                  </button>
                  {tab === 'recent' && (
                    <button
                      type="button"
                      className="pdv-find__clear"
                      aria-label={`Apagar "${t}" das recentes`}
                      title="Apagar das recentes"
                      onClick={() =>
                        persist({ ...saved, recent: saved.recent.filter((r) => r !== t) })
                      }
                    >
                      <X size={15} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
