import { CheckCircle2, Copy, KeyRound, Plus, Send, Trash2, XCircle } from 'lucide-react';
import { FormEvent, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../../design-system';
import { CheckField, SelectField } from '../../features/forms';
import { api } from '../../lib/api';
import { useLoad } from '../OverviewPages';
import { Section, Tag } from '../ui';
import type { Contact, Domain, Mailbox, MailSettings, Overview, Rule } from './types';

const PROVIDERS: [MailSettings['provider'], string, string][] = [
  ['none', 'Desligado', 'Nenhum e-mail do sistema sai.'],
  [
    'cloudflare',
    'Cloudflare',
    'Email Sending da Cloudflare (domínio já na Cloudflare, plano Workers Paid).',
  ],
  ['resend', 'Resend', 'Grátis até 3.000 e-mails por mês. Domínio verificado no Resend.'],
  ['smtp', 'SMTP', 'Qualquer servidor: Amazon SES, Mailgun, Zoho, Google Workspace...'],
];

/** Configurar: envio, recebimento pela Cloudflare, domínios, caixas, regras e contatos. */
export function SettingsTab({ overview, onChanged }: { overview: Overview; onChanged(): void }) {
  return (
    <>
      <SendSettings settings={overview.settings} onSaved={onChanged} />
      <InboundSettings settings={overview.settings} onSaved={onChanged} />
      <Domains domains={overview.domains} mailboxes={overview.mailboxes} onChanged={onChanged} />
      <Rules mailboxes={overview.mailboxes} />
      <Contacts />
      <p className="cm-hint mail__guide">
        Passo a passo da Cloudflare, do Resend e do Worker de recebimento:{' '}
        <code>docs/email.md</code> no repositório.
      </p>
    </>
  );
}

function SendSettings({ settings: s, onSaved }: { settings: MailSettings; onSaved(): void }) {
  const toast = useToast();
  const [f, setF] = useState({
    provider: s.provider,
    fromAddress: s.fromAddress,
    fromName: s.fromName,
    replyTo: s.replyTo,
    cfAccountId: s.cfAccountId,
    cfToken: '',
    resendKey: '',
    smtpHost: s.smtpHost,
    smtpPort: String(s.smtpPort),
    smtpSecure: s.smtpSecure,
    smtpUser: s.smtpUser,
    smtpPass: '',
  });
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [to, setTo] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy('save');
    try {
      await api('/platform/mail/settings', {
        method: 'PUT',
        json: {
          provider: f.provider,
          fromAddress: f.fromAddress.trim(),
          fromName: f.fromName.trim(),
          replyTo: f.replyTo.trim(),
          cfAccountId: f.cfAccountId.trim(),
          ...(f.cfToken ? { cfToken: f.cfToken } : {}),
          ...(f.resendKey ? { resendKey: f.resendKey } : {}),
          smtpHost: f.smtpHost.trim(),
          smtpPort: Number(f.smtpPort) || 587,
          smtpSecure: f.smtpSecure,
          smtpUser: f.smtpUser.trim(),
          ...(f.smtpPass ? { smtpPass: f.smtpPass } : {}),
        },
      });
      setF((c) => ({ ...c, cfToken: '', resendKey: '', smtpPass: '' }));
      toast('Envio salvo', 'success');
      onSaved();
      return true;
    } catch (err) {
      toast((err as Error).message, 'danger');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      await api('/platform/mail/settings/test', { method: 'POST', json: { to: to.trim() } });
      toast(`E-mail de teste enviado para ${to.trim()}`, 'success');
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };

  const saved = (set: boolean) => (set ? 'Salva. Digite para trocar.' : '');

  return (
    <Section
      title="Envio"
      sub={s.ready ? <Tag level="ok">Funcionando</Tag> : <Tag level="warn">Não configurado</Tag>}
    >
      <Card>
        {!s.canStoreSecrets && (
          <Alert tone="warning">
            O servidor está sem a INTEGRATIONS_KEY: não dá para guardar chaves com segurança.
          </Alert>
        )}
        <form className="cm-form" onSubmit={save}>
          <div className="cm-form__block mail__providers" role="radiogroup" aria-label="Provedor">
            {PROVIDERS.map(([v, label, hint]) => (
              <label key={v} className="mail__provider" data-on={f.provider === v || undefined}>
                <input
                  type="radio"
                  name="provider"
                  value={v}
                  checked={f.provider === v}
                  onChange={() => setF({ ...f, provider: v })}
                />
                <span>
                  <strong>{label}</strong>
                  <span className="cm-hint">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          {f.provider !== 'none' && (
            <>
              <h3 className="cm-form__section">Remetente</h3>
              <TextField
                label="E-mail remetente"
                type="email"
                placeholder="nao-responda@seudominio.com.br"
                hint="Um endereço do domínio liberado no provedor."
                value={f.fromAddress}
                onChange={set('fromAddress')}
              />
              <TextField
                label="Nome do remetente"
                value={f.fromName}
                onChange={set('fromName')}
                maxLength={80}
              />
              <TextField
                label="Responder para (opcional)"
                type="email"
                placeholder="contato@seudominio.com.br"
                hint="Quando alguém responde um e-mail do sistema, a resposta vai para cá."
                value={f.replyTo}
                onChange={set('replyTo')}
              />
            </>
          )}
          {f.provider === 'cloudflare' && (
            <>
              <h3 className="cm-form__section">Cloudflare</h3>
              <TextField label="Account ID" value={f.cfAccountId} onChange={set('cfAccountId')} />
              <TextField
                label="API Token (Email Sending: Edit)"
                type="password"
                autoComplete="new-password"
                placeholder={saved(s.cfTokenSet)}
                value={f.cfToken}
                onChange={set('cfToken')}
              />
            </>
          )}
          {f.provider === 'resend' && (
            <>
              <h3 className="cm-form__section">Resend</h3>
              <TextField
                label="API Key"
                wrapClass="cm-form__wide"
                type="password"
                autoComplete="new-password"
                placeholder={saved(s.resendKeySet) || 're_...'}
                value={f.resendKey}
                onChange={set('resendKey')}
              />
            </>
          )}
          {f.provider === 'smtp' && (
            <>
              <h3 className="cm-form__section">Servidor SMTP</h3>
              <TextField
                label="Servidor"
                placeholder="smtp.seuprovedor.com"
                value={f.smtpHost}
                onChange={set('smtpHost')}
              />
              <TextField
                label="Porta"
                inputMode="numeric"
                value={f.smtpPort}
                onChange={set('smtpPort')}
              />
              <TextField
                label="Usuário"
                autoComplete="off"
                value={f.smtpUser}
                onChange={set('smtpUser')}
              />
              <TextField
                label="Senha"
                type="password"
                autoComplete="new-password"
                placeholder={saved(s.smtpPassSet)}
                value={f.smtpPass}
                onChange={set('smtpPass')}
              />
              <div className="cm-form__block">
                <CheckField
                  label="TLS desde o início (porta 465)"
                  description="Desligado: STARTTLS (porta 587)."
                  checked={f.smtpSecure}
                  onChange={(v) => setF({ ...f, smtpSecure: v })}
                />
              </div>
            </>
          )}
          <div className="cm-form__block mail__buttons">
            <Button type="submit" loading={busy === 'save'} disabled={!!busy}>
              Salvar
            </Button>
          </div>
        </form>
        {s.ready && (
          <form
            className="mail__test"
            onSubmit={async (e) => {
              e.preventDefault();
              await test();
            }}
          >
            <TextField
              label="Enviar teste para"
              type="email"
              placeholder="voce@exemplo.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <Button
              type="submit"
              variant="secondary"
              icon={<Send size={15} />}
              loading={busy === 'test'}
              disabled={!/^\S+@\S+\.\S+$/.test(to.trim()) || !!busy}
            >
              Enviar teste
            </Button>
          </form>
        )}
      </Card>
    </Section>
  );
}

function InboundSettings({ settings: s, onSaved }: { settings: MailSettings; onSaved(): void }) {
  const toast = useToast();
  const [shown, setShown] = useState<{ secret: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const rotate = async () => {
    if (
      s.inboundSecretSet &&
      !window.confirm(
        'Gerar um segredo novo? O Worker para de entregar até você atualizar o INBOUND_SECRET dele.',
      )
    )
      return;
    setBusy(true);
    try {
      setShown(
        await api<{ secret: string; url: string }>('/platform/mail/settings/inbound-secret', {
          method: 'POST',
        }),
      );
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  const copy = (v: string) =>
    navigator.clipboard.writeText(v).then(
      () => toast('Copiado', 'success'),
      () => undefined,
    );
  return (
    <Section
      title="Recebimento"
      sub={
        s.inboundSecretSet ? (
          <Tag level="ok">Segredo criado</Tag>
        ) : (
          <Tag level="off">Sem segredo</Tag>
        )
      }
    >
      <Card>
        <ol className="mail__steps">
          <li>
            Na Cloudflare, ative o <strong>Email Routing</strong> no domínio (ela cria os registros
            MX).
          </li>
          <li>
            Gere o segredo aqui e publique o Worker{' '}
            <code>infrastructure/cloudflare/email-worker</code> com ele.
          </li>
          <li>
            Em Email Routing › Routing rules, mande o <strong>Catch-all</strong> para o Worker{' '}
            <code>comandou-email</code>.
          </li>
          <li>Crie o domínio e as caixas abaixo. Pronto: o que chegar aparece em Caixas.</li>
        </ol>
        {shown && (
          <div className="mail__secret">
            <Alert tone="warning">Copie agora: o segredo não aparece de novo.</Alert>
            <div className="mail__secret-row">
              <code>{shown.secret}</code>
              <Button
                size="sm"
                variant="ghost"
                icon={<Copy size={14} />}
                onClick={() => copy(shown.secret)}
              >
                Copiar
              </Button>
            </div>
            <pre className="mail__cmd">{`cd infrastructure/cloudflare/email-worker
npm install
npx wrangler secret put COMANDOU_URL     # ${new URL(shown.url).origin}
npx wrangler secret put INBOUND_SECRET   # o segredo acima
npm run deploy`}</pre>
          </div>
        )}
        <Button variant="secondary" icon={<KeyRound size={15} />} loading={busy} onClick={rotate}>
          {s.inboundSecretSet ? 'Gerar segredo novo' : 'Gerar segredo'}
        </Button>
      </Card>
    </Section>
  );
}

interface DnsCheck {
  domain: string;
  mx: { ok: boolean; found: string[]; hint: string };
  spf: { ok: boolean; found: string; hint: string };
  dmarc: { ok: boolean; found: string; hint: string };
}

function Domains({
  domains,
  mailboxes,
  onChanged,
}: {
  domains: Domain[];
  mailboxes: Mailbox[];
  onChanged(): void;
}) {
  const toast = useToast();
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [dns, setDns] = useState<DnsCheck | null>(null);
  const [newBox, setNewBox] = useState<string | null>(null);
  const [editing, setEditing] = useState<Mailbox | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('add');
    try {
      await api('/platform/mail/domains', {
        method: 'POST',
        json: { domain: domain.trim().toLowerCase() },
      });
      setDomain('');
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };
  const check = async (id: string) => {
    setBusy(id);
    try {
      setDns(await api<DnsCheck>(`/platform/mail/domains/${id}/dns`));
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };
  const remove = async (d: Domain) => {
    if (!window.confirm(`Remover ${d.domain}?`)) return;
    try {
      await api(`/platform/mail/domains/${d.id}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'danger');
    }
  };

  return (
    <Section title="Domínios e caixas">
      <Card>
        <form className="mail__inline" onSubmit={add}>
          <TextField
            label="Novo domínio"
            placeholder="seudominio.com.br"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <Button
            type="submit"
            variant="secondary"
            icon={<Plus size={15} />}
            loading={busy === 'add'}
            disabled={!domain.includes('.')}
          >
            Adicionar
          </Button>
        </form>
        {!domains.length && <p className="cm-hint">Nenhum domínio ainda.</p>}
        {domains.map((d) => (
          <div key={d.id} className="mail__domain">
            <div className="mail__domain-head">
              <strong>{d.domain}</strong>
              <span className="mail__spacer" />
              <Button size="sm" variant="ghost" loading={busy === d.id} onClick={() => check(d.id)}>
                Conferir DNS
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus size={14} />}
                onClick={() => setNewBox(d.id)}
              >
                Caixa
              </Button>
              {d.mailboxes === 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 size={14} />}
                  aria-label={`Remover ${d.domain}`}
                  onClick={() => remove(d)}
                />
              )}
            </div>
            <ul className="mail__boxes">
              {mailboxes
                .filter((m) => m.domainId === d.id)
                .map((m) => (
                  <li key={m.id}>
                    <button type="button" className="mail__boxrow" onClick={() => setEditing(m)}>
                      <span>
                        {m.address}
                        {m.displayName && <span className="cm-hint"> · {m.displayName}</span>}
                      </span>
                      {m.catchAll && <Tag level="info">Recebe o resto</Tag>}
                      {m.autoReply && <Tag level="warn">Resposta automática</Tag>}
                      {m.archived && <Tag level="off">Arquivada</Tag>}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </Card>
      {dns && (
        <Modal open title={`DNS de ${dns.domain}`} onClose={() => setDns(null)}>
          {(['mx', 'spf', 'dmarc'] as const).map((k) => {
            const r = dns[k];
            return (
              <div key={k} className="mail__dns">
                {r.ok ? (
                  <CheckCircle2 size={18} className="mail__ok" />
                ) : (
                  <XCircle size={18} className="mail__bad" />
                )}
                <div>
                  <strong>{k.toUpperCase()}</strong>
                  <div className="mail__dns-found">
                    {Array.isArray(r.found)
                      ? r.found.join(', ') || 'nada encontrado'
                      : r.found || 'nada encontrado'}
                  </div>
                  {!r.ok && <div className="cm-hint">{r.hint}</div>}
                </div>
              </div>
            );
          })}
        </Modal>
      )}
      {newBox && (
        <NewMailbox
          domainId={newBox}
          domain={domains.find((d) => d.id === newBox)!.domain}
          onClose={() => setNewBox(null)}
          onSaved={() => {
            setNewBox(null);
            onChanged();
          }}
        />
      )}
      {editing && (
        <EditMailbox
          box={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </Section>
  );
}

function NewMailbox({
  domainId,
  domain,
  onClose,
  onSaved,
}: {
  domainId: string;
  domain: string;
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [local, setLocal] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/platform/mail/mailboxes', {
        method: 'POST',
        json: { domainId, local: local.trim().toLowerCase(), displayName: name.trim() },
      });
      toast('Caixa criada', 'success');
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="Nova caixa de e-mail"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="mail-newbox" loading={busy} disabled={!local.trim()}>
            Criar
          </Button>
        </>
      }
    >
      <form id="mail-newbox" className="cm-form" onSubmit={save}>
        <TextField
          label="Endereço"
          autoFocus
          hint={`${local.trim() || 'contato'}@${domain}`}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
        />
        <TextField
          label="Nome que aparece"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
      </form>
    </Modal>
  );
}

function EditMailbox({
  box,
  onClose,
  onSaved,
}: {
  box: Mailbox;
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    displayName: box.displayName,
    signature: box.signature,
    catchAll: box.catchAll,
    autoReply: box.autoReply,
    autoReplySubject: box.autoReplySubject,
    autoReplyBody: box.autoReplyBody,
    forwardTo: box.forwardTo,
    archived: box.archived,
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/platform/mail/mailboxes/${box.id}`, {
        method: 'PATCH',
        json: { ...f, forwardTo: f.forwardTo.trim() },
      });
      toast('Caixa salva', 'success');
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      size="lg"
      title={box.address}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="mail-editbox" loading={busy}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="mail-editbox" className="cm-form" onSubmit={save}>
        <TextField
          label="Nome que aparece"
          value={f.displayName}
          onChange={set('displayName')}
          maxLength={80}
        />
        <TextField
          label="Encaminhar uma cópia para"
          type="email"
          hint="O endereço precisa estar verificado em Email Routing › Destination addresses."
          value={f.forwardTo}
          onChange={set('forwardTo')}
        />
        <label className="cm-field cm-form__wide">
          <span className="cm-label">Assinatura</span>
          <textarea
            className="cm-input"
            rows={3}
            value={f.signature}
            onChange={set('signature')}
            maxLength={2000}
          />
        </label>
        <div className="cm-form__block">
          <CheckField
            label="Recebe o que não tem caixa"
            description="E-mail para um endereço do domínio sem caixa cai aqui em vez de voltar."
            checked={f.catchAll}
            onChange={(v) => setF({ ...f, catchAll: v })}
          />
        </div>
        <h3 className="cm-form__section">Resposta automática</h3>
        <div className="cm-form__block">
          <CheckField
            label="Responder sozinho"
            description="Uma vez por remetente a cada 24 horas. Nunca para listas, robôs ou outra resposta automática."
            checked={f.autoReply}
            onChange={(v) => setF({ ...f, autoReply: v })}
          />
        </div>
        {f.autoReply && (
          <>
            <TextField
              label="Assunto"
              wrapClass="cm-form__wide"
              placeholder="Re: (assunto original)"
              value={f.autoReplySubject}
              onChange={set('autoReplySubject')}
              maxLength={200}
            />
            <label className="cm-field cm-form__wide">
              <span className="cm-label">Mensagem</span>
              <textarea
                className="cm-input"
                rows={4}
                value={f.autoReplyBody}
                onChange={set('autoReplyBody')}
                maxLength={4000}
              />
            </label>
          </>
        )}
        <div className="cm-form__block">
          <CheckField
            label="Arquivar a caixa"
            description="Para de receber (o que chegar volta ao remetente). As mensagens ficam guardadas."
            checked={f.archived}
            onChange={(v) => setF({ ...f, archived: v })}
          />
        </div>
      </form>
    </Modal>
  );
}

const FIELD = { from: 'Remetente', to: 'Destinatário', subject: 'Assunto' };
const OP = { contains: 'contém', equals: 'é igual a', ends_with: 'termina com' };
const ACTION = {
  archive: 'Arquivar',
  spam: 'Mandar para o spam',
  trash: 'Mandar para a lixeira',
  star: 'Pôr estrela',
  read: 'Marcar como lida',
  reject: 'Recusar (volta ao remetente)',
};

function Rules({ mailboxes }: { mailboxes: Mailbox[] }) {
  const toast = useToast();
  const rules = useLoad<Rule[]>('/platform/mail/rules');
  const empty = {
    mailboxId: '',
    name: '',
    field: 'from' as Rule['field'],
    op: 'contains' as Rule['op'],
    value: '',
    action: 'archive' as Rule['action'],
  };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/platform/mail/rules', {
        method: 'POST',
        json: {
          ...f,
          mailboxId: f.mailboxId || null,
          name: f.name || `${FIELD[f.field]} ${OP[f.op]} ${f.value}`,
        },
      });
      setF(empty);
      rules.reload();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (r: Rule) => {
    await api(`/platform/mail/rules/${r.id}`, {
      method: 'PUT',
      json: { ...r, enabled: !r.enabled },
    }).catch((e: Error) => toast(e.message, 'danger'));
    rules.reload();
  };
  const remove = async (r: Rule) => {
    await api(`/platform/mail/rules/${r.id}`, { method: 'DELETE' }).catch((e: Error) =>
      toast(e.message, 'danger'),
    );
    rules.reload();
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Section title="Regras" sub="A primeira que combinar decide o que fazer com o e-mail que chega">
      <Card>
        {rules.data?.length ? (
          <ul className="mail__rules">
            {rules.data.map((r) => (
              <li key={r.id} data-off={!r.enabled || undefined}>
                <span>
                  Se <strong>{FIELD[r.field].toLowerCase()}</strong> {OP[r.op]}{' '}
                  <strong>{r.value}</strong> → {ACTION[r.action].toLowerCase()}
                  {r.mailboxId && (
                    <span className="cm-hint">
                      {' '}
                      · só em {mailboxes.find((m) => m.id === r.mailboxId)?.address}
                    </span>
                  )}
                </span>
                <Button size="sm" variant="ghost" onClick={() => toggle(r)}>
                  {r.enabled ? 'Desligar' : 'Ligar'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 size={14} />}
                  aria-label="Apagar regra"
                  onClick={() => remove(r)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="cm-hint">Nenhuma regra.</p>
        )}
        <form className="cm-form" onSubmit={add}>
          <SelectField label="Se o" value={f.field} onChange={set('field')}>
            {Object.entries(FIELD).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </SelectField>
          <SelectField label="Condição" value={f.op} onChange={set('op')}>
            {Object.entries(OP).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Texto"
            placeholder="@promocoes.com"
            value={f.value}
            onChange={set('value')}
            maxLength={200}
          />
          <SelectField label="Então" value={f.action} onChange={set('action')}>
            {Object.entries(ACTION).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </SelectField>
          <SelectField label="Em qual caixa" value={f.mailboxId} onChange={set('mailboxId')}>
            <option value="">Todas</option>
            {mailboxes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.address}
              </option>
            ))}
          </SelectField>
          <div className="cm-form__block mail__buttons">
            <Button
              type="submit"
              variant="secondary"
              icon={<Plus size={15} />}
              loading={busy}
              disabled={!f.value.trim()}
            >
              Adicionar regra
            </Button>
          </div>
        </form>
      </Card>
    </Section>
  );
}

function Contacts() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const contacts = useLoad<Contact[]>(
    `/platform/mail/contacts?q=${encodeURIComponent(q)}&limit=100`,
  );
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  return (
    <Section
      title="Contatos"
      sub="Guardados sozinhos ao enviar e receber"
      actions={
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus size={14} />}
          onClick={() => setEditing('new')}
        >
          Novo
        </Button>
      }
    >
      <Card bodyless>
        <div className="mail__pad">
          <TextField label="Buscar contato" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!contacts.data ? (
          <Spinner />
        ) : !contacts.data.length ? (
          <EmptyState title="Nenhum contato" />
        ) : (
          <table className="cm-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Empresa</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contacts.data.map((c) => (
                <tr key={c.id}>
                  <td>{c.name || '—'}</td>
                  <td>{c.email}</td>
                  <td>{c.company || '—'}</td>
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                      Editar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {editing && (
        <ContactForm
          contact={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            contacts.reload();
          }}
          onError={(m) => toast(m, 'danger')}
        />
      )}
    </Section>
  );
}

function ContactForm({
  contact,
  onClose,
  onSaved,
  onError,
}: {
  contact: Contact | null;
  onClose(): void;
  onSaved(): void;
  onError(m: string): void;
}) {
  const [f, setF] = useState({
    email: contact?.email ?? '',
    name: contact?.name ?? '',
    company: contact?.company ?? '',
    phone: contact?.phone ?? '',
    notes: contact?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(contact ? `/platform/mail/contacts/${contact.id}` : '/platform/mail/contacts', {
        method: contact ? 'PUT' : 'POST',
        json: f,
      });
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!contact) return;
    await api(`/platform/mail/contacts/${contact.id}`, { method: 'DELETE' }).catch((e: Error) =>
      onError(e.message),
    );
    onSaved();
  };
  return (
    <Modal
      open
      title={contact ? 'Editar contato' : 'Novo contato'}
      onClose={onClose}
      footer={
        <>
          {contact && (
            <Button variant="ghost" onClick={remove}>
              Apagar
            </Button>
          )}
          <Button
            type="submit"
            form="mail-contact"
            loading={busy}
            disabled={!f.email.includes('@')}
          >
            Salvar
          </Button>
        </>
      }
    >
      <form id="mail-contact" className="cm-form" onSubmit={save}>
        <TextField label="E-mail" type="email" value={f.email} onChange={set('email')} />
        <TextField label="Nome" value={f.name} onChange={set('name')} maxLength={120} />
        <TextField label="Empresa" value={f.company} onChange={set('company')} maxLength={120} />
        <TextField label="Telefone" value={f.phone} onChange={set('phone')} maxLength={30} />
        <label className="cm-field cm-form__wide">
          <span className="cm-label">Observações</span>
          <textarea
            className="cm-input"
            rows={3}
            value={f.notes}
            onChange={set('notes')}
            maxLength={1000}
          />
        </label>
      </form>
    </Modal>
  );
}
