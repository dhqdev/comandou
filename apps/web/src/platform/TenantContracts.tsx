import {
  Ban,
  BellRing,
  Copy,
  Download,
  FileSignature,
  FileText,
  MapPin,
  PenLine,
  Plus,
  Send,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Type,
} from 'lucide-react';
import { FormEvent, useId, useState } from 'react';
import { Alert, Button, Modal, Spinner, TextField, useToast } from '../design-system';
import { dateTime } from '../features/format';
import { api } from '../lib/api';
import { addressLine, CepField } from '../features/CepField';
import { brl, parseBrlInput } from '../lib/money';
import { useLoad } from './OverviewPages';
import { askGeo, SignaturePad } from './ContractSign';
import { maskDocument } from './NewTenant';
import type {
  ContractDetail,
  ContractGeo,
  ContractRow,
  ContractSettings,
  ContractStatus,
  TenantDetail,
} from './types';
import { ago, Dot, Level, Tag } from './ui';

export const CONTRACT_STATUS: Record<ContractStatus, [string, Level]> = {
  draft: ['rascunho', 'off'],
  sent: ['enviado', 'info'],
  viewed: ['aberto pelo cliente', 'warn'],
  client_signed: ['falta a sua assinatura', 'warn'],
  signed: ['assinado', 'ok'],
  cancelled: ['cancelado', 'off'],
};

const EVENT_LABEL: Record<string, string> = {
  created: 'Contrato gerado',
  link: 'Link de assinatura criado',
  sent: 'Enviado por e-mail',
  opened: 'Aberto pelo cliente',
  read: 'Lido até o fim',
  signed: 'Assinado pelo cliente',
  countersigned: 'Assinado por você (contratada)',
  countersign_denied: 'Código do autenticador recusado',
  notified: 'Aviso por e-mail enviado',
  notify_failed: 'Aviso por e-mail falhou',
  cancelled: 'Cancelado',
};

/** AAAA-MM-DD do dia seguinte. */
const nextDay = (d: string) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

const pdfUrl = (id: string, signed = false, download = false) =>
  `/api/v1/platform/contracts/${id}/pdf?${new URLSearchParams({
    ...(signed ? { signed: '1' } : {}),
    ...(download ? { download: '1' } : {}),
  })}`;

/** Aba "Contrato" do restaurante: gerar, enviar, acompanhar e guardar o contrato assinado. */
export function ContractsPanel({ t, initialOpen }: { t: TenantDetail; initialOpen?: string }) {
  const list = useLoad<ContractRow[]>(`/platform/tenants/${t.id}/contracts`);
  const settings = useLoad<ContractSettings>('/platform/contracts/settings');
  const [creating, setCreating] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [open, setOpen] = useState<string | null>(initialOpen ?? null);
  const s = settings.data;
  const missingProfile = !t.profile.legalName || !t.profile.document;

  return (
    <div className="adm-panel">
      <div className="adm-panel__body" style={{ display: 'grid', gap: 12 }}>
        <div className="adm-actions" style={{ margin: 0 }}>
          <button
            className="adm-action adm-action--primary"
            disabled={!s?.ready || missingProfile}
            onClick={() => setCreating(true)}
          >
            <Plus size={14} /> Gerar contrato
          </button>
          <button className="adm-action" onClick={() => setConfiguring(true)}>
            <Settings2 size={14} /> Configurar
          </button>
        </div>
        {s && !s.ready && (
          <Alert tone="warning">
            Antes do primeiro contrato, preencha os dados da contratada (sua empresa) em Configurar.
          </Alert>
        )}
        {missingProfile && (
          <Alert tone="warning">
            Falta a razão social ou o CPF/CNPJ do cliente: preencha na aba Cadastro.
          </Alert>
        )}
        {s?.ready && !s.mailReady && (
          <span className="adm-sub" style={{ whiteSpace: 'normal' }}>
            Sem o envio de e-mail configurado (Super Admin › E-mail) o contrato não sai por e-mail,
            mas dá para copiar o link de assinatura e mandar por WhatsApp.
          </span>
        )}
      </div>
      {list.error ? (
        <div className="adm-panel__body">
          <Alert tone="danger">{list.error}</Alert>
        </div>
      ) : !list.data ? (
        <div className="adm-panel__body">
          <Spinner />
        </div>
      ) : list.data.length === 0 ? (
        <div className="adm-empty">Nenhum contrato gerado ainda.</div>
      ) : (
        <div className="adm-rows">
          {list.data.map((c) => (
            <button key={c.id} className="adm-row" onClick={() => setOpen(c.id)}>
              <Dot level={CONTRACT_STATUS[c.status][1]} />
              <span className="adm-row__main">
                <span className="adm-row__title">
                  {c.number}{' '}
                  <Tag level={CONTRACT_STATUS[c.status][1]}>{CONTRACT_STATUS[c.status][0]}</Tag>
                </span>
                <span className="adm-row__meta">
                  {c.planName} · {brl(c.priceMonthly)}/mês
                  {c.validUntil
                    ? ` · vale até ${new Date(`${c.validUntil}T12:00:00`).toLocaleDateString('pt-BR')}`
                    : ''}
                  {c.signerEmail ? ` · ${c.signerEmail}` : ''}
                </span>
              </span>
              <span className="adm-row__side">
                {c.status === 'client_signed' && c.countersignDeadline
                  ? `cliente assinou ${ago(c.signedAt!)} · assine até ${new Date(c.countersignDeadline).toLocaleDateString('pt-BR')}`
                  : c.signedAt
                    ? `assinado ${ago(c.countersignedAt ?? c.signedAt)}`
                    : c.sentAt
                      ? `enviado ${ago(c.sentAt)}`
                      : `gerado ${ago(c.createdAt)}`}
                {(c.status === 'signed' || c.status === 'client_signed') && c.notifyError && (
                  <>
                    <br />
                    aviso não enviado
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {creating && (
        <NewContractModal
          t={t}
          settings={s!}
          renewFrom={
            list.data
              ?.filter((c) => c.status === 'signed' && c.validUntil)
              .map((c) => c.validUntil!)
              .sort()
              .pop() ?? null
          }
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            list.reload();
            setOpen(c.id);
          }}
        />
      )}
      {configuring && (
        <ContractSettingsModal
          onClose={() => setConfiguring(false)}
          onSaved={(x) => settings.setData(x)}
        />
      )}
      {open && (
        <ContractSheet
          id={open}
          settings={s ?? null}
          canEmail={!!s?.mailReady}
          onClose={() => setOpen(null)}
          onChanged={() => list.reload()}
        />
      )}
    </div>
  );
}

function NewContractModal({
  t,
  settings,
  onClose,
  onCreated,
  renewFrom,
}: {
  t: TenantDetail;
  settings: ContractSettings;
  /** Fim do contrato assinado atual: o novo começa no dia seguinte (renovação anual). */
  renewFrom?: string | null;
  onClose: () => void;
  onCreated: (c: ContractDetail) => void;
}) {
  const toast = useToast();
  const notesId = useId();
  const [f, setF] = useState({
    planName: '',
    priceMonthly: '',
    setupFee: '',
    dueDay: String(settings.dueDay),
    termMonths: String(Math.min(12, settings.termMonths)),
    startDate: renewFrom ? nextDay(renewFrom) : '',
    trialDays: '',
    signerEmail: t.profile.billingEmail ?? '',
    specialConditions: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const price = f.priceMonthly ? parseBrlInput(f.priceMonthly) : undefined;
  const setup = f.setupFee ? parseBrlInput(f.setupFee) : undefined;
  const errors = {
    priceMonthly: price === null ? 'valor inválido' : undefined,
    setupFee: setup === null ? 'valor inválido' : undefined,
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (errors.priceMonthly || errors.setupFee) return;
    setBusy(true);
    try {
      const c = await api<ContractDetail>(`/platform/tenants/${t.id}/contracts`, {
        method: 'POST',
        json: {
          ...(f.planName.trim() ? { planName: f.planName.trim() } : {}),
          ...(price ? { priceMonthly: price } : {}),
          ...(setup ? { setupFee: setup } : {}),
          dueDay: Number(f.dueDay),
          termMonths: Number(f.termMonths),
          ...(f.startDate ? { startDate: f.startDate } : {}),
          ...(f.trialDays !== '' ? { trialDays: Number(f.trialDays) } : {}),
          ...(f.signerEmail ? { signerEmail: f.signerEmail } : {}),
          ...(f.specialConditions.trim() ? { specialConditions: f.specialConditions } : {}),
        },
      });
      toast(`Contrato ${c.number} gerado`, 'success');
      onCreated(c);
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title="Gerar contrato"
      onClose={onClose}
      footer={
        <Button type="submit" form="new-contract" loading={busy}>
          Gerar contrato
        </Button>
      }
    >
      <form id="new-contract" className="adm-form" onSubmit={submit} noValidate>
        <p className="adm-sub span-6" style={{ whiteSpace: 'normal', margin: 0 }}>
          Plano, cliente e regras vêm do cadastro e da configuração. Deixe em branco o que não muda.
          O texto fica congelado no contrato gerado.
        </p>
        <TextField
          label="Plano"
          placeholder={t.subscription ? 'o da assinatura' : 'nome do plano'}
          value={f.planName}
          maxLength={80}
          onChange={set('planName')}
          wrapClass="span-2"
        />
        <TextField
          label="Mensalidade (R$)"
          inputMode="decimal"
          placeholder="do plano"
          value={f.priceMonthly}
          onChange={set('priceMonthly')}
          error={errors.priceMonthly}
          wrapClass="span-2"
        />
        <TextField
          label="Implantação (R$)"
          inputMode="decimal"
          placeholder="sem taxa"
          value={f.setupFee}
          onChange={set('setupFee')}
          error={errors.setupFee}
          wrapClass="span-2"
        />
        <TextField
          label="Dia do vencimento"
          type="number"
          min={1}
          max={28}
          value={f.dueDay}
          onChange={set('dueDay')}
          wrapClass="span-2"
        />
        <TextField
          label="Vigência (meses)"
          type="number"
          min={1}
          max={12}
          hint="Até 12: o contrato é reassinado todo ano"
          value={f.termMonths}
          onChange={set('termMonths')}
          wrapClass="span-2"
        />
        <TextField
          label="Início"
          type="date"
          value={f.startDate}
          onChange={set('startDate')}
          hint={renewFrom ? 'Renovação: começa quando o atual termina' : 'Vazio = hoje'}
          wrapClass="span-2"
        />
        <TextField
          label="Dias de teste"
          type="number"
          min={0}
          max={90}
          placeholder="do plano"
          value={f.trialDays}
          onChange={set('trialDays')}
          wrapClass="span-2"
        />
        <TextField
          label="E-mail de quem assina"
          type="email"
          value={f.signerEmail}
          onChange={set('signerEmail')}
          hint="Vazio = e-mail de cobrança ou do dono"
          wrapClass="span-4"
        />
        <div className="cm-field span-6">
          <label className="cm-label" htmlFor={notesId}>
            Condições especiais
          </label>
          <textarea
            id={notesId}
            className="cm-input adm-textarea"
            rows={3}
            maxLength={3000}
            value={f.specialConditions}
            onChange={set('specialConditions')}
          />
          <span className="cm-hint">
            Vira uma cláusula própria. Ex.: desconto nos primeiros meses. Uma linha por item.
          </span>
        </div>
      </form>
    </Modal>
  );
}

const mapUrl = (g: ContractGeo) =>
  `https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lng}#map=17/${g.lat}/${g.lng}`;

function GeoLine({ geo }: { geo: ContractGeo | null }) {
  if (!geo) return <>localização não informada</>;
  return (
    <a href={mapUrl(geo)} target="_blank" rel="noreferrer">
      <MapPin size={12} /> {geo.lat.toFixed(5)}, {geo.lng.toFixed(5)} (±{geo.accuracy} m)
    </a>
  );
}

/** Assinatura da contratada: depois do cliente, conferindo a dele, com o código do autenticador. */
function CountersignForm({
  c,
  settings,
  onDone,
}: {
  c: ContractDetail;
  settings: ContractSettings | null;
  onDone: (c: ContractDetail) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(settings?.providerRepresentative ?? '');
  const [doc, setDoc] = useState(maskDocument(settings?.providerRepresentativeDocument ?? ''));
  const [kind, setKind] = useState<'drawn' | 'typed'>('drawn');
  const [png, setPng] = useState<string | null>(null);
  const [typed, setTyped] = useState(settings?.providerRepresentative ?? '');
  const [accept, setAccept] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const late = !!c.countersignDeadline && new Date(c.countersignDeadline).getTime() < Date.now();
  const ready =
    !late &&
    name.trim().split(/\s+/).length >= 2 &&
    doc.replace(/\D/g, '').length === 11 &&
    (kind === 'drawn' ? !!png : typed.trim().length >= 3) &&
    accept &&
    /^\d{6}$/.test(code);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      const geo = await askGeo(5000);
      const r = await api<ContractDetail>(`/platform/contracts/${c.id}/countersign`, {
        method: 'POST',
        json: {
          name: name.trim(),
          document: doc,
          accept: true,
          contentHash: c.contentHash,
          clientEvidenceSha256: c.clientEvidenceSha256,
          code,
          signature: kind === 'drawn' ? { kind, image: png } : { kind, text: typed.trim() },
          ...(geo ? { geo } : {}),
        },
      });
      toast(
        r.notifyError
          ? 'Contrato assinado. O e-mail não saiu: use Reenviar aviso.'
          : 'Contrato assinado. A via final foi para os dois e-mails.',
        r.notifyError ? 'neutral' : 'success',
      );
      onDone(r);
    } catch (err) {
      setCode('');
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  if (late)
    return (
      <Alert tone="warning">
        Passou o prazo para a sua assinatura. Pela regra do contrato a assinatura do cliente perdeu
        o efeito: cancele este e gere um contrato novo.
      </Alert>
    );

  return (
    <form className="adm-panel" onSubmit={submit} noValidate>
      <div className="adm-panel__body" style={{ display: 'grid', gap: 12 }}>
        <div className="adm-label">Sua assinatura (contratada)</div>
        <div className="adm-form">
          <TextField
            label="Nome completo"
            value={name}
            onChange={(e) => setName(e.target.value)}
            wrapClass="span-3"
          />
          <TextField
            label="CPF"
            inputMode="numeric"
            value={doc}
            onChange={(e) => setDoc(maskDocument(e.target.value).slice(0, 14))}
            wrapClass="span-3"
          />
        </div>
        <div className="cs-kind" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'drawn'}
            onClick={() => setKind('drawn')}
          >
            <PenLine size={15} /> Desenhar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'typed'}
            onClick={() => setKind('typed')}
          >
            <Type size={15} /> Digitar
          </button>
        </div>
        {kind === 'drawn' ? (
          <SignaturePad onChange={setPng} />
        ) : (
          <div className="cs-typed">
            <TextField
              label="Seu nome como assinatura"
              value={typed}
              maxLength={80}
              onChange={(e) => setTyped(e.target.value)}
            />
            <div className="cs-typed__preview" aria-hidden>
              {typed || ' '}
            </div>
          </div>
        )}
        <label className="cs-accept">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          <span>
            Conferi a assinatura de {c.signerName} e assino este contrato em nome de{' '}
            {c.content.parties.provider.name}.
          </span>
        </label>
        <TextField
          label="Código do autenticador"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          hint="Os 6 dígitos do aplicativo, pedidos sempre que você assina."
        />
        <Button type="submit" size="lg" block loading={busy} disabled={!ready}>
          <FileSignature size={16} /> Assinar e enviar a via final
        </Button>
      </div>
    </form>
  );
}

function ContractSheet({
  id,
  settings,
  canEmail,
  onClose,
  onChanged,
}: {
  id: string;
  settings: ContractSettings | null;
  canEmail: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { data: c, error, setData, reload } = useLoad<ContractDetail>(`/platform/contracts/${id}`);
  const [mode, setMode] = useState<'send' | 'cancel' | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  async function run<T>(key: string, fn: () => Promise<T>, ok?: string) {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) toast(ok, 'success');
      onChanged();
      return r;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return null;
    } finally {
      setBusy(null);
    }
  }

  const copy = async (url: string) => {
    setLink(url);
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copiado', 'success');
    } catch {
      toast('Copie o link abaixo', 'neutral');
    }
  };

  if (error)
    return (
      <Modal open title="Contrato" onClose={onClose}>
        <Alert tone="danger">{error}</Alert>
      </Modal>
    );
  if (!c)
    return (
      <Modal open title="Contrato" onClose={onClose}>
        <Spinner />
      </Modal>
    );
  // Ainda dá para (re)enviar ao cliente: ele não assinou.
  const pending = c.status === 'draft' || c.status === 'sent' || c.status === 'viewed';
  const canCancel = pending || c.status === 'client_signed';
  const to = email ?? c.signerEmail ?? '';

  return (
    <Modal
      open
      size="lg"
      title={`Contrato ${c.number}`}
      onClose={onClose}
      footer={
        mode === 'send' ? (
          <Button
            loading={busy === 'send'}
            disabled={!/^\S+@\S+\.\S+$/.test(to)}
            onClick={async () => {
              const r = await run(
                'send',
                () =>
                  api<{ url: string; contract: ContractDetail }>(`/platform/contracts/${id}/send`, {
                    method: 'POST',
                    json: { email: to, ...(message.trim() ? { message } : {}) },
                  }),
                `Enviado para ${to}`,
              );
              if (r) {
                setData(r.contract);
                setLink(r.url);
                setMode(null);
              }
            }}
          >
            <Send size={16} /> Enviar
          </Button>
        ) : mode === 'cancel' ? (
          <Button
            variant="danger"
            loading={busy === 'cancel'}
            disabled={reason.trim().length < 3}
            onClick={async () => {
              const r = await run(
                'cancel',
                () =>
                  api<ContractDetail>(`/platform/contracts/${id}/cancel`, {
                    method: 'POST',
                    json: { reason },
                  }),
                'Contrato cancelado',
              );
              if (r) {
                setData(r);
                setMode(null);
              }
            }}
          >
            Cancelar contrato
          </Button>
        ) : undefined
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <div className="adm-sub" style={{ whiteSpace: 'normal' }}>
          <Tag level={CONTRACT_STATUS[c.status][1]}>{CONTRACT_STATUS[c.status][0]}</Tag>{' '}
          {c.content.parties.customer.name} · {c.planName} · {brl(c.priceMonthly)}/mês · gerado{' '}
          {dateTime(c.createdAt)}
          {c.createdBy ? ` por ${c.createdBy}` : ''}
        </div>

        <div className="adm-actions" style={{ margin: 0 }}>
          <a className="adm-action" href={pdfUrl(c.id)} target="_blank" rel="noreferrer">
            <FileText size={14} /> Ver PDF
          </a>
          {c.status === 'signed' && (
            <a className="adm-action adm-action--primary" href={pdfUrl(c.id, true, true)}>
              <Download size={14} /> Baixar assinado
            </a>
          )}
          {pending && (
            <button
              className="adm-action adm-action--primary"
              disabled={!canEmail}
              title={canEmail ? undefined : 'Configure o envio em Super Admin › E-mail'}
              onClick={() => setMode('send')}
            >
              <Send size={14} /> {c.sentAt ? 'Reenviar por e-mail' : 'Enviar por e-mail'}
            </button>
          )}
          {pending && (
            <button
              className="adm-action"
              disabled={busy === 'link'}
              onClick={async () => {
                const r = await run('link', () =>
                  api<{ url: string }>(`/platform/contracts/${id}/link`, { method: 'POST' }),
                );
                if (r) {
                  reload();
                  await copy(r.url);
                }
              }}
            >
              <Copy size={14} /> Copiar link
            </button>
          )}
          {(c.status === 'signed' || c.status === 'client_signed') && c.notifyError && (
            <button
              className="adm-action"
              disabled={busy === 'notify'}
              onClick={async () => {
                const r = await run(
                  'notify',
                  () => api<ContractDetail>(`/platform/contracts/${id}/notify`, { method: 'POST' }),
                  'Aviso reenviado',
                );
                if (r) setData(r);
              }}
            >
              <BellRing size={14} /> Reenviar aviso
            </button>
          )}
          {canCancel && (
            <button className="adm-action adm-action--danger" onClick={() => setMode('cancel')}>
              <Ban size={14} /> Cancelar
            </button>
          )}
        </div>

        {link && (
          <Alert tone="info">
            Link de assinatura (pessoal, vale 30 dias, o anterior deixou de valer):{' '}
            <code style={{ overflowWrap: 'anywhere' }}>{link}</code>
          </Alert>
        )}

        {mode === 'send' && (
          <div className="adm-form">
            <TextField
              label="E-mail de quem assina"
              type="email"
              value={to}
              onChange={(e) => setEmail(e.target.value)}
              wrapClass="span-6"
            />
            <TextField
              label="Recado no e-mail (opcional)"
              value={message}
              maxLength={1000}
              onChange={(e) => setMessage(e.target.value)}
              wrapClass="span-6"
            />
            <span className="adm-sub span-6" style={{ whiteSpace: 'normal' }}>
              Vai um e-mail com o botão de assinatura e o PDF anexado. Um link novo é criado e o
              anterior deixa de valer.
            </span>
          </div>
        )}
        {mode === 'cancel' && (
          <TextField
            label="Motivo (fica no histórico)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            hint={
              c.status === 'client_signed'
                ? 'O cliente já assinou: ele recebe um e-mail avisando que a assinatura perdeu o efeito.'
                : 'O link de assinatura deixa de funcionar.'
            }
          />
        )}

        {c.signedAt && (
          <div className="adm-grid">
            <div className="adm-tile">
              <span className="adm-label">1ª assinatura · cliente</span>
              {c.clientSignature && (
                <div className="adm-sigbox">
                  {c.clientSignature.kind === 'drawn' ? (
                    <img src={c.clientSignature.image} alt={`Assinatura de ${c.signerName}`} />
                  ) : (
                    <span className="cs-typed__preview">{c.clientSignature.text}</span>
                  )}
                </div>
              )}
              <span className="adm-value" style={{ fontSize: 16 }}>
                {c.signerName}
              </span>
              <span className="adm-sub" style={{ whiteSpace: 'normal' }}>
                CPF {c.signerDocument} · {c.signerEmail}
                <br />
                {dateTime(c.signedAt)} · IP {c.signerIp} ·{' '}
                {c.signatureKind === 'drawn' ? 'desenhada' : 'digitada'}
                <br />
                <GeoLine geo={c.signerGeo} />
                {c.signerUserAgent && (
                  <>
                    <br />
                    {c.signerUserAgent}
                  </>
                )}
              </span>
            </div>
            {c.countersignedAt ? (
              <div className="adm-tile">
                <span className="adm-label">2ª assinatura · contratada</span>
                <span className="adm-value" style={{ fontSize: 16 }}>
                  {c.countersignerName}
                </span>
                <span className="adm-sub" style={{ whiteSpace: 'normal' }}>
                  CPF {c.countersignerDocument} · {c.countersignerEmail}
                  <br />
                  {dateTime(c.countersignedAt)} · IP {c.countersignerIp} · com o autenticador
                </span>
              </div>
            ) : c.status === 'signed' ? (
              <div className="adm-tile">
                <span className="adm-label">Contratada</span>
                <span className="adm-sub" style={{ whiteSpace: 'normal' }}>
                  Contrato do modelo antigo: a contratada concordou pelo envio, sem assinar depois.
                </span>
              </div>
            ) : (
              <div className="adm-tile">
                <span className="adm-label">2ª assinatura · contratada</span>
                <span className="adm-value" style={{ fontSize: 16 }}>
                  Falta você
                </span>
                {c.countersignDeadline && (
                  <span className="adm-sub">prazo até {dateTime(c.countersignDeadline)}</span>
                )}
              </div>
            )}
          </div>
        )}
        {c.status === 'client_signed' && (
          <CountersignForm
            c={c}
            settings={settings}
            onDone={(x) => {
              setData(x);
              onChanged();
            }}
          />
        )}
        {(c.status === 'signed' || c.status === 'client_signed') && c.notifyError && (
          <Alert tone="warning">O aviso por e-mail não foi enviado: {c.notifyError}</Alert>
        )}
        {c.status === 'cancelled' && <Alert tone="info">Cancelado: {c.cancelReason}</Alert>}

        <div>
          <div className="adm-label" style={{ marginBottom: 6 }}>
            Histórico
          </div>
          <div className="adm-rows">
            {c.events.map((e, i) => (
              <div key={i} className="adm-row">
                <Dot
                  level={
                    e.kind === 'signed' || e.kind === 'countersigned'
                      ? 'ok'
                      : e.kind === 'notify_failed' || e.kind === 'countersign_denied'
                        ? 'bad'
                        : e.kind === 'cancelled'
                          ? 'off'
                          : 'info'
                  }
                />
                <span className="adm-row__main">
                  <span className="adm-row__title">
                    {EVENT_LABEL[e.kind] ?? e.kind}
                    {typeof e.data.to === 'string' ? ` para ${e.data.to}` : ''}
                  </span>
                  <span className="adm-row__meta">
                    {dateTime(e.createdAt)}
                    {e.ip ? ` · IP ${e.ip}` : ''}
                    {typeof e.data.by === 'string' ? ` · ${e.data.by}` : ''}
                    {typeof e.data.error === 'string' ? ` · ${e.data.error}` : ''}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {c.integrity.chainedEvents > 0 &&
          (c.integrity.trailOk && c.integrity.clientEvidenceOk !== false ? (
            <div className="adm-sub" style={{ whiteSpace: 'normal' }}>
              <ShieldCheck size={12} /> Trilha conferida agora: {c.integrity.chainedEvents} eventos
              encadeados, nenhum alterado
              {c.integrity.clientEvidenceOk ? '; assinatura do cliente íntegra' : ''}.
            </div>
          ) : (
            <Alert tone="danger">
              <ShieldAlert size={14} /> A trilha deste contrato não confere: algum registro foi
              alterado direto no banco. Guarde o PDF assinado e veja a auditoria.
            </Alert>
          ))}

        <div className="adm-sub" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
          <FileSignature size={12} /> Hash do texto (SHA-256): <code>{c.contentHash}</code>
          {c.signedPdfSha256 && (
            <>
              <br />
              Hash do PDF assinado: <code>{c.signedPdfSha256}</code>
            </>
          )}
          {c.trailSha256 && (
            <>
              <br />
              Hash da trilha: <code>{c.trailSha256}</code>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

type SettingsForm = Omit<
  ContractSettings,
  | 'mailReady'
  | 'keyConfigured'
  | 'ready'
  | 'updatedAt'
  | 'dueDay'
  | 'termMonths'
  | 'suspendAfterDays'
> & {
  dueDay: string;
  termMonths: string;
  suspendAfterDays: string;
};

/**
 * Dados da contratada (a sua empresa) e regras padrão: valem para todos os contratos novos e para
 * o cabeçalho do orçamento. Abre na aba Contrato do restaurante e em Orçamento.
 */
export function ContractSettingsModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (s: ContractSettings) => void;
}) {
  const toast = useToast();
  const { data: s } = useLoad<ContractSettings>('/platform/contracts/settings');
  const [f, setF] = useState<SettingsForm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const form: SettingsForm | null =
    f ??
    (s && {
      providerName: s.providerName,
      providerDocument: maskDocument(s.providerDocument),
      providerAddress: s.providerAddress,
      providerEmail: s.providerEmail,
      providerRepresentative: s.providerRepresentative,
      providerRepresentativeDocument: maskDocument(s.providerRepresentativeDocument),
      forumCity: s.forumCity,
      dueDay: String(s.dueDay),
      termMonths: String(s.termMonths),
      slaPercent: s.slaPercent.replace('.', ','),
      readjustIndex: s.readjustIndex,
      lateFeePercent: s.lateFeePercent.replace('.', ','),
      lateInterestPercent: s.lateInterestPercent.replace('.', ','),
      suspendAfterDays: String(s.suspendAfterDays),
      supportHours: s.supportHours,
      notifyEmail: s.notifyEmail,
    });
  const set = (k: keyof SettingsForm) => (e: { target: { value: string } }) =>
    setF({
      ...form!,
      [k]:
        k === 'providerDocument'
          ? maskDocument(e.target.value)
          : k === 'providerRepresentativeDocument'
            ? maskDocument(e.target.value).slice(0, 14)
            : e.target.value,
    });
  const n = (v: string) => Number(v.replace(',', '.'));

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!form) return null;
    setBusy('save');
    try {
      const r = await api<ContractSettings>('/platform/contracts/settings', {
        method: 'PUT',
        json: {
          ...form,
          dueDay: Number(form.dueDay),
          termMonths: Number(form.termMonths),
          suspendAfterDays: Number(form.suspendAfterDays),
          slaPercent: n(form.slaPercent),
          lateFeePercent: n(form.lateFeePercent),
          lateInterestPercent: n(form.lateInterestPercent),
        },
      });
      onSaved(r);
      toast('Configuração salva', 'success');
      return r;
    } catch (err) {
      toast((err as Error).message, 'danger');
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      size="xl"
      title="Configurar contratos"
      onClose={onClose}
      footer={
        <Button type="submit" form="contract-settings" loading={busy === 'save'} disabled={!form}>
          Salvar
        </Button>
      }
    >
      {!form || !s ? (
        <Spinner />
      ) : (
        <form id="contract-settings" className="adm-form-stack" onSubmit={save} noValidate>
          <fieldset className="adm-fieldset">
            <legend className="adm-fieldset__title">Contratada (sua empresa)</legend>
            <div className="adm-form">
              <TextField
                label="Razão social"
                value={form.providerName}
                onChange={set('providerName')}
                wrapClass="span-4"
              />
              <TextField
                label="CNPJ"
                inputMode="numeric"
                value={form.providerDocument}
                onChange={set('providerDocument')}
                wrapClass="span-2"
              />
              <CepField
                label="CEP da empresa"
                wrapClass="span-2"
                onFound={(a) =>
                  setF(
                    (x) =>
                      x && {
                        ...x,
                        providerAddress: addressLine(a),
                        forumCity: x.forumCity || [a.city, a.state].filter(Boolean).join('/'),
                      },
                  )
                }
              />
              <TextField
                label="Endereço completo"
                value={form.providerAddress}
                onChange={set('providerAddress')}
                wrapClass="span-4"
              />
              <TextField
                label="Foro (cidade/UF)"
                placeholder="São Paulo/SP"
                value={form.forumCity}
                onChange={set('forumCity')}
                wrapClass="span-2"
              />
              <TextField
                label="Representante (quem assina)"
                value={form.providerRepresentative}
                onChange={set('providerRepresentative')}
                wrapClass="span-2"
              />
              <TextField
                label="CPF do representante"
                inputMode="numeric"
                value={form.providerRepresentativeDocument}
                onChange={set('providerRepresentativeDocument')}
                hint="Preenche a sua assinatura"
                wrapClass="span-2"
              />
              <TextField
                label="E-mail para comunicações"
                type="email"
                value={form.providerEmail}
                onChange={set('providerEmail')}
                wrapClass="span-2"
              />
            </div>
          </fieldset>
          <fieldset className="adm-fieldset">
            <legend className="adm-fieldset__title">Regras padrão</legend>
            <div className="adm-form">
              <TextField
                label="Dia do vencimento"
                type="number"
                min={1}
                max={28}
                value={form.dueDay}
                onChange={set('dueDay')}
                wrapClass="span-2"
              />
              <TextField
                label="Vigência (meses)"
                type="number"
                min={1}
                max={12}
                value={form.termMonths}
                onChange={set('termMonths')}
                wrapClass="span-2"
              />
              <TextField
                label="Disponibilidade (%)"
                inputMode="decimal"
                value={form.slaPercent}
                onChange={set('slaPercent')}
                wrapClass="span-2"
              />
              <TextField
                label="Índice de reajuste"
                value={form.readjustIndex}
                onChange={set('readjustIndex')}
                wrapClass="span-2"
              />
              <TextField
                label="Multa por atraso (%)"
                inputMode="decimal"
                value={form.lateFeePercent}
                onChange={set('lateFeePercent')}
                hint="Máximo 2%"
                wrapClass="span-2"
              />
              <TextField
                label="Juros ao mês (%)"
                inputMode="decimal"
                value={form.lateInterestPercent}
                onChange={set('lateInterestPercent')}
                wrapClass="span-2"
              />
              <TextField
                label="Suspender após (dias)"
                type="number"
                min={1}
                max={90}
                value={form.suspendAfterDays}
                onChange={set('suspendAfterDays')}
                wrapClass="span-2"
              />
              <TextField
                label="Horário do suporte"
                value={form.supportHours}
                onChange={set('supportHours')}
                wrapClass="span-4"
              />
            </div>
          </fieldset>
          <fieldset className="adm-fieldset">
            <legend className="adm-fieldset__title">
              E-mail{' '}
              <span className="adm-fieldset__hint">
                contrato e aviso de assinatura saem por Super Admin › E-mail
              </span>
            </legend>
            <div className="adm-form">
              <TextField
                label="Me avise da assinatura em"
                type="email"
                value={form.notifyEmail}
                onChange={set('notifyEmail')}
                hint="Recebe o PDF assinado. Vazio = e-mail da contratada."
                wrapClass="span-4"
              />
              <div className="span-2" style={{ alignSelf: 'end' }}>
                <Button
                  type="button"
                  variant="secondary"
                  block
                  loading={busy === 'test'}
                  disabled={!s.mailReady}
                  onClick={async () => {
                    if (!(await save())) return;
                    setBusy('test');
                    try {
                      const r = await api<{ to: string }>('/platform/contracts/settings/test', {
                        method: 'POST',
                      });
                      toast(`Teste enviado para ${r.to}`, 'success');
                    } catch (err) {
                      toast((err as Error).message, 'danger');
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Salvar e testar
                </Button>
              </div>
            </div>
            {!s.mailReady && (
              <Alert tone="warning">
                O envio de e-mail ainda não está configurado: configure em Super Admin › E-mail.
              </Alert>
            )}
          </fieldset>
        </form>
      )}
    </Modal>
  );
}
