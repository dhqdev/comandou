import { Bot, CheckCheck, MessageCircle, RotateCcw, Search, Send, Sparkles } from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  HelpScope,
  HelpTip,
  Segmented,
  Spinner,
  TextField,
  useToast,
  type HelpDict,
} from '../design-system';
import { CheckField } from '../features/forms';
import { api } from '../lib/api';
import './ai-agent.css';

type Tone = 'friendly' | 'formal' | 'fun';
type ReplyWhen = 'always' | 'open';

export interface AgentSettings {
  whatsappEnabled: boolean;
  agentName: string | null;
  tone: Tone;
  greeting: string | null;
  about: string | null;
  rules: string | null;
  handoffMessage: string | null;
  suggestItems: boolean;
  showPrices: boolean;
  sendStoreLink: boolean;
  replyWhen: ReplyWhen;
}

interface Overview {
  settings: AgentSettings;
  defaultName: string;
  available: boolean;
  reason: 'platform' | 'tenant' | 'limit' | null;
  usage: { used: number; limit: number; percent: number | null };
}

interface MenuRow {
  id: string;
  name: string;
  category: string;
  price: string;
  soldOut: boolean;
  aiVisible: boolean;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  handoff?: boolean;
}

const TONES: { value: Tone; label: string; example: string }[] = [
  {
    value: 'friendly',
    label: 'Simpático',
    example: 'Oi, Maria! Temos sim 😊 O X-Burger sai por R$ 25,90. Quer que eu mande o cardápio?',
  },
  {
    value: 'formal',
    label: 'Formal',
    example:
      'Boa noite, senhora. Temos o X-Burger por R$ 25,90. Posso enviar o link do cardápio para o pedido?',
  },
  {
    value: 'fun',
    label: 'Descontraído',
    example: 'Opa, tem sim! 🍔🔥 X-Burger por R$ 25,90, chega quentinho. Bora pedir?',
  },
];

const REASON: Record<NonNullable<Overview['reason']>, string> = {
  platform:
    'A IA ainda não foi ligada pelo Comandou. Você já pode deixar tudo configurado; ela começa a responder quando for liberada.',
  tenant: 'A IA está desligada para este restaurante. Fale com o suporte do Comandou.',
  limit:
    'O limite de uso da IA neste mês acabou. Ela volta no próximo mês ou quando o Comandou liberar mais.',
};

const HELP: HelpDict = {
  'Nome do atendente': {
    text: 'Como a IA se apresenta para o cliente. Vazio usa o nome padrão do Comandou.',
    example: 'Lu, da Casa do Lanche',
  },
  'Mensagem de boas-vindas': {
    text: 'Como a IA cumprimenta o cliente na primeira mensagem da conversa.',
    example: 'Olá! Bem-vindo à Casa do Lanche. Como posso ajudar?',
  },
  'Sobre a casa': {
    text: 'Tudo o que a IA deve saber para responder dúvidas: endereço, estacionamento, formas de pagamento, se aceita cartão na entrega, promoções da semana. Uma informação por linha.',
    example: 'Aceitamos Pix, cartão e dinheiro na entrega.\nTerça é dia de burger em dobro.',
  },
  'O que a IA não deve fazer': {
    text: 'Regras que a IA sempre segue. Ela já não fecha pedido, não dá desconto e não pede dados de cartão; aqui você acrescenta as da casa.',
    example: 'Não prometer horário exato de entrega.\nNão falar de outros restaurantes.',
  },
  'Quando precisar de uma pessoa': {
    text: 'O que a IA responde quando o cliente reclama, pede para falar com alguém ou ela não sabe a resposta. Depois disso ela fica quieta nessa conversa por 12 horas e avisa a equipe no chat.',
  },
  'Sugerir itens e adicionais': {
    text: 'A IA pode indicar itens e complementos do cardápio quando fizer sentido (ex.: uma bebida com o lanche).',
  },
  'Informar preços': {
    text: 'Desligado, a IA não fala valores e manda o cliente ver no cardápio online.',
  },
  'Mandar o link do cardápio online': {
    text: 'Quando o cliente quer pedir, a IA manda o link da sua loja online para ele montar o pedido e pagar.',
    link: { to: '/loja-online', label: 'Abrir Loja online' },
  },
};

const blank = (v: string | null) => v ?? '';

/**
 * Assistente de IA do restaurante: o gerente escolhe como a IA atende os clientes no WhatsApp,
 * quais itens do cardápio ela pode oferecer e testa a conversa antes de ligar.
 */
export function AiAgentPage() {
  const toast = useToast();
  const [o, setO] = useState<Overview | null>(null);
  const [form, setForm] = useState<AgentSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function fill(x: Overview) {
    setO(x);
    setForm(x.settings);
  }
  useEffect(() => {
    api<Overview>('/ai-agent')
      .then(fill)
      .catch((e: Error) => setError(e.message));
  }, []);

  const dirty = useMemo(
    () =>
      !!o &&
      !!form &&
      (Object.keys(form) as (keyof AgentSettings)[]).some(
        (k) => k !== 'whatsappEnabled' && blank(form[k] as never) !== blank(o.settings[k] as never),
      ),
    [o, form],
  );

  async function save(patch: Partial<AgentSettings>, ok = 'Configuração da IA salva') {
    setBusy(true);
    try {
      const x = await api<Overview>('/ai-agent', { method: 'PUT', json: patch });
      setO(x);
      // Mantém o que ainda está sendo editado; só troca o que foi salvo.
      setForm((f) => ({ ...(f ?? x.settings), ...pick(x.settings, Object.keys(patch)) }));
      toast(ok, 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  if (!o || !form) return error ? <Alert tone="danger">{error}</Alert> : <Spinner />;
  const set =
    <K extends keyof AgentSettings>(k: K) =>
    (v: AgentSettings[K]) =>
      setForm((f) => ({ ...f!, [k]: v }));
  const text = (k: 'agentName' | 'greeting' | 'about' | 'rules' | 'handoffMessage') => ({
    value: blank(form[k]),
    onChange: (e: { target: { value: string } }) => set(k)(e.target.value),
  });
  const name = form.agentName?.trim() || o.defaultName;
  const tone = TONES.find((t) => t.value === form.tone)!;

  function submit(e: FormEvent) {
    e.preventDefault();
    const { whatsappEnabled: _skip, ...rest } = form!;
    const clean = Object.fromEntries(
      Object.entries(rest).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]),
    );
    void save(clean);
  }

  return (
    <HelpScope dict={HELP}>
      <div>
        <h1 className="page-title">Assistente de IA</h1>
        <p className="page-sub">
          Escolha como a IA conversa com seus clientes no WhatsApp e quais itens do cardápio ela
          pode oferecer. Ela tira dúvidas, sugere pratos e manda o link do cardápio para o cliente
          pedir.
        </p>
      </div>

      <Card
        searchId="secao-ia-ligar"
        title="Atendimento no WhatsApp"
        actions={
          <Badge tone={form.whatsappEnabled && o.available ? 'success' : 'neutral'}>
            {form.whatsappEnabled
              ? o.available
                ? 'respondendo'
                : 'ligado, aguardando'
              : 'desligado'}
          </Badge>
        }
      >
        <div className="ai-steps">
          <Step n={1}>
            Conecte o WhatsApp da loja em <Link to="/whatsapp?foco=secao-qr">WhatsApp</Link>.
          </Step>
          <Step n={2} done={!dirty}>
            Preencha como a IA deve atender (abaixo) e salve.
          </Step>
          <Step n={3}>Teste a conversa no fim da página, como se você fosse o cliente.</Step>
          <Step n={4} done={form.whatsappEnabled}>
            Ligue o atendimento.
          </Step>
        </div>
        {o.reason && (
          <Alert tone={o.reason === 'platform' ? 'info' : 'warning'}>{REASON[o.reason]}</Alert>
        )}
        <div className="ai-switch-row">
          <Button
            variant={form.whatsappEnabled ? 'secondary' : 'primary'}
            loading={busy}
            icon={<MessageCircle size={16} />}
            onClick={() =>
              save(
                { whatsappEnabled: !form.whatsappEnabled },
                form.whatsappEnabled
                  ? 'A IA parou de responder no WhatsApp'
                  : 'A IA vai responder no WhatsApp',
              ).then(() => setForm((f) => f && { ...f, whatsappEnabled: !f.whatsappEnabled }))
            }
          >
            {form.whatsappEnabled ? 'Desligar atendimento' : 'Ligar atendimento'}
          </Button>
          <div className="ai-when">
            <span className="cm-label">Quando responder</span>
            <Segmented<ReplyWhen>
              label="Quando responder"
              value={form.replyWhen}
              onChange={(v) => {
                set('replyWhen')(v);
                void save({ replyWhen: v }, 'Horário de resposta salvo');
              }}
              options={[
                { value: 'always', label: 'Sempre' },
                { value: 'open', label: 'Só com a loja aberta' },
              ]}
            />
          </div>
        </div>
        <Usage u={o.usage} />
      </Card>

      <form className="ai-form" onSubmit={submit}>
        <Card searchId="secao-ia-jeito" title="Jeito de atender">
          <div className="cm-form">
            <TextField
              label="Nome do atendente"
              placeholder={o.defaultName}
              maxLength={30}
              {...text('agentName')}
            />
            <div className="cm-field">
              <span className="cm-label">Jeito de falar</span>
              <Segmented<Tone>
                label="Jeito de falar"
                value={form.tone}
                onChange={set('tone')}
                options={TONES.map((t) => ({ value: t.value, label: t.label }))}
              />
              <div className="ai-bubble" aria-live="polite">
                <small>Exemplo de resposta</small>
                {tone.example}
              </div>
            </div>
            <TextField
              label="Mensagem de boas-vindas"
              placeholder={`Olá! Aqui é ${name}. Como posso ajudar?`}
              maxLength={300}
              {...text('greeting')}
            />
            <Area
              label="Sobre a casa"
              hint="Endereço, pagamento, estacionamento, promoções… Uma informação por linha."
              placeholder={'Aceitamos Pix, cartão e dinheiro na entrega.\nTemos opção sem glúten.'}
              max={1500}
              rows={5}
              {...text('about')}
            />
            <Area
              label="O que a IA não deve fazer"
              hint="Ela já não fecha pedido, não dá desconto e não pede dados de cartão."
              placeholder={'Não prometer horário exato.\nNão falar de outros restaurantes.'}
              max={1000}
              rows={3}
              {...text('rules')}
            />
            <TextField
              label="Quando precisar de uma pessoa"
              placeholder="Vou chamar alguém da nossa equipe para continuar com você, só um instante."
              hint="A IA responde isso, avisa a equipe no chat e fica quieta na conversa por 12 horas."
              maxLength={300}
              {...text('handoffMessage')}
            />
          </div>
        </Card>

        <Card searchId="secao-ia-pode" title="O que a IA pode fazer">
          <div className="ai-checks">
            <CheckField
              label="Sugerir itens e adicionais"
              description="Indica pratos e complementos do cardápio quando faz sentido."
              checked={form.suggestItems}
              onChange={set('suggestItems')}
            />
            <CheckField
              label="Informar preços"
              description="Fala o valor de cada item como está no cardápio."
              checked={form.showPrices}
              onChange={set('showPrices')}
            />
            <CheckField
              label="Mandar o link do cardápio online"
              description="Para o cliente montar o pedido e pagar pela loja online."
              checked={form.sendStoreLink}
              onChange={set('sendStoreLink')}
            />
          </div>
          <p className="cm-hint ai-never">
            Sempre: fala só do que está liberado no cardápio, não inventa preço nem promoção, não
            fecha pedido, não dá desconto e não pede dados de cartão.
          </p>
        </Card>

        {dirty && (
          <div className="ai-savebar">
            <span>Você tem alterações não salvas.</span>
            <Button
              type="button"
              variant="ghost"
              disabled={!dirty || busy}
              icon={<RotateCcw size={16} />}
              onClick={() => setForm({ ...o.settings, whatsappEnabled: form.whatsappEnabled })}
            >
              Desfazer
            </Button>
            <Button type="submit" loading={busy} disabled={!dirty}>
              Salvar
            </Button>
          </div>
        )}
      </form>

      <MenuCard />
      <TestCard draft={form} name={name} available={o.available} reason={o.reason} />
    </HelpScope>
  );
}

function pick<T extends object>(o: T, keys: string[]): Partial<T> {
  return Object.fromEntries(keys.map((k) => [k, o[k as keyof T]])) as Partial<T>;
}

function Step({ n, done, children }: { n: number; done?: boolean; children: ReactNode }) {
  return (
    <div className="ai-step" data-done={done || undefined}>
      <span className="ai-step__n" aria-hidden>
        {done ? <CheckCheck size={14} /> : n}
      </span>
      <span>{children}</span>
    </div>
  );
}

function Usage({ u }: { u: Overview['usage'] }) {
  const fmt = (n: number) => n.toLocaleString('pt-BR');
  return (
    <div className="ai-usage">
      <div className="ai-usage__row">
        <span>Uso da IA neste mês</span>
        <strong>
          {fmt(u.used)} {u.limit > 0 ? `de ${fmt(u.limit)}` : ''} tokens
        </strong>
      </div>
      {u.limit > 0 && (
        <div
          className="ai-usage__bar"
          role="progressbar"
          aria-valuenow={u.percent ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span
            style={{ width: `${u.percent ?? 0}%` }}
            data-high={(u.percent ?? 0) >= 80 || undefined}
          />
        </div>
      )}
      <span className="cm-hint">
        O mesmo limite vale para o assistente da equipe e para o atendimento no WhatsApp.
      </span>
    </div>
  );
}

function Area({
  label,
  hint,
  placeholder,
  max,
  rows,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  placeholder?: string;
  max: number;
  rows: number;
  value: string;
  onChange(e: { target: { value: string } }): void;
}) {
  const id = `ai-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="cm-field">
      <span className="cm-label-row">
        <label className="cm-label" htmlFor={id}>
          {label}
        </label>
        <HelpTip label={label} />
      </span>
      <textarea
        id={id}
        className="cm-input"
        rows={rows}
        maxLength={max}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
      <span className="cm-hint ai-count">
        {hint && <span>{hint}</span>}
        <span>
          {value.length}/{max}
        </span>
      </span>
    </div>
  );
}

/** Itens que a IA pode oferecer, por categoria, com busca e marcar/desmarcar todos. */
function MenuCard() {
  const toast = useToast();
  const [rows, setRows] = useState<MenuRow[] | null>(null);
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<MenuRow[]>('/ai-agent/menu')
      .then(setRows)
      .catch((e: Error) => toast(e.message, 'danger'));
  }, [toast]);

  async function toggle(body: { ids?: string[]; all?: true; visible: boolean }) {
    setBusy(true);
    const before = rows;
    setRows(
      (r) =>
        r?.map((x) =>
          body.all || body.ids?.includes(x.id) ? { ...x, aiVisible: body.visible } : x,
        ) ?? r,
    );
    try {
      await api('/ai-agent/menu', { method: 'PUT', json: body });
    } catch (e) {
      setRows(before);
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  const groups = useMemo(() => {
    const t = term.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const m = new Map<string, MenuRow[]>();
    for (const r of rows ?? []) {
      const hay = `${r.name} ${r.category}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      if (t && !hay.includes(t)) continue;
      m.set(r.category, [...(m.get(r.category) ?? []), r]);
    }
    return [...m.entries()];
  }, [rows, term]);

  const on = rows?.filter((r) => r.aiVisible).length ?? 0;
  return (
    <Card
      searchId="secao-ia-cardapio"
      title="Itens que a IA pode oferecer"
      actions={
        rows && <Badge tone={on ? 'brand' : 'warning'}>{`${on} de ${rows.length} liberados`}</Badge>
      }
    >
      <p className="cm-hint" style={{ marginTop: 0 }}>
        A IA só fala dos itens marcados. Ela usa os preços do cardápio Delivery (o mesmo da loja
        online) e avisa quando um item está esgotado. Itens desativados no cardápio nunca aparecem.
      </p>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Bot size={20} />}
          title="Nenhum item no cardápio"
          description="Cadastre os itens em Cardápio e volte aqui."
          action={<Link to="/cardapio">Abrir Cardápio</Link>}
        />
      ) : (
        <>
          <div className="ai-menu-tools">
            <TextField
              label="Buscar item"
              leading={<Search size={16} />}
              placeholder="Nome do item ou categoria"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || on === rows.length}
              onClick={() => toggle({ all: true, visible: true })}
            >
              Marcar todos
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || on === 0}
              onClick={() => toggle({ all: true, visible: false })}
            >
              Desmarcar todos
            </Button>
          </div>
          {groups.length === 0 && <p className="cm-hint">Nenhum item encontrado.</p>}
          {groups.map(([cat, items]) => {
            const allOn = items.every((i) => i.aiVisible);
            return (
              <section key={cat} className="ai-cat">
                <header>
                  <h3>{cat}</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => toggle({ ids: items.map((i) => i.id), visible: !allOn })}
                  >
                    {allOn ? 'Desmarcar categoria' : 'Marcar categoria'}
                  </Button>
                </header>
                <ul>
                  {items.map((i) => (
                    <li key={i.id}>
                      <label className="ai-item" data-on={i.aiVisible || undefined}>
                        <input
                          type="checkbox"
                          checked={i.aiVisible}
                          disabled={busy}
                          onChange={(e) => toggle({ ids: [i.id], visible: e.target.checked })}
                        />
                        <span className="ai-item__name">{i.name}</span>
                        {i.soldOut && <Badge tone="warning">esgotado</Badge>}
                        <span className="ai-item__price">
                          {Number(i.price).toLocaleString('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          })}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </Card>
  );
}

/** Conversa de teste: o gerente faz o papel do cliente, com a configuração da tela (mesmo sem salvar). */
function TestCard({
  draft,
  name,
  available,
  reason,
}: {
  draft: AgentSettings;
  name: string;
  available: boolean;
  reason: Overview['reason'];
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [turns, busy]);

  async function ask(e?: FormEvent, preset?: string) {
    e?.preventDefault();
    const content = (preset ?? input).trim();
    if (!content || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content }];
    setTurns(next);
    setInput('');
    setBusy(true);
    setError(null);
    try {
      const { whatsappEnabled: _w, ...d } = draft;
      const r = await api<{ text: string; handoff: boolean }>('/ai-agent/test', {
        method: 'POST',
        json: {
          messages: next.map(({ role, content: c }) => ({ role, content: c })),
          draft: Object.fromEntries(
            Object.entries(d).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]),
          ),
        },
      });
      setTurns([...next, { role: 'assistant', content: r.text, handoff: r.handoff }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ideas = [
    'Oi, vocês estão abertos?',
    'Qual o lanche mais pedido?',
    'Quero falar com alguém',
  ];
  return (
    <Card
      searchId="secao-ia-teste"
      title="Testar a conversa"
      actions={
        turns.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw size={16} />}
            onClick={() => setTurns([])}
          >
            Recomeçar
          </Button>
        )
      }
    >
      <p className="cm-hint" style={{ marginTop: 0 }}>
        Escreva como se fosse um cliente. O teste usa o que está na tela agora, mesmo sem salvar, e
        não manda nada no WhatsApp.
      </p>
      {!available && reason && <Alert tone="info">{REASON[reason]}</Alert>}
      <div className="ai-chat" aria-live="polite">
        {turns.length === 0 && (
          <div className="ai-chat__empty">
            <Sparkles size={18} />
            <span>Experimente:</span>
            {ideas.map((i) => (
              <button
                key={i}
                type="button"
                className="ai-chip"
                disabled={!available || busy}
                onClick={() => ask(undefined, i)}
              >
                {i}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`ai-msg ai-msg--${t.role}`}>
            {t.role === 'assistant' && <small>{name}</small>}
            {t.content}
            {t.handoff && (
              <em className="ai-msg__note">
                Aqui a IA chamaria alguém da equipe e ficaria quieta nesta conversa.
              </em>
            )}
          </div>
        ))}
        {busy && <div className="ai-msg ai-msg--assistant ai-msg--typing">digitando…</div>}
        <div ref={end} />
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <form className="ai-chat__form" onSubmit={ask}>
        <input
          className="cm-input"
          aria-label="Mensagem do cliente"
          placeholder="Mensagem do cliente"
          maxLength={2000}
          value={input}
          disabled={!available}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button
          type="submit"
          icon={<Send size={16} />}
          loading={busy}
          disabled={!available || !input.trim()}
        >
          Enviar
        </Button>
      </form>
    </Card>
  );
}
