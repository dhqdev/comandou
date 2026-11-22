import { MessageCircle } from 'lucide-react';
import QRCode from 'qrcode';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  TextField,
  useToast,
  Skeleton,
} from '../design-system';
import { dateTime } from '../features/format';
import { CheckField } from '../features/forms';
import { api } from '../lib/api';
import { NOTICE_KEYS, NoticeKey } from '../lib/types';
import type { MessagingSettings, OutboxMessage, WhatsAppSession } from '../lib/types';

const EVENT: Record<OutboxMessage['event'], string> = {
  'order.accepted': 'Pedido aceito',
  'order.ready': 'Pedido pronto',
  'order.dispatched': 'Saiu para entrega',
  'order.delivered': 'Pedido entregue',
  'order.cancelled': 'Pedido cancelado',
  test: 'Teste',
};
/** Cada aviso: nome na tela e quando ele sai. */
const NOTICE: Record<NoticeKey, { label: string; when: string }> = {
  Accepted: { label: 'Pedido aceito', when: 'pedido online aceito pela loja' },
  Ready: { label: 'Pronto para retirar', when: 'retirada ou balcão pronto' },
  Dispatched: { label: 'Saiu para entrega', when: 'entregador saiu com o pedido' },
  Delivered: { label: 'Entregue', when: 'entrega concluída' },
  Cancelled: { label: 'Cancelado', when: 'delivery ou retirada cancelado pela loja' },
};
const STATUS: Record<OutboxMessage['status'], [string, 'neutral' | 'success' | 'danger']> = {
  queued: ['Na fila', 'neutral'],
  sent: ['Enviada', 'success'],
  failed: ['Falhou', 'danger'],
};
const SESSION: Record<
  WhatsAppSession['status'],
  [string, 'neutral' | 'info' | 'success' | 'warning']
> = {
  disconnected: ['Desconectado', 'neutral'],
  connecting: ['Conectando…', 'info'],
  qr: ['Aguardando leitura do QR Code', 'warning'],
  connected: ['Conectado', 'success'],
  logged_out: ['Desconectado no celular', 'warning'],
};

/**
 * WhatsApp do restaurante: conexão por QR Code (Baileys), como o WhatsApp Web. É a única forma
 * de conexão oferecida na tela (a API oficial da Meta saiu na 0.222.1).
 */
export function WhatsAppPage() {
  const toast = useToast();
  const [s, setS] = useState<MessagingSettings | null>(null);
  const [msgs, setMsgs] = useState<OutboxMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState('');

  const loadMsgs = useCallback(async () => {
    try {
      setMsgs(await api<OutboxMessage[]>('/messaging/messages?limit=50'));
    } catch {
      /* a lista é secundária; o erro principal aparece na configuração */
    }
  }, []);
  useEffect(() => {
    api<MessagingSettings>('/messaging/settings')
      .then(setS)
      .catch((e: Error) => setError(e.message));
    void loadMsgs();
  }, [loadMsgs]);

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

  async function act(url: string, json: object, ok: string) {
    try {
      await api(url, { method: 'POST', json });
      toast(ok, 'success');
      setTimeout(() => void loadMsgs(), 2500);
      await loadMsgs();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  if (!s) return error ? <Alert tone="danger">{error}</Alert> : <Skeleton variant="detail" />;
  return (
    <>
      <h1 className="page-title cm-sr-only">WhatsApp</h1>
      <Card
        searchId="secao-avisos"
        title="Avisos"
        actions={
          <Badge tone={s.enabled ? 'success' : 'neutral'}>
            {s.enabled ? 'ativos' : 'desativados'}
          </Badge>
        }
      >
        <div className="wa-notices">
          <Button
            variant={s.enabled ? 'secondary' : 'primary'}
            loading={busy}
            onClick={() =>
              save({ enabled: !s.enabled }, s.enabled ? 'Avisos desativados' : 'Avisos ativados')
            }
          >
            {s.enabled ? 'Desativar avisos' : 'Ativar avisos'}
          </Button>
          <div className="wa-notices__list">
            {NOTICE_KEYS.map((k) => (
              <CheckField
                key={k}
                label={NOTICE[k].label}
                checked={s[`notify${k}`]}
                onChange={(v) => save({ [`notify${k}`]: v })}
              />
            ))}
          </div>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
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
      </Card>
      <BaileysCard s={s} busy={busy} save={save} />
      <Card searchId="secao-teste" title="Enviar teste">
        <div className="form-grid">
          <TextField
            label="Telefone (DDD + número)"
            inputMode="tel"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
          />
          <div style={{ alignSelf: 'end' }}>
            <Button
              variant="secondary"
              disabled={!s.enabled || testPhone.replace(/\D/g, '').length < 10}
              onClick={() =>
                act('/messaging/test', { phone: testPhone }, 'Mensagem de teste na fila')
              }
            >
              Enviar teste
            </Button>
          </div>
        </div>
      </Card>
      <Card
        searchId="secao-mensagens"
        title="Mensagens recentes"
        actions={
          <Button variant="ghost" onClick={loadMsgs}>
            Atualizar
          </Button>
        }
      >
        {msgs.length === 0 ? (
          <EmptyState icon={<MessageCircle size={20} />} title="Nenhuma mensagem ainda" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cm-table">
              <thead>
                <tr>
                  <th>Aviso</th>
                  <th>Para</th>
                  <th>Situação</th>
                  <th>Quando</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {msgs.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {EVENT[m.event]}
                      {m.orderNumber && <div className="cm-hint">Pedido #{m.orderNumber}</div>}
                    </td>
                    <td>+{m.toPhone}</td>
                    <td>
                      <Badge tone={STATUS[m.status][1]}>{STATUS[m.status][0]}</Badge>
                      {m.lastError && <div className="cm-hint">{m.lastError}</div>}
                    </td>
                    <td>{dateTime(m.sentAt ?? m.createdAt)}</td>
                    <td className="cm-num">
                      {m.status === 'failed' && (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            act(`/messaging/messages/${m.id}/retry`, {}, 'Reenvio na fila')
                          }
                        >
                          Reenviar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

type SaveFn = (json: Record<string, unknown>, ok?: string) => Promise<boolean>;

function BaileysCard({ s, busy, save }: { s: MessagingSettings; busy: boolean; save: SaveFn }) {
  const toast = useToast();
  const [session, setSession] = useState<WhatsAppSession | null>(null);
  const [qrImg, setQrImg] = useState<string | null>(null);
  const [texts, setTexts] = useState(
    () =>
      Object.fromEntries(NOTICE_KEYS.map((k) => [`text${k}`, s[`text${k}`]])) as Record<
        string,
        string
      >,
  );
  const [acting, setActing] = useState(false);

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
  // Enquanto espera o QR Code ou a conexão, consulta a cada 3 s.
  useEffect(() => {
    if (session?.status !== 'qr' && session?.status !== 'connecting') return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [session?.status, refresh]);
  useEffect(() => {
    if (session?.status === 'qr' && session.qr)
      QRCode.toDataURL(session.qr, { margin: 1, width: 264 })
        .then(setQrImg)
        .catch(() => setQrImg(null));
    else setQrImg(null);
  }, [session?.status, session?.qr]);

  async function call(url: string, ok: string) {
    setActing(true);
    try {
      setSession(await api<WhatsAppSession>(url, { method: 'POST', json: {} }));
      toast(ok, 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setActing(false);
    }
  }

  return (
    <Card
      searchId="secao-qr"
      title="Conexão por QR Code"
      actions={
        session &&
        (session.reconnecting ? (
          <Badge tone="info">Reconectando…</Badge>
        ) : (
          <Badge tone={SESSION[session.status][1]}>{SESSION[session.status][0]}</Badge>
        ))
      }
    >
      <Alert tone="warning">
        Esta conexão funciona como o WhatsApp Web, mas não é oficial. O WhatsApp pode bloquear o
        número se considerar o uso indevido. Prefira um número só para avisos e evite mensagens em
        massa.
      </Alert>
      {!s.gatewayConfigured ? (
        <Alert tone="info">O serviço de WhatsApp ainda não está ligado neste servidor.</Alert>
      ) : (
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          {session?.error && session.status !== 'connected' && (
            <Alert tone="warning">{session.error}</Alert>
          )}
          {session?.status === 'connected' && (
            <p style={{ margin: 0 }}>Número conectado: +{session.phone}</p>
          )}
          {session?.status === 'qr' && (
            <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
              <p style={{ margin: 0 }}>
                No celular do restaurante: WhatsApp &gt; Aparelhos conectados &gt; Conectar um
                aparelho, e aponte para o código.
              </p>
              {qrImg ? (
                <img src={qrImg} alt="QR Code para conectar o WhatsApp" width={264} height={264} />
              ) : (
                <Skeleton variant="qr" size={264} />
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {session?.status !== 'connected' && (
              <Button
                loading={acting}
                onClick={() => call('/messaging/session/connect', 'Gerando QR Code')}
              >
                Conectar WhatsApp
              </Button>
            )}
            {(session?.status === 'connected' ||
              session?.status === 'qr' ||
              session?.status === 'connecting') && (
              <Button
                variant="ghost"
                loading={acting}
                onClick={() => call('/messaging/session/logout', 'WhatsApp desconectado')}
              >
                Desconectar
              </Button>
            )}
          </div>
        </div>
      )}
      <form
        className="wa-texts"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void save(texts, 'Textos salvos');
        }}
      >
        {NOTICE_KEYS.map((k) => (
          <TextField
            key={k}
            label={`Texto: ${NOTICE[k].label.toLowerCase()}`}
            hint={`Quando: ${NOTICE[k].when}`}
            value={texts[`text${k}`]}
            maxLength={1000}
            onChange={(e) => setTexts({ ...texts, [`text${k}`]: e.target.value })}
          />
        ))}
        <div className="wa-texts__actions">
          <Button
            type="submit"
            loading={busy}
            disabled={Object.values(texts).some((t) => !t.trim())}
          >
            Salvar textos
          </Button>
        </div>
      </form>
      <p className="cm-hint">
        Use {'{cliente}'}, {'{pedido}'} e {'{restaurante}'} no texto. O código de “esqueci minha
        senha” do cardápio também sai por este número.
      </p>
    </Card>
  );
}
