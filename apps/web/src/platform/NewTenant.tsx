import { validateTenantSlug } from '@comandou/shared';
import { Eye, EyeOff, RefreshCw } from 'lucide-react';
import { FormEvent, ReactNode, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button, Modal, Select, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import { useLoad } from './OverviewPages';
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

export const UFS = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
];

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

const onlyDigits = (v: string) => v.replace(/\D/g, '');

/** CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00) enquanto digita. */
export function maskDocument(v: string) {
  const d = onlyDigits(v).slice(0, 14);
  if (d.length <= 11)
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

/** (11) 98765-4321 ou (11) 3456-7890 enquanto digita. */
export function maskPhone(v: string) {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  const rest = d.slice(2);
  const split = d.length === 11 ? 5 : 4;
  return `(${d.slice(0, 2)}) ${rest.length > split ? `${rest.slice(0, split)}-${rest.slice(split)}` : rest}`;
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
  wide = true,
}: {
  f: Pick<ProfileForm, 'city' | 'state'>;
  set: (k: 'city' | 'state', v: string) => void;
  onState?: (uf: string) => void;
  /** Ocupa a linha toda (aba Cadastro) ou divide com o fuso (Novo restaurante). */
  wide?: boolean;
}) {
  return (
    <>
      <TextField
        label="Cidade"
        value={f.city}
        onChange={(e) => set('city', e.target.value)}
        maxLength={80}
        wrapClass={`${wide ? 'span-4' : 'span-2'} m-span-3`}
      />
      <SelectBox
        label="UF"
        value={f.state}
        onChange={(v) => {
          set('state', v);
          onState?.(v);
        }}
        className={`${wide ? 'span-2' : 'span-1'} m-span-1`}
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

export function NewTenantModal({ onClose }: { onClose(): void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const plans = useLoad<Plan[]>('/platform/plans').data?.filter((p) => p.active) ?? [];
  const [f, setF] = useState({
    name: '',
    slug: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    planCode: '',
    timezone: 'America/Sao_Paulo',
  });
  const [profile, setProfile] = useState<ProfileForm>(profileForm());
  const [slugTouched, setSlugTouched] = useState(false);
  const [tzTouched, setTzTouched] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const setP = (k: keyof ProfileForm, v: string) => setProfile((x) => ({ ...x, [k]: v }));
  const base = window.location.hostname.replace(/^admin\./, '');
  const defaultPlan = plans.find((p) => p.isDefault);
  const plan = f.planCode || defaultPlan?.code || '';

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
  const valid = !Object.values(errors).some(Boolean) && !Object.keys(pErrors).length;
  const show = (k: string) => (tried ? errors[k] : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const t = await api<TenantDetail>('/platform/tenants', {
        method: 'POST',
        json: {
          ...f,
          planCode: plan || undefined,
          profile: profileBody(profile),
        },
      });
      toast('Restaurante cadastrado: criando o banco dele', 'success');
      navigate(`/restaurantes/${t.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Novo restaurante"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="new-tenant" loading={busy}>
            Criar restaurante
          </Button>
        </>
      }
    >
      <form id="new-tenant" onSubmit={submit} noValidate className="adm-form-stack">
        <Group title="Restaurante">
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
            wide={false}
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
        </Group>

        <Group title="Acesso do dono" hint="primeiro login no sistema">
          <TextField
            label="Nome"
            value={f.adminName}
            autoComplete="off"
            maxLength={120}
            onChange={(e) => set('adminName', e.target.value)}
            error={show('adminName')}
            wrapClass="span-3"
          />
          <TextField
            label="E-mail"
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
        </Group>

        <Group title="Plano">
          <div className="adm-plan-pick span-6" role="radiogroup" aria-label="Plano">
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
                : [{ code: '', name: 'Sem plano', detail: 'Sem limites nem cobrança', tag: null }]),
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
        </Group>

        <details className="adm-fieldset adm-fieldset--more">
          <summary className="adm-fieldset__title">
            Contato e cobrança <span className="adm-fieldset__hint">opcional</span>
          </summary>
          <div className="adm-form">
            <ProfileFields f={profile} set={setP} errors={pErrors} withCity={false} />
          </div>
        </details>

        {error && <Alert tone="danger">{error}</Alert>}
        {tried && !valid && (
          <Alert tone="warning">Confira os campos marcados antes de criar.</Alert>
        )}
      </form>
    </Modal>
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
