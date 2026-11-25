import { Send, Trash2 } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Alert, Badge, Button, Modal, Skeleton, TextField, useToast } from '../design-system';
import { SelectField } from '../features/forms';
import { api } from '../lib/api';
import { formatPhone } from './wa-phone';

/**
 * Super Admin › WhatsApp › Menu do admin: os números que recebem o menu de opções (escolher um
 * restaurante, varredura, backups, bancos, cobrança) e os avisos automáticos, e a hora do resumo
 * do dia. Quem não está aqui escreve para o número e só aparece nas conversas, sem resposta
 * automática.
 */

interface Operator {
  id: string;
  phone: string;
  label: string | null;
  adminId: string;
  adminName: string;
  alerts: boolean;
  summary: boolean;
  createdAt: string;
}

interface MenuSettings {
  enabled: boolean;
  summaryHour: number | null;
  operators: Operator[];
  admins: { id: string; name: string }[];
}

const URL = '/platform/whatsapp/menu';

export function AdminMenuModal({ onClose }: { onClose(): void }) {
  const toast = useToast();
  const [m, setM] = useState<MenuSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [label, setLabel] = useState('');
  const [adminId, setAdminId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<MenuSettings>(URL)
      .then(setM)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function act(key: string, run: () => Promise<MenuSettings | void>, ok?: string) {
    setBusy(key);
    try {
      const r = await run();
      if (r) setM(r);
      if (ok) toast(ok, 'success');
      return true;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return false;
    } finally {
      setBusy(null);
    }
  }

  const save = (patch: Partial<Pick<MenuSettings, 'enabled' | 'summaryHour'>>) =>
    m &&
    act('settings', () =>
      api<MenuSettings>(URL, {
        method: 'PUT',
        json: { enabled: m.enabled, summaryHour: m.summaryHour, ...patch },
      }),
    );

  const update = (o: Operator, patch: Partial<Pick<Operator, 'alerts' | 'summary'>>) =>
    act(`op-${o.id}`, () =>
      api<MenuSettings>(`${URL}/operators/${o.id}`, { method: 'PATCH', json: patch }),
    );

  async function add(e: FormEvent) {
    e.preventDefault();
    const ok = await act(
      'add',
      () =>
        api<MenuSettings>(`${URL}/operators`, {
          method: 'POST',
          json: { phone, label: label.trim() || null, ...(adminId ? { adminId } : {}) },
        }),
      'Número cadastrado. Mande "menu" para o WhatsApp do painel.',
    );
    if (ok) {
      setPhone('');
      setLabel('');
    }
  }

  return (
    <Modal
      open
      size="lg"
      title="Menu do admin no WhatsApp"
      onClose={onClose}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : !m ? (
        <Skeleton variant="detail" />
      ) : (
        <div className="wadm-menu">
          <p className="wadm-menu__lead">
            Quem está aqui recebe um <strong>menu de opções</strong> ao mandar “menu” para o
            WhatsApp do painel (resumo do sistema, escolher um restaurante e fazer a varredura dele,
            saúde do servidor, backups, bancos, cobrança), os <strong>avisos automáticos</strong>{' '}
            (backup que falhou, serviço fora do ar, banco que não ficou pronto, restaurante novo,
            assinatura em atraso) e o <strong>resumo do dia</strong>. Outros números só aparecem nas
            conversas, sem resposta automática.
          </p>

          <div className="wadm-menu__row">
            <label className="wadm-menu__check">
              <input
                type="checkbox"
                checked={m.enabled}
                disabled={busy === 'settings'}
                onChange={(e) => void save({ enabled: e.target.checked })}
              />
              Menu e avisos ligados
            </label>
            <SelectField
              label="Resumo do dia (horário de Brasília)"
              value={m.summaryHour ?? ''}
              disabled={busy === 'settings' || !m.enabled}
              onChange={(e) =>
                void save({ summaryHour: e.target.value === '' ? null : Number(e.target.value) })
              }
            >
              <option value="">Sem resumo</option>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  Às {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </SelectField>
          </div>

          <h3 className="wadm-menu__title">Números</h3>
          {m.operators.length === 0 ? (
            <p className="wadm-menu__empty">
              Nenhum número ainda. Cadastre o seu celular abaixo e mande “menu” para o WhatsApp do
              painel.
            </p>
          ) : (
            <ul className="wadm-menu__list">
              {m.operators.map((o) => (
                <li key={o.id} className="wadm-menu__op">
                  <div className="wadm-menu__who">
                    <strong>{formatPhone(o.phone)}</strong>
                    <small>
                      {o.label ? `${o.label} · ` : ''}
                      {o.adminName}
                    </small>
                  </div>
                  <label className="wadm-menu__check">
                    <input
                      type="checkbox"
                      checked={o.alerts}
                      disabled={busy === `op-${o.id}`}
                      onChange={(e) => void update(o, { alerts: e.target.checked })}
                    />
                    Avisos
                  </label>
                  <label className="wadm-menu__check">
                    <input
                      type="checkbox"
                      checked={o.summary}
                      disabled={busy === `op-${o.id}`}
                      onChange={(e) => void update(o, { summary: e.target.checked })}
                    />
                    Resumo do dia
                  </label>
                  <div className="wadm-menu__actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Send size={15} />}
                      loading={busy === `test-${o.id}`}
                      onClick={() =>
                        void act(
                          `test-${o.id}`,
                          () =>
                            api(`${URL}/operators/${o.id}/test`, {
                              method: 'POST',
                              json: {},
                            }).then(() => undefined),
                          'Mensagem de teste enviada',
                        )
                      }
                    >
                      Testar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 size={15} />}
                      aria-label={`Remover ${formatPhone(o.phone)}`}
                      loading={busy === `del-${o.id}`}
                      onClick={() => {
                        if (!window.confirm(`Tirar ${formatPhone(o.phone)} do menu do admin?`))
                          return;
                        void act(
                          `del-${o.id}`,
                          () => api<MenuSettings>(`${URL}/operators/${o.id}`, { method: 'DELETE' }),
                          'Número removido',
                        );
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form className="wadm-menu__add" onSubmit={add}>
            <TextField
              label="Celular com DDD"
              placeholder="11 91234-5678"
              inputMode="tel"
              autoComplete="off"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <TextField
              label="Apelido (opcional)"
              maxLength={60}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            {m.admins.length > 1 && (
              <SelectField
                label="De qual administrador"
                value={adminId}
                onChange={(e) => setAdminId(e.target.value)}
              >
                <option value="">Eu</option>
                {m.admins.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </SelectField>
            )}
            <Button type="submit" loading={busy === 'add'} disabled={phone.trim().length < 8}>
              Cadastrar
            </Button>
          </form>
          <p className="wadm-menu__note">
            <Badge tone="info">Segurança</Badge> O menu só responde a esses números. Ações que mudam
            algo (backup agora, teste de restauração, limpar cache) pedem SIM e entram no histórico
            do painel no nome do administrador do número.
          </p>
        </div>
      )}
    </Modal>
  );
}
