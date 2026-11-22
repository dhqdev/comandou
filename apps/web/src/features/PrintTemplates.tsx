import {
  PRINT_TEMPLATE_FILTERS,
  PRINT_TEMPLATE_HELP,
  PRINT_TEMPLATE_LABELS,
  PRINT_TEMPLATE_VARS,
  type PrintTemplateKind,
} from '@comandou/shared';
import { Eye, RotateCcw, Save, Send, Sparkles, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Segmented,
  Skeleton,
  Spinner,
  useToast,
} from '../design-system';
import { api } from '../lib/api';
import { Tabs } from './forms';
import { PaperText } from './PaperText';

type Kind = PrintTemplateKind;
interface Template {
  kind: Kind;
  body: string | null;
  updatedAt: string | null;
  default: string;
}

const LABEL = PRINT_TEMPLATE_LABELS;
const HELP = PRINT_TEMPLATE_HELP;
const VARS = PRINT_TEMPLATE_VARS;
const FILTERS = PRINT_TEMPLATE_FILTERS;

type Side = 'ai' | 'preview' | 'help';

/**
 * Modelos de impressão em Liquid (a mesma ideia do Jinja): o restaurante muda o que sai na
 * conferência, na via de entrega, na comanda da cozinha e no rodapé do cupom fiscal, com prévia
 * antes de salvar. Ao lado do editor, a conversa com a IA muda o código pelo restaurante.
 */
export function PrintTemplatesCard() {
  const toast = useToast();
  const areaId = useId();
  const [list, setList] = useState<Template[] | null>(null);
  const [kind, setKind] = useState<Kind>('receipt');
  const [draft, setDraft] = useState<Record<Kind, string>>({
    receipt: '',
    delivery_slip: '',
    kitchen_ticket: '',
    fiscal_footer: '',
  });
  const [preview, setPreview] = useState<{ text: string; logoUrl: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | 'reset' | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [side, setSide] = useState<Side>('help');

  const load = useCallback(async () => {
    const r = await api<Template[]>('/printing/templates');
    setList(r);
    setDraft(
      Object.fromEntries(r.map((t) => [t.kind, t.body ?? t.default])) as Record<Kind, string>,
    );
  }, []);
  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
    api<AiStatus>('/printing/templates/ai')
      .then((s) => {
        setAi(s);
        if (s.enabled) setSide('ai');
      })
      .catch(() => setAi(null));
  }, [load]);

  const cur = list?.find((t) => t.kind === kind);
  const body = draft[kind];

  const showPreview = useCallback(async (k: Kind, text: string) => {
    const r = await api<{ text: string; logoUrl?: string | null }>('/printing/templates/preview', {
      method: 'POST',
      json: { kind: k, body: text },
    });
    setPreview({ text: r.text, logoUrl: r.logoUrl ?? null });
  }, []);

  async function run(what: 'preview' | 'save' | 'reset') {
    setBusy(what);
    setError(null);
    try {
      if (what === 'preview') {
        await showPreview(kind, body);
        setSide('preview');
      } else if (what === 'save') {
        await api(`/printing/templates/${kind}`, { method: 'PUT', json: { body } });
        toast('Modelo salvo: as próximas impressões já saem assim', 'success');
        await load();
      } else {
        await api(`/printing/templates/${kind}`, { method: 'DELETE' });
        toast('Voltou para o modelo padrão do Comandou', 'success');
        setPreview(null);
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** A IA mandou o modelo novo: entra no editor (sem salvar) e a prévia já atualiza. */
  function applyFromAi(next: string) {
    setDraft((d) => ({ ...d, [kind]: next }));
    setError(null);
    showPreview(kind, next).catch((e: Error) => setError(e.message));
  }

  const sides: [Side, string][] = [
    ...(ai?.enabled ? ([['ai', `Conversar com ${ai.name || 'a IA'}`]] as [Side, string][]) : []),
    ['preview', 'Prévia'],
    ['help', 'O que dá para usar'],
  ];

  return (
    <Card searchId="secao-modelos" title="Modelos de impressão">
      {list === null ? (
        error ? (
          <Alert tone="danger">{error}</Alert>
        ) : (
          <Skeleton variant="grid" />
        )
      ) : (
        <div className="print-tpl">
          <Tabs
            value={kind}
            onChange={(k) => {
              setKind(k);
              setPreview(null);
              setError(null);
            }}
            items={(Object.keys(LABEL) as Kind[]).map((k) => [k, LABEL[k]])}
          />
          <p className="cm-hint">
            {HELP[kind]}{' '}
            {cur?.body ? <Badge tone="brand">personalizado</Badge> : <Badge>padrão</Badge>}
          </p>
          <div className="print-tpl__grid">
            <div className="cm-field">
              <label className="cm-label" htmlFor={areaId}>
                Modelo
              </label>
              <textarea
                id={areaId}
                className="cm-input print-tpl__area"
                spellCheck={false}
                rows={22}
                maxLength={8000}
                value={body}
                onChange={(e) => setDraft((d) => ({ ...d, [kind]: e.target.value }))}
              />
              <span className="cm-hint">
                Use {'{{ variável }}'} para mostrar um dado e {'{% if %}'} / {'{% for %}'} para
                condições e listas. A bobina tem 42 colunas; a letra grande, 21.
              </span>
            </div>
            <div className="print-tpl__side">
              <Segmented
                label="Ao lado do editor"
                value={side}
                onChange={(v) => {
                  setSide(v);
                  if (v === 'preview' && !preview && body.trim())
                    showPreview(kind, body).catch((e: Error) => setError(e.message));
                }}
                options={sides.map(([value, label]) => ({ value, label }))}
              />
              {side === 'ai' && ai?.enabled ? (
                <TemplateAiChat
                  key={kind}
                  kind={kind}
                  body={body}
                  name={ai.name || 'IA'}
                  preview={preview}
                  onApply={applyFromAi}
                />
              ) : side === 'preview' ? (
                preview ? (
                  <PaperText
                    text={preview.text}
                    logoUrl={preview.logoUrl}
                    className="print-tpl__paper"
                    label="Prévia do modelo"
                  />
                ) : (
                  <p className="cm-hint">Clique em Ver prévia para ver como sai no papel.</p>
                )
              ) : (
                <>
                  <strong>O que dá para usar</strong>
                  <ul className="print-tpl__vars">
                    {VARS[kind].map(([v, d]) => (
                      <li key={v}>
                        <code>{v}</code> <span className="cm-hint">{d}</span>
                      </li>
                    ))}
                  </ul>
                  <strong>Ajudantes</strong>
                  <ul className="print-tpl__vars">
                    {FILTERS.map(([v, d]) => (
                      <li key={v}>
                        <code>{v}</code> <span className="cm-hint">{d}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="actions-row">
            <Button
              variant="secondary"
              icon={<Eye size={16} />}
              loading={busy === 'preview'}
              disabled={!body.trim()}
              onClick={() => void run('preview')}
            >
              Ver prévia
            </Button>
            <Button
              icon={<Save size={16} />}
              loading={busy === 'save'}
              disabled={!body.trim()}
              onClick={() => void run('save')}
            >
              Salvar modelo
            </Button>
            {cur?.body && (
              <Button
                variant="ghost"
                icon={<RotateCcw size={16} />}
                loading={busy === 'reset'}
                onClick={() => void run('reset')}
              >
                Voltar ao padrão
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

interface AiStatus {
  enabled: boolean;
  reason: string | null;
  name: string;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  /** Modelo que estava no editor antes desta resposta mudar (para desfazer). */
  before?: string;
  aviso?: string | null;
}

const SUGGESTIONS: Record<Kind, string[]> = {
  receipt: [
    'Deixe o nome da loja maior e o total em destaque',
    'Tire o CPF/CNPJ e a data de impressão',
    'Coloque "Volte sempre!" no final',
  ],
  delivery_slip: [
    'Deixe o endereço e o telefone bem grandes',
    'Coloque "Confira o pedido na entrega" no final',
    'Tire os preços dos itens',
  ],
  kitchen_ticket: [
    'Deixe os itens em letra grande',
    'Mostre a observação do pedido logo no topo',
    'Tire o nome do cliente',
  ],
  fiscal_footer: [
    'Coloque a senha do Wi-Fi: cliente123',
    'Coloque nosso Instagram @minhaloja',
    'Deixe o agradecimento em letra grande',
  ],
};

/**
 * Conversa com a IA ao lado do editor. Cada pedido vai com o modelo que está no editor; a
 * resposta com modelo novo entra no editor (dá para desfazer) e a prévia atualiza. Salvar continua
 * sendo da pessoa.
 */
function TemplateAiChat({
  kind,
  body,
  name,
  preview,
  onApply,
}: {
  kind: Kind;
  body: string;
  name: string;
  preview: { text: string; logoUrl: string | null } | null;
  onApply(next: string): void;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputId = useId();

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy]);

  async function send(ask: string) {
    const q = ask.trim();
    if (!q || busy) return;
    const next: ChatMsg[] = [...msgs, { role: 'user', content: q }];
    setMsgs(next);
    setText('');
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ resposta: string; modelo: string | null; aviso: string | null }>(
        '/printing/templates/ai',
        {
          method: 'POST',
          json: {
            kind,
            body,
            messages: next.slice(-12).map((m) => ({ role: m.role, content: m.content })),
          },
        },
      );
      setMsgs((m) => [
        ...m,
        {
          role: 'assistant',
          content: r.resposta,
          before: r.modelo ? body : undefined,
          aviso: r.aviso,
        },
      ]);
      if (r.modelo) onApply(r.modelo);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tpl-ai">
      <div className="tpl-ai__scroll" ref={scroller}>
        {msgs.length === 0 && (
          <div className="tpl-ai__hello">
            <Sparkles size={18} aria-hidden />
            <p>
              Diga como quer o papel e eu mudo o modelo para você. A mudança entra no editor com a
              prévia; nada é salvo até você clicar em Salvar modelo.
            </p>
            <div className="tpl-ai__chips">
              {SUGGESTIONS[kind].map((s) => (
                <button key={s} type="button" className="tpl-ai__chip" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`tpl-ai__msg ${m.role === 'user' ? 'is-mine' : ''}`}>
            {m.role === 'assistant' && <span className="tpl-ai__who">{name}</span>}
            <p>{m.content}</p>
            {m.aviso && <span className="tpl-ai__warn">{m.aviso}</span>}
            {m.before !== undefined && (
              <div className="tpl-ai__actions">
                <span className="cm-hint">Mudança aplicada no editor.</span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Undo2 size={14} />}
                  onClick={() => {
                    onApply(m.before!);
                    setMsgs((all) =>
                      all.map((x, j) => (j === i ? { ...x, before: undefined } : x)),
                    );
                  }}
                >
                  Desfazer
                </Button>
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="tpl-ai__msg">
            <span className="tpl-ai__who">{name}</span>
            <p className="tpl-ai__typing">
              <Spinner inline label="Mexendo no modelo" /> Mexendo no modelo…
            </p>
          </div>
        )}
        {preview && msgs.length > 0 && !busy && (
          <PaperText
            text={preview.text}
            logoUrl={preview.logoUrl}
            className="print-tpl__paper tpl-ai__paper"
            label="Prévia do modelo"
          />
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <form
        className="tpl-ai__form"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <label className="cm-sr-only" htmlFor={inputId}>
          O que mudar no papel
        </label>
        <textarea
          id={inputId}
          className="cm-input tpl-ai__input"
          rows={2}
          maxLength={1500}
          placeholder="Ex.: deixe o total maior e tire o telefone"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
        />
        <Button
          type="submit"
          size="sm"
          icon={<Send size={14} />}
          loading={busy}
          disabled={!text.trim() || !body.trim()}
          aria-label="Enviar"
        >
          Enviar
        </Button>
      </form>
    </div>
  );
}
