import { Camera, FileText, Images, RotateCcw, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Spinner } from '../../design-system';
import {
  analyzeMenuFile,
  draftPrice,
  importStatus,
  readyDrafts,
  saveDrafts,
  toDrafts,
  WHY_OFF,
  type DraftItem,
  type ImportStatus,
} from './menu-import';
import './menu-import.css';

/**
 * Importar o cardápio com IA: a pessoa manda a foto do cardápio, a foto de um prato ou o PDF,
 * a IA lê e devolve os itens; aqui ela confere, corrige e salva. Nada entra no cardápio sem
 * passar pela conferência. Usado em Cardápio › Itens e nos primeiros passos.
 */

type Kind = 'menu' | 'dish' | 'pdf';
type Stage =
  | { at: 'pick' }
  | { at: 'reading'; fileName: string }
  | { at: 'review' }
  | { at: 'saving'; done: number; total: number }
  | { at: 'done'; created: number; failed: { name: string; message: string }[] };

const PICKS: { kind: Kind; icon: typeof Camera; title: string; hint: string; accept: string }[] = [
  {
    kind: 'menu',
    icon: Images,
    title: 'Foto do cardápio',
    hint: 'Uma página por vez',
    accept: 'image/*',
  },
  {
    kind: 'dish',
    icon: Camera,
    title: 'Foto de um prato',
    hint: 'Vira a foto do item',
    accept: 'image/*',
  },
  { kind: 'pdf', icon: FileText, title: 'PDF', hint: 'Até 3 MB', accept: 'application/pdf' },
];

export function MenuImport({
  onSaved,
  onFinish,
}: {
  /** Chamado quando pelo menos um item entrou no cardápio. */
  onSaved?: (created: number) => void;
  /** Botão "Concluir" do fim (fechar a janela, seguir a conversa). */
  onFinish?: (created: number) => void;
}) {
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [stage, setStage] = useState<Stage>({ at: 'pick' });
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const inputs = useRef<Partial<Record<Kind, HTMLInputElement | null>>>({});

  useEffect(() => {
    importStatus().then(setStatus, () =>
      setStatus({ enabled: false, reason: 'platform', assistantName: 'Comandou' }),
    );
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, DraftItem[]>();
    for (const d of drafts) map.set(d.category, [...(map.get(d.category) ?? []), d]);
    return [...map.entries()];
  }, [drafts]);
  const ready = readyDrafts(drafts).length;

  const read = async (kind: Kind, file: File | undefined) => {
    if (!file) return;
    setError(null);
    setStage({ at: 'reading', fileName: file.name });
    try {
      const list = toDrafts(await analyzeMenuFile(file));
      if (list.length === 0) {
        setError('Não encontrei itens neste arquivo. Tente uma foto mais nítida e de perto.');
        setStage({ at: drafts.length ? 'review' : 'pick' });
        return;
      }
      setPhoto(kind === 'dish' ? file : null);
      setDrafts((cur) => [...cur, ...list]);
      setStage({ at: 'review' });
    } catch (e) {
      setError((e as Error).message);
      setStage({ at: drafts.length ? 'review' : 'pick' });
    }
  };

  const patch = (key: string, p: Partial<DraftItem>) =>
    setDrafts((cur) => cur.map((d) => (d.key === key ? { ...d, ...p } : d)));
  const renameCategory = (from: string, to: string) =>
    setDrafts((cur) => cur.map((d) => (d.category === from ? { ...d, category: to } : d)));

  const save = async () => {
    setError(null);
    setStage({ at: 'saving', done: 0, total: ready });
    try {
      const r = await saveDrafts(drafts, photo, (done, t) =>
        setStage({ at: 'saving', done, total: t }),
      );
      setTotal((n) => n + r.created);
      if (r.created > 0) onSaved?.(r.created);
      setStage({ at: 'done', ...r });
    } catch (e) {
      setError((e as Error).message);
      setStage({ at: 'review' });
    }
  };

  const again = () => {
    setDrafts([]);
    setPhoto(null);
    setError(null);
    setStage({ at: 'pick' });
  };

  if (!status) return <Spinner inline label="Carregando" />;
  if (!status.enabled && status.reason)
    return (
      <Alert tone="warning">
        {WHY_OFF[status.reason]} Enquanto isso, cadastre os itens em Cardápio › Itens.
      </Alert>
    );

  const pickers = (
    <div className="mi-picks">
      {PICKS.map((p) => (
        <button
          key={p.kind}
          type="button"
          className="mi-pick"
          onClick={() => inputs.current[p.kind]?.click()}
        >
          <p.icon size={18} aria-hidden />
          <span className="mi-pick__title">{p.title}</span>
          <span className="mi-pick__hint">{p.hint}</span>
          <input
            ref={(el) => {
              inputs.current[p.kind] = el;
            }}
            type="file"
            hidden
            accept={p.accept}
            aria-label={p.title}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              void read(p.kind, f);
            }}
          />
        </button>
      ))}
    </div>
  );

  return (
    <div className="mi">
      {error && <Alert tone="danger">{error}</Alert>}

      {stage.at === 'pick' && pickers}

      {stage.at === 'reading' && (
        <div className="mi-wait" role="status">
          <Sparkles size={18} aria-hidden className="mi-wait__spark" />
          <div>
            <strong>Lendo {stage.fileName}</strong>
            <span>Leva alguns segundos. Pode deixar esta tela aberta.</span>
          </div>
        </div>
      )}

      {stage.at === 'review' && (
        <>
          <p className="mi-lead">
            Confira o que eu li. Corrija o que precisar e desmarque o que não quer cadastrar.
            {drafts.some((d) => !d.price) && ' Item sem preço só entra depois que você digitar.'}
          </p>
          <div className="mi-list">
            {groups.map(([cat, items]) => (
              <section key={items[0]!.key} className="mi-group">
                <input
                  className="mi-group__name"
                  aria-label="Categoria"
                  value={cat}
                  maxLength={60}
                  onChange={(e) => renameCategory(cat, e.target.value)}
                />
                {items.map((d) => (
                  <div key={d.key} className="mi-row" data-off={!d.on || undefined}>
                    <input
                      type="checkbox"
                      checked={d.on}
                      aria-label={`Cadastrar ${d.name}`}
                      onChange={(e) => patch(d.key, { on: e.target.checked })}
                    />
                    <div className="mi-row__text">
                      <input
                        className="mi-row__name"
                        aria-label="Nome do item"
                        value={d.name}
                        maxLength={120}
                        onChange={(e) => patch(d.key, { name: e.target.value })}
                      />
                      <input
                        className="mi-row__desc"
                        aria-label={`Descrição de ${d.name}`}
                        placeholder="Descrição (opcional)"
                        value={d.description}
                        maxLength={500}
                        onChange={(e) => patch(d.key, { description: e.target.value })}
                      />
                    </div>
                    <label className="mi-row__price">
                      <span aria-hidden>R$</span>
                      <input
                        inputMode="decimal"
                        aria-label={`Preço de ${d.name}`}
                        placeholder="0,00"
                        value={d.price}
                        aria-invalid={d.on && draftPrice(d.price) === null ? true : undefined}
                        onChange={(e) =>
                          patch(d.key, {
                            price: e.target.value,
                            on: d.on || draftPrice(e.target.value) !== null,
                          })
                        }
                      />
                    </label>
                  </div>
                ))}
              </section>
            ))}
          </div>
          <div className="mi-foot">
            <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={again}>
              Começar de novo
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Images size={14} />}
              onClick={() => inputs.current.menu?.click()}
            >
              Outra página
            </Button>
            <Button disabled={ready === 0} onClick={save}>
              {ready === 0
                ? 'Nada para salvar'
                : `Salvar ${ready} ${ready === 1 ? 'item' : 'itens'}`}
            </Button>
          </div>
          {/* Os campos de arquivo continuam montados para "Outra página". */}
          <div hidden>{pickers}</div>
        </>
      )}

      {stage.at === 'saving' && (
        <div className="mi-wait" role="status">
          <Spinner inline label="Salvando" />
          <div>
            <strong>
              Salvando {stage.done} de {stage.total}
            </strong>
            <progress max={stage.total} value={stage.done} />
          </div>
        </div>
      )}

      {stage.at === 'done' && (
        <>
          <Alert tone={stage.created > 0 ? 'info' : 'warning'}>
            {stage.created > 0
              ? `${stage.created} ${stage.created === 1 ? 'item entrou' : 'itens entraram'} no cardápio.`
              : 'Nenhum item foi salvo.'}
          </Alert>
          {stage.failed.length > 0 && (
            <ul className="mi-failed">
              {stage.failed.map((f, i) => (
                <li key={i}>
                  <strong>{f.name}</strong>: {f.message}
                </li>
              ))}
            </ul>
          )}
          <div className="mi-foot">
            <Button variant="secondary" size="sm" icon={<Images size={14} />} onClick={again}>
              Importar mais
            </Button>
            {onFinish && <Button onClick={() => onFinish(total)}>Concluir</Button>}
          </div>
        </>
      )}
    </div>
  );
}
