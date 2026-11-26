import { normalizeCouponCode } from '@comandou/shared';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CircleHelp,
  Instagram,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Segmented,
  Skeleton,
  TextField,
  useToast,
} from '../design-system';
import { api, type Product } from '../lib/api';
import { mediaUrl } from '../lib/media';
import { AreaField, isoOf, localInput, Switch } from './admin-fields';
import type { AdminCoupon } from './CouponsPanel';
import { SelectField } from './forms';
import { ImagePicker } from './ImagePicker';
import './app-admin.css';

type Target = 'none' | 'product' | 'coupon';
interface Notice {
  id: string;
  title: string;
  body: string | null;
  imageId: string | null;
  targetType: Target;
  target: string | null;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
  createdAt: string;
}
interface FaqRow {
  key: string;
  section: string;
  question: string;
  answer: string;
  active: boolean;
}
interface Overview {
  about: string | null;
  instagram: string | null;
  faq: (Omit<FaqRow, 'key'> & { id: string })[];
  notices: Notice[];
}

const EMPTY_NOTICE = {
  title: '',
  body: '',
  imageId: null as string | null,
  targetType: 'none' as Target,
  target: '',
  startsAt: '',
  endsAt: '',
  active: true,
};
type NoticeForm = typeof EMPTY_NOTICE;

let seq = 0;
const keyOf = () => `f${++seq}`;

/** Perguntas prontas para começar: a loja ajusta cada resposta ao seu jeito antes de salvar. */
const READY_FAQ: Omit<FaqRow, 'key' | 'active'>[] = [
  {
    section: 'Pedidos',
    question: 'Como faço um pedido?',
    answer:
      'Escolha os itens no cardápio e toque em Adicionar. Na sacola, escolha entrega ou retirada, confira o endereço e a forma de pagamento e toque em Fazer pedido.',
  },
  {
    section: 'Pedidos',
    question: 'Como acompanho o meu pedido?',
    answer:
      'Na aba Pedidos você vê cada passo: recebido, em preparo, a caminho e entregue. A tela atualiza sozinha.',
  },
  {
    section: 'Pedidos',
    question: 'Posso mudar ou cancelar o pedido?',
    answer:
      'Fale com a loja o quanto antes pelo WhatsApp. Depois que o pedido entra em preparo, a mudança depende da cozinha.',
  },
  {
    section: 'Entrega e retirada',
    question: 'Quanto tempo demora a entrega?',
    answer: 'Em média de 40 a 60 minutos, conforme o movimento da loja.',
  },
  {
    section: 'Entrega e retirada',
    question: 'Posso retirar na loja?',
    answer:
      'Pode. Escolha Retirada na sacola e busque no balcão quando o pedido ficar pronto: o app avisa.',
  },
  {
    section: 'Pagamento',
    question: 'Quais as formas de pagamento?',
    answer: 'Pix e cartão pelo app, ou dinheiro e cartão na entrega.',
  },
  {
    section: 'Pontos e cupons',
    question: 'Como funcionam os pontos?',
    answer:
      'Cada pedido concluído soma pontos na sua conta. Na aba Conta › Pontos você vê o saldo e troca por recompensas, aqui no app ou no balcão, mostrando o PIN.',
  },
  {
    section: 'Pontos e cupons',
    question: 'Como uso um cupom?',
    answer:
      'Na aba Cupons, toque em Usar no cupom que quiser: o desconto aparece na sacola. Também dá para digitar o código na finalização. Vale um cupom por pedido.',
  },
];

const when = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

function noticeState(n: Notice): { label: string; tone: 'success' | 'info' | 'neutral' } {
  const now = Date.now();
  if (!n.active) return { label: 'Desligado', tone: 'neutral' };
  if (new Date(n.startsAt).getTime() > now) return { label: 'Agendado', tone: 'info' };
  if (n.endsAt && new Date(n.endsAt).getTime() <= now)
    return { label: 'Encerrado', tone: 'neutral' };
  return { label: 'No app', tone: 'success' };
}

/**
 * Loja online › App do cliente: o que a loja escreve para as telas da aba Conta do cardápio.
 * Avisos (tela Notificações), perguntas da Ajuda e o texto do Sobre com o Instagram.
 */
export function AppContentPanel({
  canManage,
  products,
}: {
  canManage: boolean;
  products: Product[];
}) {
  const toast = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  // Avisos
  const [edit, setEdit] = useState<Notice | 'new' | null>(null);
  const [form, setForm] = useState<NoticeForm>(EMPTY_NOTICE);
  const setF = <K extends keyof NoticeForm>(k: K, v: NoticeForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  // Ajuda
  const [faq, setFaq] = useState<FaqRow[]>([]);
  const saved = useRef('[]');
  // Sobre
  const [about, setAbout] = useState({ about: '', instagram: '' });

  const fillFaq = (rows: Overview['faq']) => {
    const next = rows.map((f) => ({
      key: keyOf(),
      section: f.section,
      question: f.question,
      answer: f.answer,
      active: f.active,
    }));
    setFaq(next);
    saved.current = JSON.stringify(next.map(({ key: _k, ...r }) => r));
  };

  const load = useCallback(
    () =>
      api<Overview>('/app-content').then(
        (r) => {
          setData(r);
          setFailed(false);
          fillFaq(r.faq);
          setAbout({ about: r.about ?? '', instagram: r.instagram ?? '' });
        },
        (e: Error) => {
          setFailed(true);
          toast(e.message, 'danger');
        },
      ),
    [toast],
  );
  useEffect(() => void load(), [load]);
  useEffect(() => {
    api<AdminCoupon[]>('/coupons').then(setCoupons, () => setCoupons([]));
  }, []);

  const productName = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);
  const targetText = (n: Notice) =>
    n.targetType === 'product'
      ? `Abre ${productName.get(n.target ?? '') ?? 'um produto'}`
      : n.targetType === 'coupon'
        ? `Mostra o cupom ${n.target}`
        : null;

  // ------------------------------------------------------------ avisos
  function openNotice(n: Notice | 'new') {
    setEdit(n);
    setForm(
      n === 'new'
        ? EMPTY_NOTICE
        : {
            title: n.title,
            body: n.body ?? '',
            imageId: n.imageId,
            targetType: n.targetType,
            target: n.target ?? '',
            startsAt: localInput(n.startsAt),
            endsAt: localInput(n.endsAt),
            active: n.active,
          },
    );
  }

  async function run(tag: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(tag);
    try {
      await fn();
      toast(ok, 'success');
      await load();
      return true;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return false;
    } finally {
      setBusy(null);
    }
  }

  const noticeErr =
    form.startsAt && form.endsAt && form.endsAt <= form.startsAt
      ? 'O fim precisa ser depois do início'
      : undefined;
  const noticeInvalid =
    !form.title.trim() || !!noticeErr || (form.targetType !== 'none' && !form.target);

  async function saveNotice() {
    const json = {
      title: form.title.trim(),
      body: form.body.trim() || null,
      imageId: form.imageId,
      targetType: form.targetType,
      target:
        form.targetType === 'coupon'
          ? normalizeCouponCode(form.target)
          : form.targetType === 'product'
            ? form.target
            : null,
      startsAt: isoOf(form.startsAt),
      endsAt: isoOf(form.endsAt),
      active: form.active,
    };
    const ok = await run(
      'notice',
      () =>
        edit === 'new'
          ? api('/app-content/notices', { method: 'POST', json })
          : api(`/app-content/notices/${(edit as Notice).id}`, { method: 'PATCH', json }),
      edit === 'new' ? 'Aviso publicado' : 'Aviso salvo',
    );
    if (ok) setEdit(null);
  }

  // ------------------------------------------------------------ ajuda
  const faqDirty = JSON.stringify(faq.map(({ key: _k, ...r }) => r)) !== saved.current;
  const faqBad = faq.findIndex(
    (f) => !f.section.trim() || f.question.trim().length < 3 || !f.answer.trim(),
  );
  const sections = [...new Set(faq.map((f) => f.section.trim()).filter(Boolean))];
  const patchFaq = (key: string, patch: Partial<FaqRow>) =>
    setFaq((all) => all.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) =>
    setFaq((all) => {
      const next = [...all];
      const j = i + d;
      if (j < 0 || j >= next.length) return all;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  async function saveFaq() {
    if (faqBad >= 0)
      return toast(
        `Pergunta ${faqBad + 1}: preencha o assunto, a pergunta (3 letras ou mais) e a resposta`,
        'danger',
      );
    setBusy('faq');
    try {
      const rows = await api<Overview['faq']>('/app-content/faq', {
        method: 'PUT',
        json: {
          items: faq.map((f) => ({
            section: f.section.trim(),
            question: f.question.trim(),
            answer: f.answer.trim(),
            active: f.active,
          })),
        },
      });
      fillFaq(rows);
      toast('Perguntas salvas', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  // ------------------------------------------------------------ sobre
  const aboutDirty =
    !!data &&
    (about.about.trim() !== (data.about ?? '') ||
      about.instagram.trim().replace(/^@+/, '') !== (data.instagram ?? ''));

  if (!data)
    return failed ? (
      <EmptyState
        icon={<CircleHelp size={20} />}
        title="Não deu para abrir o conteúdo do app"
        description="Confira a conexão e tente de novo."
        action={
          <Button variant="secondary" onClick={() => void load()}>
            Tentar de novo
          </Button>
        }
      />
    ) : (
      <Skeleton variant="form" />
    );

  const liveCoupons = coupons.filter((c) => c.active);
  return (
    <div className="os-stack">
      <Card
        title="Avisos"
        actions={
          canManage && (
            <Button
              variant="secondary"
              icon={<Plus size={16} />}
              onClick={() => openNotice('new')}
              disabled={!!busy}
            >
              Novo aviso
            </Button>
          )
        }
      >
        <p className="cm-hint aa-lead">
          Aparecem em Conta › Notificações do app, com um número no quadrado até o cliente abrir.
          Use para novidades, promoções e mudanças de horário. Um aviso pode abrir um produto ou
          mostrar um cupom.
        </p>
        {data.notices.length === 0 ? (
          <EmptyState
            icon={<Bell size={20} />}
            title="Nenhum aviso ainda"
            description="Ex.: “Sábado tem rodízio de pizza”, com a foto e o botão para pedir."
          />
        ) : (
          <ul className="aa-list">
            {data.notices.map((n) => {
              const st = noticeState(n);
              const img = mediaUrl(n.imageId);
              return (
                <li key={n.id} className="aa-row" data-off={st.tone === 'neutral' || undefined}>
                  {img ? (
                    <img className="aa-thumb" src={img} alt="" loading="lazy" />
                  ) : (
                    <span className="aa-thumb" aria-hidden>
                      <Bell size={18} />
                    </span>
                  )}
                  <span className="aa-row__text">
                    <strong>{n.title}</strong>
                    {n.body && <small>{n.body}</small>}
                    <small className="aa-row__meta">
                      {new Date(n.startsAt).getTime() > Date.now()
                        ? `Entra em ${when(n.startsAt)}`
                        : `Desde ${when(n.startsAt)}`}
                      {n.endsAt ? ` · até ${when(n.endsAt)}` : ''}
                      {targetText(n) ? ` · ${targetText(n)}` : ''}
                    </small>
                  </span>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {canManage && (
                    <span className="aa-row__actions">
                      <Button
                        variant="ghost"
                        aria-label={`Editar ${n.title}`}
                        icon={<Pencil size={16} />}
                        onClick={() => openNotice(n)}
                      />
                      <Button
                        variant="ghost"
                        aria-label={`Apagar ${n.title}`}
                        icon={<Trash2 size={16} />}
                        onClick={() =>
                          window.confirm(`Apagar o aviso “${n.title}”?`) &&
                          run(
                            'notice',
                            () => api(`/app-content/notices/${n.id}`, { method: 'DELETE' }),
                            'Aviso apagado',
                          )
                        }
                      />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card
        title="Ajuda (perguntas frequentes)"
        actions={
          canManage &&
          faq.length > 0 && (
            <Button
              variant="secondary"
              icon={<Plus size={16} />}
              disabled={faq.length >= 60}
              onClick={() =>
                setFaq((all) => [
                  ...all,
                  {
                    key: keyOf(),
                    section: all.at(-1)?.section ?? 'Pedidos',
                    question: '',
                    answer: '',
                    active: true,
                  },
                ])
              }
            >
              Nova pergunta
            </Button>
          )
        }
      >
        <p className="cm-hint aa-lead">
          A tela Ajuda do app agrupa as perguntas pelo assunto, na ordem daqui. Sem perguntas
          cadastradas, o app mostra perguntas prontas montadas com o que a loja oferece (entrega,
          pagamento, pontos e cupons).
        </p>
        {faq.length === 0 ? (
          <>
            <EmptyState
              icon={<CircleHelp size={20} />}
              title="O app está usando as perguntas prontas"
              description="Para escrever as suas, comece pelas prontas e ajuste cada resposta."
            />
            {canManage && (
              <div className="aa-templates">
                <Button
                  variant="secondary"
                  icon={<Sparkles size={16} />}
                  onClick={() =>
                    setFaq(READY_FAQ.map((f) => ({ ...f, key: keyOf(), active: true })))
                  }
                >
                  Começar com as prontas
                </Button>
                <Button
                  variant="ghost"
                  icon={<Plus size={16} />}
                  onClick={() =>
                    setFaq([
                      { key: keyOf(), section: 'Pedidos', question: '', answer: '', active: true },
                    ])
                  }
                >
                  Escrever do zero
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="aa-faq">
            <datalist id="aa-faq-sections">
              {sections.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            {faq.map((f, i) => (
              <div key={f.key} className="aa-faq__item" data-off={!f.active || undefined}>
                <div className="aa-faq__fields">
                  <TextField
                    label="Assunto"
                    list="aa-faq-sections"
                    maxLength={40}
                    placeholder="Ex.: Pedidos"
                    value={f.section}
                    disabled={!canManage}
                    onChange={(e) => patchFaq(f.key, { section: e.target.value })}
                  />
                  <TextField
                    label="Pergunta"
                    maxLength={160}
                    placeholder="Ex.: Vocês entregam no meu bairro?"
                    value={f.question}
                    disabled={!canManage}
                    onChange={(e) => patchFaq(f.key, { question: e.target.value })}
                  />
                  <AreaField
                    label="Resposta"
                    wide={false}
                    maxLength={2000}
                    rows={3}
                    value={f.answer}
                    onChange={(v) => canManage && patchFaq(f.key, { answer: v })}
                  />
                </div>
                {canManage && (
                  <div className="aa-faq__side">
                    <label className="switch" title={f.active ? 'Aparece no app' : 'Escondida'}>
                      <input
                        type="checkbox"
                        checked={f.active}
                        aria-label={`Pergunta ${i + 1} aparece no app`}
                        onChange={(e) => patchFaq(f.key, { active: e.target.checked })}
                      />
                      <span className="switch__track" aria-hidden />
                    </label>
                    <Button
                      variant="ghost"
                      aria-label="Subir"
                      icon={<ArrowUp size={16} />}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    />
                    <Button
                      variant="ghost"
                      aria-label="Descer"
                      icon={<ArrowDown size={16} />}
                      disabled={i === faq.length - 1}
                      onClick={() => move(i, 1)}
                    />
                    <Button
                      variant="ghost"
                      aria-label="Tirar a pergunta"
                      icon={<Trash2 size={16} />}
                      onClick={() => setFaq((all) => all.filter((x) => x.key !== f.key))}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {canManage && (faq.length > 0 || faqDirty) && (
          <div className="aa-actions">
            {faqDirty && (
              <Button variant="ghost" onClick={() => fillFaq(data.faq)}>
                Desfazer
              </Button>
            )}
            <Button loading={busy === 'faq'} disabled={!faqDirty} onClick={saveFaq}>
              Salvar perguntas
            </Button>
          </div>
        )}
      </Card>

      <Card title="Sobre a loja">
        <div className="cm-form">
          <AreaField
            label="Texto da tela Sobre"
            maxLength={2000}
            rows={4}
            placeholder="Ex.: Desde 2012 fazendo pizza na pedra, com massa de fermentação natural."
            hint="Aparece em Conta › Sobre, com a capa, a logo e o endereço da loja."
            value={about.about}
            onChange={(v) => canManage && setAbout({ ...about, about: v })}
          />
          <TextField
            label="Instagram"
            maxLength={60}
            placeholder="@sualoja"
            hint="Vira um botão para abrir o perfil."
            value={about.instagram}
            disabled={!canManage}
            onChange={(e) => setAbout({ ...about, instagram: e.target.value })}
          />
          {canManage && (
            <div className="cm-form__wide">
              <Button
                variant="secondary"
                icon={<Instagram size={16} />}
                loading={busy === 'about'}
                disabled={!aboutDirty}
                onClick={() =>
                  run(
                    'about',
                    () =>
                      api('/app-content/about', {
                        method: 'PUT',
                        json: {
                          about: about.about.trim() || null,
                          instagram: about.instagram.trim() || null,
                        },
                      }),
                    'Sobre salvo',
                  )
                }
              >
                Salvar Sobre
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Modal
        open={edit !== null}
        size="lg"
        title={edit === 'new' ? 'Novo aviso' : 'Editar aviso'}
        onClose={() => setEdit(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              Cancelar
            </Button>
            <Button loading={busy === 'notice'} disabled={noticeInvalid} onClick={saveNotice}>
              {edit === 'new' ? 'Publicar aviso' : 'Salvar aviso'}
            </Button>
          </>
        }
      >
        <div className="cm-form">
          <TextField
            label="Título"
            required
            maxLength={80}
            placeholder="Ex.: Sábado tem rodízio de pizza"
            value={form.title}
            wrapClass="cm-form__wide"
            onChange={(e) => setF('title', e.target.value)}
          />
          <AreaField
            label="Texto (opcional)"
            maxLength={600}
            rows={3}
            placeholder="Ex.: Das 18h às 23h, todos os sabores por R$ 59,90."
            value={form.body}
            onChange={(v) => setF('body', v)}
          />
          <div className="cm-field cm-form__wide aa-photo">
            <span className="cm-label">Foto (opcional)</span>
            <ImagePicker
              label="Foto do aviso"
              ratio="16 / 9"
              width={220}
              value={form.imageId}
              onChange={(id) => setF('imageId', id)}
            />
          </div>
          <div className="cm-form__block">
            <Segmented
              label="Ao tocar no aviso"
              block
              value={form.targetType}
              onChange={(t) => setForm((f) => ({ ...f, targetType: t, target: '' }))}
              options={[
                { value: 'none', label: 'Só o texto' },
                { value: 'product', label: 'Abre um produto' },
                { value: 'coupon', label: 'Mostra um cupom' },
              ]}
            />
          </div>
          {form.targetType === 'product' && (
            <SelectField
              label="Produto"
              value={form.target}
              onChange={(e) => setF('target', e.target.value)}
            >
              <option value="">Escolha…</option>
              {products
                .filter((p) => p.active || p.id === form.target)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </SelectField>
          )}
          {form.targetType === 'coupon' &&
            (liveCoupons.length === 0 && !form.target ? (
              <Alert tone="warning">Nenhum cupom ligado. Crie um na aba Cupons e volte aqui.</Alert>
            ) : (
              <SelectField
                label="Cupom"
                value={form.target}
                onChange={(e) => setF('target', e.target.value)}
              >
                <option value="">Escolha…</option>
                {form.target && !liveCoupons.some((c) => c.code === form.target) && (
                  <option value={form.target}>{form.target}</option>
                )}
                {liveCoupons.map((c) => (
                  <option key={c.id} value={c.code}>
                    {c.code} · {c.title}
                  </option>
                ))}
              </SelectField>
            ))}
          <TextField
            label="Entra no app (opcional)"
            type="datetime-local"
            hint="Em branco, entra agora."
            value={form.startsAt}
            onChange={(e) => setF('startsAt', e.target.value)}
          />
          <TextField
            label="Sai do app (opcional)"
            type="datetime-local"
            hint="Em branco, fica até você desligar."
            value={form.endsAt}
            error={noticeErr}
            onChange={(e) => setF('endsAt', e.target.value)}
          />
          <Switch label="Aviso ligado" checked={form.active} onChange={(v) => setF('active', v)} />
        </div>
      </Modal>
    </div>
  );
}
