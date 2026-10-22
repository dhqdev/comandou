import { MessageCircle } from 'lucide-react';
import QRCode from 'qrcode';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Spinner,
  TextField,
  useToast,
} from '../design-system';
import { dateTime } from '../features/format';
import { Tabs } from '../features/forms';
import { api } from '../lib/api';
import type { MessagingSettings, OutboxMessage, WhatsAppSession } from '../lib/types';

const EVENT: Record<OutboxMessage['event'], string> = {
  'order.ready': 'Pedido pronto',
  'order.dispatched': 'Saiu para entrega',
  test: 'Teste',
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
 * WhatsApp do restaurante. Padrão: conexão por QR Code (Baileys), como o WhatsApp Web.
 * Alternativa: API oficial da Meta (Cloud API), com modelos aprovados.
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

  if (!s) return error ? <Alert tone="danger">{error}</Alert> : <Spinner />;
  return (
    <>
      <div>
        <h1 className="page-title">WhatsApp</h1>
        <p className="page-sub">
          Avisos automáticos ao cliente quando o pedido fica pronto ou sai para entrega.
        </p>
      </div>
      <Card
        title="Avisos"
        actions={
          <Badge tone={s.enabled ? 'success' : 'neutral'}>
            {s.enabled ? 'ativos' : 'desativados'}
          </Badge>
        }
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            variant={s.enabled ? 'secondary' : 'primary'}
            loading={busy}
            onClick={() =>
              save({ enabled: !s.enabled }, s.enabled ? 'Avisos desativados' : 'Avisos ativados')
            }
          >
            {s.enabled ? 'Desativar avisos' : 'Ativar avisos'}
          </Button>
          <label className="option-row">
            <input
              type="checkbox"
              checked={s.notifyReady}
              onChange={(e) => save({ notifyReady: e.target.checked })}
            />
            Pedido de retirada/balcão pronto
          </label>
          <label className="option-row">
            <input
              type="checkbox"
              checked={s.notifyDispatched}
              onChange={(e) => save({ notifyDispatched: e.target.checked })}
            />
            Delivery saiu para entrega
          </label>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div style={{ marginTop: 12 }}>
          <Tabs<MessagingSettings['provider']>
            value={s.provider}
            onChange={(p) => save({ provider: p }, 'Forma de conexão alterada')}
            items={[
              ['baileys', 'QR Code (padrão)'],
              ['meta_cloud', 'API oficial da Meta'],
            ]}
          />
        </div>
      </Card>
      {s.provider === 'baileys' ? (
        <BaileysCard s={s} busy={busy} save={save} />
      ) : (
        <MetaCard s={s} busy={busy} save={save} />
      )}
      <Card title="Enviar teste">
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
  const [texts, setTexts] = useState({ textReady: s.textReady, textDispatched: s.textDispatched });
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
      title="Conexão por QR Code"
      actions={
        session && <Badge tone={SESSION[session.status][1]}>{SESSION[session.status][0]}</Badge>
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
                <Spinner />
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
            {(session?.status === 'connected' || session?.status === 'qr') && (
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
        className="form-grid"
        style={{ marginTop: 16 }}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void save(texts, 'Textos salvos');
        }}
      >
        <TextField
          label="Texto: pedido pronto"
          value={texts.textReady}
          maxLength={1000}
          onChange={(e) => setTexts({ ...texts, textReady: e.target.value })}
        />
        <TextField
          label="Texto: saiu para entrega"
          value={texts.textDispatched}
          maxLength={1000}
          onChange={(e) => setTexts({ ...texts, textDispatched: e.target.value })}
        />
        <div style={{ alignSelf: 'end' }}>
          <Button
            type="submit"
            loading={busy}
            disabled={!texts.textReady.trim() || !texts.textDispatched.trim()}
          >
            Salvar textos
          </Button>
        </div>
      </form>
      <p className="cm-hint">
        Use {'{cliente}'}, {'{pedido}'} e {'{restaurante}'} no texto.
      </p>
    </Card>
  );
}

function MetaCard({ s, busy, save }: { s: MessagingSettings; busy: boolean; save: SaveFn }) {
  const [form, setForm] = useState({
    phoneNumberId: s.phoneNumberId ?? '',
    token: '',
    language: s.language,
    templateReady: s.templateReady ?? '',
    templateDispatched: s.templateDispatched ?? '',
  });
  const tpl = /^[a-z0-9_]*$/;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (
      await save({
        phoneNumberId: form.phoneNumberId.trim() || null,
        language: form.language.trim() || 'pt_BR',
        templateReady: form.templateReady.trim() || null,
        templateDispatched: form.templateDispatched.trim() || null,
        ...(form.token.trim() ? { token: form.token.trim() } : {}),
      })
    )
      setForm((f) => ({ ...f, token: '' }));
  }
  return (
    <Card title="API oficial da Meta">
      {!s.keyConfigured && (
        <Alert tone="warning">
          O servidor ainda não tem a chave que protege tokens (INTEGRATIONS_KEY). Peça ao suporte
          para configurá-la antes de salvar o token.
        </Alert>
      )}
      <form onSubmit={submit} className="form-grid">
        <TextField
          label="ID do número de telefone"
          inputMode="numeric"
          value={form.phoneNumberId}
          onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value.replace(/\D/g, '') })}
          hint="Painel da Meta > WhatsApp > Configuração da API"
        />
        <TextField
          label="Token de acesso"
          type="password"
          autoComplete="off"
          value={form.token}
          onChange={(e) => setForm({ ...form, token: e.target.value })}
          hint={
            s.hasToken
              ? `Token salvo (final ${s.tokenLast4}). Preencha só para trocar.`
              : 'Token permanente de usuário do sistema'
          }
        />
        <TextField
          label="Idioma dos modelos"
          value={form.language}
          onChange={(e) => setForm({ ...form, language: e.target.value })}
        />
        <TextField
          label="Modelo: pedido pronto"
          value={form.templateReady}
          error={tpl.test(form.templateReady) ? undefined : 'minúsculas, números e _'}
          onChange={(e) => setForm({ ...form, templateReady: e.target.value })}
        />
        <TextField
          label="Modelo: saiu para entrega"
          value={form.templateDispatched}
          error={tpl.test(form.templateDispatched) ? undefined : 'minúsculas, números e _'}
          onChange={(e) => setForm({ ...form, templateDispatched: e.target.value })}
        />
        <div style={{ alignSelf: 'end' }}>
          <Button type="submit" loading={busy}>
            Salvar
          </Button>
        </div>
      </form>
      <p className="cm-hint">
        Os modelos precisam estar aprovados na Meta com três variáveis no corpo, nesta ordem:{' '}
        {'{{1}}'} nome do cliente, {'{{2}}'} número do pedido e {'{{3}}'} nome do restaurante.
        Mensagens iniciadas pelo restaurante são cobradas pela Meta.
      </p>
    </Card>
  );
}
