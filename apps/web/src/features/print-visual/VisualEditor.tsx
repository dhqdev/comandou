import {
  LAYOUT_BLOCKS,
  LAYOUT_CHARS,
  LAYOUT_OPT_LABELS,
  LAYOUT_PRESETS,
  layoutBlocksFor,
  layoutPreset,
  newLayoutBlock,
  parsePrintLines,
  PRINT_BIG_WIDTH,
  PRINT_WIDTH,
  type LayoutAlign,
  type LayoutBlock,
  type LayoutBlockType,
  type LayoutChar,
  type LayoutOpts,
  type LayoutPresetId,
  type PrintLayout,
  type PrintLine,
  type PrintTemplateKind,
} from '@comandou/shared';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bold,
  CalendarDays,
  Calculator,
  CaseUpper,
  ChefHat,
  Clock,
  Copy,
  Eye,
  EyeOff,
  FileText,
  GripVertical,
  Hash,
  IdCard,
  Image,
  List,
  MapPin,
  MapPinHouse,
  MessageSquareText,
  Minus,
  MousePointerClick,
  Phone,
  Plus,
  Printer,
  QrCode,
  Redo2,
  Smartphone,
  Space,
  Store,
  Trash2,
  Type,
  Undo2,
  User,
  Utensils,
  Wallet,
  X,
  CodeXml,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Alert, Button, Skeleton, Spinner } from '../../design-system';

type Kind = PrintTemplateKind;

export interface VisualPreview {
  text: string;
  logoUrl: string | null;
  /** Id do bloco de cada linha (quando a prévia veio com as marcas do editor). */
  owners?: (string | null)[];
}

const ICON: Record<LayoutBlockType, LucideIcon> = {
  logo: Image,
  loja_nome: Store,
  loja_endereco: MapPin,
  loja_telefone: Phone,
  texto: Type,
  separador: Minus,
  espaco: Space,
  qr: QrCode,
  numero: Hash,
  data: CalendarDays,
  hora: Clock,
  tipo: Utensils,
  setor: ChefHat,
  cliente: User,
  telefone: Smartphone,
  endereco: MapPinHouse,
  cpf: IdCard,
  impresso: Printer,
  nota: FileText,
  observacao: MessageSquareText,
  itens: List,
  totais: Calculator,
  pagamentos: Wallet,
};

const GROUPS: { id: 'loja' | 'pedido' | 'conta' | 'enfeite'; label: string }[] = [
  { id: 'enfeite', label: 'Texto e enfeites' },
  { id: 'loja', label: 'Loja' },
  { id: 'pedido', label: 'Pedido' },
  { id: 'conta', label: 'Conta' },
];

const CHAR_NAME: Record<LayoutChar, string> = {
  '-': 'Traço',
  '=': 'Duplo',
  '*': 'Estrelinha',
  '.': 'Pontinho',
  '~': 'Onda',
  _: 'Sublinhado',
  '#': 'Grade',
  '+': 'Mais',
};

/** Adicionar um título (texto em negrito, maiúsculo e no meio), além do texto comum. */
type AddId = LayoutBlockType | 'titulo';

function summary(b: LayoutBlock) {
  const info = LAYOUT_BLOCKS[b.type];
  if (b.type === 'separador') return `${CHAR_NAME[b.char]} ${b.char.repeat(6)}`;
  if (b.type === 'texto') return b.text.split('\n')[0] || 'Texto vazio';
  if (b.type === 'qr') return b.text && b.text !== 'https://' ? b.text : 'Falta o link';
  if (info.input === 'label') return b.text ? `${b.text} …` : 'Só o valor';
  return info.hint;
}

/** Estilo pronto desenhado em miniatura (só linhas, para dar a ideia). */
function PresetMini({ id }: { id: LayoutPresetId }) {
  return (
    <span className="pv-mini" data-preset={id} aria-hidden>
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * Editor visual do papel (pedido do David, 0.278: "tipo um Canva"). À esquerda os estilos
 * prontos e a lista de blocos (arrastar para mudar a ordem); no meio o papel de verdade, vindo da
 * prévia, onde tocar numa parte escolhe o bloco; em cima dele a barra de formatação (tamanho,
 * negrito, alinhamento, maiúsculas, linha); à direita os ajustes do bloco escolhido. Tudo vira o
 * mesmo Liquid do modo código (`compileLayout`).
 */
export function VisualEditor({
  kind,
  layout,
  preview,
  previewErr,
  busy,
  source,
  locked,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onChange,
}: {
  kind: Kind;
  layout: PrintLayout;
  preview: VisualPreview | undefined;
  previewErr?: string;
  busy: boolean;
  source: string;
  locked: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  /** `group`: mudanças seguidas com a mesma chave viram um passo só do Desfazer (digitação). */
  onChange(next: PrintLayout, group?: string): void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const textId = useId();
  const paperRef = useRef<HTMLDivElement>(null);

  const blocks = layout.blocks;
  const index = blocks.findIndex((b) => b.id === sel);
  const block = index >= 0 ? blocks[index] : null;
  const info = block ? LAYOUT_BLOCKS[block.type] : null;

  // O bloco escolhido sumiu (desfazer, estilo pronto): nada escolhido.
  useEffect(() => {
    if (sel && !blocks.some((b) => b.id === sel)) setSel(null);
  }, [blocks, sel]);

  // O bloco escolhido aparece no papel (rola até ele quando escolhido pela lista).
  useEffect(() => {
    if (!sel) return;
    const el = paperRef.current?.querySelector<HTMLElement>('[data-sel="true"]');
    el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [sel]);

  const set = (next: LayoutBlock[], group?: string) => onChange({ blocks: next }, group);
  const patch = (id: string, p: Partial<LayoutBlock>, group?: string) =>
    set(
      blocks.map((b) => (b.id === id ? { ...b, ...p } : b)),
      group,
    );
  const patchOpts = (id: string, o: Partial<LayoutOpts>) => {
    const b = blocks.find((x) => x.id === id);
    if (b) patch(id, { opts: { ...b.opts, ...o } });
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length || from === to) return;
    const next = [...blocks];
    const [b] = next.splice(from, 1);
    next.splice(to, 0, b!);
    set(next);
  };
  const remove = (i: number) => {
    const next = blocks.filter((_, j) => j !== i);
    set(next);
    setSel(next[Math.min(i, next.length - 1)]?.id ?? null);
  };
  const duplicate = (i: number) => {
    const src = blocks[i]!;
    const copy = { ...src, opts: { ...src.opts }, id: newLayoutBlock(src.type).id };
    const next = [...blocks];
    next.splice(i + 1, 0, copy);
    set(next);
    setSel(copy.id);
  };
  const add = (id: AddId) => {
    const b =
      id === 'titulo'
        ? newLayoutBlock('texto', { text: 'SEU TÍTULO', bold: true, align: 'centro', upper: true })
        : newLayoutBlock(id);
    const at = index >= 0 ? index + 1 : blocks.length;
    const next = [...blocks];
    next.splice(at, 0, b);
    set(next);
    setSel(b.id);
    setAdding(false);
  };

  // Linhas do papel agrupadas pelo bloco de onde vieram.
  const groups = useMemo(() => {
    if (!preview) return [];
    const lines = parsePrintLines(preview.text);
    const out: { owner: string | null; lines: PrintLine[]; start: number }[] = [];
    lines.forEach((l, i) => {
      const owner = preview.owners?.[i] ?? null;
      const last = out[out.length - 1];
      if (last && last.owner === owner) last.lines.push(l);
      else out.push({ owner, lines: [l], start: i });
    });
    return out;
  }, [preview]);
  const shown = useMemo(() => new Set(groups.map((g) => g.owner)), [groups]);
  const marked = !!preview?.owners;

  const onPaperKey = (e: KeyboardEvent<HTMLElement>, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSel(id);
    }
  };

  const charPicker = (b: LayoutBlock) => (
    <label className="pv-tool pv-tool--select">
      <span className="cm-sr-only">Desenho da linha</span>
      <select
        className="cm-input"
        value={b.char}
        disabled={locked}
        onChange={(e) => patch(b.id, { char: e.target.value as LayoutChar })}
      >
        {LAYOUT_CHARS.map((c) => (
          <option key={c} value={c}>
            {c.repeat(5)} {CHAR_NAME[c]}
          </option>
        ))}
      </select>
    </label>
  );

  const alignBtn = (b: LayoutBlock, a: LayoutAlign, Icon: LucideIcon, label: string) => (
    <button
      type="button"
      className="pv-tool"
      aria-pressed={b.align === a}
      aria-label={label}
      title={label}
      disabled={locked}
      onClick={() => patch(b.id, { align: a })}
    >
      <Icon size={16} aria-hidden />
    </button>
  );

  // Na comanda da cozinha os itens não têm preço nem cabeçalho (nem a linha dele).
  const kitchen = kind === 'kitchen_ticket';
  const opts = (info?.opts ?? []).filter(
    (o) => !(kitchen && block?.type === 'itens' && (o === 'header' || o === 'prices')),
  );
  const limit = block?.size === 'grande' ? PRINT_BIG_WIDTH : PRINT_WIDTH;
  const longest =
    block?.type === 'texto' ? Math.max(0, ...block.text.split('\n').map((l) => l.length)) : 0;

  return (
    <div
      className="pv"
      data-locked={locked || undefined}
      onKeyDown={(e) => {
        const t = e.target as HTMLElement;
        if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || locked) return;
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
      }}
    >
      <section className="pv-sec pv-top" aria-label="Estilos prontos">
        <h3 className="pv-sec__title">Estilos prontos</h3>
        <PresetGrid
          kind={kind}
          locked={locked}
          onPick={(l) => {
            onChange(l);
            setSel(null);
          }}
        />
      </section>
      <aside className="pv-left" aria-label="Partes do papel">
        <section className="pv-sec">
          <div className="pv-sec__head">
            <h3 className="pv-sec__title">Partes do papel</h3>
            <button
              type="button"
              className="pv-add-btn"
              aria-expanded={adding}
              disabled={locked}
              onClick={() => setAdding((v) => !v)}
            >
              {adding ? <X size={15} aria-hidden /> : <Plus size={15} aria-hidden />}
              {adding ? 'Fechar' : 'Adicionar'}
            </button>
          </div>
          {adding && (
            <div className="pv-add" role="group" aria-label="Adicionar ao papel">
              {GROUPS.map((g) => {
                const types: AddId[] = layoutBlocksFor(kind).filter(
                  (t) => LAYOUT_BLOCKS[t].group === g.id,
                );
                if (g.id === 'enfeite') types.unshift('titulo');
                if (!types.length) return null;
                return (
                  <div key={g.id} className="pv-add__group">
                    <span className="pv-add__title">{g.label}</span>
                    {types.map((t) => {
                      const Icon = t === 'titulo' ? Type : ICON[t];
                      return (
                        <button
                          key={t}
                          type="button"
                          className="pv-add__opt"
                          onClick={() => add(t)}
                        >
                          <Icon size={16} aria-hidden />
                          <span>
                            <strong>{t === 'titulo' ? 'Título' : LAYOUT_BLOCKS[t].label}</strong>
                            <small>
                              {t === 'titulo' ? 'Texto em negrito, no meio' : LAYOUT_BLOCKS[t].hint}
                            </small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
          <ol className="pv-list" aria-label="Partes do papel, em ordem">
            {blocks.map((b, i) => {
              const Icon = ICON[b.type];
              const absent = marked && !b.hidden && !shown.has(b.id);
              return (
                <li
                  key={b.id}
                  className="pv-row"
                  data-sel={b.id === sel || undefined}
                  data-hidden={b.hidden || undefined}
                  data-over={
                    drag && drag.over === i && drag.from !== i
                      ? drag.from < i
                        ? 'after'
                        : 'before'
                      : undefined
                  }
                  draggable={!locked}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(i));
                    setDrag({ from: i, over: i });
                  }}
                  onDragOver={(e) => {
                    if (!drag) return;
                    e.preventDefault();
                    if (drag.over !== i) setDrag({ ...drag, over: i });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (drag) move(drag.from, i);
                    setDrag(null);
                  }}
                  onDragEnd={() => setDrag(null)}
                >
                  <GripVertical size={15} className="pv-row__grip" aria-hidden />
                  <button
                    type="button"
                    className="pv-row__main"
                    aria-pressed={b.id === sel}
                    onClick={() => setSel(b.id === sel ? null : b.id)}
                  >
                    <Icon size={16} aria-hidden className="pv-row__icon" />
                    <span className="pv-row__text">
                      <strong>{LAYOUT_BLOCKS[b.type].label}</strong>
                      <small>
                        {b.hidden
                          ? 'Escondido: não sai no papel'
                          : absent
                            ? 'Não aparece neste pedido'
                            : summary(b)}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="pv-row__eye"
                    aria-label={
                      b.hidden
                        ? `Mostrar ${LAYOUT_BLOCKS[b.type].label}`
                        : `Esconder ${LAYOUT_BLOCKS[b.type].label}`
                    }
                    title={b.hidden ? 'Mostrar no papel' : 'Esconder do papel'}
                    disabled={locked}
                    onClick={() => patch(b.id, { hidden: !b.hidden })}
                  >
                    {b.hidden ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ol>
          {!blocks.length && (
            <p className="cm-hint">
              O papel está vazio. Escolha um estilo pronto ou adicione uma parte.
            </p>
          )}
        </section>
      </aside>

      <div className="pv-center">
        <div className="pv-bar" role="toolbar" aria-label="Formatar a parte escolhida">
          {block && info ? (
            <>
              <span className="pv-bar__name">
                {(() => {
                  const Icon = ICON[block.type];
                  return <Icon size={15} aria-hidden />;
                })()}
                {LAYOUT_BLOCKS[block.type].label}
              </span>
              {info.size && (
                <div className="pv-tools" role="group" aria-label="Tamanho da letra">
                  <button
                    type="button"
                    className="pv-tool pv-tool--text"
                    aria-pressed={block.size === 'normal'}
                    disabled={locked}
                    onClick={() => patch(block.id, { size: 'normal' })}
                    title="Letra normal: 42 por linha"
                  >
                    Normal
                  </button>
                  <button
                    type="button"
                    className="pv-tool pv-tool--text pv-tool--big"
                    aria-pressed={block.size === 'grande'}
                    disabled={locked}
                    onClick={() => patch(block.id, { size: 'grande' })}
                    title="Letra grande: 21 por linha, sempre em negrito"
                  >
                    Grande
                  </button>
                </div>
              )}
              {(info.bold || info.upper) && (
                <div className="pv-tools" role="group" aria-label="Estilo da letra">
                  {info.bold && (
                    <button
                      type="button"
                      className="pv-tool"
                      aria-pressed={block.bold || block.size === 'grande'}
                      aria-label="Negrito"
                      title={
                        block.size === 'grande' ? 'A letra grande já sai em negrito' : 'Negrito'
                      }
                      disabled={locked || block.size === 'grande'}
                      onClick={() => patch(block.id, { bold: !block.bold })}
                    >
                      <Bold size={16} aria-hidden />
                    </button>
                  )}
                  {info.upper && (
                    <button
                      type="button"
                      className="pv-tool"
                      aria-pressed={block.upper}
                      aria-label="Tudo maiúsculo"
                      title="Tudo maiúsculo"
                      disabled={locked}
                      onClick={() => patch(block.id, { upper: !block.upper })}
                    >
                      <CaseUpper size={17} aria-hidden />
                    </button>
                  )}
                </div>
              )}
              {info.align && (
                <div className="pv-tools" role="group" aria-label="Alinhamento">
                  {alignBtn(block, 'esquerda', AlignLeft, 'Alinhar à esquerda')}
                  {alignBtn(block, 'centro', AlignCenter, 'Centralizar')}
                  {alignBtn(block, 'direita', AlignRight, 'Alinhar à direita')}
                </div>
              )}
              {info.char && !(kitchen && block.type === 'itens') && charPicker(block)}
              <div className="pv-tools pv-tools--end" role="group" aria-label="Parte">
                <button
                  type="button"
                  className="pv-tool"
                  aria-label="Subir"
                  title="Subir"
                  disabled={locked || index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUp size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className="pv-tool"
                  aria-label="Descer"
                  title="Descer"
                  disabled={locked || index === blocks.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDown size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className="pv-tool"
                  aria-label="Duplicar"
                  title="Duplicar"
                  disabled={locked}
                  onClick={() => duplicate(index)}
                >
                  <Copy size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className="pv-tool pv-tool--danger"
                  aria-label="Tirar do papel"
                  title="Tirar do papel"
                  disabled={locked}
                  onClick={() => remove(index)}
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </div>
            </>
          ) : (
            <span className="pv-bar__hint">
              <MousePointerClick size={16} aria-hidden /> Toque numa parte do papel para mudar o
              tamanho, o negrito e o lugar dela.
            </span>
          )}
          <div className="pv-tools pv-tools--history" role="group" aria-label="Histórico">
            <button
              type="button"
              className="pv-tool"
              aria-label="Desfazer"
              title="Desfazer"
              disabled={locked || !canUndo}
              onClick={onUndo}
            >
              <Undo2 size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="pv-tool"
              aria-label="Refazer"
              title="Refazer"
              disabled={locked || !canRedo}
              onClick={onRedo}
            >
              <Redo2 size={16} aria-hidden />
            </button>
          </div>
        </div>

        <div className="pv-stage">
          <div className="print-tpl__src">
            <span className="cm-hint">{preview ? source : 'Montando a prévia…'}</span>
            {(busy || locked) && <Spinner inline label="Atualizando a prévia" />}
          </div>
          {previewErr && <Alert tone="danger">{previewErr}</Alert>}
          {preview ? (
            <div
              ref={paperRef}
              className={`pv-paper print-tpl__paper paper-text${previewErr ? ' is-stale' : ''}`}
              role="group"
              aria-label="Prévia do modelo"
              onClick={(e) => {
                if (e.target === e.currentTarget) setSel(null);
              }}
            >
              {groups.map((g) => {
                const b = g.owner !== null ? blocks.find((x) => x.id === g.owner) : undefined;
                const lines = g.lines.map((l, j) => (
                  <PaperLine key={j} line={l} logoUrl={preview.logoUrl} />
                ));
                if (!b)
                  return (
                    <div key={`f${g.start}`} className="pv-blk is-free">
                      {lines}
                    </div>
                  );
                return (
                  <div
                    key={`b${g.start}`}
                    className="pv-blk"
                    role="button"
                    tabIndex={0}
                    data-sel={b.id === sel}
                    aria-pressed={b.id === sel}
                    aria-label={LAYOUT_BLOCKS[b.type].label}
                    data-label={LAYOUT_BLOCKS[b.type].label}
                    onClick={() => setSel(b.id)}
                    onKeyDown={(e) => onPaperKey(e, b.id)}
                  >
                    {lines}
                  </div>
                );
              })}
            </div>
          ) : previewErr ? null : (
            <Skeleton variant="list" rows={8} label="Montando a prévia" />
          )}
        </div>
      </div>

      <aside className="pv-right" aria-label="Ajustes da parte escolhida">
        {block && info ? (
          <>
            <div className="pv-right__head">
              <strong>{info.label}</strong>
              <span className="cm-hint">{info.hint}</span>
            </div>
            {info.input === 'text' && (
              <div className="cm-field">
                <label className="cm-label" htmlFor={textId}>
                  Texto
                </label>
                <textarea
                  id={textId}
                  className="cm-input pv-textarea"
                  rows={3}
                  maxLength={240}
                  value={block.text}
                  disabled={locked}
                  onChange={(e) => patch(block.id, { text: e.target.value }, `t${block.id}`)}
                />
                <span className="cm-hint" data-over={longest > limit || undefined}>
                  {longest > limit
                    ? `Passa de ${limit} letras: quebra para a linha de baixo.`
                    : `Cabem ${limit} letras por linha${block.size === 'grande' ? ' na letra grande' : ''}. Enter pula linha.`}
                </span>
              </div>
            )}
            {info.input === 'label' && (
              <div className="cm-field">
                <label className="cm-label" htmlFor={textId}>
                  Rótulo
                </label>
                <input
                  id={textId}
                  className="cm-input"
                  maxLength={20}
                  value={block.text}
                  disabled={locked}
                  placeholder="Sem rótulo"
                  onChange={(e) => patch(block.id, { text: e.target.value }, `t${block.id}`)}
                />
                <span className="cm-hint">
                  O que vem antes do dado ("DATA:"). Vazio, sai só o dado.
                </span>
              </div>
            )}
            {info.input === 'link' && (
              <div className="cm-field">
                <label className="cm-label" htmlFor={textId}>
                  Link do QR Code
                </label>
                <input
                  id={textId}
                  className="cm-input"
                  inputMode="url"
                  maxLength={240}
                  value={block.text}
                  disabled={locked}
                  placeholder="https://instagram.com/sualoja"
                  onChange={(e) => patch(block.id, { text: e.target.value }, `t${block.id}`)}
                />
                <span className="cm-hint">
                  Instagram, avaliação no Google, cardápio online… Quem aponta a câmera abre o link.
                </span>
              </div>
            )}
            {opts.length ? (
              <div className="pv-opts">
                {opts.map((o) => (
                  <label key={o} className="pv-opt">
                    <span>{LAYOUT_OPT_LABELS[o]}</span>
                    <span className="pv-switch">
                      <input
                        type="checkbox"
                        checked={!!block.opts[o]}
                        disabled={locked}
                        onChange={(e) => patchOpts(block.id, { [o]: e.target.checked })}
                      />
                      <span className="pv-switch__track" />
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
            {block.type === 'logo' && (
              <p className="cm-hint">
                É a logo da Loja online. Ela sai sempre no meio, do tamanho que cabe na bobina:
                arraste esta parte (ou use as setas) para pôr a logo no topo, no fim ou onde quiser.
              </p>
            )}
            {block.type === 'itens' && block.size === 'grande' && (
              <p className="cm-hint">
                Na letra grande cabem 21 letras por linha: nome comprido quebra em duas.
              </p>
            )}
          </>
        ) : (
          <div className="pv-right__empty">
            <strong>Como funciona</strong>
            <ul>
              <li>Toque numa parte do papel ou da lista para escolher.</li>
              <li>Mude tamanho, negrito, maiúsculas e alinhamento na barra de cima.</li>
              <li>Arraste na lista para mudar a ordem; o olho esconde sem apagar.</li>
              <li>Nada vale na impressora até você salvar.</li>
            </ul>
          </div>
        )}
        <p className="pv-limits cm-hint">
          A impressora térmica tem uma letra só. O que muda é o tamanho (normal: 42 letras por
          linha; grande: 21, em negrito), o negrito, as maiúsculas e o alinhamento.
        </p>
      </aside>
    </div>
  );
}

/** Uma linha do papel, igual ao `PaperText` (negrito, letra grande, logo, QR Code). */
function PaperLine({ line: l, logoUrl }: { line: PrintLine; logoUrl: string | null }) {
  if (l.kind === 'logo')
    return (
      <span className="paper-text__logo pv-line">
        {logoUrl ? <img src={logoUrl} alt="Logo do restaurante" /> : <span>LOGO</span>}
      </span>
    );
  if (l.kind === 'qr')
    return (
      <span className="pv-line pv-qr">
        <QrCode size={44} aria-hidden strokeWidth={1.5} />
        <small>{l.data}</small>
      </span>
    );
  if (l.kind === 'bold') return <b className="pv-line">{l.text || ' '}</b>;
  if (l.kind === 'big') return <b className="pv-line paper-text__big">{l.text || ' '}</b>;
  return <span className="pv-line">{l.text || ' '}</span>;
}

/** Os quatro estilos prontos (no começo do editor e na entrada de um modelo feito no código). */
function PresetGrid({
  kind,
  locked,
  onPick,
}: {
  kind: Kind;
  locked: boolean;
  onPick(l: PrintLayout): void;
}) {
  return (
    <div className="pv-presets">
      {LAYOUT_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          className="pv-preset"
          disabled={locked}
          onClick={() => onPick(layoutPreset(kind, p.id))}
        >
          <PresetMini id={p.id} />
          <span className="pv-preset__text">
            <strong>{p.name}</strong>
            <span>{p.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Modelo que não é do editor visual (escrito no código, ou mudado no código/pela IA depois do
 * visual): mostra o papel como está e oferece começar de um estilo pronto ou voltar aos blocos.
 */
export function VisualStart({
  kind,
  stale,
  locked,
  paper,
  source,
  onLayout,
  onCode,
}: {
  kind: Kind;
  stale: PrintLayout | null;
  locked: boolean;
  paper: ReactNode;
  source: string;
  onLayout(l: PrintLayout): void;
  onCode(): void;
}) {
  return (
    <div className="pv-start">
      <div className="pv-start__main">
        <Alert tone="info">
          {stale
            ? 'Este papel foi montado no visual e depois mudou no código (ou pela IA). O papel ao lado é como ele sai hoje.'
            : 'Este papel foi escrito no código. O papel ao lado é como ele sai hoje.'}{' '}
          Para editar no visual, comece de um estilo pronto
          {stale ? ' ou volte aos blocos de antes' : ''}: dá para desfazer, e nada muda na
          impressora até você salvar.
        </Alert>
        {stale && (
          <div className="pv-start__row">
            <Button
              variant="secondary"
              icon={<RotateCcw size={16} />}
              disabled={locked}
              onClick={() => onLayout(stale)}
            >
              Voltar aos blocos do visual
            </Button>
          </div>
        )}
        <section className="pv-sec">
          <h3 className="pv-sec__title">Começar de um estilo pronto</h3>
          <PresetGrid kind={kind} locked={locked} onPick={onLayout} />
        </section>
        <div className="pv-start__row">
          <Button variant="ghost" icon={<CodeXml size={16} />} onClick={onCode}>
            Continuar no código
          </Button>
        </div>
      </div>
      <div className="pv-stage">
        <div className="print-tpl__src">
          <span className="cm-hint">{source}</span>
        </div>
        {paper}
      </div>
    </div>
  );
}
