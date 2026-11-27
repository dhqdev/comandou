import {
  Bot,
  Check,
  CheckCheck,
  FileDown,
  FileText,
  Image as ImageIcon,
  MessageCircle,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
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
  ItemThumb,
  Segmented,
  TextField,
  useToast,
  type HelpDict,
  Skeleton,
} from '../design-system';
import { api } from '../lib/api';
import { downloadFile } from '../lib/download';
import { mediaUrl } from '../lib/media';
import { WaText } from '../features/wa-text';
import '../app/home.css';
import './ai-agent.css';

type Tone = 'friendly' | 'formal' | 'fun';
type ReplyWhen = 'always' | 'open';
type PayMethod = 'pix' | 'cash' | 'credit' | 'debit' | 'voucher';

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
  takeReservations: boolean;
  sendPdfs: boolean;
  menuMode: boolean;
  takeOrders: boolean;
  orderStatus: boolean;
  offerSignup: boolean;
  guestOrders: boolean;
  orderDelivery: boolean;
  orderPickup: boolean;
  payMethods: PayMethod[];
  understandText: boolean;
  itemNotes: boolean;
  sendTracking: boolean;
  freeChat: boolean;
  showInfo: boolean;
}

interface Overview {
  settings: AgentSettings;
  defaultName: string;
  available: boolean;
  reason: 'platform' | 'tenant' | 'limit' | null;
  /** null: sem serviço de WhatsApp ou sem resposta dele agora */
  whatsapp: { connected: boolean; inboundOff: boolean } | null;
  usage: { used: number; limit: number; percent: number | null };
}

interface MenuRow {
  id: string;
  name: string;
  category: string;
  price: string;
  soldOut: boolean;
  aiVisible: boolean;
  imageId: string | null;
  description: string | null;
}

const TONES: { value: Tone; label: string; example: string }[] = [
  {
    value: 'friendly',
    label: 'Simpático',
    example: 'Oi, Maria! Temos sim 😊 O *X-Burger* sai por *R$ 25,90*. Quer que eu monte o pedido?',
  },
  {
    value: 'formal',
    label: 'Formal',
    example:
      'Boa noite, senhora. Temos o *X-Burger* por *R$ 25,90*. Posso registrar o pedido por aqui?',
  },
  {
    value: 'fun',
    label: 'Descontraído',
    example: 'Opa, tem sim! 🍔🔥 *X-Burger* por *R$ 25,90*, chega quentinho. Bora pedir?',
  },
];

const PAY: { value: PayMethod; label: string }[] = [
  { value: 'pix', label: 'Pix' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'credit', label: 'Crédito' },
  { value: 'debit', label: 'Débito' },
  { value: 'voucher', label: 'Vale-refeição' },
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
    text: 'A primeira linha do menu, no lugar de "Olá! Aqui é…". Vazio usa a saudação padrão com o nome do cliente.',
    example: 'Olá! Bem-vindo à Casa do Lanche 🍔',
  },
  'Sobre a casa': {
    text: 'Tudo o que a IA deve saber para responder dúvidas: estacionamento, promoções da semana, se tem opção vegana. Uma informação por linha.',
    example: 'Terça é dia de burger em dobro.\nTemos opção sem glúten.',
  },
  'O que a IA não deve fazer': {
    text: 'Regras que a IA sempre segue nas perguntas livres. Ela já não dá desconto e não pede dados de cartão; aqui você acrescenta as da casa.',
    example: 'Não prometer horário exato de entrega.\nNão falar de outros restaurantes.',
  },
  'Quando precisar de uma pessoa': {
    text: 'O que a IA responde quando o cliente escolhe falar com uma pessoa, reclama ou ela não sabe a resposta. Depois disso ela fica quieta nessa conversa por 12 horas e avisa a equipe no chat.',
  },
};

const blank = (v: unknown) => (Array.isArray(v) ? v.join(',') : (v ?? ''));

/**
 * Assistente de IA do restaurante: como a IA atende os clientes no WhatsApp (menu numerado com o
 * pedido inteiro pela conversa, perguntas livres), o que ela pode fazer e os itens que oferece.
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
        (k) => k !== 'whatsappEnabled' && blank(form[k]) !== blank(o.settings[k]),
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

  /** Prévia do calendário de reservas em PDF que a IA manda (com o que está salvo). */
  function pdf() {
    downloadFile('/api/v1/ai-agent/pdf/calendar', 'calendario-reservas.pdf').catch((e: Error) =>
      toast(e.message, 'danger'),
    );
  }

  if (!o || !form)
    return error ? <Alert tone="danger">{error}</Alert> : <Skeleton variant="form" />;
  const set =
    <K extends keyof AgentSettings>(k: K) =>
    (v: AgentSettings[K]) =>
      setForm((f) => ({ ...f!, [k]: v }));
  const text = (k: 'agentName' | 'greeting' | 'about' | 'rules' | 'handoffMessage') => ({
    value: (form[k] as string | null) ?? '',
    onChange: (e: { target: { value: string } }) => set(k)(e.target.value),
  });
  const name = form.agentName?.trim() || o.defaultName;
  const tone = TONES.find((t) => t.value === form.tone)!;
  const live = form.whatsappEnabled && o.available;

  function submit(e: FormEvent) {
    e.preventDefault();
    const { whatsappEnabled: _skip, ...rest } = form!;
    const clean = Object.fromEntries(
      Object.entries(rest).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]),
    );
    void save(clean);
  }

  const togglePay = (m: PayMethod) => {
    const has = form.payMethods.includes(m);
    if (has && form.payMethods.length === 1) {
      toast('Deixe pelo menos uma forma de pagamento', 'danger');
      return;
    }
    set('payMethods')(
      has
        ? form.payMethods.filter((x) => x !== m)
        : PAY.map((p) => p.value).filter((v) => v === m || form.payMethods.includes(v)),
    );
  };

  return (
    <HelpScope dict={HELP}>
      <h1 className="page-title cm-sr-only">Assistente de IA</h1>

      <Card
        searchId="secao-ia-ligar"
        title="Atendimento no WhatsApp"
        actions={
          <Badge tone={live ? 'success' : 'neutral'}>
            {form.whatsappEnabled
              ? o.available
                ? 'respondendo'
                : 'ligado, aguardando'
              : 'desligado'}
          </Badge>
        }
      >
        <div className="ai-hero">
          <div className="ai-hero__main">
            <p className="ai-hero__lead">
              <span className="ai-dot" data-on={live || undefined} aria-hidden />
              {live
                ? `${name} está atendendo os clientes no WhatsApp.`
                : form.whatsappEnabled
                  ? `${name} está ligado e começa a responder assim que a IA for liberada.`
                  : `${name} está desligado: os clientes falam só com a equipe.`}
            </p>
            <p className="cm-hint ai-hero__sub">
              {form.menuMode
                ? 'O cliente escolhe por números e faz o pedido inteiro pela conversa. A IA só entra nas perguntas livres e nos pedidos escritos, o que gasta bem menos.'
                : 'A IA responde tudo pela conversa, sem menu numerado.'}
            </p>
            <div className="ai-hero__actions">
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
          </div>
          <ol className="ai-checklist" aria-label="Para começar">
            <Step n={1} done={o.whatsapp?.connected}>
              Conecte o WhatsApp da loja em <Link to="/whatsapp?foco=secao-qr">WhatsApp</Link>
            </Step>
            <Step n={2} done={!dirty}>
              Escolha o que a IA faz (abaixo) e salve
            </Step>
            <Step n={3} done={form.whatsappEnabled}>
              Ligue o atendimento
            </Step>
          </ol>
        </div>
        {o.reason && (
          <Alert tone={o.reason === 'platform' ? 'info' : 'warning'}>{REASON[o.reason]}</Alert>
        )}
        {o.whatsapp?.connected && o.whatsapp.inboundOff && (
          <Alert tone="danger">
            O WhatsApp está conectado, mas as mensagens dos clientes não estão chegando ao Comandou,
            então a IA não tem o que responder. Falta um ajuste no servidor; fale com o suporte do
            Comandou.
          </Alert>
        )}
        <Usage u={o.usage} />
      </Card>

      <form className="ai-form" onSubmit={submit}>
        <Card
          searchId="secao-ia-menu"
          title="Atendimento por menu"
          actions={
            <Toggle
              label="Atendimento por menu"
              checked={form.menuMode}
              onChange={set('menuMode')}
              bare
            />
          }
        >
          <div className="ai-menu">
            <div className="ai-menu__opts">
              {form.menuMode ? (
                <>
                  <OptGroup title="Opções do menu">
                    <Toggle
                      label="Fazer um pedido"
                      hint="O pedido inteiro pela conversa: cadastro, entrega, itens, complementos, pagamento e confirmação."
                      checked={form.takeOrders}
                      onChange={set('takeOrders')}
                    />
                    <Toggle
                      label="Acompanhar meu pedido"
                      hint="Mostra a situação dos pedidos de hoje feitos com o número da conversa."
                      checked={form.orderStatus}
                      onChange={set('orderStatus')}
                    />
                    <Toggle
                      label="Reservar uma mesa"
                      hint="Mostra os horários livres e só grava depois do SIM do cliente. Precisa das reservas ligadas em Reservas."
                      checked={form.takeReservations}
                      onChange={set('takeReservations')}
                    />
                    <Toggle
                      label="Horários e endereço"
                      hint="Horário, endereço, taxa de entrega e formas de pagamento, sem gastar a IA."
                      checked={form.showInfo}
                      onChange={set('showInfo')}
                    />
                    <Toggle
                      label="Responder perguntas livres com IA"
                      hint="Fora do menu, a IA responde dúvidas sobre o cardápio e a loja. Desligado, ela mostra o menu de novo."
                      checked={form.freeChat}
                      onChange={set('freeChat')}
                    />
                  </OptGroup>
                  {form.takeOrders && (
                    <>
                      <OptGroup title="Pedido">
                        <Toggle
                          label="Entrega"
                          hint="Endereço com a taxa da área de entrega, como no cardápio online."
                          checked={form.orderDelivery}
                          onChange={set('orderDelivery')}
                        />
                        <Toggle
                          label="Retirada na loja"
                          checked={form.orderPickup}
                          onChange={set('orderPickup')}
                        />
                        <div className="ai-opt ai-opt--pay">
                          <span>
                            <strong>Formas de pagamento</strong>
                            <small>Na entrega ou na retirada. Dinheiro pergunta o troco.</small>
                          </span>
                          <div className="ai-pay" role="group" aria-label="Formas de pagamento">
                            {PAY.map((p) => {
                              const on = form.payMethods.includes(p.value);
                              return (
                                <button
                                  key={p.value}
                                  type="button"
                                  className="ai-pay__chip"
                                  aria-pressed={on}
                                  onClick={() => togglePay(p.value)}
                                >
                                  {on && <Check size={14} aria-hidden />}
                                  {p.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <Toggle
                          label="Entender pedido escrito"
                          hint={
                            'O cliente pode escrever "2 smash e 1 coca". Primeiro o Comandou lê sozinho; só o que ele não entender vai para a IA.'
                          }
                          checked={form.understandText}
                          onChange={set('understandText')}
                        />
                        <Toggle
                          label="Perguntar observação de cada item"
                          hint="Ex.: sem cebola, ponto da carne."
                          checked={form.itemNotes}
                          onChange={set('itemNotes')}
                        />
                        <Toggle
                          label="Sugerir um acompanhamento"
                          hint="Na sacola, oferece uma bebida ou sobremesa que o cliente ainda não pediu."
                          checked={form.suggestItems}
                          onChange={set('suggestItems')}
                        />
                        <Toggle
                          label="Mostrar preços"
                          checked={form.showPrices}
                          onChange={set('showPrices')}
                        />
                        <Toggle
                          label="Mandar link para acompanhar o pedido"
                          hint="Depois de confirmado. Desligado, o cliente acompanha pelo próprio WhatsApp (opção Acompanhar)."
                          checked={form.sendTracking}
                          onChange={set('sendTracking')}
                        />
                      </OptGroup>
                      <OptGroup title="Cadastro do cliente">
                        <Toggle
                          label="Oferecer cadastro"
                          hint="Sem cadastro com o número, pergunta se quer se cadastrar (só o nome). O pedido e os endereços ficam salvos."
                          checked={form.offerSignup}
                          onChange={set('offerSignup')}
                        />
                        <Toggle
                          label="Deixar pedir sem cadastro"
                          hint="Desligado, quem não tem cadastro se cadastra antes de pedir."
                          checked={form.guestOrders || !form.offerSignup}
                          disabled={!form.offerSignup}
                          onChange={set('guestOrders')}
                        />
                      </OptGroup>
                    </>
                  )}
                </>
              ) : (
                <OptGroup title="Sem menu">
                  <Toggle
                    label="Mandar o link do cardápio online"
                    hint="Quando o cliente quer pedir, a IA manda o link da loja online."
                    checked={form.sendStoreLink}
                    onChange={set('sendStoreLink')}
                  />
                  <Toggle
                    label="Fazer reservas de mesa"
                    hint="Mostra os horários livres e só grava depois do SIM do cliente."
                    checked={form.takeReservations}
                    onChange={set('takeReservations')}
                  />
                  <Toggle
                    label="Sugerir itens e adicionais"
                    checked={form.suggestItems}
                    onChange={set('suggestItems')}
                  />
                  <Toggle
                    label="Informar preços"
                    checked={form.showPrices}
                    onChange={set('showPrices')}
                  />
                </OptGroup>
              )}
              <OptGroup title="Arquivos">
                <Toggle
                  label="Mandar o cardápio e o calendário"
                  hint="Quando o cliente pede, manda o cardápio que vocês subiram (abaixo) e o calendário de reservas em PDF."
                  checked={form.sendPdfs}
                  onChange={set('sendPdfs')}
                />
                <div className="ai-pdfs">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon={<FileDown size={16} />}
                    onClick={pdf}
                  >
                    Ver o calendário em PDF
                  </Button>
                </div>
              </OptGroup>
            </div>
            <WaPreview form={form} name={name} />
          </div>
        </Card>

        <Card searchId="secao-ia-jeito" title="Jeito de atender">
          <div className="cm-form ai-style">
            <TextField
              label="Nome do atendente"
              placeholder={o.defaultName}
              maxLength={30}
              {...text('agentName')}
            />
            <TextField
              label="Mensagem de boas-vindas"
              placeholder={`Olá! Aqui é ${name}. Como posso ajudar?`}
              maxLength={300}
              {...text('greeting')}
            />
            <div className="cm-field cm-form__wide">
              <span className="cm-label">Jeito de falar</span>
              <Segmented<Tone>
                label="Jeito de falar"
                value={form.tone}
                onChange={set('tone')}
                options={TONES.map((t) => ({ value: t.value, label: t.label }))}
              />
              <div className="ai-bubble" aria-live="polite">
                <small>Exemplo de resposta livre</small>
                <WaText text={tone.example} />
              </div>
            </div>
            <Area
              label="Sobre a casa"
              hint="Estacionamento, promoções, opções especiais… Uma informação por linha."
              placeholder={'Terça é dia de burger em dobro.\nTemos opção sem glúten.'}
              max={1500}
              rows={4}
              {...text('about')}
            />
            <Area
              label="O que a IA não deve fazer"
              hint="Ela já não dá desconto e não pede dados de cartão."
              placeholder={'Não prometer horário exato.\nNão falar de outros restaurantes.'}
              max={1000}
              rows={4}
              {...text('rules')}
            />
            <TextField
              label="Quando precisar de uma pessoa"
              placeholder="Vou chamar alguém da nossa equipe para continuar com você, só um instante."
              hint="A IA responde isso, avisa a equipe no chat e fica quieta na conversa por 12 horas."
              wrapClass="cm-form__wide"
              maxLength={300}
              {...text('handoffMessage')}
            />
          </div>
          <p className="cm-hint ai-never">
            Sempre: fala só do que está liberado no cardápio, não inventa preço nem promoção, não dá
            desconto, não pede dados de cartão, não manda link de fora nem chave Pix, recusa assunto
            que não é do restaurante e não sai do papel. Quem insiste em golpe ou ofensa fica 24
            horas sem resposta da IA, e a equipe é avisada.
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
      <MenuFilesCard />
    </HelpScope>
  );
}

/** Interruptor com título e explicação. `bare`: só o interruptor (no topo do cartão). */
function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
  bare,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange(v: boolean): void;
  disabled?: boolean;
  bare?: boolean;
}) {
  const input = (
    <span className="switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={bare ? label : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch__track" aria-hidden />
    </span>
  );
  if (bare) return <label className="ai-opt--bare">{input}</label>;
  return (
    <label className="ai-opt" data-off={disabled || undefined}>
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      {input}
    </label>
  );
}

function OptGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ai-optgroup">
      <h3>{title}</h3>
      <div className="ai-optgroup__list">{children}</div>
    </section>
  );
}

const KEYCAPS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

/**
 * Prévia da primeira mensagem do menu, do jeito que o cliente vê no WhatsApp (mesmas opções que
 * o servidor monta em `homeEntries`, apps/api/src/chat/wa-flow.ts).
 */
function WaPreview({ form, name }: { form: AgentSettings; name: string }) {
  const lines = form.menuMode
    ? [
        form.takeOrders && '🛵 Fazer um pedido',
        form.orderStatus && '📦 Acompanhar meu pedido',
        '📖 Ver o cardápio',
        form.takeReservations && '📅 Reservar uma mesa',
        form.showInfo && '🕒 Horários e endereço',
        '🙋 Falar com uma pessoa',
      ].filter((l): l is string => !!l)
    : [];
  const hello = form.greeting?.trim()
    ? form.greeting.trim()
    : `Olá, *Maria*! 👋 Aqui é *${name}*, da sua loja.`;
  const text = form.menuMode
    ? [
        hello,
        '_Como posso te ajudar?_',
        '',
        ...lines.map((l, i) => `${KEYCAPS[i + 1]} ${l}`),
        '',
        '> Responda com o *número* da opção.',
      ].join('\n')
    : `${hello}\nComo posso ajudar?`;
  return (
    <aside className="ai-wa" aria-label="Prévia no WhatsApp">
      <span className="ai-wa__title">Como o cliente vê</span>
      <div className="ai-wa__screen">
        <div className="ai-wa__msg ai-wa__msg--in">oi</div>
        <div className="ai-wa__msg ai-wa__msg--out">
          <WaText text={text} />
        </div>
        {form.menuMode && form.takeOrders && (
          <>
            <div className="ai-wa__msg ai-wa__msg--in">2 smash e 1 coca</div>
            <div className="ai-wa__msg ai-wa__msg--out">
              <WaText
                text={[
                  '✅ Adicionei *2× Smash duplo*.',
                  '',
                  '🛒 *Sua sacola*',
                  `- 2× Smash duplo${form.showPrices ? ' — R$ 73,80' : ''}`,
                  `- 1× Coca-Cola lata${form.showPrices ? ' — R$ 7,00' : ''}`,
                  form.showPrices ? '_Subtotal: R$ 80,80_' : '',
                  '',
                  '1️⃣ ➕ Adicionar mais itens',
                  '2️⃣ ✅ Fechar o pedido',
                  '3️⃣ 🗑️ Tirar um item',
                ]
                  .filter((l, i, a) => l !== '' || a[i - 1] !== '')
                  .join('\n')}
              />
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

interface MenuFile {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
}

const MB = 1024 * 1024;

/** Foto do cardápio: reduz para até 2400 px no lado maior (texto ainda legível) e vira JPEG. */
async function menuPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error(`Não foi possível ler a foto ${file.name}`);
  });
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff'; // PNG com fundo transparente não fica preto no JPEG
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const q of [0.88, 0.8, 0.7]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= 3 * MB) return blob;
  }
  throw new Error(`A foto ${file.name} ficou grande demais; tente uma menor`);
}

const sizeText = (n: number) =>
  n >= MB
    ? `${(n / MB).toFixed(1).replace('.', ',')} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;

/**
 * O cardápio que a IA manda no WhatsApp: o próprio arquivo do restaurante (PDF ou fotos), na
 * ordem em que foi enviado. Sem arquivo, a opção "Ver o cardápio" manda a lista em texto.
 */
function MenuFilesCard() {
  const toast = useToast();
  const [files, setFiles] = useState<MenuFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<MenuFile[]>('/ai-agent/menu-files')
      .then(setFiles)
      .catch((e: Error) => toast(e.message, 'danger'));
  }, [toast]);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(list)) {
        const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
        if (!isPdf && !f.type.startsWith('image/'))
          throw new Error(`${f.name}: envie PDF ou foto (JPG ou PNG)`);
        if (isPdf && f.size > 10 * MB) throw new Error(`${f.name} passa de 10 MB`);
        const body = isPdf ? f : await menuPhoto(f);
        const next = await api<MenuFile[]>(
          `/ai-agent/menu-files?name=${encodeURIComponent(f.name.slice(0, 120))}`,
          {
            method: 'POST',
            body,
            headers: { 'Content-Type': isPdf ? 'application/pdf' : 'image/jpeg' },
          },
        );
        setFiles(next);
      }
      toast('Cardápio salvo. A IA já manda este arquivo no WhatsApp.', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove(f: MenuFile) {
    try {
      setFiles(await api<MenuFile[]>(`/ai-agent/menu-files/${f.id}`, { method: 'DELETE' }));
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  return (
    <Card
      searchId="secao-ia-arquivo"
      title="Cardápio para mandar no WhatsApp"
      actions={
        <Button
          type="button"
          size="sm"
          variant="secondary"
          icon={<Upload size={16} />}
          loading={busy}
          disabled={(files?.length ?? 0) >= 10}
          onClick={() => input.current?.click()}
        >
          Enviar arquivo
        </Button>
      }
    >
      <p className="cm-hint" style={{ marginTop: 0 }}>
        PDF (até 10 MB) ou fotos (JPG ou PNG). Quando o cliente escolhe Ver o cardápio, a IA manda
        estes arquivos na ordem abaixo. Sem arquivo, ela manda a lista dos itens em texto.
      </p>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept="application/pdf,.pdf,image/jpeg,image/png"
        onChange={(e) => upload(e.target.files)}
      />
      {!files ? (
        <Skeleton />
      ) : files.length === 0 ? (
        <EmptyState
          icon={<FileText size={20} />}
          title="Nenhum arquivo ainda"
          description="Envie o PDF ou as fotos do cardápio."
        />
      ) : (
        <ul className="ai-files">
          {files.map((f, i) => (
            <li key={f.id}>
              <span className="ai-files__n">{i + 1}</span>
              {f.contentType === 'application/pdf' ? (
                <FileText size={18} aria-hidden />
              ) : (
                <ImageIcon size={18} aria-hidden />
              )}
              <a
                className="ai-files__name"
                href={`/api/v1/ai-agent/menu-files/${f.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {f.fileName}
              </a>
              <small>{sizeText(f.size)}</small>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={<Trash2 size={16} />}
                aria-label={`Apagar ${f.fileName}`}
                onClick={() => remove(f)}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function pick<T extends object>(o: T, keys: string[]): Partial<T> {
  return Object.fromEntries(keys.map((k) => [k, o[k as keyof T]])) as Partial<T>;
}

function Step({ n, done, children }: { n: number; done?: boolean; children: ReactNode }) {
  return (
    <li className="ai-step" data-done={done || undefined}>
      <span className="ai-step__n" aria-hidden>
        {done ? <CheckCheck size={14} /> : n}
      </span>
      <span>{children}</span>
    </li>
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

type ItemFilter = 'all' | 'on' | 'off' | 'out';

const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Itens que a IA pode oferecer: cartões com a foto, por categoria, com busca e filtros. */
function MenuCard() {
  const toast = useToast();
  const [rows, setRows] = useState<MenuRow[] | null>(null);
  const [term, setTerm] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [filter, setFilter] = useState<ItemFilter>('all');
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

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return [...m.entries()];
  }, [rows]);

  const shown = useMemo(() => {
    const t = fold(term.trim());
    return (rows ?? []).filter(
      (r) =>
        (!cat || r.category === cat) &&
        (filter === 'all' ||
          (filter === 'on' && r.aiVisible) ||
          (filter === 'off' && !r.aiVisible) ||
          (filter === 'out' && r.soldOut)) &&
        (!t || fold(`${r.name} ${r.category}`).includes(t)),
    );
  }, [rows, term, cat, filter]);

  const groups = useMemo(() => {
    const m = new Map<string, MenuRow[]>();
    for (const r of shown) m.set(r.category, [...(m.get(r.category) ?? []), r]);
    return [...m.entries()];
  }, [shown]);

  const on = rows?.filter((r) => r.aiVisible).length ?? 0;
  const out = rows?.filter((r) => r.soldOut).length ?? 0;
  const ids = shown.map((r) => r.id);
  const shownOn = shown.filter((r) => r.aiVisible).length;
  return (
    <Card
      searchId="secao-ia-cardapio"
      title="Itens que a IA pode oferecer"
      actions={
        rows && <Badge tone={on ? 'brand' : 'warning'}>{`${on} de ${rows.length} liberados`}</Badge>
      }
    >
      {!rows ? (
        <Skeleton variant="grid" />
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
              label="Pesquisar"
              wrapClass="ai-search"
              aria-label="Pesquisar item ou categoria"
              leading={<Search size={16} />}
              placeholder="Pesquisar"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            <Segmented<ItemFilter>
              label="Mostrar"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `Todos ${rows.length}` },
                { value: 'on', label: `Liberados ${on}` },
                { value: 'off', label: `Fora ${rows.length - on}` },
                ...(out ? [{ value: 'out' as const, label: `Esgotados ${out}` }] : []),
              ]}
            />
          </div>
          <div className="ai-cats" role="group" aria-label="Categorias">
            <button
              type="button"
              className="ai-pay__chip"
              aria-pressed={cat === null}
              onClick={() => setCat(null)}
            >
              Todas
            </button>
            {cats.map(([c, n]) => (
              <button
                key={c}
                type="button"
                className="ai-pay__chip"
                aria-pressed={cat === c}
                onClick={() => setCat(cat === c ? null : c)}
              >
                {c} <span className="ai-cats__n">{n}</span>
              </button>
            ))}
          </div>
          {shown.length > 0 && (
            <div className="ai-bulk">
              <span className="cm-hint">
                {shown.length === rows.length
                  ? `${shownOn} de ${shown.length} marcados`
                  : `${shownOn} de ${shown.length} marcados nesta lista`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || shownOn === shown.length}
                onClick={() =>
                  toggle(
                    shown.length === rows.length
                      ? { all: true, visible: true }
                      : { ids, visible: true },
                  )
                }
              >
                Marcar {shown.length === rows.length ? 'todos' : 'estes'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || shownOn === 0}
                onClick={() =>
                  toggle(
                    shown.length === rows.length
                      ? { all: true, visible: false }
                      : { ids, visible: false },
                  )
                }
              >
                Desmarcar {shown.length === rows.length ? 'todos' : 'estes'}
              </Button>
            </div>
          )}
          {groups.length === 0 && (
            <EmptyState icon={<Search size={20} />} title="Nenhum item com esse filtro" />
          )}
          {groups.map(([c, items]) => {
            const allOn = items.every((i) => i.aiVisible);
            return (
              <section key={c} className="ai-cat">
                <header>
                  <h3>
                    {c}{' '}
                    <span className="ai-cats__n">
                      {items.filter((i) => i.aiVisible).length}/{items.length}
                    </span>
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => toggle({ ids: items.map((i) => i.id), visible: !allOn })}
                  >
                    {allOn ? 'Desmarcar categoria' : 'Marcar categoria'}
                  </Button>
                </header>
                <ul className="ai-items">
                  {items.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        className="ai-itemcard"
                        aria-pressed={i.aiVisible}
                        disabled={busy}
                        onClick={() => toggle({ ids: [i.id], visible: !i.aiVisible })}
                      >
                        <span className="ai-itemcard__ph">
                          <ItemThumb src={mediaUrl(i.imageId)} name={i.name} size={64} />
                          <span className="ai-itemcard__check" aria-hidden>
                            <Check size={13} strokeWidth={3} />
                          </span>
                        </span>
                        <span className="ai-itemcard__body">
                          <span className="ai-itemcard__name">{i.name}</span>
                          {i.description && (
                            <span className="ai-itemcard__desc">{i.description}</span>
                          )}
                          <span className="ai-itemcard__foot">
                            <span className="ai-itemcard__price">
                              {Number(i.price).toLocaleString('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              })}
                            </span>
                            {i.soldOut && <Badge tone="warning">esgotado</Badge>}
                          </span>
                        </span>
                      </button>
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
