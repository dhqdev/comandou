import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../../app/auth';
import { Alert, Button, Modal, Select, Spinner, TextField, useToast } from '../../design-system';
import { api } from '../../lib/api';
import { UFS, maskDocument, maskPhone, onlyDigits } from '../../lib/br-format';

/** Cadastro do restaurante: o mesmo que o Comandou vê no painel (GET/PATCH /account). */
export interface RestaurantData {
  name: string;
  legalName: string | null;
  document: string | null;
  contactName: string | null;
  phone: string | null;
  billingEmail: string | null;
  city: string | null;
  state: string | null;
}
interface AccountData {
  me: { name: string; email: string | null };
  restaurant: RestaurantData | null;
}

const loadAccount = () => api<AccountData>('/account');

/**
 * Meus dados: nome e e-mail de entrada. O e-mail é o login da pessoa (em todos os restaurantes
 * dela), então trocar pede a senha atual.
 */
export function MyDataModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(me?.user.name ?? '');
    setEmail(me?.user.email ?? '');
    setPassword('');
    setError(null);
  }, [open, me]);
  const emailChanged = email.trim().toLowerCase() !== (me?.user.email ?? '').toLowerCase();
  const valid = name.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(email.trim());

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!valid || (emailChanged && !password)) return;
    setBusy(true);
    setError(null);
    try {
      await api('/account/me', {
        method: 'PATCH',
        json: { name, email, currentPassword: emailChanged ? password : undefined },
      });
      await refresh();
      toast(
        emailChanged ? 'Dados salvos. Entre com o e-mail novo daqui para frente.' : 'Dados salvos.',
        'success',
      );
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Meus dados"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={busy}
            disabled={!valid || (emailChanged && !password)}
            onClick={() => void save()}
          >
            Salvar
          </Button>
        </>
      }
    >
      <form className="cm-form" onSubmit={save}>
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField
          label="Seu nome"
          autoComplete="name"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label="E-mail de entrada"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          hint="É com ele que você entra no sistema."
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {emailChanged && (
          <TextField
            label="Senha atual"
            type="password"
            autoComplete="current-password"
            hint="Para trocar o e-mail, confirme que é você."
            wrapClass="cm-form__wide"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

type Form = Record<keyof RestaurantData, string>;
const toForm = (r: RestaurantData): Form => ({
  name: r.name,
  legalName: r.legalName ?? '',
  document: r.document ? maskDocument(r.document) : '',
  contactName: r.contactName ?? '',
  phone: r.phone ? maskPhone(r.phone) : '',
  billingEmail: r.billingEmail ?? '',
  city: r.city ?? '',
  state: r.state ?? '',
});

/**
 * Dados do restaurante (só o administrador): nome, razão social, CPF/CNPJ, responsável e contato.
 * É o cadastro que o Comandou usa para falar com você e para a cobrança, e o painel do Comandou
 * mostra a mudança na hora.
 */
export function RestaurantDataModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { refresh } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setForm(null);
    setError(null);
    let alive = true;
    loadAccount()
      .then((a) => {
        if (!alive) return;
        if (a.restaurant) setForm(toForm(a.restaurant));
        else setError('Só o administrador do restaurante altera estes dados.');
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [open]);

  const set = (k: keyof Form) => (v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const doc = form ? onlyDigits(form.document) : '';
  const docError =
    doc && doc.length !== 11 && doc.length !== 14 ? 'CPF com 11 ou CNPJ com 14 números' : undefined;
  const phone = form ? onlyDigits(form.phone) : '';
  const phoneError = phone && phone.length < 10 ? 'Telefone com DDD' : undefined;
  const valid = !!form && form.name.trim().length > 0 && !docError && !phoneError;

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!form || !valid) return;
    setBusy(true);
    setError(null);
    try {
      await api('/account/restaurant', {
        method: 'PATCH',
        json: { ...form, document: doc, phone },
      });
      await refresh();
      toast('Dados do restaurante salvos.', 'success');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Dados do restaurante"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!valid} onClick={() => void save()}>
            Salvar
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {!form && !error && <Spinner />}
      {form && (
        <form className="cm-form" onSubmit={save}>
          <p className="cm-hint cm-form__wide" style={{ margin: 0 }}>
            É o cadastro que o Comandou usa para falar com você e para a cobrança. O que você mudar
            aqui chega na hora para a nossa equipe.
          </p>
          <TextField
            label="Nome do restaurante"
            hint="Aparece no topo do sistema, no cardápio e nos e-mails."
            wrapClass="cm-form__wide"
            maxLength={120}
            value={form.name}
            onChange={(e) => set('name')(e.target.value)}
          />
          <h3 className="cm-form__section">Empresa</h3>
          <TextField
            label="Razão social"
            maxLength={160}
            value={form.legalName}
            onChange={(e) => set('legalName')(e.target.value)}
          />
          <TextField
            label="CPF ou CNPJ"
            inputMode="numeric"
            autoComplete="off"
            error={docError}
            value={form.document}
            onChange={(e) => set('document')(maskDocument(e.target.value))}
          />
          <h3 className="cm-form__section">Contato</h3>
          <TextField
            label="Responsável"
            autoComplete="name"
            maxLength={120}
            value={form.contactName}
            onChange={(e) => set('contactName')(e.target.value)}
          />
          <TextField
            label="Telefone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            error={phoneError}
            value={form.phone}
            onChange={(e) => set('phone')(maskPhone(e.target.value))}
          />
          <TextField
            label="E-mail de cobrança"
            type="email"
            inputMode="email"
            autoComplete="email"
            hint="Recebe faturas e avisos da assinatura."
            maxLength={254}
            wrapClass="cm-form__wide"
            value={form.billingEmail}
            onChange={(e) => set('billingEmail')(e.target.value)}
          />
          <TextField
            label="Cidade"
            autoComplete="address-level2"
            maxLength={80}
            value={form.city}
            onChange={(e) => set('city')(e.target.value)}
          />
          <label className="cm-field">
            <span className="cm-label">UF</span>
            <Select value={form.state} onChange={(e) => set('state')(e.target.value)}>
              <option value="">—</option>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </Select>
          </label>
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}
