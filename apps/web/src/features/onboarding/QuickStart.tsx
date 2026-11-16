import {
  ArrowLeft,
  Camera,
  Check,
  FileUp,
  Images,
  Link2,
  PencilLine,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { Alert, Button, Spinner, TextField } from '../../design-system';
import {
  importStatus,
  readyDrafts,
  WHY_OFF,
  type DraftItem,
  type ImportStatus,
} from '../menu-import/menu-import';
import { DraftList } from '../menu-import/MenuImport';
import '../menu-import/menu-import.css';
import {
  aiPhoto,
  applyAll,
  hoursLabel,
  imageColors,
  readFile,
  readLink,
  readSiteDraft,
  readText,
  squareIcon,
  storeDraft,
  trialAuto,
  TRIAL_IMPORT_KEY,
  TRIAL_SITE_KEY,
  type ApplyResult,
  type Reading,
  type Signup,
  type StoreDraft,
} from './quick-start';
import './quick-start.css';

/**
 * Primeiros passos pelo cardápio: a pessoa joga o cardápio (fotos, PDF ou link) e a IA lê tudo
 * (itens, preços, fotos, logo, cores, ícone do site, contato, endereço, horário). Na tela
 * seguinte ela confere tudo e aplica. Nada entra na loja sem passar pela conferência. Voltar
 * nunca apaga o que já foi lido ou corrigido.
 */

type Stage =
  | { at: 'pick' }
  | { at: 'reading'; label: string; page?: number; pages?: number }
  | { at: 'review' }
  | { at: 'applying'; label: string; done?: number; total?: number }
  | { at: 'done'; result: ApplyResult };

/** Fotos e PDF entram; o resto (planilha, texto) a IA não lê por aqui. */
const readable = (f: File) =>
  f.type.startsWith('image/') ||
  f.type === 'application/pdf' ||
  f.name.toLowerCase().endsWith('.pdf');
const looksLikeLink = (t: string) => /^(https?:\/\/|www\.)\S+$/i.test(t.trim());

const READ_TIPS = [
  'Lendo os itens e os preços',
  'Separando as categorias',
  'Procurando o logo e as cores da marca',
  'Pegando contato, endereço e horário',
  'Preparando as fotos dos itens',
];
/** Fotos pela IA por vez (cada uma leva alguns segundos e gasta do limite). */
const AI_PHOTO_MAX = 40;

export function QuickStart({
  signup,
  active = true,
  onReview,
  onDone,
  onBack,
  backRef,
  onBusy,
}: {
  signup: Signup | null;
  /** Na tela agora (a conversa guarda o cartão escondido quando a pessoa volta ou segue). */
  active?: boolean;
  /** Abriu (ou saiu da) conferência: a conversa para de rolar sozinha para o fim. */
  onReview?: (on: boolean) => void;
  onDone: (r: ApplyResult) => void;
  /** Voltar daqui de dentro já no começo: volta para a pergunta anterior da conversa. */
  onBack: () => void;
  /** O "Voltar" do topo da conversa chama este (conferência → envio → pergunta anterior). */
  backRef?: MutableRefObject<(() => void) | null>;
  /** Lendo ou salvando: o "Voltar" fica parado até terminar. */
  onBusy?: (busy: boolean) => void;
}) {
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [stage, setStage] = useState<Stage>({ at: 'pick' });
  const [link, setLink] = useState('');
  const [typed, setTyped] = useState('');
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [store, setStore] = useState<StoreDraft | null>(null);
  const [sources, setSources] = useState<File[]>([]);
  const [tip, setTip] = useState(0);
  const [photos, setPhotos] = useState<{ done: number; total: number } | null>(null);
  const [over, setOver] = useState(false);
  const stopPhotos = useRef(false);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    importStatus().then(setStatus, () =>
      setStatus({ enabled: false, reason: 'platform', assistantName: 'Comandou' }),
    );
  }, []);

  // Enquanto a IA lê, a frase de baixo vai mudando (a leitura leva de 10 a 40 segundos).
  useEffect(() => {
    if (stage.at !== 'reading') return;
    setTip(0);
    const t = window.setInterval(() => setTip((n) => Math.min(n + 1, READ_TIPS.length - 1)), 4000);
    return () => window.clearInterval(t);
  }, [stage.at]);

  useEffect(() => () => void (stopPhotos.current = true), []);

  // Teste criado pelo site: a pessoa já disse de onde vem o cardápio (site, Google Maps ou os
  // itens escritos). A leitura começa sozinha, uma única vez neste navegador.
  const auto = useRef(false);
  useEffect(() => {
    const t = signup?.trial;
    if (auto.current || !status || !t) return;
    const what = trialAuto(signup, status.enabled);
    if (!what) return;
    auto.current = true;
    try {
      localStorage.setItem(what === 'site' ? TRIAL_SITE_KEY : TRIAL_IMPORT_KEY, '1');
    } catch {
      /* navegação privada: abre mesmo assim */
    }
    // A IA já montou o site no comandou.com: a conferência abre com ele, sem ler de novo.
    if (what === 'site') {
      setStage({ at: 'reading', label: 'Abrindo o site que a IA montou' });
      readSiteDraft(null)
        .then((r) => (r ? finishReading(r, []) : setStage({ at: 'pick' })))
        .catch((e: Error) => {
          setError(e.message);
          setStage({ at: 'pick' });
        });
      return;
    }
    // Os itens escritos no site são lidos mesmo sem IA (linha por linha).
    if (what === 'text') {
      setTyped(t.sourceValue);
      void fromText(t.sourceValue);
    } else {
      setLink(t.sourceValue);
      void fromLink(t.sourceValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, signup]);

  // Conferência aberta: mostra do começo (a loja), não do fim da lista.
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const on = active && stage.at === 'review';
    onReview?.(on);
    if (on)
      root.current?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
  }, [stage.at, active, onReview]);

  const busy = stage.at === 'reading' || stage.at === 'applying';
  useEffect(() => onBusy?.(busy), [busy, onBusy]);

  const finishReading = async (r: Reading, files: File[]) => {
    if (!r.drafts.length && !r.store.address && !r.store.whatsapp && !r.store.logoUrl) {
      setError('Não encontrei o cardápio. Tente uma foto mais nítida, de perto, ou outro link.');
      setStage({ at: reading ? 'review' : 'pick' });
      return;
    }
    setStage({ at: 'reading', label: 'Preparando o logo, as cores e as fotos' });
    const d = await storeDraft(r.store, files, signup);
    setReading(r);
    setDrafts(r.drafts);
    setStore((cur) => (cur ? keepEdited(cur, d) : d));
    setStage({ at: 'review' });
  };

  const fromText = async (given?: string) => {
    const text = (given ?? typed).trim();
    if (text.length < 10) return;
    setError(null);
    setStage({ at: 'reading', label: 'Lendo os itens que você escreveu' });
    try {
      const r = await readText(text, reading ? { ...reading, drafts } : null);
      await finishReading(r, sources);
    } catch (e) {
      setError((e as Error).message);
      setWriting(true);
      setStage({ at: reading ? 'review' : 'pick' });
    }
  };

  const fromLink = async (given?: string) => {
    const url = (given ?? link).trim();
    if (!url) return;
    setError(null);
    setStage({ at: 'reading', label: 'Abrindo o link' });
    try {
      const r = await readLink(url, reading ? { ...reading, drafts } : null);
      await finishReading(r, sources);
    } catch (e) {
      setError((e as Error).message);
      setStage({ at: reading ? 'review' : 'pick' });
    }
  };

  const fromFiles = async (list: FileList | File[] | null) => {
    const all0 = [...(list ?? [])];
    const files = all0.filter(readable).slice(0, 12);
    if (!files.length) {
      if (all0.length) setError('Mande fotos (JPG, PNG, WebP) ou o PDF do cardápio.');
      return;
    }
    setError(null);
    let r: Reading | null = reading ? { ...reading, drafts } : null;
    const failed: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setStage({
        at: 'reading',
        label: files.length > 1 ? `Lendo a página ${i + 1} de ${files.length}` : 'Lendo o cardápio',
        page: i + 1,
        pages: files.length,
      });
      try {
        r = await readFile(files[i]!, r);
      } catch (e) {
        failed.push(`${files[i]!.name}: ${(e as Error).message}`);
        // Sem IA ligada ou sem limite, as outras páginas também falhariam.
        if ((e as { status?: number }).status === 429 || (e as { status?: number }).status === 503)
          break;
      }
    }
    const all = [...sources, ...files.filter((f) => f.type.startsWith('image/'))];
    setSources(all);
    if (failed.length) setError(failed.join(' · '));
    if (r) await finishReading(r, all);
    else setStage({ at: reading ? 'review' : 'pick' });
  };

  /** Mandar outro cardápio do zero (o que foi lido some; nada tinha entrado na loja). */
  const restart = () => {
    setReading(null);
    setDrafts([]);
    setStore(null);
    setSources([]);
    setError(null);
  };

  // Voltar: da conferência para o envio (tudo guardado); do envio para a conversa.
  const back = () => {
    if (busy) return;
    stopPhotos.current = true;
    setError(null);
    if (stage.at === 'review') setStage({ at: 'pick' });
    else onBack();
  };
  if (backRef) backRef.current = active ? back : null;

  // Jogar o cardápio em qualquer lugar da tela (ou colar um print): lê na hora.
  const take = useRef<(files: File[], text: string) => void>(() => undefined);
  take.current = (files, text) => {
    if (files.length) void fromFiles(files);
    else if (looksLikeLink(text)) {
      setLink(text.trim());
      void fromLink(text.trim());
    }
  };
  const dropping = active && stage.at === 'pick' && !!status?.enabled;
  useEffect(() => {
    if (!dropping) return;
    const isField = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName));
    const onOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setOver(true);
    };
    const onLeave = (e: DragEvent) => !e.relatedTarget && setOver(false);
    const onDrop = (e: DragEvent) => {
      setOver(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      const text =
        e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text') || '';
      if (!files.length && (isField(e.target) || !looksLikeLink(text))) return;
      e.preventDefault();
      take.current(files, text);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isField(e.target)) return;
      const files = [...(e.clipboardData?.files ?? [])];
      const text = e.clipboardData?.getData('text') ?? '';
      if (!files.length && !looksLikeLink(text)) return;
      e.preventDefault();
      take.current(files, text);
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      setOver(false);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, [dropping]);

  // Ícone do site (favicon) que vai para a aba do navegador e o app: mostrado na conferência.
  const favicon = store?.favicon ?? null;
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!favicon) return setFaviconUrl(null);
    const url = URL.createObjectURL(favicon);
    setFaviconUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [favicon]);

  const changeLogo = async (f: File | undefined) => {
    if (!f || !store) return;
    const [a, b] = await imageColors(f).catch(() => [] as string[]);
    const icon = await squareIcon(f).catch(() => null);
    setStore({
      ...store,
      logo: f,
      logoPreview: URL.createObjectURL(f),
      favicon: icon ?? store.favicon,
      brandColor: a ?? store.brandColor,
      accentColor: b ?? store.accentColor,
      brandStaff: store.brandStaff || !!a,
    });
  };

  const noPhoto = drafts.filter((d) => d.on && !d.thumb);
  const makePhotos = async () => {
    const list = noPhoto.slice(0, AI_PHOTO_MAX);
    stopPhotos.current = false;
    setError(null);
    setPhotos({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      if (stopPhotos.current) break;
      const d = list[i]!;
      try {
        const f = await aiPhoto(d);
        const thumb = URL.createObjectURL(f);
        setDrafts((cur) => cur.map((x) => (x.key === d.key ? { ...x, photo: f, thumb } : x)));
      } catch (e) {
        setError((e as Error).message);
        const st = (e as { status?: number }).status;
        if (st === 429 || st === 503 || st === 0) break;
      }
      setPhotos({ done: i + 1, total: list.length });
    }
    setPhotos(null);
  };

  const apply = async () => {
    if (!store) return;
    stopPhotos.current = true;
    setError(null);
    setStage({ at: 'applying', label: 'Começando' });
    try {
      const r = await applyAll(store, drafts, (label, done, total) =>
        setStage({ at: 'applying', label, done, total }),
      );
      // Já está na loja: voltar até aqui mostra o resumo (aplicar de novo duplicaria os itens).
      setStage({ at: 'done', result: r });
      onDone(r);
    } catch (e) {
      setError((e as Error).message);
      setStage({ at: 'review' });
    }
  };

  if (!status) return <Spinner inline label="Carregando" />;
  const aiOn = status.enabled;

  // Voltou da conferência: o que já foi lido continua guardado.
  const resume = (
    <div className="qs-resume">
      <span>
        {drafts.length === 1 ? '1 item já lido' : `${drafts.length} itens já lidos`} e guardados. O
        que você mandar agora soma ao que já li.
      </span>
      <div className="qs-resume__btns">
        <Button size="sm" variant="secondary" onClick={() => setStage({ at: 'review' })}>
          Ir para a conferência
        </Button>
        <Button size="sm" variant="ghost" onClick={restart}>
          Começar de novo
        </Button>
      </div>
    </div>
  );

  const textForm = (
    <form
      className="qs-link"
      onSubmit={(e) => {
        e.preventDefault();
        void fromText();
      }}
    >
      <label className="cm-label" htmlFor="qs-text">
        Escreva os itens
      </label>
      <textarea
        id="qs-text"
        className="cm-input qs-text"
        rows={6}
        maxLength={6000}
        placeholder={'Lanches\nX-Burger 28,90\nX-Salada 32,00\n\nBebidas\nRefrigerante lata 7,00'}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      <span className="cm-hint">
        Um item por linha, com o preço no fim. Uma linha sem preço antes dos itens vira categoria.
      </span>
      <div className="qs-foot">
        <Button type="submit" disabled={typed.trim().length < 10}>
          Ler itens
        </Button>
      </div>
    </form>
  );

  // Sem IA (desligada ou sem limite): escrever os itens continua funcionando, sem IA.
  if (!aiOn && stage.at === 'pick')
    return (
      <div className="qs">
        {error && <Alert tone="danger">{error}</Alert>}
        {status.reason && status.reason !== 'platform' && (
          <Alert tone="warning">{WHY_OFF[status.reason]}</Alert>
        )}
        {reading && resume}
        {textForm}
      </div>
    );

  const fileInputs = (
    <>
      <input
        ref={camera}
        type="file"
        hidden
        accept="image/*"
        capture="environment"
        aria-label="Tirar foto do cardápio"
        onChange={(e) => {
          const f = e.target.files;
          void fromFiles(f).finally(() => (e.target.value = ''));
        }}
      />
      <input
        ref={gallery}
        type="file"
        hidden
        multiple
        accept="image/*,application/pdf"
        aria-label="Escolher fotos ou PDF do cardápio"
        onChange={(e) => {
          const f = e.target.files;
          void fromFiles(f).finally(() => (e.target.value = ''));
        }}
      />
    </>
  );

  if (stage.at === 'pick')
    return (
      <div className="qs">
        {error && <Alert tone="danger">{error}</Alert>}
        {reading && resume}
        <div
          className="qs-drop"
          data-over={over || undefined}
          onClick={(e) => !(e.target as HTMLElement).closest('button') && gallery.current?.click()}
        >
          <FileUp size={28} aria-hidden className="qs-drop__icon" />
          <strong>{over ? 'Pode soltar' : 'Jogue o cardápio aqui'}</strong>
          <span className="qs-drop__hint">
            Arraste as fotos ou o PDF para cá, ou cole um print. Pode mandar várias páginas de uma
            vez.
          </span>
          <div className="qs-drop__btns">
            <Button icon={<Images size={16} />} onClick={() => gallery.current?.click()}>
              Escolher arquivos
            </Button>
            <Button
              variant="secondary"
              className="qs-drop__camera"
              icon={<Camera size={16} />}
              onClick={() => camera.current?.click()}
            >
              Tirar foto
            </Button>
          </div>
        </div>
        {fileInputs}
        <div className="qs-or" aria-hidden>
          <span>ou</span>
        </div>
        <form
          className="qs-link"
          onSubmit={(e) => {
            e.preventDefault();
            void fromLink();
          }}
        >
          <label className="cm-label" htmlFor="qs-link">
            Link do cardápio
          </label>
          <div className="qs-link__row">
            <span className="qs-link__field">
              <Link2 size={16} aria-hidden />
              <input
                id="qs-link"
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="seurestaurante.com.br/cardapio"
                value={link}
                maxLength={2000}
                onChange={(e) => setLink(e.target.value)}
              />
            </span>
            <Button type="submit" variant="secondary" disabled={!link.trim()}>
              Ler cardápio
            </Button>
          </div>
          <span className="cm-hint">
            Pode ser o seu site, o cardápio digital ou a página da loja no app de delivery.
          </span>
        </form>
        {writing ? (
          textForm
        ) : (
          <button type="button" className="qs-skip" onClick={() => setWriting(true)}>
            <PencilLine size={14} aria-hidden /> Prefiro escrever os itens
          </button>
        )}
        <p className="qs-note">
          <Sparkles size={14} aria-hidden /> A IA lê os itens, os preços e as fotos, e pega o logo,
          as cores, o ícone do site, o contato, o endereço e o horário. Você confere tudo na próxima
          tela, antes de entrar na loja.
        </p>
      </div>
    );

  if (stage.at === 'reading')
    return (
      <div className="qs">
        <div className="qs-wait" role="status">
          <Sparkles size={18} aria-hidden className="qs-wait__spark" />
          <div>
            <strong>{stage.label}</strong>
            <span key={tip} className="qs-wait__tip">
              {READ_TIPS[tip]}
            </span>
            {stage.pages && stage.pages > 1 && (
              <progress max={stage.pages} value={(stage.page ?? 1) - 1} />
            )}
          </div>
        </div>
      </div>
    );

  if (stage.at === 'applying')
    return (
      <div className="qs">
        <div className="qs-wait" role="status">
          <Spinner inline label="Salvando" />
          <div>
            <strong>
              {stage.label}
              {stage.total ? ` (${stage.done ?? 0} de ${stage.total})` : ''}
            </strong>
            {stage.total ? <progress max={stage.total} value={stage.done ?? 0} /> : null}
          </div>
        </div>
      </div>
    );

  if (stage.at === 'done') {
    const r = stage.result;
    const got = [
      r.created && (r.created === 1 ? '1 item' : `${r.created} itens`),
      r.saved.identity && 'logo e cores',
      r.saved.whatsapp && 'WhatsApp',
      r.saved.address && 'endereço',
    ].filter(Boolean) as string[];
    return (
      <div className="qs">
        <div className="qs-done" role="status">
          <Check size={18} aria-hidden className="qs-done__icon" />
          <div>
            <strong>Cardápio aplicado</strong>
            <span>
              {got.length ? `Já está na loja: ${got.join(', ')}. ` : ''}
              Para mudar alguma coisa, use Cardápio e Loja online.
            </span>
          </div>
        </div>
        <div className="qs-foot">
          <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={back}>
            Voltar
          </Button>
          <Button onClick={() => onDone(r)}>Continuar</Button>
        </div>
      </div>
    );
  }

  // Conferência: a loja em cima, os itens embaixo, um botão para aplicar tudo.
  const s = store!;
  const set = (p: Partial<StoreDraft>) => setStore({ ...s, ...p });
  const ready = readyDrafts(drafts).length;
  const hours = hoursLabel(s.hours);

  return (
    <div ref={root} className="qs qs--review">
      <header className="qs-head">
        <strong>Confira antes de aplicar</strong>
        <span>
          Foi isso que eu li do seu cardápio. Corrija o que precisar: nada entra na loja antes de
          você aplicar.
        </span>
      </header>
      {error && <Alert tone="warning">{error}</Alert>}
      {reading?.partial && (
        <Alert tone="warning">
          O cardápio é grande e li só até onde deu. Confira o fim da lista e mande o resto em
          &quot;Outra página&quot;.
        </Alert>
      )}

      <section className="qs-sec" aria-labelledby="qs-store">
        <h3 id="qs-store" className="qs-sec__title">
          Sua loja
        </h3>
        <div className="qs-brand">
          <button
            type="button"
            className="qs-logo"
            onClick={() => logoInput.current?.click()}
            aria-label={s.logo ? 'Trocar o logo' : 'Colocar o logo'}
          >
            {s.logoPreview ? <img src={s.logoPreview} alt="" /> : <Upload size={18} aria-hidden />}
          </button>
          <input
            ref={logoInput}
            type="file"
            hidden
            accept="image/*"
            aria-label="Logo da loja"
            onChange={(e) => {
              void changeLogo(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <div className="qs-brand__colors">
            <span className="qs-brand__label">
              {s.logo ? 'Logo e cores da marca' : 'Sem logo: toque para colocar'}
            </span>
            <div className="qs-swatches">
              {(['brandColor', 'accentColor'] as const).map((k) => (
                <label key={k} className="qs-swatch">
                  <input
                    type="color"
                    value={s[k] ?? (k === 'brandColor' ? '#e23a00' : '#f2b705')}
                    aria-label={k === 'brandColor' ? 'Cor principal' : 'Cor de destaque'}
                    onChange={(e) => set({ [k]: e.target.value })}
                  />
                  <span>
                    {k === 'brandColor' ? 'Principal' : 'Destaque'}
                    <small>{s[k] ?? 'padrão'}</small>
                  </span>
                </label>
              ))}
            </div>
            {s.brandColor && (
              <label className="qs-check">
                <input
                  type="checkbox"
                  checked={s.brandStaff}
                  onChange={(e) => set({ brandStaff: e.target.checked })}
                />
                Usar as cores também no sistema da equipe
              </label>
            )}
            {faviconUrl && (
              <span className="qs-fav">
                <img src={faviconUrl} alt="" />
                Ícone do site (aba do navegador e app)
              </span>
            )}
          </div>
        </div>
        {s.coverPreview && (
          <div className="qs-cover">
            <img src={s.coverPreview} alt="Capa da loja online" />
            <button
              type="button"
              className="qs-cover__x"
              onClick={() => set({ cover: null, coverPreview: null })}
            >
              Tirar a capa
            </button>
          </div>
        )}
        <div className="cm-form qs-form">
          <TextField
            label="WhatsApp da loja"
            type="tel"
            inputMode="tel"
            value={s.whatsapp}
            placeholder="(11) 99999-9999"
            onChange={(e) => set({ whatsapp: e.target.value })}
          />
          <TextField
            label="Endereço"
            value={s.address}
            placeholder="Rua, número e bairro"
            wrapClass="cm-form__wide"
            maxLength={300}
            onChange={(e) => set({ address: e.target.value })}
          />
          <TextField
            label="Cidade"
            value={s.city}
            maxLength={80}
            onChange={(e) => set({ city: e.target.value })}
          />
          <TextField
            label="UF"
            value={s.state}
            maxLength={2}
            onChange={(e) => set({ state: e.target.value.toUpperCase() })}
          />
          <TextField
            label="Sobre a loja"
            value={s.about}
            placeholder="Uma frase que aparece no topo do cardápio"
            wrapClass="cm-form__wide"
            maxLength={500}
            onChange={(e) => set({ about: e.target.value })}
          />
        </div>
        <div className="qs-hours">
          <span className="cm-label">Horário</span>
          {hours ? (
            <>
              <span className="qs-hours__text">{hours}</span>
              <label className="qs-check">
                <input
                  type="checkbox"
                  checked={s.useHours}
                  onChange={(e) => set({ useHours: e.target.checked })}
                />
                Abrir e fechar a loja sozinha nesse horário
              </label>
            </>
          ) : (
            <span className="cm-hint">Não achei o horário. Você coloca depois em Ajustes.</span>
          )}
        </div>
      </section>

      <section className="qs-sec" aria-labelledby="qs-menu">
        <div className="qs-sec__head">
          <h3 id="qs-menu" className="qs-sec__title">
            Cardápio <span className="qs-count">{drafts.length}</span>
          </h3>
          {aiOn && noPhoto.length > 0 && !photos && (
            <Button
              size="sm"
              variant="secondary"
              icon={<Sparkles size={14} />}
              onClick={() => void makePhotos()}
            >
              {`Criar ${Math.min(noPhoto.length, AI_PHOTO_MAX)} ${noPhoto.length === 1 ? 'foto' : 'fotos'} com IA`}
            </Button>
          )}
          {photos && (
            <Button size="sm" variant="ghost" onClick={() => (stopPhotos.current = true)}>
              Parar ({photos.done} de {photos.total})
            </Button>
          )}
        </div>
        {drafts.length ? (
          <>
            <p className="mi-lead">
              Confira e corrija o que precisar. Desmarque o que não quer cadastrar.
              {drafts.some((d) => !d.price) && ' Item sem preço só entra depois que você digitar.'}
            </p>
            <DraftList drafts={drafts} setDrafts={setDrafts} />
          </>
        ) : (
          <p className="mi-lead">
            {aiOn
              ? 'Não achei itens. Mande fotos do cardápio em “Outra página” ou cadastre depois em Cardápio.'
              : 'Sem itens por enquanto. Você cadastra depois em Cardápio › Itens.'}
          </p>
        )}
      </section>

      {fileInputs}
      <div className="qs-foot">
        <Button
          variant="ghost"
          className="qs-foot__back"
          icon={<ArrowLeft size={16} />}
          disabled={!!photos}
          onClick={back}
        >
          Voltar
        </Button>
        {aiOn && (
          <Button
            variant="secondary"
            icon={<Images size={16} />}
            onClick={() => gallery.current?.click()}
          >
            Outra página
          </Button>
        )}
        <Button disabled={!!photos} onClick={() => void apply()}>
          {ready ? `Aplicar tudo (${ready} ${ready === 1 ? 'item' : 'itens'})` : 'Aplicar a loja'}
        </Button>
      </div>
    </div>
  );
}

/** Leu outra página depois de editar: o que a pessoa já mudou fica; o que estava vazio completa. */
function keepEdited(cur: StoreDraft, next: StoreDraft): StoreDraft {
  return {
    ...cur,
    about: cur.about || next.about,
    whatsapp: cur.whatsapp || next.whatsapp,
    address: cur.address || next.address,
    city: cur.city || next.city,
    state: cur.state || next.state,
    hours: cur.hours.length ? cur.hours : next.hours,
    useHours: cur.hours.length ? cur.useHours : next.useHours,
    brandColor: cur.brandColor ?? next.brandColor,
    accentColor: cur.accentColor ?? next.accentColor,
    brandStaff: cur.brandColor ? cur.brandStaff : next.brandStaff,
    logo: cur.logo ?? next.logo,
    logoPreview: cur.logoPreview ?? next.logoPreview,
    cover: cur.cover ?? next.cover,
    coverPreview: cur.coverPreview ?? next.coverPreview,
    favicon: cur.favicon ?? next.favicon,
  };
}
