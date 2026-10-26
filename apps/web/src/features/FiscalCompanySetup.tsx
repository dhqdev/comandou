import { Building2, CheckCircle2, FileKey2, KeyRound, Search, ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';
import { Alert, Badge, Button, Card, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import type { FiscalCompany, FiscalSettings } from '../lib/types';
import { SelectField } from './forms';

type Step = 'company' | 'certificate' | 'csc';
const STEPS: [Step, string, typeof Building2][] = [
  ['company', 'Empresa', Building2],
  ['certificate', 'Certificado A1', FileKey2],
  ['csc', 'CSC da NFC-e', KeyRound],
];

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
};

const fmtCnpj = (v: string) =>
  v
    .replace(/\D/g, '')
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');

/** Dias até a data (negativo = já passou). */
const daysUntil = (iso: string) => Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);

function fileToBase64(f: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Não foi possível ler o arquivo'));
    r.readAsDataURL(f);
  });
}

/**
 * Cadastro guiado da empresa na Focus NFe (modo revenda): o lojista informa os dados, o
 * certificado A1 e o CSC; o Comandou cria a empresa na Focus e guarda os tokens dela.
 */
export function FiscalCompanySetup({
  settings: s,
  onSaved,
}: {
  settings: FiscalSettings;
  onSaved: (s: FiscalSettings) => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<Step>('company');
  const [cnpj, setCnpj] = useState(fmtCnpj(s.cnpj ?? ''));
  const [c, setC] = useState<FiscalCompany>({ ...EMPTY, ...(s.company ?? {}) });
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [cscHomId, setCscHomId] = useState('');
  const [cscHom, setCscHom] = useState('');
  const [cscProdId, setCscProdId] = useState('');
  const [cscProd, setCscProd] = useState('');
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FiscalCompany>(k: K, v: FiscalCompany[K]) =>
    setC((x) => ({ ...x, [k]: v }));
  const digits = cnpj.replace(/\D/g, '');
  const companyOk =
    digits.length === 14 &&
    !!c.nome.trim() &&
    c.inscricaoEstadual.replace(/\D/g, '').length >= 2 &&
    !!c.logradouro.trim() &&
    !!c.numero.trim() &&
    !!c.bairro.trim() &&
    !!c.municipio.trim() &&
    /^[A-Za-z]{2}$/.test(c.uf.trim()) &&
    c.cep.replace(/\D/g, '').length === 8;
  const certOk = s.focusRegistered ? !file || !!password : !!file && !!password;
  const cscPair = (id: string, v: string) =>
    (!id && !v) || (/^\d{1,6}$/.test(id) && v.trim().length >= 16);
  const cscOk = cscPair(cscHomId, cscHom) && cscPair(cscProdId, cscProd);
  const done = {
    company: !!s.focusRegistered,
    certificate: !!s.certificateValidUntil,
    csc: s.cscHomolog || s.cscProd,
  };

  async function lookup() {
    setLooking(true);
    setError(null);
    try {
      const r = await api<Partial<FiscalCompany>>(`/fiscal/cnpj/${digits}`);
      setC((x) => ({
        ...x,
        ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== '')),
      }));
      toast('Dados do CNPJ preenchidos. Confira e complete a inscrição estadual.', 'success');
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
      const json: Record<string, unknown> = {
        cnpj: digits,
        company: { ...c, regimeTributario: Number(c.regimeTributario) },
      };
      if (file) json.certificate = { base64: await fileToBase64(file), password };
      const csc: Record<string, unknown> = {};
      if (cscHomId) csc.homologacao = { id: cscHomId, csc: cscHom.trim() };
      if (cscProdId) csc.producao = { id: cscProdId, csc: cscProd.trim() };
      if (Object.keys(csc).length) json.csc = csc;
      const next = await api<FiscalSettings>('/fiscal/company', { method: 'PUT', json });
      onSaved(next);
      setFile(null);
      setPassword('');
      setCscHom('');
      setCscProd('');
      setCscHomId('');
      setCscProdId('');
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
  const idx = STEPS.findIndex(([k]) => k === step);

  return (
    <Card
      searchId="secao-focus-empresa"
      title="Cadastro da empresa"
      actions={
        s.focusRegistered ? (
          <Badge tone="success">cadastrada na Focus NFe</Badge>
        ) : (
          <Badge tone="neutral">não cadastrada</Badge>
        )
      }
    >
      <p className="cm-hint" style={{ marginTop: 0 }}>
        Você não precisa de conta na Focus NFe: o Comandou cadastra a sua empresa e cuida da
        integração. Tenha em mãos o certificado digital A1 (.pfx) e o CSC gerado no site da SEFAZ.
      </p>

      {certDays !== null && certDays <= 30 && (
        <Alert tone={certDays < 0 ? 'danger' : 'warning'}>
          {certDays < 0
            ? 'O certificado digital venceu: as notas param de sair até você enviar um novo.'
            : `O certificado digital vence em ${certDays} dia${certDays === 1 ? '' : 's'}. Envie o novo para não parar de emitir.`}
        </Alert>
      )}

      <ol className="fx-steps" aria-label="Etapas do cadastro">
        {STEPS.map(([k, label, Icon], i) => (
          <li key={k}>
            <button
              type="button"
              className="fx-step"
              aria-current={k === step ? 'step' : undefined}
              data-done={done[k] || undefined}
              onClick={() => setStep(k)}
            >
              <span className="fx-step__dot">
                {done[k] ? <CheckCircle2 size={16} /> : <Icon size={16} />}
              </span>
              <span className="fx-step__label">
                <small>Etapa {i + 1}</small>
                {label}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {step === 'company' && (
        <div className="fx-panel">
          <div className="fx-cnpj">
            <TextField
              label="CNPJ"
              inputMode="numeric"
              value={cnpj}
              onChange={(e) => setCnpj(fmtCnpj(e.target.value))}
              error={digits && digits.length !== 14 ? 'CNPJ com 14 dígitos' : undefined}
            />
            <Button
              type="button"
              variant="secondary"
              loading={looking}
              disabled={digits.length !== 14}
              onClick={lookup}
            >
              <Search size={16} /> Buscar dados
            </Button>
          </div>
          <div className="form-grid fx-grid">
            <TextField
              label="Razão social"
              wrapClass="fx-span-2"
              value={c.nome}
              onChange={(e) => set('nome', e.target.value)}
            />
            <TextField
              label="Nome fantasia"
              value={c.nomeFantasia ?? ''}
              onChange={(e) => set('nomeFantasia', e.target.value)}
            />
            <TextField
              label="Inscrição estadual"
              inputMode="numeric"
              value={c.inscricaoEstadual}
              onChange={(e) => set('inscricaoEstadual', e.target.value.replace(/\D/g, ''))}
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
              maxLength={9}
              value={c.cep}
              onChange={(e) => set('cep', e.target.value.replace(/[^\d-]/g, ''))}
            />
            <TextField
              label="Rua"
              wrapClass="fx-span-2"
              value={c.logradouro}
              onChange={(e) => set('logradouro', e.target.value)}
            />
            <TextField
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
              onChange={(e) => set('uf', e.target.value.toUpperCase())}
            />
            <TextField
              label="E-mail fiscal"
              type="email"
              value={c.email ?? ''}
              onChange={(e) => set('email', e.target.value)}
              hint="Opcional, para avisos da Focus"
            />
            <TextField
              label="Telefone"
              inputMode="tel"
              value={c.telefone ?? ''}
              onChange={(e) => set('telefone', e.target.value)}
            />
          </div>
        </div>
      )}

      {step === 'certificate' && (
        <div className="fx-panel">
          {s.certificateValidUntil && (
            <p className="fx-ok">
              <ShieldCheck size={18} /> Certificado enviado, válido até{' '}
              <strong>{new Date(s.certificateValidUntil).toLocaleDateString('pt-BR')}</strong>.
              Envie outro só para trocar.
            </p>
          )}
          <label className="fx-drop" data-filled={file ? true : undefined}>
            <input
              ref={fileRef}
              type="file"
              accept=".pfx,.p12,application/x-pkcs12"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <FileKey2 size={28} />
            <strong>{file ? file.name : 'Escolher o certificado A1 (.pfx ou .p12)'}</strong>
            <span className="cm-hint">
              {file
                ? `${(file.size / 1024).toFixed(1)} KB · toque para trocar`
                : 'O mesmo arquivo que a contabilidade usa para emitir notas'}
            </span>
          </label>
          <div className="form-grid fx-grid">
            <TextField
              label="Senha do certificado"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <p className="cm-hint">
            O arquivo e a senha vão direto para a Focus NFe por conexão segura. O Comandou não
            guarda o certificado.
          </p>
        </div>
      )}

      {step === 'csc' && (
        <div className="fx-panel">
          <p className="cm-hint" style={{ marginTop: 0 }}>
            O CSC (código de segurança do contribuinte) é gerado no site da SEFAZ do seu estado, na
            área da NFC-e. Cada ambiente tem um identificador (ex.: 1) e um código.
          </p>
          <div className="fx-csc">
            <fieldset>
              <legend>
                Homologação (teste) {s.cscHomolog && <Badge tone="success">informado</Badge>}
              </legend>
              <TextField
                label="Identificador"
                inputMode="numeric"
                value={cscHomId}
                onChange={(e) => setCscHomId(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              <TextField
                label="CSC"
                autoComplete="off"
                value={cscHom}
                onChange={(e) => setCscHom(e.target.value)}
              />
            </fieldset>
            <fieldset>
              <legend>Produção {s.cscProd && <Badge tone="success">informado</Badge>}</legend>
              <TextField
                label="Identificador"
                inputMode="numeric"
                value={cscProdId}
                onChange={(e) => setCscProdId(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              <TextField
                label="CSC"
                autoComplete="off"
                value={cscProd}
                onChange={(e) => setCscProd(e.target.value)}
              />
            </fieldset>
          </div>
          {!cscOk && (
            <p className="cm-error-text">Preencha identificador e CSC (16+ caracteres) juntos.</p>
          )}
        </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="fx-actions">
        {idx > 0 && (
          <Button type="button" variant="ghost" onClick={() => setStep(STEPS[idx - 1]![0])}>
            Voltar
          </Button>
        )}
        <span style={{ flex: 1 }} />
        {idx < STEPS.length - 1 && (
          <Button
            type="button"
            variant="secondary"
            disabled={step === 'company' && !companyOk}
            onClick={() => setStep(STEPS[idx + 1]![0])}
          >
            Continuar
          </Button>
        )}
        <Button
          type="button"
          loading={busy}
          disabled={!companyOk || !certOk || !cscOk}
          onClick={submit}
        >
          {s.focusRegistered ? 'Salvar na Focus NFe' : 'Cadastrar na Focus NFe'}
        </Button>
      </div>
    </Card>
  );
}
