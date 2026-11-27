import {
  CheckCircle2,
  Clock3,
  LogOut,
  MessageCircle,
  Phone,
  QrCode,
  RefreshCw,
  RotateCw,
  Search,
  Smartphone,
  XCircle,
} from 'lucide-react';
import QRCode from 'qrcode';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Segmented,
  TextField,
  useToast,
  Skeleton,
} from '../design-system';
import { dateTime } from '../features/format';
import { WaText } from '../features/wa-text';
import { api } from '../lib/api';
import { NOTICE_KEYS, NoticeKey } from '../lib/types';
import type { MessagingSettings, OutboxMessage, WhatsAppSession } from '../lib/types';
import '../app/home.css';
import './whatsapp.css';

const EVENT: Record<OutboxMessage['event'], string> = {
  'order.accepted': 'Pedido aceito',
  'order.ready': 'Pedido pronto',
  'order.dispatched': 'Saiu para entrega',
  'order.delivered': 'Pedido entregue',
  'order.cancelled': 'Pedido cancelado',
  test: 'Teste',
};
/** Cada aviso: nome na tela, quando ele sai e o evento das mensagens. */
const NOTICE: Record<NoticeKey, { label: string; when: string; event: OutboxMessage['event'] }> = {
  Accepted: {
    label: 'Pedido aceito',
    when: 'Pedido online aceito pela loja',
    event: 'order.accepted',
  },
  Ready: { label: 'Pronto para retirar', when: 'Retirada ou balcão pronto', event: 'order.ready' },
  Dispatched: {
    label: 'Saiu para entrega',
    when: 'Entregador saiu com o pedido',
    event: 'order.dispatched',
  },
  Delivered: { label: 'Entregue', when: 'Entrega concluída', event: 'order.delivered' },
  Cancelled: {
    label: 'Cancelado',
    when: 'Delivery ou retirada cancelado pela loja',
    event: 'order.cancelled',
  },
};
const STATUS: Record<OutboxMessage['status'], [string, 'neutral' | 'success' | 'danger']> = {
  queued: ['Em processo', 'neutral'],
  sent: ['Enviada', 'success'],
  failed: ['Com erro', 'danger'],
};
const SESSION: Record<WhatsAppSession['status'], string> = {
  disconnected: 'Desconectado',
  connecting: 'Conectando…',
  qr: 'Esperando a leitura do QR Code',
  connected: 'Conectado',
  logged_out: 'Desconectado no celular',
};

/** "5519994455157" → "+55 19 99445-5157". */
export function phoneText(p: string | undefined | null): string {
  if (!p) return '';
  const d = p.replace(/\D/g, '');
  const m = /^(55)(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m ? `+${m[1]} ${m[2]} ${m[3]}-${m[4]}` : `+${d}`;
}

/** "há 3 min", "há 2 h", "ontem"… a partir de uma data ISO. */
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'agora há pouco';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return dateTime(iso);
}

const SAMPLE = { cliente: 'Maria', pedido: '18622', restaurante: 'sua loja' };
const fillSample = (t: string) =>
  t.replace(/\{(cliente|pedido|restaurante)\}/g, (_, k: keyof typeof SAMPLE) => SAMPLE[k]);

/**
 * WhatsApp do restaurante: o número conectado por QR Code (Baileys), os avisos de pedido e as
 * mensagens que saíram, com filtros. É a única forma de conexão oferecida (a API oficial da Meta
 * saiu na 0.222.1).
 */
export function WhatsAppPage() {
  const toast = useToast();
  const [s, setS] = useState<MessagingSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MessagingSettings>('/messaging/settings')
      .then(setS)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function save(json: Record<string, unknown>, ok = 'Configuração salva') {
    setBusy(true);
    try {
      setS(await api<MessagingSettings>('/messaging/settings', { method: 'PUT', json }));
      setError(null);
      toast(ok, 'success');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!s) return error ? <Alert tone="danger">{error}</Alert> : <Skeleton variant="detail" />;
  return (
    <>
      <h1 className="page-title cm-sr-only">WhatsApp</h1>
      {s.provider !== 'baileys' && (
        <Alert tone="warning">
          Este restaurante ainda está na conexão antiga pela API oficial da Meta, que não é mais
          oferecida.{' '}
          <Button
            variant="ghost"
            loading={busy}
            onClick={() => save({ provider: 'baileys' }, 'Conexão por QR Code ativada')}
          >
            Usar QR Code
          </Button>
        </Alert>
      )}
      <ConnectionCard s={s} />
      <NoticesCard s={s} busy={busy} save={save} error={error} />
      <MessagesCard />
    </>
  );
}

type SaveFn = (json: Record<string, unknown>, ok?: string) => Promise<boolean>;

/** O número conectado num cartão: situação, últimas mensagens e as ações da conexão. */
function ConnectionCard({ s }: { s: MessagingSettings }) {
  const toast = useToast();
  const [session, setSession] = useState<WhatsAppSession | null>(null);
  const [qrImg, setQrImg] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSession(await api<WhatsAppSession>('/messaging/session'));
    } catch (e) {
      setSession({ status: 'disconnected', error: (e as Error).message });
    }
  }, []);
  useEffect(() => {
    if (s.gatewayConfigured) void refresh();
  }, [refresh, s.gatewayConfigured]);
  // Esperando o QR Code ou a conexão: consulta a cada 3 s. Conectado: a cada 30 s, para a tela
  // não seguir dizendo "Conectado" depois que a conexão cai.
  const status = session?.status;
  const fast = status === 'qr' || status === 'connecting';
  useEffect(() => {
    if (!fast && status !== 'connected') return;
    const t = setInterval(() => !document.hidden && void refresh(), fast ? 3000 : 30_000);
    return () => clearInterval(t);
  }, [status, fast, refresh]);
  useEffect(() => {
    if (session?.status === 'qr' && session.qr)
      QRCode.toDataURL(session.qr, { margin: 1, width: 264 })
        .then(setQrImg)
        .catch(() => setQrImg(null));
    else setQrImg(null);
  }, [session?.status, session?.qr]);

  async function call(what: 'connect' | 'restart' | 'logout', ok: string) {
    setActing(what);
    try {
      setSession(
        await api<WhatsAppSession>(`/messaging/session/${what}`, { method: 'POST', json: {} }),
      );
      toast(ok, 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setActing(null);
    }
  }

  /** Trocar o número: desconecta este aparelho e já mostra um QR Code novo. */
  async function swap() {
    setActing('swap');
    try {
      await api('/messaging/session/logout', { method: 'POST', json: {} });
      setSession(
        await api<WhatsAppSession>('/messaging/session/connect', { method: 'POST', json: {} }),
      );
      toast('Leia o QR Code com o celular do número novo', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setActing(null);
    }
  }

  const connected = session?.status === 'connected';
  const reconnecting = !!session?.reconnecting;
  const tone = connected ? 'on' : reconnecting || fast ? 'wait' : 'off';
  return (
    <Card searchId="secao-qr" title="Número conectado">
      {!s.gatewayConfigured ? (
        <Alert tone="info">O serviço de WhatsApp ainda não está ligado neste servidor.</Alert>
      ) : !session ? (
        <Skeleton variant="detail" />
      ) : (
        <div className="wa-conn">
          <div className="wa-device" data-tone={tone}>
            <span className="wa-device__icon" aria-hidden>
              <Smartphone size={26} />
              <span className="wa-device__dot" />
            </span>
            <div className="wa-device__info">
              <strong className="wa-device__phone cm-selectable">
                {session.phone ? phoneText(session.phone) : 'Nenhum número conectado'}
              </strong>
              <span className="wa-device__status">
                {reconnecting ? 'Reconectando…' : SESSION[session.status]}
              </span>
              <dl className="wa-device__facts">
                {connected && (
                  <div>
                    <dt>No celular aparece como</dt>
                    <dd>Mac OS (computador)</dd>
                  </div>
                )}
                {connected && (
                  <div>
                    <dt>Última mensagem de cliente</dt>
                    <dd>
                      {session.lastInboundAt
                        ? ago(session.lastInboundAt)
                        : 'nenhuma desde a última reconexão'}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
            <div className="wa-device__actions">
              {connected || reconnecting ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<RotateCw size={15} />}
                    loading={acting === 'restart'}
                    disabled={!!acting}
                    onClick={() => call('restart', 'Reiniciando a conexão')}
                  >
                    Reiniciar conexão
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Phone size={15} />}
                    loading={acting === 'swap'}
                    disabled={!!acting}
                    onClick={() => void swap()}
                  >
                    Trocar número
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<LogOut size={15} />}
                    loading={acting === 'logout'}
                    disabled={!!acting}
                    onClick={() => call('logout', 'WhatsApp desconectado')}
                  >
                    Desconectar
                  </Button>
                </>
              ) : session.status === 'qr' || session.status === 'connecting' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<XCircle size={15} />}
                  loading={acting === 'logout'}
                  disabled={!!acting}
                  onClick={() => call('logout', 'Conexão cancelada')}
                >
                  Cancelar
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    icon={<QrCode size={15} />}
                    loading={acting === 'connect'}
                    disabled={!!acting}
                    onClick={() => call('connect', 'Gerando QR Code')}
                  >
                    Conectar WhatsApp
                  </Button>
                  {session.status === 'disconnected' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<RefreshCw size={15} />}
                      loading={acting === 'restart'}
                      disabled={!!acting}
                      onClick={() => call('restart', 'Tentando reconectar com a sessão salva')}
                    >
                      Reconectar
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {session.error && !connected && <Alert tone="warning">{session.error}</Alert>}
          {connected && session.inboundOff && (
            <Alert tone="danger">
              Os avisos de pedido saem, mas as mensagens que os clientes mandam não estão chegando
              ao Comandou: o atendimento da IA não responde. Falta um ajuste no servidor; fale com o
              suporte do Comandou.
            </Alert>
          )}
          {connected && !!session.unreadable && (
            <Alert tone="warning">
              {session.unreadable === 1
                ? 'Uma mensagem de cliente chegou sem abrir neste aparelho.'
                : `${session.unreadable} mensagens de cliente chegaram sem abrir neste aparelho.`}{' '}
              O WhatsApp pede de novo ao celular do cliente. Se continuar, toque em Reiniciar
              conexão; se ainda assim continuar, Trocar número e leia o QR Code de novo.
            </Alert>
          )}
          {session.status === 'qr' && (
            <div className="wa-qr">
              <div className="wa-qr__code">
                {qrImg ? (
                  <img
                    src={qrImg}
                    alt="QR Code para conectar o WhatsApp"
                    width={232}
                    height={232}
                  />
                ) : (
                  <Skeleton variant="qr" size={232} />
                )}
              </div>
              <ol className="wa-qr__steps">
                <li>Abra o WhatsApp no celular do restaurante.</li>
                <li>
                  Toque em <strong>Aparelhos conectados</strong> e depois em{' '}
                  <strong>Conectar um aparelho</strong>.
                </li>
                <li>Aponte a câmera para este código.</li>
                <li>Na lista de aparelhos ele aparece como Mac OS.</li>
              </ol>
            </div>
          )}
          <p className="cm-hint wa-conn__note">
            Funciona como o WhatsApp Web, mas não é oficial: o WhatsApp pode bloquear o número se
            considerar uso indevido. Prefira um número só da loja e evite mensagens em massa. A IA
            que atende os clientes fica em <Link to="/assistente-ia">Assistente de IA</Link>.
          </p>
        </div>
      )}
    </Card>
  );
}

/** Avisos automáticos: liga/desliga cada um e o texto, com a prévia de como o cliente vê. */
function NoticesCard({
  s,
  busy,
  save,
  error,
}: {
  s: MessagingSettings;
  busy: boolean;
  save: SaveFn;
  error: string | null;
}) {
  const [texts, setTexts] = useState(
    () =>
      Object.fromEntries(NOTICE_KEYS.map((k) => [`text${k}`, s[`text${k}`]])) as Record<
        string,
        string
      >,
  );
  const [open, setOpen] = useState<NoticeKey | null>(null);
  const dirty = NOTICE_KEYS.some((k) => texts[`text${k}`] !== s[`text${k}`]);
  const onCount = NOTICE_KEYS.filter((k) => s[`notify${k}`]).length;
  return (
    <Card
      searchId="secao-avisos"
      title="Avisos de pedido"
      actions={
        <label className="wa-master">
          <span>{s.enabled ? `Ligados (${onCount} de ${NOTICE_KEYS.length})` : 'Desligados'}</span>
          <span className="switch">
            <input
              type="checkbox"
              checked={s.enabled}
              disabled={busy}
              aria-label="Avisos de pedido"
              onChange={() =>
                save({ enabled: !s.enabled }, s.enabled ? 'Avisos desligados' : 'Avisos ligados')
              }
            />
            <span className="switch__track" aria-hidden />
          </span>
        </label>
      }
    >
      <p className="cm-hint wa-lead">
        Mensagens automáticas para o cliente a cada passo do pedido. Use {'{cliente}'}, {'{pedido}'}{' '}
        e {'{restaurante}'} no texto e a formatação do WhatsApp (*negrito*, _itálico_). O código de
        “esqueci minha senha” do cardápio também sai por este número.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <form
        className="wa-notices"
        data-off={!s.enabled || undefined}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void save(texts, 'Textos salvos').then((ok) => ok && setOpen(null));
        }}
      >
        {NOTICE_KEYS.map((k) => {
          const on = s[`notify${k}`];
          const t = texts[`text${k}`] ?? '';
          const editing = open === k;
          return (
            <div key={k} className="wa-notice" data-on={on || undefined}>
              <div className="wa-notice__head">
                <span className="switch">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy || !s.enabled}
                    aria-label={NOTICE[k].label}
                    onChange={(e) => save({ [`notify${k}`]: e.target.checked })}
                  />
                  <span className="switch__track" aria-hidden />
                </span>
                <span className="wa-notice__title">
                  <strong>{NOTICE[k].label}</strong>
                  <small>{NOTICE[k].when}</small>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(editing ? null : k)}
                >
                  {editing ? 'Fechar' : 'Editar texto'}
                </Button>
              </div>
              {editing ? (
                <TextField
                  label={`Texto: ${NOTICE[k].label.toLowerCase()}`}
                  value={t}
                  maxLength={1000}
                  autoFocus
                  onChange={(e) => setTexts({ ...texts, [`text${k}`]: e.target.value })}
                />
              ) : null}
              <div className="wa-notice__bubble">
                <WaText text={fillSample(t || '…')} />
              </div>
            </div>
          );
        })}
        {dirty && (
          <div className="wa-notices__save">
            <span>Textos alterados</span>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setTexts(
                  Object.fromEntries(NOTICE_KEYS.map((k) => [`text${k}`, s[`text${k}`]])) as Record<
                    string,
                    string
                  >,
                )
              }
            >
              Desfazer
            </Button>
            <Button
              type="submit"
              loading={busy}
              disabled={Object.values(texts).some((x) => !x.trim())}
            >
              Salvar textos
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

type StatusFilter = 'all' | 'sent' | 'queued' | 'failed';
interface Summary {
  all: number;
  queued: number;
  sent: number;
  failed: number;
  today: number;
}

/** Mensagens que saíram: filtros por situação, aviso e telefone/pedido, e reenvio das com erro. */
function MessagesCard() {
  const toast = useToast();
  const [msgs, setMsgs] = useState<OutboxMessage[] | null>(null);
  const [sum, setSum] = useState<Summary | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [event, setEvent] = useState<OutboxMessage['event'] | ''>('');
  const [term, setTerm] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams({ limit: '100' });
    if (status !== 'all') q.set('status', status);
    if (event) q.set('event', event);
    if (term.replace(/\D/g, '')) q.set('q', term.replace(/\D/g, ''));
    try {
      const [list, s] = await Promise.all([
        api<OutboxMessage[]>(`/messaging/messages?${q}`),
        api<Summary>('/messaging/messages/summary'),
      ]);
      setMsgs(list);
      setSum(s);
    } catch {
      setMsgs((m) => m ?? []);
    } finally {
      setLoading(false);
    }
  }, [status, event, term]);

  useEffect(() => {
    const t = setTimeout(() => void load(), term ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, term]);
  // Mensagens em processo andam sozinhas: confere de novo enquanto houver alguma na fila.
  useEffect(() => {
    if (!sum?.queued) return;
    const t = setInterval(() => !document.hidden && void load(), 10_000);
    return () => clearInterval(t);
  }, [sum?.queued, load]);

  async function retry(id: string) {
    try {
      await api(`/messaging/messages/${id}/retry`, { method: 'POST', json: {} });
      toast('Reenvio na fila', 'success');
      setTimeout(() => void load(), 2500);
      await load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  const events = useMemo(
    () => (Object.keys(EVENT) as OutboxMessage['event'][]).filter((e) => e !== 'test'),
    [],
  );
  const filtered = status !== 'all' || !!event || !!term.trim();
  return (
    <Card
      searchId="secao-mensagens"
      title="Mensagens recentes"
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw size={15} />}
          loading={loading}
          onClick={() => void load()}
        >
          Atualizar
        </Button>
      }
    >
      <div className="wa-filters">
        <Segmented<StatusFilter>
          label="Situação"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: `Todas${sum ? ` ${sum.all}` : ''}` },
            { value: 'sent', label: `Enviadas${sum ? ` ${sum.sent}` : ''}` },
            { value: 'queued', label: `Em processo${sum ? ` ${sum.queued}` : ''}` },
            { value: 'failed', label: `Com erro${sum ? ` ${sum.failed}` : ''}` },
          ]}
        />
        <TextField
          label="Pesquisar"
          wrapClass="wa-search"
          aria-label="Pesquisar por telefone ou número do pedido"
          title="Telefone ou número do pedido"
          leading={<Search size={16} />}
          placeholder="Pesquisar"
          inputMode="numeric"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>
      <div className="wa-events" role="group" aria-label="Aviso">
        <button
          type="button"
          className="wa-chip"
          aria-pressed={!event}
          onClick={() => setEvent('')}
        >
          Todos os avisos
        </button>
        {events.map((e) => (
          <button
            key={e}
            type="button"
            className="wa-chip"
            aria-pressed={event === e}
            onClick={() => setEvent(event === e ? '' : e)}
          >
            {EVENT[e]}
          </button>
        ))}
      </div>
      {!msgs ? (
        <Skeleton variant="table" />
      ) : msgs.length === 0 ? (
        <EmptyState
          icon={<MessageCircle size={20} />}
          title={filtered ? 'Nenhuma mensagem com esse filtro' : 'Nenhuma mensagem ainda'}
          description={filtered ? undefined : 'Os avisos de pedido aparecem aqui assim que saírem.'}
        />
      ) : (
        <ul className="wa-msgs">
          {msgs.map((m) => (
            <li key={m.id} className="wa-msg" data-status={m.status}>
              <span className="wa-msg__icon" aria-hidden>
                {m.status === 'sent' ? (
                  <CheckCircle2 size={18} />
                ) : m.status === 'failed' ? (
                  <XCircle size={18} />
                ) : (
                  <Clock3 size={18} />
                )}
              </span>
              <span className="wa-msg__main">
                <strong>
                  {EVENT[m.event]}
                  {m.orderNumber && (
                    <span className="wa-msg__order"> · Pedido #{m.orderNumber}</span>
                  )}
                </strong>
                <span className="wa-msg__meta">
                  {phoneText(m.toPhone)} · {dateTime(m.sentAt ?? m.createdAt)}
                  {m.attempts > 1 ? ` · ${m.attempts} tentativas` : ''}
                </span>
                {m.lastError && m.status !== 'sent' && (
                  <span className="wa-msg__error">{m.lastError}</span>
                )}
              </span>
              <span className="wa-msg__side">
                <Badge tone={STATUS[m.status][1]}>{STATUS[m.status][0]}</Badge>
                {m.status === 'failed' && (
                  <Button variant="ghost" size="sm" onClick={() => void retry(m.id)}>
                    Reenviar
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
