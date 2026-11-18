import { validateTenantSlug } from '@comandou/shared';
import { ArrowLeft, Check, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert, Button, Select, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import { CepField } from '../features/CepField';
import { useLoad } from './OverviewPages';
import { UFS, maskDocument, maskPhone, onlyDigits } from '../lib/br-format';

export { UFS, maskDocument, maskPhone };
import { PageHead } from './ui';
import type { Plan, TenantDetail, TenantProfile } from './types';

/** Fusos do Brasil (os mesmos que a API aceita). */
export const TIMEZONES: [string, string][] = [
  ['America/Sao_Paulo', 'Brasília (Sul, Sudeste, GO, DF)'],
  ['America/Bahia', 'Bahia'],
  ['America/Fortaleza', 'CE, RN, PB, PI, MA'],
  ['America/Recife', 'Pernambuco'],
  ['America/Belem', 'Pará e Amapá'],
  ['America/Manaus', 'Amazonas (−1 h)'],
  ['America/Cuiaba', 'Mato Grosso (−1 h)'],
  ['America/Campo_Grande', 'Mato Grosso do Sul (−1 h)'],
  ['America/Porto_Velho', 'Rondônia (−1 h)'],
  ['America/Boa_Vista', 'Roraima (−1 h)'],
  ['America/Rio_Branco', 'Acre (−2 h)'],
  ['America/Noronha', 'Fernando de Noronha (+1 h)'],
];

/** Fuso sugerido pela UF (o dono ainda pode trocar). */
const UF_TIMEZONE: Record<string, string> = {
  BA: 'America/Bahia',
  CE: 'America/Fortaleza',
  RN: 'America/Fortaleza',
  PB: 'America/Fortaleza',
  PI: 'America/Fortaleza',
  MA: 'America/Fortaleza',
  PE: 'America/Recife',
  AL: 'America/Recife',
  SE: 'America/Recife',
  PA: 'America/Belem',
  AP: 'America/Belem',
  TO: 'America/Sao_Paulo',
  AM: 'America/Manaus',
  MT: 'America/Cuiaba',
  MS: 'America/Campo_Grande',
  RO: 'America/Porto_Velho',
  RR: 'America/Boa_Vista',
  AC: 'America/Rio_Branco',
};

/** "Cantina da Praça" → "cantina-da-praca". */
export function slugify(name: string) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** Senha forte e fácil de ditar (sem 0/O, 1/l/I). */
export function generatePassword(length = 14) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const r = new Uint32Array(length);
  crypto.getRandomValues(r);
  return Array.from(r, (n) => chars[n % chars.length]).join('');
}

export type ProfileForm = Record<
  'legalName' | 'document' | 'contactName' | 'phone' | 'billingEmail' | 'city' | 'state' | 'notes',
  string
>;

export const profileForm = (p?: TenantProfile | null): ProfileForm => ({
  legalName: p?.legalName ?? '',
  document: p?.document ? maskDocument(p.document) : '',
  contactName: p?.contactName ?? '',
  phone: p?.phone ? maskPhone(p.phone) : '',
  billingEmail: p?.billingEmail ?? '',
  city: p?.city ?? '',
  state: p?.state ?? '',
  notes: p?.notes ?? '',
});

export function profileErrors(f: ProfileForm): Partial<Record<keyof ProfileForm, string>> {
  const e: Partial<Record<keyof ProfileForm, string>> = {};
  const doc = onlyDigits(f.document);
  if (doc && doc.length !== 11 && doc.length !== 14) e.document = 'CPF tem 11 dígitos e CNPJ, 14';
  const phone = onlyDigits(f.phone);
  if (phone && (phone.length < 10 || phone.length > 11)) e.phone = 'Telefone com DDD';
  if (f.billingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.billingEmail))
    e.billingEmail = 'E-mail inválido';
  return e;
}

/** Bloco do formulário com título (as seções do modal). */
function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="adm-fieldset">
      <legend className="adm-fieldset__title">
        {title}
        {hint && <span className="adm-fieldset__hint">{hint}</span>}
      </legend>
      <div className="adm-form">{children}</div>
    </fieldset>
  );
}

function SelectBox({
  label,
  value,
  onChange,
  children,
  hint,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`cm-field ${className ?? ''}`}>
      <label className="cm-label" htmlFor={id}>
        {label}
      </label>
      <Select id={id} className="cm-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </Select>
      {hint && <span className="cm-hint">{hint}</span>}
    </div>
  );
}

/**
 * Campos de contato e cobrança (CPF/CNPJ, responsável, telefone, e-mail de cobrança e
 * observações). Usados no "Novo restaurante" e na aba Cadastro.
 */
export function ProfileFields({
  f,
  set,
  errors,
  withCity = true,
}: {
  f: ProfileForm;
  set: (k: keyof ProfileForm, v: string) => void;
  errors: Partial<Record<keyof ProfileForm, string>>;
  withCity?: boolean;
}) {
  const notesId = useId();
  return (
    <>
      <TextField
        label="Razão social"
        value={f.legalName}
        onChange={(e) => set('legalName', e.target.value)}
        maxLength={160}
        wrapClass="span-4"
      />
      <TextField
        label="CPF ou CNPJ"
        inputMode="numeric"
        value={f.document}
        onChange={(e) => set('document', maskDocument(e.target.value))}
        error={errors.document}
        wrapClass="span-2"
      />
      <TextField
        label="Responsável"
        value={f.contactName}
        onChange={(e) => set('contactName', e.target.value)}
        maxLength={120}
        hint="Quem fala com a gente"
        wrapClass="span-2"
      />
      <TextField
        label="Telefone / WhatsApp"
        type="tel"
        inputMode="tel"
        value={f.phone}
        onChange={(e) => set('phone', maskPhone(e.target.value))}
        error={errors.phone}
        placeholder="(11) 98765-4321"
        wrapClass="span-2"
      />
      <TextField
        label="E-mail de cobrança"
        type="email"
        value={f.billingEmail}
        onChange={(e) => set('billingEmail', e.target.value)}
        error={errors.billingEmail}
        wrapClass="span-2"
      />
      {withCity && <CityFields f={f} set={set} />}
      <div className="cm-field span-6">
        <label className="cm-label" htmlFor={notesId}>
          Observações internas
        </label>
        <textarea
          id={notesId}
          className="cm-input adm-textarea"
          rows={2}
          maxLength={1000}
          value={f.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
        <span className="cm-hint">
          Só o painel admin vê. Ex.: indicado por, combinado de preço.
        </span>
      </div>
    </>
  );
}

function CityFields({
  f,
  set,
  onState,
}: {
  f: Pick<ProfileForm, 'city' | 'state'>;
  set: (k: 'city' | 'state', v: string) => void;
  onState?: (uf: string) => void;
}) {
  return (
    <>
      <CepField
        label="CEP"
        wrapClass="span-2 m-span-4"
        onFound={(a) => {
          if (a.city) set('city', a.city);
          if (a.state) {
            set('state', a.state);
            onState?.(a.state);
          }
        }}
      />
      <TextField
        label="Cidade"
        value={f.city}
        onChange={(e) => set('city', e.target.value)}
        maxLength={80}
        wrapClass="span-3 m-span-3"
      />
      <SelectBox
        label="UF"
        value={f.state}
        onChange={(v) => {
          set('state', v);
          onState?.(v);
        }}
        className="span-1 m-span-1"
      >
        <option value="">—</option>
        {UFS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </SelectBox>
    </>
  );
}

/** Corpo para a API: só dígitos no documento e no telefone. */
export const profileBody = (f: ProfileForm) => ({
  ...f,
  document: onlyDigits(f.document),
  phone: onlyDigits(f.phone),
});

const money = (v: string) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type TenantForm = {
  name: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  planCode: string;
  timezone: string;
  sendAccessEmail: boolean;
};

type Created = TenantDetail & {
  accessEmail: { to: string; sent: boolean; error?: string } | null;
};

/** Os passos do "Criar restaurante", na ordem. */
const STEPS = [
  { key: 'restaurant', title: 'Restaurante', hint: 'Nome, endereço e cidade' },
  { key: 'owner', title: 'Acesso do dono', hint: 'Login e senha' },
  { key: 'plan', title: 'Plano', hint: 'Preço e dias grátis' },
  { key: 'contact', title: 'Contato e cobrança', hint: 'Opcional' },
  { key: 'review', title: 'Conferir e criar', hint: 'Tudo certo?' },
] as const;

/** Rascunho no navegador (sem a senha): sair da tela sem querer não perde o que foi digitado. */
const DRAFT_KEY = 'cm-admin:new-tenant';

function readDraft(): { f?: Partial<TenantForm>; profile?: ProfileForm; step?: number } {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeDraft(v: { f: TenantForm; profile: ProfileForm; step: number } | null) {
  try {
    if (!v) sessionStorage.removeItem(DRAFT_KEY);
    else
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...v, f: { ...v.f, adminPassword: '' } }));
  } catch {
    /* navegador sem armazenamento: segue sem rascunho */
  }
}

/** Linha do resumo: rótulo, valor e o atalho para voltar ao passo. */
function ReviewRow({ label, value, onEdit }: { label: string; value: ReactNode; onEdit(): void }) {
  return (
    <div className="adm-wizard__row">
      <span className="adm-wizard__label">{label}</span>
      <span className="adm-wizard__value">{value || '—'}</span>
      <button type="button" className="adm-wizard__edit" onClick={onEdit}>
        Alterar
      </button>
    </div>
  );
}

/**
 * Tela própria (Restaurantes › Novo) com os passos para criar um restaurante. Antes era uma
 * janela que fechava num clique fora e perdia tudo; aqui o que foi digitado fica salvo até criar.
 * No fim avisa para qual e-mail foram o login e a senha.
 */
export function NewTenantPage() {
  const navigate = useNavigate();
  const plans = useLoad<Plan[]>('/platform/plans').data?.filter((p) => p.active) ?? [];
  const [draft] = useState(readDraft);
  const [f, setF] = useState<TenantForm>(() => ({
    name: '',
    slug: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    planCode: '',
    timezone: 'America/Sao_Paulo',
    sendAccessEmail: true,
    ...draft.f,
  }));
  const [profile, setProfile] = useState<ProfileForm>(draft.profile ?? profileForm());
  const [step, setStep] = useState(Math.min(draft.step ?? 0, STEPS.length - 1));
  const [slugTouched, setSlugTouched] = useState(!!draft.f?.slug);
  const [tzTouched, setTzTouched] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [tried, setTried] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const set = <K extends keyof TenantForm>(k: K, v: TenantForm[K]) =>
    setF((x) => ({ ...x, [k]: v }));
  const setP = (k: keyof ProfileForm, v: string) => setProfile((x) => ({ ...x, [k]: v }));
  const base = window.location.hostname.replace(/^admin\./, '');
  const defaultPlan = plans.find((p) => p.isDefault);
  const plan = f.planCode || defaultPlan?.code || '';
  const planInfo = plans.find((p) => p.code === plan);

  useEffect(() => {
    if (!created) writeDraft({ f, profile, step });
  }, [f, profile, step, created]);

  const slugCheck = f.slug ? validateTenantSlug(f.slug) : null;
  const pErrors = profileErrors(profile);
  const errors: Record<string, string | undefined> = {
    name: !f.name.trim() ? 'Informe o nome' : undefined,
    slug: !f.slug
      ? 'Escolha o endereço'
      : slugCheck && !slugCheck.ok
        ? slugCheck.reason
        : undefined,
    adminName: !f.adminName.trim() ? 'Informe o nome' : undefined,
    adminEmail: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.adminEmail) ? 'E-mail inválido' : undefined,
    adminPassword: f.adminPassword.length < 10 ? 'Mínimo 10 caracteres' : undefined,
  };
  const stepFields: string[][] = [
    ['name', 'slug'],
    ['adminName', 'adminEmail', 'adminPassword'],
    [],
    [],
    [],
  ];
  const stepValid = (i: number) =>
    !stepFields[i]!.some((k) => errors[k]) && (i !== 3 || !Object.keys(pErrors).length);
  const show = (k: string) => {
    const i = stepFields.findIndex((fs) => fs.includes(k));
    return tried[i] ? errors[k] : undefined;
  };
  const firstInvalid = STEPS.findIndex((_, i) => !stepValid(i));

  function go(i: number) {
    setError(null);
    setStep(i);
    window.scrollTo({ top: 0 });
  }

  async function next(e: FormEvent) {
    e.preventDefault();
    setTried((t) => ({ ...t, [step]: true }));
    if (!stepValid(step)) return;
    if (step < STEPS.length - 1) return go(step + 1);
    if (firstInvalid >= 0) {
      setTried((t) => ({ ...t, [firstInvalid]: true }));
      return go(firstInvalid);
    }
    setBusy(true);
    setError(null);
    try {
      const t = await api<Created>('/platform/tenants', {
        method: 'POST',
        json: {
          ...f,
          planCode: plan || undefined,
          profile: profileBody(profile),
        },
      });
      writeDraft(null);
      setCreated(t);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    writeDraft(null);
    navigate('/restaurantes');
  }

  const back = (
    <Link to="/restaurantes" className="adm-back">
      <ArrowLeft size={14} /> Restaurantes
    </Link>
  );

  if (created) {
    const mail = created.accessEmail;
    return (
      <>
        {back}
        <div className="adm-section">
          <PageHead title="Restaurante criado" />
          <div className="adm-panel adm-wizard__done">
            <span className="adm-wizard__done-icon" aria-hidden>
              <Check size={22} />
            </span>
            <h2>{created.name} foi criado</h2>
            <p className="adm-sub">
              {created.slug}.{base}
              {created.status !== 'provisioned' && ' · preparando o banco, leva cerca de um minuto'}
            </p>
            {mail?.sent ? (
              <Alert tone="info">
                <span>
                  Mandamos o login e a senha para <strong>{mail.to}</strong>. Avise o cliente para
                  olhar a caixa de entrada (e o spam, se não achar).
                </span>
              </Alert>
            ) : mail ? (
              <Alert tone="warning">
                <span>
                  O e-mail para <strong>{mail.to}</strong> não saiu: {mail.error}. Passe o login e a
                  senha para o cliente de outro jeito.
                </span>
              </Alert>
            ) : (
              <Alert tone="info">
                Você pediu para não mandar e-mail. Passe o login e a senha para o cliente.
              </Alert>
            )}
            <div className="adm-wizard__actions">
              <Button variant="secondary" onClick={() => navigate('/restaurantes')}>
                Voltar para a lista
              </Button>
              <Button onClick={() => navigate(`/restaurantes/${created.id}`)}>
                Abrir o restaurante
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  const tzLabel = TIMEZONES.find(([v]) => v === f.timezone)?.[1] ?? f.timezone;
  const contactFilled = Object.entries(profile).filter(
    ([k, v]) => v && k !== 'city' && k !== 'state',
  ).length;

  return (
    <>
      {back}
      <div className="adm-section adm-wizard">
        <PageHead
          title="Novo restaurante"
          sub="Preencha os passos. Se sair desta tela, o que já foi digitado continua aqui."
        />
        <ol className="adm-wizard__steps" aria-label="Passos">
          {STEPS.map((s, i) => {
            const state = i === step ? 'current' : i < step ? 'done' : 'todo';
            return (
              <li key={s.key}>
                <button
                  type="button"
                  className="adm-wizard__step"
                  data-state={state}
                  aria-current={i === step ? 'step' : undefined}
                  disabled={i > step && (firstInvalid < 0 ? false : i > firstInvalid)}
                  onClick={() => go(i)}
                >
                  <span className="adm-wizard__num">
                    {state === 'done' ? <Check size={13} /> : i + 1}
                  </span>
                  <span className="adm-wizard__text">
                    <span className="adm-wizard__title">{s.title}</span>
                    <span className="adm-wizard__hint">{s.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <form className="adm-panel adm-wizard__body" onSubmit={next} noValidate>
          <div className="adm-wizard__head">
            <span className="adm-sub">
              Passo {step + 1} de {STEPS.length}
            </span>
            <h2>{STEPS[step]!.title}</h2>
          </div>

          {step === 0 && (
            <div className="adm-form">
              <TextField
                label="Nome do restaurante"
                value={f.name}
                autoFocus
                maxLength={120}
                onChange={(e) => {
                  set('name', e.target.value);
                  if (!slugTouched) set('slug', slugify(e.target.value));
                }}
                error={show('name')}
                wrapClass="span-6"
              />
              <div className="cm-field span-6">
                <label className="cm-label" htmlFor="nt-slug">
                  Endereço
                </label>
                <div className="adm-addon">
                  <input
                    id="nt-slug"
                    className="cm-input"
                    value={f.slug}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="cantina-da-praca"
                    aria-invalid={show('slug') || (slugCheck && !slugCheck.ok) ? true : undefined}
                    onChange={(e) => {
                      setSlugTouched(true);
                      set('slug', e.target.value.toLowerCase().replace(/\s+/g, '-'));
                    }}
                  />
                  <span className="adm-addon__suffix">.{base}</span>
                </div>
                {(slugCheck && !slugCheck.ok) || show('slug') ? (
                  <span className="cm-error-text" role="alert">
                    {slugCheck && !slugCheck.ok ? slugCheck.reason : show('slug')}
                  </span>
                ) : (
                  <span className="cm-hint">
                    Sai do nome sozinho. Não dá para mudar depois de criado.
                  </span>
                )}
              </div>
              <CityFields
                f={profile}
                set={setP}
                onState={(uf) => {
                  if (!tzTouched) set('timezone', UF_TIMEZONE[uf] ?? 'America/Sao_Paulo');
                }}
              />
              <SelectBox
                label="Fuso horário"
                value={f.timezone}
                onChange={(v) => {
                  setTzTouched(true);
                  set('timezone', v);
                }}
                hint="Horário dos pedidos, do caixa e dos relatórios"
                className="span-3"
              >
                {TIMEZONES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </SelectBox>
            </div>
          )}

          {step === 1 && (
            <div className="adm-form">
              <TextField
                label="Nome do dono"
                value={f.adminName}
                autoFocus
                autoComplete="off"
                maxLength={120}
                onChange={(e) => set('adminName', e.target.value)}
                error={show('adminName')}
                wrapClass="span-3"
              />
              <TextField
                label="E-mail (vira o login)"
                type="email"
                autoComplete="off"
                value={f.adminEmail}
                onChange={(e) => set('adminEmail', e.target.value.trim())}
                error={show('adminEmail')}
                wrapClass="span-3"
              />
              <div className="cm-field span-6">
                <label className="cm-label" htmlFor="nt-pass">
                  Senha inicial
                </label>
                <div className="adm-addon">
                  <input
                    id="nt-pass"
                    className="cm-input"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={f.adminPassword}
                    aria-invalid={show('adminPassword') ? true : undefined}
                    onChange={(e) => set('adminPassword', e.target.value)}
                  />
                  <button
                    type="button"
                    className="adm-addon__btn"
                    aria-label={showPassword ? 'Esconder a senha' : 'Mostrar a senha'}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button
                    type="button"
                    className="adm-addon__btn"
                    onClick={() => {
                      set('adminPassword', generatePassword());
                      setShowPassword(true);
                    }}
                  >
                    <RefreshCw size={14} /> Gerar
                  </button>
                </div>
                {show('adminPassword') ? (
                  <span className="cm-error-text" role="alert">
                    {show('adminPassword')}
                  </span>
                ) : (
                  <span className="cm-hint">
                    Mínimo 10 caracteres. Se o e-mail já tem conta, a senha dele continua.
                  </span>
                )}
              </div>
              <label className="adm-check span-6">
                <input
                  type="checkbox"
                  checked={f.sendAccessEmail}
                  onChange={(e) => set('sendAccessEmail', e.target.checked)}
                />
                <span>
                  <strong>Mandar o login e a senha para o e-mail do dono</strong>
                  <span className="adm-sub">
                    Sai assim que o restaurante for criado, com o endereço e o botão para entrar.
                  </span>
                </span>
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="adm-plan-pick" role="radiogroup" aria-label="Plano">
              {[
                ...plans.map((p) => ({
                  code: p.code,
                  name: p.name,
                  detail: `${money(p.priceMonthly)}/mês${p.trialDays ? ` · ${p.trialDays} dias grátis` : ''}`,
                  tag: p.isDefault ? 'padrão' : null,
                })),
                // Com plano padrão, todo restaurante novo entra num plano.
                ...(defaultPlan
                  ? []
                  : [
                      {
                        code: '',
                        name: 'Sem plano',
                        detail: 'Sem limites nem cobrança',
                        tag: null,
                      },
                    ]),
              ].map((p) => {
                const checked = p.code === plan;
                return (
                  <label key={p.code || 'none'} className="adm-plan-opt" data-checked={checked}>
                    <input
                      type="radio"
                      name="plan"
                      value={p.code}
                      checked={checked}
                      onChange={() => set('planCode', p.code)}
                    />
                    <span className="adm-plan-opt__name">
                      {p.name}
                      {p.tag && <span className="adm-plan-opt__tag">{p.tag}</span>}
                    </span>
                    <span className="adm-plan-opt__detail">{p.detail}</span>
                  </label>
                );
              })}
            </div>
          )}

          {step === 3 && (
            <>
              <p className="adm-sub adm-wizard__lead">
                Pode pular e preencher depois na aba Cadastro do restaurante.
              </p>
              <div className="adm-form">
                <ProfileFields
                  f={profile}
                  set={setP}
                  errors={tried[3] ? pErrors : {}}
                  withCity={false}
                />
              </div>
            </>
          )}

          {step === 4 && (
            <div className="adm-wizard__review">
              <ReviewRow label="Restaurante" value={f.name} onEdit={() => go(0)} />
              <ReviewRow label="Endereço" value={`${f.slug}.${base}`} onEdit={() => go(0)} />
              <ReviewRow
                label="Cidade"
                value={[profile.city, profile.state].filter(Boolean).join(' / ')}
                onEdit={() => go(0)}
              />
              <ReviewRow label="Fuso" value={tzLabel} onEdit={() => go(0)} />
              <ReviewRow
                label="Dono"
                value={f.adminName && `${f.adminName} · ${f.adminEmail}`}
                onEdit={() => go(1)}
              />
              <ReviewRow
                label="Login e senha"
                value={
                  f.sendAccessEmail
                    ? `vão para ${f.adminEmail || 'o e-mail do dono'}`
                    : 'não mandar e-mail'
                }
                onEdit={() => go(1)}
              />
              <ReviewRow
                label="Plano"
                value={planInfo ? planInfo.name : 'Sem plano'}
                onEdit={() => go(2)}
              />
              <ReviewRow
                label="Contato e cobrança"
                value={contactFilled ? `${contactFilled} campos preenchidos` : 'depois'}
                onEdit={() => go(3)}
              />
            </div>
          )}

          {error && <Alert tone="danger">{error}</Alert>}
          {tried[step] && !stepValid(step) && (
            <Alert tone="warning">Confira os campos marcados para continuar.</Alert>
          )}

          <div className="adm-wizard__actions">
            <Button variant="ghost" type="button" onClick={cancel}>
              Cancelar
            </Button>
            <span className="adm-wizard__spacer" />
            {step > 0 && (
              <Button variant="secondary" type="button" onClick={() => go(step - 1)}>
                Voltar
              </Button>
            )}
            <Button type="submit" loading={busy}>
              {step === STEPS.length - 1
                ? 'Criar restaurante'
                : step === 3 && !contactFilled
                  ? 'Pular'
                  : 'Continuar'}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}

/** Aba "Cadastro" do restaurante: contato e cobrança, editáveis. */
export function ProfilePanel({
  t,
  onSaved,
}: {
  t: TenantDetail;
  onSaved: (t: TenantDetail) => void;
}) {
  const toast = useToast();
  const [f, setF] = useState<ProfileForm>(() => profileForm(t.profile));
  const [busy, setBusy] = useState(false);
  const errors = profileErrors(f);
  const dirty = JSON.stringify(f) !== JSON.stringify(profileForm(t.profile));
  const set = (k: keyof ProfileForm, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      const r = await api<TenantDetail>(`/platform/tenants/${t.id}/profile`, {
        method: 'PUT',
        json: profileBody(f),
      });
      onSaved(r);
      setF(profileForm(r.profile));
      toast('Cadastro salvo', 'success');
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="adm-panel adm-panel__body" onSubmit={save} noValidate>
      <div className="adm-form">
        <ProfileFields f={f} set={set} errors={errors} />
      </div>
      <div className="adm-form-actions">
        {t.profile.updatedAt && (
          <span className="adm-sub">
            atualizado {new Date(t.profile.updatedAt).toLocaleString('pt-BR')}
          </span>
        )}
        <Button type="submit" loading={busy} disabled={!dirty || !!Object.keys(errors).length}>
          Salvar cadastro
        </Button>
      </div>
    </form>
  );
}
