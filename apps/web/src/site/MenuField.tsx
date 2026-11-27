import { FileText, Plus, X } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { Bone, Spinner } from '../design-system';
import { brl } from '../lib/money';

/**
 * "Seu cardápio" na janela de criar: a pessoa manda a foto ou o PDF, a IA separa os itens com os
 * preços e sugere o estoque de cada um (pela chave do sistema). Sem cardápio enviado e com o site
 * montado pela IA, a lista mostra os itens do site com o estoque sugerido.
 */
export interface MenuItem {
  name: string;
  description: string | null;
  price: string | null;
  /** undefined = ainda sem sugestão; null = sem controle (peso, rodízio, adicional). */
  stock?: { qty: number; min: number } | null;
}

export interface SiteMenu {
  items: number;
  suggested: boolean;
  stockPending: boolean;
  categories: { name: string; items: MenuItem[] }[];
}

export const MENU_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf,.pdf';

export function MenuField({
  reading,
  menu,
  fromSite,
  pages,
  stocking,
  error,
  disabled,
  onFile,
  onClear,
}: {
  /** Nome do arquivo sendo lido agora. */
  reading: string | null;
  /** O que listar: o cardápio enviado ou, sem ele, o do site montado pela IA. */
  menu: SiteMenu | null;
  fromSite: boolean;
  /** Páginas já lidas do cardápio enviado (0 = nenhum). */
  pages: number;
  stocking: boolean;
  error: string | null;
  disabled: boolean;
  onFile: (f: File) => void;
  onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const sent = pages > 0;

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f && !disabled && !reading) onFile(f);
    if (input.current) input.current.value = '';
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    pick(e.dataTransfer.files);
  };

  const cats = menu?.categories.filter((c) => c.items.length) ?? [];

  return (
    <div className="st-menu">
      <div className="st-menu__head">
        <span className="st-menu__title">
          Seu cardápio <small>(opcional)</small>
        </span>
        {sent && !reading && (
          <span className="st-menu__acts">
            <button
              type="button"
              className="st-link"
              disabled={disabled}
              onClick={() => input.current?.click()}
            >
              <Plus size={14} aria-hidden />
              Mais uma página
            </button>
            <button type="button" className="st-link" disabled={disabled} onClick={onClear}>
              <X size={14} aria-hidden />
              Tirar
            </button>
          </span>
        )}
      </div>

      <label
        className="st-drop"
        data-over={over || undefined}
        data-busy={reading ? true : undefined}
        hidden={sent && !reading}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <input
          ref={input}
          type="file"
          accept={MENU_ACCEPT}
          aria-label="Foto ou PDF do cardápio"
          disabled={disabled || !!reading}
          onChange={(e) => pick(e.target.files)}
        />
        <span className="st-drop__ic" aria-hidden>
          {reading ? <Spinner inline label="Lendo" /> : <FileText size={20} />}
        </span>
        <span className="st-drop__txt" aria-live="polite">
          {reading ? (
            <>
              <b>Lendo {sent ? 'mais uma página' : 'o seu cardápio'}</b>
              <small>A IA está separando os itens e os preços. Leva uns 30 segundos.</small>
            </>
          ) : (
            <>
              <b>{fromSite ? 'Tem o cardápio em foto ou PDF?' : 'Mande uma foto ou o PDF'}</b>
              <small>
                {fromSite
                  ? 'Mande para usar os itens e os preços dele no lugar dos do site.'
                  : 'A IA separa os itens com os preços e sugere o estoque de cada um.'}
              </small>
            </>
          )}
        </span>
      </label>

      {error && (
        <p className="st-menu__err" role="alert">
          {error}
        </p>
      )}

      {menu && cats.length > 0 && (
        <>
          <p className="st-menu__sum">
            {fromSite ? 'Do seu site: ' : ''}
            {menu.items} {menu.items === 1 ? 'item' : 'itens'} em {cats.length}{' '}
            {cats.length === 1 ? 'categoria' : 'categorias'}
            {sent ? ` · ${pages} ${pages === 1 ? 'página' : 'páginas'}` : ''}
          </p>
          <div className="st-menu__list" tabIndex={0} aria-label="Itens do cardápio">
            <div className="st-menu__row st-menu__row--head" aria-hidden>
              <span>Item</span>
              <span>Preço</span>
              <span>Estoque</span>
            </div>
            {cats.map((c, ci) => (
              <section key={`${ci}-${c.name}`}>
                <h4>{c.name}</h4>
                <ul>
                  {c.items.map((i, ii) => (
                    <li key={`${ii}-${i.name}`} className="st-menu__row">
                      <span className="st-menu__name">{i.name}</span>
                      <span className="st-menu__price">{i.price ? brl(i.price) : '—'}</span>
                      <span className="st-menu__stock">
                        <Stock s={i.stock} loading={stocking} />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className="st-menu__note">
            {stocking
              ? 'A IA está sugerindo o estoque de cada item.'
              : 'Estoque sugerido pela IA para começar. Você confere tudo nos primeiros passos.'}
          </p>
        </>
      )}
    </div>
  );
}

function Stock({ s, loading }: { s: MenuItem['stock']; loading: boolean }) {
  if (s === undefined) return loading ? <Bone w={46} h={10} r={5} /> : <>—</>;
  if (s === null) return <small>sem controle</small>;
  return (
    <span title={`Avisa quando chegar a ${s.min}`}>
      <b>{s.qty}</b> un <small>mín. {s.min}</small>
    </span>
  );
}
