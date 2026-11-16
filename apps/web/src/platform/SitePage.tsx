import { ExternalLink, Send } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Card, EmptyState, Spinner, TextField, useToast } from '../design-system';
import { CheckField } from '../features/forms';
import { api } from '../lib/api';
import { useLoad } from './OverviewPages';
import { ago, PageHead, Section, Tag, type Level } from './ui';

interface SiteSettings {
  signupEnabled: boolean;
  /** Dias de teste do plano em que o restaurante do site nasce (Super Admin › Preço). */
  trialDays: number;
  trialPlan: string | null;
  dailyLimit: number;
  emailWebhookUrl: string;
  emailTokenSet: boolean;
  siteUrl: string;
}

interface Trial {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  status: string;
  email: string;
  contactName: string;
  phone: string | null;
  sourceKind: 'site' | 'maps' | 'text' | 'none';
  sourceValue: string;
  createdAt: string;
  trialEndsAt: string;
  subscription: string | null;
  emailSentAt: string | null;
  emailError: string | null;
  expiredAt: string | null;
  /** O restaurante nasceu de um site montado pela IA. */
  aiSite?: boolean;
}

const SOURCE = { site: 'Site', maps: 'Google Maps', text: 'Descrição', none: 'Só o nome' };

/** Em que pé está o teste: em teste, fechou (assinatura ativa), venceu ou ainda criando. */
function situation(t: Trial): [string, Level] {
  if (t.status !== 'provisioned' && t.status !== 'suspended') return ['Criando', 'info'];
  if (t.subscription === 'active') return ['Fechou', 'ok'];
  if (t.expiredAt || t.status === 'suspended') return ['Venceu', 'off'];
  const left = new Date(t.trialEndsAt).getTime() - Date.now();
  if (left <= 0) return ['Vencendo', 'warn'];
  const days = Math.ceil(left / 86_400_000);
  return [`Em teste, ${days} ${days === 1 ? 'dia' : 'dias'}`, days <= 1 ? 'warn' : 'info'];
}

/**
 * Super Admin › Site: o cadastro pelo comandou.com (ligado, limite por dia; os dias de teste são
 * os do plano, em Planos), o
 * webhook do n8n que envia o e-mail de boas-vindas e os testes que as pessoas criaram.
 */
export function SitePage() {
  const { data, error, reload } = useLoad<{ settings: SiteSettings; trials: Trial[] }>(
    '/platform/site',
  );
  return (
    <>
      <PageHead
        page
        title="Site"
        sub="Quem chega pelo site cria o próprio restaurante de teste. Aqui você controla o cadastro, o e-mail de boas-vindas e acompanha quem entrou."
        actions={
          data && (
            <a className="adm-action" href={data.settings.siteUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={15} /> Abrir o site
            </a>
          )
        }
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {!data ? (
        <Card>
          <Spinner />
        </Card>
      ) : (
        <>
          <SettingsForm settings={data.settings} onSaved={reload} />
          <Trials trials={data.trials} />
        </>
      )}
    </>
  );
}

function SettingsForm({ settings, onSaved }: { settings: SiteSettings; onSaved(): void }) {
  const toast = useToast();
  const [f, setF] = useState({
    signupEnabled: settings.signupEnabled,
    dailyLimit: String(settings.dailyLimit),
    emailWebhookUrl: settings.emailWebhookUrl,
    emailToken: '',
  });
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    setF((cur) => ({ ...cur, emailWebhookUrl: settings.emailWebhookUrl }));
  }, [settings.emailWebhookUrl]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/platform/site/settings', {
        method: 'PUT',
        json: {
          signupEnabled: f.signupEnabled,
          dailyLimit: Number(f.dailyLimit) || 40,
          emailWebhookUrl: f.emailWebhookUrl.trim(),
          ...(f.emailToken ? { emailToken: f.emailToken } : {}),
        },
      });
      toast('Site salvo', 'success');
      setF((cur) => ({ ...cur, emailToken: '' }));
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setSending(true);
    try {
      await api('/platform/site/test-email', { method: 'POST', json: { to: to.trim() } });
      toast(`E-mail de teste enviado para ${to.trim()}`, 'success');
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Section title="Cadastro pelo site">
        <Card>
          <form className="cm-form" onSubmit={save}>
            <div className="cm-form__block">
              <CheckField
                label="Aceitar cadastros pelo site"
                description="Desligado, o site continua no ar e o botão de criar fica fechado."
                checked={f.signupEnabled}
                onChange={(v) => setF({ ...f, signupEnabled: v })}
              />
            </div>
            <div className="cm-field">
              <span className="cm-label">Tempo de teste</span>
              <p className="adm-site-trial">
                {settings.trialDays > 0 ? (
                  <strong>
                    {settings.trialDays} {settings.trialDays === 1 ? 'dia' : 'dias'}
                  </strong>
                ) : (
                  <strong className="adm-site-trial__off">Sem teste</strong>
                )}{' '}
                <Link to="/planos">Mudar em Preço</Link>
              </p>
              <span className="cm-hint">
                {settings.trialDays > 0
                  ? 'O mesmo tempo do sistema todo. Passou disso sem fechar, o restaurante é suspenso (nada é apagado).'
                  : 'O plano está sem dias de teste: o botão de criar no site fica fechado até colocar.'}
              </span>
            </div>
            <TextField
              label="Limite de cadastros por dia"
              inputMode="numeric"
              hint="Proteção contra abuso. Cada pessoa também só tenta 6 vezes por hora."
              value={f.dailyLimit}
              onChange={(e) => setF({ ...f, dailyLimit: e.target.value.replace(/\D/g, '') })}
            />
            <h3 className="cm-form__section">E-mail de boas-vindas (n8n)</h3>
            <TextField
              label="Endereço do webhook"
              wrapClass="cm-form__wide"
              inputMode="url"
              placeholder="https://seu-n8n.com/webhook/comandou-boas-vindas"
              hint="O Comandou envia o e-mail pronto (para, assunto e HTML) e o n8n só dispara. Vazio: o login aparece só na tela."
              value={f.emailWebhookUrl}
              onChange={(e) => setF({ ...f, emailWebhookUrl: e.target.value })}
            />
            <TextField
              label="Segredo do webhook (opcional)"
              wrapClass="cm-form__wide"
              type="password"
              autoComplete="new-password"
              placeholder={settings.emailTokenSet ? 'Salvo. Digite para trocar.' : ''}
              hint="Vai no cabeçalho X-Comandou-Token, para o n8n recusar chamadas de fora."
              value={f.emailToken}
              onChange={(e) => setF({ ...f, emailToken: e.target.value })}
            />
            <div className="cm-form__block" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button type="submit" loading={busy}>
                Salvar
              </Button>
              <a
                className="cm-btn cm-btn--secondary"
                href="/api/v1/platform/site/email-preview"
                target="_blank"
                rel="noreferrer"
              >
                Ver o e-mail
              </a>
            </div>
          </form>
        </Card>
      </Section>
      {settings.emailWebhookUrl && (
        <Section title="Testar o envio" sub="Manda o e-mail de exemplo pelo webhook salvo">
          <Card>
            <form
              className="cm-form"
              onSubmit={(e) => {
                e.preventDefault();
                void test();
              }}
            >
              <TextField
                label="Enviar para"
                type="email"
                placeholder="voce@exemplo.com"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
              <div className="cm-form__block">
                <Button
                  type="submit"
                  variant="secondary"
                  loading={sending}
                  disabled={!/^\S+@\S+\.\S+$/.test(to.trim())}
                  icon={<Send size={15} />}
                >
                  Enviar e-mail de teste
                </Button>
              </div>
            </form>
          </Card>
        </Section>
      )}
    </>
  );
}

function Trials({ trials }: { trials: Trial[] }) {
  return (
    <Section title="Testes criados pelo site" sub={trials.length ? `${trials.length}` : undefined}>
      <Card bodyless>
        {trials.length === 0 ? (
          <EmptyState
            title="Ninguém criou um teste ainda"
            description="Quando alguém criar um restaurante pelo site, ele aparece aqui."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cm-table">
              <thead>
                <tr>
                  <th>Restaurante</th>
                  <th>Contato</th>
                  <th>Veio de</th>
                  <th>Situação</th>
                  <th>E-mail</th>
                  <th>Criado</th>
                </tr>
              </thead>
              <tbody>
                {trials.map((t) => {
                  const [label, level] = situation(t);
                  return (
                    <tr key={t.id}>
                      <td>
                        <Link to={`/restaurantes/${t.tenantId}`}>
                          <strong>{t.name}</strong>
                        </Link>
                        <div className="cm-hint">{t.slug}</div>
                      </td>
                      <td>
                        {t.contactName}
                        <div className="cm-hint">
                          {t.email}
                          {t.phone ? ` · ${t.phone}` : ''}
                        </div>
                      </td>
                      <td title={t.sourceValue}>
                        {SOURCE[t.sourceKind]}
                        {t.aiSite && <div className="cm-hint">site com IA</div>}
                      </td>
                      <td>
                        <Tag level={level}>{label}</Tag>
                      </td>
                      <td>
                        {t.emailSentAt ? (
                          <Tag level="ok">Enviado</Tag>
                        ) : t.emailError?.includes('não configurado') ? (
                          <Tag level="off">Sem webhook</Tag>
                        ) : t.emailError ? (
                          <span title={t.emailError}>
                            <Tag level="bad">Falhou</Tag>
                          </span>
                        ) : (
                          <Tag level="off">Na fila</Tag>
                        )}
                      </td>
                      <td>{ago(t.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Section>
  );
}
