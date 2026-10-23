import { ROLE_LABELS, ROLES, type Role } from '@comandou/shared';
import { UserPlus, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Spinner,
  TextField,
  useToast,
  Select,
} from '../design-system';
import { useAuth } from '../app/auth';
import { dateTime } from '../features/format';
import { SelectField } from '../features/forms';
import { api } from '../lib/api';
import { useLinkParam } from '../lib/deep-link';
import type { Member } from '../lib/types';

/** Equipe do restaurante: quem acessa, com qual papel. Só administradores alteram. */
export function TeamPage() {
  const toast = useToast();
  const { me } = useAuth();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useLinkParam('acao', (a) => a === 'pessoa' && setAdding(true));

  const load = useCallback(async () => {
    try {
      setMembers(await api<Member[]>('/users'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function update(m: Member, json: { role?: string; status?: string }, ok: string) {
    try {
      await api(`/users/${m.id}`, { method: 'PATCH', json });
      toast(ok, 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
    await load();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Equipe</h1>
          <p className="page-sub">
            Quem acessa o sistema e o que cada um pode fazer. Desativar encerra o acesso na hora.
          </p>
        </div>
        <Button icon={<UserPlus size={18} />} onClick={() => setAdding(true)}>
          Adicionar pessoa
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <Card bodyless>
        {members === null ? (
          <div className="cm-card__body">
            <Spinner />
          </div>
        ) : members.length === 0 ? (
          <EmptyState icon={<Users size={20} />} title="Ninguém na equipe ainda" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cm-table">
              <thead>
                <tr>
                  <th>Pessoa</th>
                  <th>Papel</th>
                  <th>Último acesso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const self = m.id === me?.user.id;
                  return (
                    <tr key={m.id} data-search-id={`membro-${m.id}`}>
                      <td>
                        <strong>{m.name}</strong> {self && <Badge tone="info">você</Badge>}{' '}
                        {m.status === 'revoked' && <Badge tone="danger">desativado</Badge>}
                        <div className="cm-hint">{m.email}</div>
                      </td>
                      <td>
                        {self ? (
                          ROLE_LABELS[m.role as Role]
                        ) : (
                          <Select
                            className="cm-input"
                            aria-label={`Papel de ${m.name}`}
                            value={m.role}
                            onChange={(e) =>
                              update(m, { role: e.target.value }, 'Papel atualizado')
                            }
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </Select>
                        )}
                      </td>
                      <td>{m.lastSeenAt ? dateTime(m.lastSeenAt) : '—'}</td>
                      <td className="cm-num">
                        {!self &&
                          (m.status === 'active' ? (
                            <Button
                              variant="ghost"
                              onClick={() =>
                                update(m, { status: 'revoked' }, `${m.name} foi desativado`)
                              }
                            >
                              Desativar
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              onClick={() =>
                                update(m, { status: 'active' }, `${m.name} foi reativado`)
                              }
                            >
                              Reativar
                            </Button>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <AddMemberModal
        open={adding}
        onClose={() => setAdding(false)}
        onDone={() => {
          setAdding(false);
          void load();
        }}
      />
    </>
  );
}

function AddMemberModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose(): void;
  onDone(): void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('waiter');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim().length >= 2 && /\S+@\S+\.\S+/.test(email) && password.length >= 8;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ existingAccount: boolean }>('/users', {
        method: 'POST',
        json: { name, email, password, role },
      });
      toast(
        r.existingAccount
          ? 'Pessoa adicionada. Ela já tinha conta: continua usando a senha dela.'
          : 'Pessoa adicionada à equipe',
        'success',
      );
      setName('');
      setEmail('');
      setPassword('');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Adicionar pessoa"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!valid} onClick={save}>
            Adicionar
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <TextField
        label="Nome"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={80}
      />
      <TextField
        label="E-mail"
        type="email"
        autoComplete="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TextField
        label="Senha inicial"
        type="password"
        autoComplete="new-password"
        hint="Mínimo de 8 caracteres. Combine a entrega da senha pessoalmente."
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <SelectField label="Papel" value={role} onChange={(e) => setRole(e.target.value as Role)}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </SelectField>
    </Modal>
  );
}

/** Troca da própria senha (qualquer pessoa da equipe). */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== next;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password', { method: 'POST', json: { current, next } });
      toast('Senha alterada. Outros aparelhos foram desconectados.', 'success');
      setCurrent('');
      setNext('');
      setConfirm('');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Trocar minha senha"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={busy}
            disabled={!current || next.length < 8 || next !== confirm}
            onClick={save}
          >
            Salvar
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <TextField
        label="Senha atual"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <TextField
        label="Nova senha"
        type="password"
        autoComplete="new-password"
        hint="Mínimo de 8 caracteres"
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      <TextField
        label="Repita a nova senha"
        type="password"
        autoComplete="new-password"
        error={mismatch ? 'As senhas não conferem' : undefined}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
    </Modal>
  );
}
