import {
  ArrowRight,
  FileText,
  Globe,
  Instagram,
  Link2,
  MapPin,
  Paperclip,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from 'react';
import { Button, type PandaMood } from '../design-system';
import { FILE_ACCEPT, isPdf, LINK_RE, linksOf, MAX_FILES, shortLink } from './create/create-api';
import { handOff } from './create/handoff';
import { goTo } from './fx';
import type { SiteConfig } from './host';
import { calmMotion } from './motion';
import type { Look } from './PhoneMock';
import { parseItems, SAMPLE_ITEMS, SAMPLE_STORE } from './site-data';

/**
 * Campo da página inicial (0.282): a pessoa escreve, cola links e anexa fotos e PDF do restaurante
 * e, ao mandar, vai para a conversa de criar (/criar), que já começa lendo tudo. Lá a IA pergunta
 * o que é cada coisa e o restaurante nasce pronto. Aqui o celular ao lado só mostra os itens que
 * a pessoa escreve (sem IA).
 */

/** A loja de exemplo do celular, antes de a pessoa mexer em qualquer coisa. */
export const FIRST_LOOK: Look = {
  name: SAMPLE_STORE.name,
  color: null,
  icon: SAMPLE_STORE.logo,
  cover: SAMPLE_STORE.cover,
  items: SAMPLE_ITEMS,
  typed: false,
  tagline: SAMPLE_STORE.tagline,
  chips: SAMPLE_STORE.chips,
};

/** Exemplos que o campo escreve sozinho enquanto está vazio. */
const EXAMPLES = [
  'Cole o site, o link do Google Maps ou do iFood…',
  'Escreva o cardápio: X-Burger 28,90 · Batata 18,00',
  'Anexe a foto do cardápio e o logo pelo clipe',
  'Mande o CNPJ, o endereço e o horário da loja',
];

/** Texto de exemplo que se escreve e se apaga no campo vazio (direto no atributo). */
function useTypedPlaceholder(
  ref: RefObject<HTMLTextAreaElement | null>,
  phrases: string[],
  active: boolean,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !active || calmMotion()) return;
    let phrase = 0;
    let chars = 0;
    let erasing = false;
    let t = 0;
    const tick = () => {
      const full = phrases[phrase] ?? '';
      if (!erasing) {
        chars += 1;
        if (chars >= full.length) {
          erasing = true;
          el.placeholder = full;
          t = window.setTimeout(tick, 1800);
          return;
        }
      } else {
        chars -= 2;
        if (chars <= 0) {
          chars = 0;
          erasing = false;
          phrase = (phrase + 1) % phrases.length;
          el.placeholder = '';
          t = window.setTimeout(tick, 350);
          return;
        }
      }
      el.placeholder = full.slice(0, chars);
      t = window.setTimeout(tick, erasing ? 22 : 40 + Math.random() * 35);
    };
    el.placeholder = phrases[0] ?? '';
    t = window.setTimeout(() => {
      chars = (phrases[0] ?? '').length;
      erasing = true;
      tick();
    }, 2200);
    return () => {
      window.clearTimeout(t);
      el.placeholder = phrases[0] ?? '';
    };
  }, [ref, phrases, active]);
}

const linkIcon = (u: string) =>
  /maps\.app\.goo\.gl|google\.[a-z.]+\/maps|goo\.gl\/maps/i.test(u)
    ? MapPin
    : /instagram\.com/i.test(u)
      ? Instagram
      : /ifood|aiqfome|99food|rappi/i.test(u)
        ? Link2
        : Globe;

export function Builder({
  config,
  onLook,
  onMood,
}: {
  config: SiteConfig | null;
  onLook: (l: Look) => void;
  onMood: (m: PandaMood) => void;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  useTypedPlaceholder(field, EXAMPLES, !text && !files.length);

  // Links não viram itens no celular (só as linhas com o preço).
  const typedItems = useMemo(() => parseItems(text.replace(LINK_RE, '')), [text]);
  const links = useMemo(() => linksOf(text), [text]);
  useEffect(() => {
    if (!typedItems.length) return onLook(FIRST_LOOK);
    onLook({
      name: 'Seu restaurante',
      color: null,
      icon: null,
      cover: null,
      items: typedItems,
      typed: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedItems]);

  const addFiles = (list: FileList | File[]) => {
    const picked = Array.from(list).filter((f) => isPdf(f) || f.type.startsWith('image/'));
    if (!picked.length) return;
    setFiles((cur) => [...cur, ...picked].slice(0, MAX_FILES));
    onMood('happy');
  };

  /** Vai para a conversa de criar levando o que já foi escrito e anexado. */
  const start = () => {
    handOff({ text: text.trim(), files });
    goTo('/criar');
  };

  const closed = config && !config.signup;
  const has = !!text.trim() || files.length > 0;

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  return (
    <div className="st-build" id="criar">
      <form
        className="st-compose"
        data-drag={drag || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <textarea
          ref={field}
          className="st-compose__text"
          aria-label="Conte sobre o seu restaurante"
          rows={3}
          maxLength={6000}
          placeholder={EXAMPLES[0]}
          value={text}
          disabled={!!closed}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              addFiles(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              start();
            }
          }}
        />
        {(files.length > 0 || links.length > 0) && (
          <div className="st-compose__chips" aria-label="O que vai junto">
            {links.map((l) => {
              const Ic = linkIcon(l);
              return (
                <span key={l} className="st-chip">
                  <Ic size={14} aria-hidden />
                  {shortLink(l)}
                </span>
              );
            })}
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="st-att" title={f.name}>
                <span className="st-att__pdf">
                  <FileText size={18} aria-hidden />
                </span>
                <span className="st-att__label">{isPdf(f) ? 'PDF' : 'Foto'}</span>
                <button
                  type="button"
                  className="st-att__x"
                  aria-label={`Tirar ${f.name}`}
                  onClick={() => setFiles((cur) => cur.filter((_, k) => k !== i))}
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="st-compose__bar">
          <input
            ref={picker}
            type="file"
            hidden
            multiple
            accept={FILE_ACCEPT}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="st-compose__attach"
            aria-label="Anexar foto ou PDF"
            title="Anexar foto ou PDF (logo, cardápio, fachada, cartão do CNPJ)"
            disabled={!!closed || files.length >= MAX_FILES || !config?.ai}
            onClick={() => picker.current?.click()}
          >
            <Paperclip size={18} aria-hidden />
          </button>
          <span className="st-compose__hint">
            {config?.ai
              ? 'Texto, links, fotos e PDF. Tudo junto ou aos poucos.'
              : 'Cole o link do site ou escreva os itens com o preço.'}
          </span>
          <Button type="submit" size="lg" className="st-build__go st-press" disabled={!!closed}>
            {config?.ai && has ? 'Criar com IA' : 'Criar meu restaurante'}
            {config?.ai && has ? (
              <Sparkles size={17} aria-hidden />
            ) : (
              <ArrowRight size={18} aria-hidden className="st-arrow__i" />
            )}
          </Button>
        </div>
        {drag && <div className="st-compose__drop">Solte aqui as fotos ou o PDF</div>}
      </form>
      <div className="st-build__under">
        {closed ? (
          <span>O cadastro pelo site está fechado no momento. Fale com a gente.</span>
        ) : (
          <span>
            Ex.: o site ou o Instagram, o link do Google Maps, a foto do cardápio, o logo e o CNPJ.
          </span>
        )}
      </div>
    </div>
  );
}
