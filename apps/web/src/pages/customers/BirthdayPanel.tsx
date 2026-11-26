import {
  addLocalDays,
  BIRTHDAY_THEME_INFO,
  BIRTHDAY_THEMES,
  BIRTHDAY_VARS,
  birthdayMessage,
  birthdayShort,
  firstName,
  giftMessageLine,
  type BirthdayGiftKind,
  type BirthdayTheme,
  type LocalDay,
} from '@comandou/shared';
import { RotateCcw, Send } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../app/auth';
import { Alert, Bone, Button, Segmented, Skeleton, Spinner, TextField } from '../../design-system';
import { dateTime } from '../../features/format';
import { SelectField } from '../../features/forms';
import { SidePanel } from '../../features/SidePanel';
import { api } from '../../lib/api';
import { inDaysLabel } from '../../lib/birthday';
import type { BirthdayOverview, BirthdaySettings } from '../../lib/types';
import './birthdays.css';

/** O que a tela muda antes de salvar (a mensagem já vem com o texto padrão quando não há a dela). */
interface Draft {
  enabled: boolean;
  sendHour: number;
  theme: BirthdayTheme;
  artLine: string;
  message: string;
  giftKind: BirthdayGiftKind;
  giftPoints: string;
  giftText: string;
  giftDays: number;
}

const draftOf = (s: BirthdaySettings): Draft => ({
  enabled: s.enabled,
  sendHour: s.sendHour,
  theme: s.theme,
  artLine: s.artLine,
  message: s.message ?? s.defaultMessage,
  giftKind: s.giftKind,
  giftPoints: s.giftPoints ? String(s.giftPoints) : '',
  giftText: s.giftText ?? '',
  giftDays: s.giftDays,
});

/** O rascunho no formato da API (texto igual ao padrão vira null). */
function payloadOf(d: Draft, defaultMessage: string) {
  const message = d.message.trim();
  return {
    enabled: d.enabled,
    sendHour: d.sendHour,
    theme: d.theme,
    artLine: d.artLine.trim(),
    message: !message || message === defaultMessage.trim() ? null : message,
    giftKind: d.giftKind,
    giftPoints: d.giftKind === 'points' && d.giftPoints ? Number(d.giftPoints) : null,
    giftText: d.giftKind === 'text' ? d.giftText.trim() || null : null,
    giftDays: d.giftDays,
  };
}

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7);
const VALIDITY = [
  { days: 0, label: 'Só no dia do aniversário' },
  { days: 3, label: 'Até 3 dias depois' },
  { days: 7, label: 'Até 7 dias depois' },
  { days: 15, label: 'Até 15 dias depois' },
  { days: 30, label: 'Até 30 dias depois' },
];

const dayOf = (iso: string): LocalDay => ({
  year: Number(iso.slice(0, 4)),
  month: Number(iso.slice(5, 7)),
  day: Number(iso.slice(8, 10)),
});

/** Negrito do WhatsApp (*assim*) na prévia do balão. */
function waText(text: string): ReactNode {
  return text
    .split(/(\*[^*\n]+\*)/g)
    .map((part, i) =>
      /^\*[^*\n]+\*$/.test(part) ? (
        <strong key={i}>{part.slice(1, -1)}</strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
}

const STATUS: Record<string, { label: string; tone: 'ok' | 'wait' | 'bad' | 'off' }> = {
  sent: { label: 'Enviado', tone: 'ok' },
  queued: { label: 'Na fila', tone: 'wait' },
  sending: { label: 'Enviando', tone: 'wait' },
  failed: { label: 'Não saiu', tone: 'bad' },
};

/**
 * Clientes › Aniversários: liga o parabéns automático pelo WhatsApp da loja, escolhe a arte, o
 * texto e o presente, mostra a prévia (a arte de verdade, feita pela API), manda um teste e lista
 * os próximos aniversariantes e o que já saiu.
 */
export function BirthdayPanel({
  open,
  onClose,
  onOpenCustomer,
}: {
  open: boolean;
  onClose(): void;
  onOpenCustomer(id: string): void;
}) {
  const { me } = useAuth();
  const canManage = !!me?.permissions.includes('customers:manage');
  const [o, setO] = useState<BirthdayOverview | null>(null);
  const [d, setD] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveNote, setSaveNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function load(reset: boolean) {
    try {
      const x = await api<BirthdayOverview>('/birthdays');
      setO(x);
      if (reset) setD(draftOf(x.settings));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }
  useEffect(() => {
    if (!open) return;
    setO(null);
    setD(null);
    setSaveNote(null);
    void load(true);
  }, [open]);

  const payload = o && d ? payloadOf(d, o.settings.defaultMessage) : null;
  const saved = o ? payloadOf(draftOf(o.settings), o.settings.defaultMessage) : null;
  const dirty = !!payload && JSON.stringify(payload) !== JSON.stringify(saved);
  const problem = !d
    ? null
    : !d.artLine.trim()
      ? 'Escreva a frase da arte'
      : d.giftKind === 'points' && !(Number(d.giftPoints) >= 1)
        ? `Diga quantos ${o?.loyaltyMode === 'stamps' ? 'carimbos' : 'pontos'} o cliente ganha`
        : d.giftKind === 'text' && !d.giftText.trim()
          ? 'Escreva qual é o presente'
          : null;

  async function save() {
    if (!payload || !o) return;
    setBusy(true);
    setSaveNote(null);
    try {
      const s = await api<BirthdaySettings>('/birthdays/settings', {
        method: 'PUT',
        json: payload,
      });
      setO({ ...o, settings: s });
      setD(draftOf(s));
      setSaveNote({
        ok: true,
        text: s.enabled ? 'Salvo. O parabéns automático está ligado.' : 'Salvo.',
      });
    } catch (e) {
      setSaveNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (dirty && !window.confirm('Sair sem salvar as mudanças do parabéns?')) return;
    onClose();
  }

  const set = (p: Partial<Draft>) => {
    setD((x) => (x ? { ...x, ...p } : x));
    setSaveNote(null);
  };

  return (
    <SidePanel
      open={open}
      title="Parabéns de aniversário"
      size="xl"
      onClose={close}
      footer={
        canManage && d ? (
          <div className="bd-foot">
            <span
              className="bd-foot__note"
              role="status"
              data-tone={saveNote && !saveNote.ok ? 'bad' : undefined}
            >
              {saveNote?.text ??
                (problem && dirty ? problem : dirty ? 'Mudanças ainda não salvas' : '')}
            </span>
            <Button variant="primary" loading={busy} disabled={!dirty || !!problem} onClick={save}>
              Salvar
            </Button>
          </div>
        ) : undefined
      }
    >
      {loadError ? (
        <Alert tone="danger">{loadError}</Alert>
      ) : !o || !d ? (
        <Skeleton variant="form" />
      ) : (
        <div className="bd">
          <WhatsAppState o={o} />
          <div className="bd-cols">
            <div className="bd-form">
              <section className="bd-block">
                <label className="os-toggle">
                  <span>
                    <strong>Parabéns automático</strong>
                    <small>
                      No dia do aniversário, o cliente recebe a arte com o nome dele e a mensagem
                      pelo WhatsApp da loja. Uma vez por ano, só para quem tem a data na ficha.
                    </small>
                  </span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      checked={d.enabled}
                      disabled={!canManage}
                      onChange={(e) => set({ enabled: e.target.checked })}
                    />
                    <span className="switch__track" aria-hidden />
                  </span>
                </label>
                <p className="bd-stats">
                  {o.stats.withBirthday} de {o.stats.total}{' '}
                  {o.stats.total === 1 ? 'cliente tem' : 'clientes têm'} o aniversário na ficha
                  {o.stats.optedOut > 0 &&
                    ` · ${o.stats.optedOut} ${o.stats.optedOut === 1 ? 'pediu' : 'pediram'} para não receber`}
                </p>
                <SelectField
                  label="Horário de envio"
                  value={d.sendHour}
                  disabled={!canManage}
                  onChange={(e) => set({ sendHour: Number(e.target.value) })}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      A partir das {h}h
                    </option>
                  ))}
                </SelectField>
                <p className="cm-hint bd-hint">
                  Sai um parabéns a cada 25 segundos, para o número da loja não parecer robô. Quem
                  não recebeu até as 22h (WhatsApp desconectado o dia todo) fica para o ano que vem.
                </p>
              </section>

              <section className="bd-block">
                <h3>Arte</h3>
                <Segmented
                  label="Estilo da arte"
                  value={d.theme}
                  onChange={(theme) => canManage && set({ theme })}
                  options={BIRTHDAY_THEMES.map((t) => ({
                    value: t,
                    label: BIRTHDAY_THEME_INFO[t].name,
                  }))}
                  block
                />
                <p className="cm-hint bd-hint">
                  {BIRTHDAY_THEME_INFO[d.theme].hint}. Usa a cor e a logo da Loja online.
                </p>
                <TextField
                  label="Frase embaixo do nome"
                  value={d.artLine}
                  maxLength={48}
                  disabled={!canManage}
                  onChange={(e) => set({ artLine: e.target.value })}
                />
              </section>

              <MessageField d={d} o={o} canManage={canManage} set={set} />

              <section className="bd-block">
                <h3>Presente</h3>
                <Segmented
                  label="Presente de aniversário"
                  value={d.giftKind}
                  onChange={(giftKind) => canManage && set({ giftKind })}
                  options={[
                    { value: 'none', label: 'Sem presente' },
                    {
                      value: 'points',
                      label: o.loyaltyMode === 'stamps' ? 'Carimbos' : 'Pontos',
                    },
                    { value: 'text', label: 'Outro presente' },
                  ]}
                  block
                />
                {d.giftKind === 'points' && (
                  <>
                    {!o.loyaltyEnabled && (
                      <Alert tone="warning">
                        Para dar {o.loyaltyMode === 'stamps' ? 'carimbos' : 'pontos'}, ligue o
                        programa em{' '}
                        <Link to="/loja-online?aba=fidelidade">Loja online › Fidelidade</Link>.
                      </Alert>
                    )}
                    <TextField
                      label={o.loyaltyMode === 'stamps' ? 'Quantos carimbos' : 'Quantos pontos'}
                      inputMode="numeric"
                      maxLength={6}
                      value={d.giftPoints}
                      disabled={!canManage}
                      hint="Entram na fidelidade do cliente junto com o parabéns."
                      onChange={(e) => set({ giftPoints: e.target.value.replace(/\D/g, '') })}
                    />
                  </>
                )}
                {d.giftKind === 'text' && (
                  <div className="bd-gift">
                    <TextField
                      label="Qual é o presente"
                      placeholder="Ex.: Sobremesa grátis"
                      maxLength={60}
                      value={d.giftText}
                      disabled={!canManage}
                      onChange={(e) => set({ giftText: e.target.value })}
                    />
                    <SelectField
                      label="Vale"
                      value={d.giftDays}
                      disabled={!canManage}
                      onChange={(e) => set({ giftDays: Number(e.target.value) })}
                    >
                      {VALIDITY.map((v) => (
                        <option key={v.days} value={v.days}>
                          {v.label}
                        </option>
                      ))}
                    </SelectField>
                    <p className="cm-hint bd-hint">
                      Na hora de usar, a equipe confere na ficha do cliente (Parabéns deste ano).
                    </p>
                  </div>
                )}
              </section>
            </div>

            <Preview d={d} o={o} canManage={canManage} />
          </div>

          <Upcoming o={o} onOpen={onOpenCustomer} />
          <History
            o={o}
            canManage={canManage}
            onOpen={onOpenCustomer}
            onChanged={() => load(false)}
          />
        </div>
      )}
    </SidePanel>
  );
}

function WhatsAppState({ o }: { o: BirthdayOverview }) {
  const r = o.whatsapp.reason;
  if (r === 'ok')
    return (
      <p className="bd-wa">
        <span className="bd-dot" data-tone="ok" aria-hidden />O parabéns sai pelo WhatsApp da loja
        (QR Code).
      </p>
    );
  return (
    <Alert tone="warning">
      {/* Um bloco só: o link no meio não vira coluna do aviso. */}
      <span className="cm-alert__text">
        {r === 'off' ? (
          <>
            O parabéns sai pelo WhatsApp da loja. Conecte o número por QR Code em{' '}
            <Link to="/whatsapp">WhatsApp</Link> para ele sair.
          </>
        ) : r === 'meta' ? (
          <>
            Pela API oficial da Meta o parabéns não sai (ela só manda modelos aprovados). Use o
            WhatsApp por QR Code em <Link to="/whatsapp">WhatsApp</Link>.
          </>
        ) : r === 'plan' ? (
          'O seu plano não inclui o WhatsApp da loja.'
        ) : (
          'O WhatsApp está fora do ar agora. O parabéns sai quando ele voltar (até as 22h).'
        )}
      </span>
    </Alert>
  );
}

function MessageField({
  d,
  o,
  canManage,
  set,
}: {
  d: Draft;
  o: BirthdayOverview;
  canManage: boolean;
  set(p: Partial<Draft>): void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const isDefault = d.message.trim() === o.settings.defaultMessage.trim();
  function insert(key: string) {
    const el = ref.current;
    const at = el?.selectionStart ?? d.message.length;
    const end = el?.selectionEnd ?? at;
    const next = d.message.slice(0, at) + key + d.message.slice(end);
    set({ message: next.slice(0, 900) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + key.length, at + key.length);
    });
  }
  return (
    <section className="bd-block">
      <div className="bd-block__head">
        <h3>Mensagem</h3>
        {canManage && !isDefault && (
          <button
            type="button"
            className="link-btn"
            onClick={() => set({ message: o.settings.defaultMessage })}
          >
            Voltar ao texto padrão
          </button>
        )}
      </div>
      <label className="cm-sr-only" htmlFor="bd-message">
        Mensagem que vai junto da arte
      </label>
      <textarea
        id="bd-message"
        ref={ref}
        className="cm-input bd-message"
        rows={9}
        maxLength={900}
        value={d.message}
        disabled={!canManage}
        onChange={(e) => set({ message: e.target.value })}
      />
      {canManage && (
        <div className="bd-vars" role="group" aria-label="Pôr no texto">
          {BIRTHDAY_VARS.map((v) => (
            <Button
              key={v.key}
              variant="ghost"
              size="sm"
              title={v.label}
              onClick={() => insert(v.key)}
            >
              {v.key}
            </Button>
          ))}
        </div>
      )}
      <p className="cm-hint bd-hint">
        {'{cliente}'} vira o primeiro nome, {'{restaurante}'} o nome da loja e {'{presente}'} a
        linha do presente (some quando não há presente). *Assim* fica em negrito no WhatsApp.
      </p>
    </section>
  );
}

function Preview({ d, o, canManage }: { d: Draft; o: BirthdayOverview; canManage: boolean }) {
  const { me } = useAuth();
  const [name, setName] = useState(() => firstName(me?.user.name) || 'Maria');
  const params = useMemo(() => {
    const p = new URLSearchParams({
      theme: d.theme,
      giftKind: d.giftKind,
      giftDays: String(d.giftDays),
    });
    if (name.trim()) p.set('name', name.trim());
    if (d.artLine.trim()) p.set('artLine', d.artLine.trim());
    if (d.giftKind === 'points' && Number(d.giftPoints) >= 1) p.set('giftPoints', d.giftPoints);
    if (d.giftKind === 'text' && d.giftText.trim()) p.set('giftText', d.giftText.trim());
    return p.toString();
  }, [d.theme, d.giftKind, d.giftDays, d.artLine, d.giftPoints, d.giftText, name]);
  // A arte é feita no servidor: espera a pessoa parar de digitar.
  const [src, setSrc] = useState(`/api/v1/birthdays/preview?${params}`);
  useEffect(() => {
    const t = setTimeout(() => setSrc(`/api/v1/birthdays/preview?${params}`), 400);
    return () => clearTimeout(t);
  }, [params]);
  const [shown, setShown] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const today = dayOf(o.today);
  const points = Number(d.giftPoints) || null;
  const caption = birthdayMessage(d.message, {
    cliente: firstName(name) || 'cliente',
    restaurante: me?.tenant.name ?? 'Restaurante',
    presente: giftMessageLine({
      kind: d.giftKind,
      points,
      text: d.giftText,
      stamps: o.loyaltyMode === 'stamps',
      until: d.giftKind === 'text' ? addLocalDays(today, d.giftDays) : null,
      today,
    }),
  });

  return (
    <aside className="bd-preview" aria-label="Prévia do parabéns">
      <div className="bd-phone">
        <div className="bd-bubble">
          <div className="bd-art">
            {!shown && !failed && <Bone className="bd-art__bone" w="100%" h="100%" r={0} />}
            <img
              src={src}
              alt={`Arte do parabéns para ${firstName(name) || 'o cliente'}`}
              width={1080}
              height={1350}
              data-ready={shown === src || undefined}
              onLoad={() => {
                setShown(src);
                setFailed(false);
              }}
              onError={() => setFailed(true)}
            />
            {shown !== null && shown !== src && !failed && (
              <span className="bd-art__busy">
                <Spinner inline label="Atualizando a arte" />
              </span>
            )}
          </div>
          {failed && <p className="bd-art__error">Não deu para montar a prévia agora.</p>}
          <p className="bd-caption">{waText(caption)}</p>
        </div>
      </div>
      <TextField
        label="Nome no exemplo"
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
      />
      {canManage && <TestSend d={d} o={o} />}
    </aside>
  );
}

function TestSend({ d, o }: { d: Draft; o: BirthdayOverview }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const draft = payloadOf(d, o.settings.defaultMessage);
  async function send() {
    setBusy(true);
    setNote(null);
    try {
      const { enabled: _e, sendHour: _h, ...art } = draft;
      await api('/birthdays/test', {
        method: 'POST',
        json: {
          phone,
          ...art,
          giftPoints: art.giftPoints ?? undefined,
          giftText: art.giftText ?? undefined,
        },
      });
      setNote({ ok: true, text: 'Teste enviado. Confira no WhatsApp desse número.' });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="bd-test">
      <TextField
        label="Mandar um teste para"
        placeholder="(11) 91234-5678"
        inputMode="tel"
        maxLength={25}
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value);
          setNote(null);
        }}
      />
      <Button
        variant="secondary"
        icon={<Send size={16} />}
        loading={busy}
        disabled={phone.replace(/\D/g, '').length < 10 || !o.whatsapp.ready}
        onClick={send}
      >
        Mandar teste
      </Button>
      <p className="cm-hint bd-hint">
        Vai com o nome de exemplo e o que está na tela, mesmo sem salvar. Não dá presente.
      </p>
      {note && <Alert tone={note.ok ? 'info' : 'danger'}>{note.text}</Alert>}
    </div>
  );
}

function Upcoming({ o, onOpen }: { o: BirthdayOverview; onOpen(id: string): void }) {
  return (
    <section className="bd-block bd-list">
      <div className="bd-block__head">
        <h3>Próximos 30 dias</h3>
        {o.upcoming.length > 0 && <span className="cm-hint">{o.upcoming.length}</span>}
      </div>
      {o.upcoming.length === 0 ? (
        <p className="cm-hint">
          Ninguém faz aniversário nos próximos 30 dias. A data entra na ficha do cliente (Clientes ›
          cliente › Aniversário) ou pelo próprio cliente na conta do cardápio.
        </p>
      ) : (
        <ul className="bd-rows">
          {o.upcoming.map((u) => {
            const st = u.optOut
              ? { label: 'Não quer receber', tone: 'off' as const }
              : u.blocked
                ? { label: 'Bloqueado', tone: 'off' as const }
                : u.status
                  ? STATUS[u.status]!
                  : null;
            const nextYear = addLocalDays(dayOf(o.today), u.inDays).year;
            return (
              <li key={u.id}>
                <button type="button" onClick={() => onOpen(u.id)}>
                  <span className="bd-rows__main">
                    <strong>{u.name}</strong>
                    <small>
                      {birthdayShort(u)} · {inDaysLabel(u.inDays)}
                      {u.year
                        ? ` · ${u.inDays === 0 ? 'faz' : 'vai fazer'} ${nextYear - u.year} anos`
                        : ''}
                    </small>
                  </span>
                  {st && (
                    <span className="bd-state">
                      <span className="bd-dot" data-tone={st.tone} aria-hidden />
                      {st.label}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function History({
  o,
  canManage,
  onOpen,
  onChanged,
}: {
  o: BirthdayOverview;
  canManage: boolean;
  onOpen(id: string): void;
  onChanged(): Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (o.history.length === 0) return null;
  async function retry(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/birthdays/greetings/${id}/retry`, { method: 'POST', json: {} });
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="bd-block bd-list">
      <div className="bd-block__head">
        <h3>Já enviados</h3>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <ul className="bd-rows">
        {o.history.map((h) => {
          const st = STATUS[h.status] ?? STATUS.queued!;
          return (
            <li key={h.id}>
              <button type="button" onClick={() => onOpen(h.customerId)}>
                <span className="bd-rows__main">
                  <strong>{h.name}</strong>
                  <small>
                    {dateTime(h.sentAt ?? h.createdAt)}
                    {h.giftKind === 'points' && h.giftPoints
                      ? ` · +${h.giftPoints} de presente`
                      : h.giftKind === 'text' && h.giftText
                        ? ` · ${h.giftText}`
                        : ''}
                    {h.status === 'failed' && h.lastError ? ` · ${h.lastError}` : ''}
                  </small>
                </span>
                <span className="bd-state">
                  <span className="bd-dot" data-tone={st.tone} aria-hidden />
                  {st.label}
                </span>
              </button>
              {canManage && h.status === 'failed' && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RotateCcw size={14} />}
                  loading={busy === h.id}
                  onClick={() => void retry(h.id)}
                >
                  Tentar de novo
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
