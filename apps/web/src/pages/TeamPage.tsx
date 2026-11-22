import {
  isPinOnlyEmail,
  isPinRole,
  ROLE_HINTS,
  ROLE_LABELS,
  ROLES,
  type Role,
} from '@comandou/shared';
import { ExternalLink, Hash, KeyRound, Link2, UserPlus, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  TextField,
  useToast,
  Select,
  Skeleton,
} from '../design-system';
import { useAuth } from '../app/auth';
import { ACCESS_LINKS, accessUrl, openPathOf } from '../app/role-home';
import { copyText } from '../features/PixQr';
import { dateTime } from '../features/format';
import { SelectField } from '../features/forms';
import { api, ApiError } from '../lib/api';
import { useLinkParam } from '../lib/deep-link';
import { useLiveData } from '../lib/realtime';
import type { Member } from '../lib/types';
import { TourButton } from '../features/tour/PageTour';
import { PinField, PinModal, PinReveal, pinFieldError } from '../features/StaffPin';
import './team.css';

/** Link de acesso de um papel (o da área dele; gerente e dono, o endereço do painel). */
function linkOf(role: Role): string {
  const area = ACCESS_LINKS.find((l) => l.roles.includes(role)) ?? ACCESS_LINKS.at(-1)!;
  return accessUrl(area.path);
}

/** Equipe do restaurante: quem acessa, com qual papel. Só administradores alteram. */
export function TeamPage() {
  const toast = useToast();
  const { me } = useAuth();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /** Quem vai ganhar senha nova (outra pessoa) ou 'self' (trocar a própria). */
  const [pwFor, setPwFor] = useState<Member | 'self' | null>(null);
  /** Garçom ou entregador que vai ganhar PIN novo. */
  const [pinFor, setPinFor] = useState<Member | null>(null);
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
  useLiveData(['team'], () => void load());

  async function update(m: Member, json: { role?: string; status?: string }, ok: string) {
    try {
      await api(`/users/${m.id}`, { method: 'PATCH', json });
      toast(ok, 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
    await load();
  }

  async function copyLink(url: string, who: string) {
    if (await copyText(url)) toast(`Link de ${who} copiado`, 'success');
    else toast(url);
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title cm-sr-only">Equipe</h1>
        <TourButton tour="equipe" />
        <Button icon={<UserPlus size={18} />} onClick={() => setAdding(true)}>
          Adicionar pessoa
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <Card bodyless>
        {members === null ? (
          <div className="cm-card__body">
            <Skeleton />
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
                  <th>Como entra</th>
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
                        {!isPinOnlyEmail(m.email) && <div className="cm-hint">{m.email}</div>}
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
                      <td>
                        {isPinRole(m.role) ? (
                          <div className="team-access">
                            <span className="team-access__what">
                              <Hash size={14} aria-hidden /> PIN
                              <span className="cm-hint">
                                {m.hasPin ? 'criado' : 'ainda sem PIN'}
                              </span>
                            </span>
                            {!self && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setPinFor(m)}
                                aria-label={`${m.hasPin ? 'Novo PIN' : 'Criar PIN'} para ${m.name}`}
                              >
                                {m.hasPin ? 'Novo PIN' : 'Criar PIN'}
                              </Button>
                            )}
                          </div>
                        ) : (
                          <div className="team-access">
                            <span className="team-access__what">
                              <KeyRound size={14} aria-hidden /> Senha
                            </span>
                            {(self || !isPinOnlyEmail(m.email)) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setPwFor(self ? 'self' : m)}
                                aria-label={
                                  self ? 'Trocar minha senha' : `Nova senha para ${m.name}`
                                }
                              >
                                {self ? 'Trocar senha' : 'Nova senha'}
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                      <td>{m.lastSeenAt ? dateTime(m.lastSeenAt) : '—'}</td>
                      <td className="cm-num">
                        <div className="team-actions">
                          {!self && m.status === 'active' && (
                            <>
                              <a
                                className="cm-btn cm-btn--ghost cm-btn--icon"
                                href={openPathOf(m.role as Role, m.id)}
                                target="_blank"
                                rel="noopener"
                                aria-label={`Abrir a tela de ${m.name}`}
                                title="Abrir a tela desta pessoa (com a sua conta, em outra aba)"
                              >
                                <ExternalLink size={16} aria-hidden />
                              </a>
                              <Button
                                variant="ghost"
                                icon={<Link2 size={16} />}
                                onClick={() => copyLink(linkOf(m.role as Role), m.name)}
                                aria-label={`Copiar link de acesso de ${m.name}`}
                                title={`Copiar o link de acesso desta pessoa (${linkOf(m.role as Role).replace(/^https?:\/\//, '')})`}
                              />
                            </>
                          )}
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
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ChangePasswordModal open={pwFor === 'self'} onClose={() => setPwFor(null)} />
      <MemberPasswordModal
        member={pwFor && pwFor !== 'self' ? pwFor : null}
        onClose={() => setPwFor(null)}
      />
      <PinModal person={pinFor} onClose={() => setPinFor(null)} onDone={() => void load()} />
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
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** PIN criado: mostrado uma vez antes de fechar. */
  const [created, setCreated] = useState<{ name: string; pin: string } | null>(null);
  const pinRole = isPinRole(role);
  /** Garçom e entregador entram só com o PIN: sem e-mail nem senha. */
  const needsEmail = !pinRole;
  const valid =
    name.trim().length >= 2 &&
    (!needsEmail || (/\S+@\S+\.\S+/.test(email) && password.length >= 8)) &&
    (!pinRole || !pin || (pin.length === 4 && !pinFieldError(pin)));

  function reset() {
    setName('');
    setEmail('');
    setPassword('');
    setPin('');
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ existingAccount: boolean; pin: string | null }>('/users', {
        method: 'POST',
        json: {
          name,
          role,
          ...(needsEmail ? { email, password } : {}),
          ...(pinRole && pin ? { pin } : {}),
        },
      });
      toast(
        r.existingAccount
          ? 'Pessoa adicionada. Ela já tinha conta: continua usando a senha dela.'
          : 'Pessoa adicionada à equipe',
        'success',
      );
      if (r.pin) setCreated({ name, pin: r.pin });
      reset();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
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
        <SelectField label="Papel" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </SelectField>
        {pinRole && <PinField value={pin} onChange={setPin} />}
        {needsEmail && (
          <>
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
          </>
        )}
        <p className="cm-hint cm-form__block">
          {ROLE_HINTS[role]} {pinRole ? 'Entra só com o PIN.' : 'Entra com e-mail e senha.'}
        </p>
      </Modal>
      <Modal
        open={!!created}
        title="Pessoa adicionada"
        onClose={() => setCreated(null)}
        footer={<Button onClick={() => setCreated(null)}>Pronto</Button>}
      >
        {created && <PinReveal name={created.name} pin={created.pin} />}
      </Modal>
    </>
  );
}

/**
 * Senha nova para alguém da equipe que esqueceu a dela. A pessoa sai de todos os aparelhos e entra
 * com a senha nova. Conta usada também em outro restaurante não troca aqui (só ela ou o suporte).
 */
function MemberPasswordModal({ member, onClose }: { member: Member | null; onClose(): void }) {
  const toast = useToast();
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guarda a última pessoa para o conteúdo não sumir enquanto a janela fecha.
  const [shown, setShown] = useState<Member | null>(member);
  if (member && member !== shown) {
    setShown(member);
    setNext('');
    setConfirm('');
    setError(null);
  }
  const m = member ?? shown;
  const mismatch = confirm.length > 0 && confirm !== next;

  async function save() {
    if (!m) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/users/${m.id}/password`, { method: 'POST', json: { password: next } });
      toast(`Senha nova salva. ${m.name} já entra com ela.`, 'success');
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
      open={!!member}
      title="Nova senha"
      onClose={onClose}
      footer={
        m?.sharedAccount ? (
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={busy} disabled={next.length < 8 || next !== confirm} onClick={save}>
              Salvar senha
            </Button>
          </>
        )
      }
    >
      {m && (
        <p className="cm-hint">
          Para <strong>{m.name}</strong> ({m.email}).
        </p>
      )}
      {m?.sharedAccount ? (
        <Alert tone="info">
          <div>
            Esta pessoa usa a mesma conta em outro restaurante. Por segurança, só ela pode trocar a
            senha (em <b>Trocar minha senha</b>). Se ela esqueceu, fale com o suporte do Comandou.
          </div>
        </Alert>
      ) : (
        <>
          {error && <Alert tone="danger">{error}</Alert>}
          <TextField
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            hint="Mínimo de 8 caracteres. Combine a entrega da senha pessoalmente."
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
          <p className="cm-hint">
            Ao salvar, a pessoa sai de todos os aparelhos e entra de novo com a senha nova.
          </p>
        </>
      )}
    </Modal>
  );
}

/**
 * Troca da própria senha (qualquer pessoa da equipe). A senha atual só aparece quando a API pede
 * (conta usada também em outro restaurante).
 */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const toast = useToast();
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== next;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password', {
        method: 'POST',
        json: { next, ...(current ? { current } : {}) },
      });
      toast('Senha alterada. Outros aparelhos foram desconectados.', 'success');
      setNext('');
      setConfirm('');
      setCurrent(null);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && (e.body as { code?: string })?.code === 'current_password')
        setCurrent((c) => c ?? '');
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
            disabled={next.length < 8 || next !== confirm || current === ''}
            onClick={save}
          >
            Salvar
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {current !== null && (
        <TextField
          label="Senha atual"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      )}
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
