import { Search, ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';
import { Alert, Button, HelpLabel, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import { maskCep, useCepAutofill } from '../lib/cep';
import type { FiscalCompany, FiscalSettings } from '../lib/types';
import { SelectField } from './forms';
import { StreetHits } from './StreetHits';

const EMPTY: FiscalCompany = {
  nome: '',
  nomeFantasia: '',
  inscricaoEstadual: '',
  inscricaoMunicipal: '',
  regimeTributario: 1,
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  municipio: '',
  uf: '',
  cep: '',
  email: '',
  telefone: '',
  contabilidade: '',
};

export const fmtCnpj = (v: string) =>
  v
    .replace(/\D/g, '')
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');

/** Dias até a data (negativo = já passou). */
export const daysUntil = (iso: string) =>
  Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);

function fileToBase64(f: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Não foi possível ler o arquivo'));
    r.readAsDataURL(f);
  });
}

/** Envia empresa (+ certificado/CSC/numeração) para a Focus pelo Comandou (modo revenda). */
export async function saveFiscalCompany(
  s: FiscalSettings,
  extra: { company?: FiscalCompany; cnpj?: string; [k: string]: unknown },
) {
  const { company, cnpj, ...rest } = extra;
  return api<FiscalSettings>('/fiscal/company', {
    method: 'PUT',
    json: { cnpj: cnpj ?? s.cnpj, company: company ?? s.company, ...rest },
  });
}

/**
 * Cadastro da empresa na Focus NFe feito pelo Comandou (modo revenda): dados da empresa e o
 * certificado A1. O CSC e a numeração ficam nas abas NFC-e e NF-e.
 */
export function FiscalCompanySetup({
  settings: s,
  onSaved,
}: {
  settings: FiscalSettings;
  onSaved: (s: FiscalSettings) => void;
}) {
  const toast = useToast();
  const [cnpj, setCnpj] = useState(fmtCnpj(s.cnpj ?? ''));
  const [c, setC] = useState<FiscalCompany>({ ...EMPTY, ...(s.company ?? {}) });
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FiscalCompany>(k: K, v: FiscalCompany[K]) =>
    setC((x) => ({ ...x, [k]: v }));
  const numberRef = useRef<HTMLInputElement>(null);
  const cepFill = useCepAutofill(
    { cep: c.cep, street: c.logradouro, city: c.municipio, state: c.uf },
    (a, from) => {
      setC((x) => ({
        ...x,
        ...(from === 'street' ? { cep: maskCep(a.cep) } : {}),
        logradouro: a.street || x.logradouro,
        bairro: a.district || x.bairro,
        municipio: a.city || x.municipio,
        uf: a.state || x.uf,
      }));
      if (a.street) numberRef.current?.focus();
    },
  );
  const digits = cnpj.replace(/\D/g, '');
  const acc = (c.contabilidade ?? '').replace(/\D/g, '');
  const companyOk =
    digits.length === 14 &&
    !!c.nome.trim() &&
    c.inscricaoEstadual.replace(/\D/g, '').length >= 2 &&
    !!c.logradouro.trim() &&
    !!c.numero.trim() &&
    !!c.bairro.trim() &&
    !!c.municipio.trim() &&
    /^[A-Za-z]{2}$/.test(c.uf.trim()) &&
    c.cep.replace(/\D/g, '').length === 8 &&
    (!acc || acc.length === 11 || acc.length === 14);
  const certOk = s.focusRegistered ? !file || !!password : !!file && !!password;

  async function lookup() {
    setLooking(true);
    setError(null);
    try {
      const r = await api<Partial<FiscalCompany>>(`/fiscal/cnpj/${digits}`);
      setC((x) => ({
        ...x,
        ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== '')),
      }));
      toast('Dados do CNPJ preenchidos. Confira e informe a inscrição estadual.', 'success');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLooking(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const json: Record<string, unknown> = {};
      if (file) json.certificate = { base64: await fileToBase64(file), password };
      const next = await saveFiscalCompany(s, {
        cnpj: digits,
        company: { ...c, regimeTributario: Number(c.regimeTributario) as 1 | 2 | 3 | 4 },
        ...json,
      });
      onSaved(next);
      setFile(null);
      setPassword('');
      if (fileRef.current) fileRef.current.value = '';
      toast(
        s.focusRegistered ? 'Cadastro atualizado na Focus NFe' : 'Empresa cadastrada na Focus NFe',
        'success',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const certDays = s.certificateValidUntil ? daysUntil(s.certificateValidUntil) : null;

  return (
    <div className="fi-tab">
      {certDays !== null && certDays <= 30 && (
        <Alert tone={certDays < 0 ? 'danger' : 'warning'}>
          {certDays < 0
            ? 'O certificado venceu: as notas param até você enviar um novo.'
            : `O certificado vence em ${certDays} dia${certDays === 1 ? '' : 's'}. Envie o novo abaixo.`}
        </Alert>
      )}

      <h3 className="fi-sub">Dados da empresa</h3>
      <div className="fi-fields">
        <div className="fi-cnpj fi-w2">
          <TextField
            label="CNPJ"
            inputMode="numeric"
            value={cnpj}
            onChange={(e) => setCnpj(fmtCnpj(e.target.value))}
            error={digits && digits.length !== 14 ? 'CNPJ com 14 dígitos' : undefined}
            hint="De quem emite a nota"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<Search size={14} />}
            loading={looking}
            disabled={digits.length !== 14}
            onClick={lookup}
          >
            Buscar
          </Button>
        </div>
        <TextField
          label="Razão social"
          wrapClass="fi-w2"
          value={c.nome}
          onChange={(e) => set('nome', e.target.value)}
          hint="Nome oficial, como no cartão CNPJ"
        />
        <TextField
          label="Nome fantasia"
          value={c.nomeFantasia ?? ''}
          onChange={(e) => set('nomeFantasia', e.target.value)}
          hint="Opcional"
        />
        <TextField
          label="Inscrição estadual"
          inputMode="numeric"
          value={c.inscricaoEstadual}
          onChange={(e) => set('inscricaoEstadual', e.target.value.replace(/\D/g, ''))}
          hint="Só números"
        />
        <SelectField
          label="Regime tributário"
          value={String(c.regimeTributario)}
          onChange={(e) => set('regimeTributario', Number(e.target.value) as 1 | 2 | 3 | 4)}
        >
          <option value="1">Simples Nacional</option>
          <option value="4">MEI</option>
          <option value="2">Simples (excesso de sublimite)</option>
          <option value="3">Regime normal</option>
        </SelectField>
        <TextField
          label="CEP"
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="00000-000"
          maxLength={9}
          value={c.cep}
          hint={cepFill.cepHint}
          onChange={(e) => {
            cepFill.cepTyped();
            set('cep', maskCep(e.target.value));
          }}
        />
        <div className="street-field fi-w2">
          <TextField
            label="Rua"
            value={c.logradouro}
            hint={cepFill.streetHint}
            role="combobox"
            aria-expanded={cepFill.open}
            aria-controls="fiscal-street-hits"
            aria-autocomplete="list"
            onChange={(e) => {
              cepFill.streetTyped();
              set('logradouro', e.target.value);
            }}
            onFocus={() => cepFill.hits.length && cepFill.setOpen(true)}
            onBlur={cepFill.streetLeft}
            onKeyDown={(e) => e.key === 'Escape' && cepFill.setOpen(false)}
          />
          {cepFill.open && (
            <StreetHits id="fiscal-street-hits" hits={cepFill.hits} onPick={cepFill.pick} />
          )}
        </div>
        <TextField
          ref={numberRef}
          label="Número"
          value={c.numero}
          onChange={(e) => set('numero', e.target.value)}
        />
        <TextField
          label="Complemento"
          value={c.complemento ?? ''}
          onChange={(e) => set('complemento', e.target.value)}
        />
        <TextField
          label="Bairro"
          value={c.bairro}
          onChange={(e) => set('bairro', e.target.value)}
        />
        <TextField
          label="Cidade"
          value={c.municipio}
          onChange={(e) => set('municipio', e.target.value)}
        />
        <TextField
          label="UF"
          maxLength={2}
          value={c.uf}
          onChange={(e) => set('uf', e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase())}
        />
        <TextField
          label="E-mail fiscal"
          wrapClass="fi-w2"
          type="email"
          value={c.email ?? ''}
          onChange={(e) => set('email', e.target.value)}
          hint="Opcional"
        />
        <TextField
          label="Telefone"
          inputMode="tel"
          value={c.telefone ?? ''}
          onChange={(e) => set('telefone', e.target.value)}
          hint="Opcional"
        />
        <TextField
          label="CPF/CNPJ da contabilidade"
          wrapClass="fi-w2"
          inputMode="numeric"
          value={c.contabilidade ?? ''}
          onChange={(e) => set('contabilidade', e.target.value.replace(/[^\d./-]/g, ''))}
          error={acc && acc.length !== 11 && acc.length !== 14 ? 'CPF ou CNPJ' : undefined}
          hint="Alguns estados exigem. Opcional"
        />
      </div>

      <h3 className="fi-sub">Certificado digital A1</h3>
      {s.certificateValidUntil && (
        <p className="fi-ok">
          <ShieldCheck size={16} /> Enviado, válido até{' '}
          <strong>{new Date(s.certificateValidUntil).toLocaleDateString('pt-BR')}</strong>. Envie
          outro só para trocar.
        </p>
      )}
      <div className="fi-fields">
        <div className="cm-field fi-w2">
          <HelpLabel htmlFor="fi-cert">Arquivo do certificado</HelpLabel>
          <input
            id="fi-cert"
            ref={fileRef}
            className="cm-input fi-file"
            type="file"
            accept=".pfx,.p12,application/x-pkcs12"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span className="cm-hint">O .pfx ou .p12 que a contabilidade usa (e-CNPJ A1)</span>
        </div>
        <TextField
          label="Senha do certificado"
          wrapClass="fi-w2"
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="Vai direto para a Focus, não fica salva"
        />
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      <div className="fi-actions">
        <Button type="button" loading={busy} disabled={!companyOk || !certOk} onClick={submit}>
          {s.focusRegistered ? 'Salvar na Focus' : 'Cadastrar na Focus'}
        </Button>
      </div>
    </div>
  );
}
