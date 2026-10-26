import {
  Ban,
  BellRing,
  Copy,
  Download,
  FileSignature,
  FileText,
  Plus,
  Send,
  Settings2,
} from 'lucide-react';
import { FormEvent, useId, useState } from 'react';
import { Alert, Button, Modal, Spinner, TextField, useToast } from '../design-system';
import { dateTime } from '../features/format';
import { api } from '../lib/api';
import { brl, parseBrlInput } from '../lib/money';
import { useLoad } from './OverviewPages';
import { maskDocument } from './NewTenant';
import type {
  ContractDetail,
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
  signed: ['assinado', 'ok'],
  cancelled: ['cancelado', 'off'],
};

const EVENT_LABEL: Record<string, string> = {
  created: 'Contrato gerado',
  link: 'Link de assinatura criado',
  sent: 'Enviado por e-mail',
  opened: 'Aberto pelo cliente',
  read: 'Lido até o fim',
  signed: 'Assinado',
  notified: 'Aviso de assinatura enviado',
  notify_failed: 'Aviso de assinatura falhou',
  cancelled: 'Cancelado',
};

const pdfUrl = (id: string, signed = false, download = false) =>
  `/api/v1/platform/contracts/${id}/pdf?${new URLSearchParams({
    ...(signed ? { signed: '1' } : {}),
    ...(download ? { download: '1' } : {}),
  })}`;

/** Aba "Contrato" do restaurante: gerar, enviar, acompanhar e guardar o contrato assinado. */
export function ContractsPanel({ t }: { t: TenantDetail }) {
  const list = useLoad<ContractRow[]>(`/platform/tenants/${t.id}/contracts`);
  const settings = useLoad<ContractSettings>('/platform/contracts/settings');
  const [creating, setCreating] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
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
        {s?.ready && !s.webhookUrl && (
          <span className="adm-sub" style={{ whiteSpace: 'normal' }}>
            Sem o webhook do n8n o contrato não sai por e-mail, mas dá para copiar o link de
            assinatura e mandar por WhatsApp.
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
                  {c.signerEmail ? ` · ${c.signerEmail}` : ''}
                </span>
              </span>
              <span className="adm-row__side">
                {c.signedAt
                  ? `assinado ${ago(c.signedAt)}`
                  : c.sentAt
                    ? `enviado ${ago(c.sentAt)}`
                    : `gerado ${ago(c.createdAt)}`}
                {c.status === 'signed' && c.notifyError && (
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
          canEmail={!!s?.webhookUrl}
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
}: {
  t: TenantDetail;
  settings: ContractSettings;
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
    termMonths: String(settings.termMonths),
    startDate: '',
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
          max={60}
          value={f.termMonths}
          onChange={set('termMonths')}
          wrapClass="span-2"
        />
        <TextField
          label="Início"
          type="date"
          value={f.startDate}
          onChange={set('startDate')}
          hint="Vazio = hoje"
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

function ContractSheet({
  id,
  canEmail,
  onClose,
  onChanged,
}: {
  id: string;
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
  const pending = c.status !== 'signed' && c.status !== 'cancelled';
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
              title={canEmail ? undefined : 'Configure o webhook do n8n'}
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
          {c.status === 'signed' && c.notifyError && (
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
          {pending && (
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
              O n8n manda o e-mail com o botão de assinatura e o PDF anexado. Um link novo é criado
              e o anterior deixa de valer.
            </span>
          </div>
        )}
        {mode === 'cancel' && (
          <TextField
            label="Motivo (fica no histórico)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            hint="O link de assinatura deixa de funcionar."
          />
        )}

        {c.status === 'signed' && (
          <div className="adm-grid">
            <div className="adm-tile">
              <span className="adm-label">Assinado por</span>
              <span className="adm-value" style={{ fontSize: 16 }}>
                {c.signerName}
              </span>
              <span className="adm-sub">
                CPF {c.signerDocument} · {c.signerEmail}
              </span>
            </div>
            <div className="adm-tile">
              <span className="adm-label">Quando</span>
              <span className="adm-value" style={{ fontSize: 16 }}>
                {dateTime(c.signedAt!)}
              </span>
              <span className="adm-sub">
                IP {c.signerIp} · {c.signatureKind === 'drawn' ? 'desenhada' : 'digitada'}
              </span>
            </div>
          </div>
        )}
        {c.status === 'signed' && c.notifyError && (
          <Alert tone="warning">O aviso pelo n8n não foi enviado: {c.notifyError}</Alert>
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
                    e.kind === 'signed'
                      ? 'ok'
                      : e.kind === 'notify_failed'
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

        <div className="adm-sub" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
          <FileSignature size={12} /> Hash do texto (SHA-256): <code>{c.contentHash}</code>
          {c.signedPdfSha256 && (
            <>
              <br />
              Hash do PDF assinado: <code>{c.signedPdfSha256}</code>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

type SettingsForm = Omit<
  ContractSettings,
  | 'hasWebhookSecret'
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
  webhookSecret: string;
};

/** Dados da contratada, regras padrão e o webhook do n8n (vale para todos os contratos novos). */
function ContractSettingsModal({
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
      forumCity: s.forumCity,
      dueDay: String(s.dueDay),
      termMonths: String(s.termMonths),
      slaPercent: s.slaPercent.replace('.', ','),
      readjustIndex: s.readjustIndex,
      lateFeePercent: s.lateFeePercent.replace('.', ','),
      lateInterestPercent: s.lateInterestPercent.replace('.', ','),
      suspendAfterDays: String(s.suspendAfterDays),
      supportHours: s.supportHours,
      webhookUrl: s.webhookUrl,
      webhookSecret: '',
      notifyEmail: s.notifyEmail,
    });
  const set = (k: keyof SettingsForm) => (e: { target: { value: string } }) =>
    setF({
      ...form!,
      [k]: k === 'providerDocument' ? maskDocument(e.target.value) : e.target.value,
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
                label="Representante"
                value={form.providerRepresentative}
                onChange={set('providerRepresentative')}
                wrapClass="span-3"
              />
              <TextField
                label="E-mail para comunicações"
                type="email"
                value={form.providerEmail}
                onChange={set('providerEmail')}
                wrapClass="span-3"
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
                max={60}
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
              Envio pelo n8n{' '}
              <span className="adm-fieldset__hint">e-mail do contrato e aviso de assinatura</span>
            </legend>
            <div className="adm-form">
              <TextField
                label="URL do webhook (Production URL)"
                placeholder="https://n8n.seudominio.com/webhook/comandou-contratos"
                value={form.webhookUrl}
                onChange={set('webhookUrl')}
                wrapClass="span-4"
              />
              <TextField
                label="Segredo (header X-Comandou-Token)"
                type="password"
                autoComplete="new-password"
                placeholder={s.hasWebhookSecret ? 'guardado (vazio mantém)' : 'opcional'}
                value={form.webhookSecret}
                onChange={set('webhookSecret')}
                wrapClass="span-2"
              />
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
                  disabled={!form.webhookUrl}
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
            {!s.keyConfigured && (
              <Alert tone="warning">
                Servidor sem INTEGRATIONS_KEY: o segredo do webhook não pode ser guardado.
              </Alert>
            )}
          </fieldset>
        </form>
      )}
    </Modal>
  );
}
