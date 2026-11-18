import { Check, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Modal, TextField, useToast } from '../../design-system';
import { CheckField } from '../../features/forms';
import { api } from '../../lib/api';
import { AgendaSettings, AgendaTag, fmtPhone, TAG_COLORS } from './agenda-utils';

/** Permissão dos lembretes pelo WhatsApp: liga/desliga e o número que recebe. */
export function WhatsAppDialog({
  settings,
  canManageWhatsApp,
  onClose,
  onSaved,
}: {
  settings: AgendaSettings | null;
  canManageWhatsApp: boolean;
  onClose: () => void;
  onSaved: (s: AgendaSettings) => void;
}) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(settings?.whatsappEnabled || !settings?.phone);
  const [phone, setPhone] = useState(fmtPhone(settings?.phone ?? null));
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(andTest = false) {
    setBusy(andTest ? 'test' : 'save');
    setError(null);
    try {
      const s = await api<AgendaSettings>('/agenda/settings', {
        method: 'PUT',
        json: { whatsappEnabled: enabled, phone: phone.trim() || null },
      });
      onSaved(s);
      if (andTest) {
        await api('/agenda/settings/test', { method: 'POST' });
        toast('Mensagem de teste enviada. Confira seu WhatsApp.', 'success');
      } else {
        toast(
          enabled ? 'Lembretes pelo WhatsApp ligados' : 'Lembretes pelo WhatsApp desligados',
          'success',
        );
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      title="Lembretes pelo WhatsApp"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            icon={<Send size={16} />}
            onClick={() => save(true)}
            loading={busy === 'test'}
            disabled={!!busy || !phone.trim() || !settings?.whatsappReady}
          >
            Mandar teste
          </Button>
          <Button onClick={() => save(false)} loading={busy === 'save'} disabled={!!busy}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="cm-form">
        <p className="cm-hint cm-form__wide" style={{ margin: 0 }}>
          O assistente do Comandou manda uma mensagem no seu WhatsApp no horário que você escolher
          em cada compromisso. Os lembretes saem pelo WhatsApp do restaurante e só você recebe os
          seus.
        </p>
        {error && (
          <div className="cm-form__wide">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}
        {settings && !settings.whatsappReady && (
          <div className="cm-form__wide">
            <Alert tone="warning">
              O WhatsApp do restaurante não está conectado pelo QR Code, então os lembretes ainda
              não saem.{' '}
              {canManageWhatsApp ? (
                <Link to="/whatsapp">Conectar o WhatsApp</Link>
              ) : (
                'Peça para quem administra conectar em WhatsApp.'
              )}
            </Alert>
          </div>
        )}
        <div className="cm-form__wide">
          <CheckField
            label="Permitir lembretes pelo WhatsApp"
            description="Você pode desligar quando quiser. Desligado, nenhum lembrete sai."
            checked={enabled}
            onChange={setEnabled}
          />
        </div>
        <TextField
          label="Seu WhatsApp"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(11) 98765-4321"
          hint="DDD + número"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
    </Modal>
  );
}

/** Criar, renomear, trocar a cor e excluir tags. */
export function TagsDialog({
  tags,
  onClose,
  onChanged,
}: {
  tags: AgendaTag[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [color, setColor] = useState(
    () => TAG_COLORS.find((c) => !tags.some((t) => t.color === c)) ?? TAG_COLORS[0]!,
  );
  const [editing, setEditing] = useState<AgendaTag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(msg, 'success');
      onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const add = async () => {
    if (!name.trim()) return;
    const ok = await run(
      () => api('/agenda/tags', { method: 'POST', json: { name: name.trim(), color } }),
      'Tag criada',
    );
    if (ok) {
      setName('');
      setColor(TAG_COLORS.find((c) => c !== color && !tags.some((t) => t.color === c)) ?? color);
    }
  };

  const saveEdit = async () => {
    if (!editing || !editing.name.trim()) return;
    const ok = await run(
      () =>
        api(`/agenda/tags/${editing.id}`, {
          method: 'PATCH',
          json: { name: editing.name.trim(), color: editing.color },
        }),
      'Tag salva',
    );
    if (ok) setEditing(null);
  };

  const remove = (t: AgendaTag) => {
    if (!window.confirm(`Excluir a tag "${t.name}"? Os compromissos ficam, só sem a tag.`)) return;
    void run(() => api(`/agenda/tags/${t.id}`, { method: 'DELETE' }), 'Tag excluída');
  };

  return (
    <Modal open title="Tags" onClose={onClose}>
      <div className="ag-tags">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="ag-tags__new">
          <TextField
            label="Nova tag"
            placeholder="Ex.: Fornecedores, Equipe, Manutenção"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
          <Swatches value={color} onChange={setColor} />
          <Button onClick={add} disabled={busy || !name.trim()}>
            Criar tag
          </Button>
        </div>
        {tags.length > 0 && (
          <ul className="ag-tags__list">
            {tags.map((t) =>
              editing?.id === t.id ? (
                <li key={t.id} className="ag-tags__row ag-tags__row--edit">
                  <input
                    className="cm-input"
                    aria-label="Nome da tag"
                    autoFocus
                    maxLength={40}
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveEdit();
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setEditing(null);
                      }
                    }}
                  />
                  <Swatches
                    value={editing.color}
                    onChange={(c) => setEditing({ ...editing, color: c })}
                  />
                  <span className="ag-tags__actions">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
                      Cancelar
                    </Button>
                    <Button size="sm" onClick={saveEdit} disabled={busy}>
                      Salvar
                    </Button>
                  </span>
                </li>
              ) : (
                <li key={t.id} className="ag-tags__row" style={{ ['--tag' as string]: t.color }}>
                  <span className="ag-dot" aria-hidden />
                  <span className="ag-tags__name">{t.name}</span>
                  <span className="ag-tags__actions">
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ ...t })}>
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Excluir ${t.name}`}
                      icon={<Trash2 size={15} />}
                      onClick={() => remove(t)}
                    />
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function Swatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="ag-swatches" role="radiogroup" aria-label="Cor">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={`Cor ${c}`}
          className="ag-swatch"
          style={{ ['--tag' as string]: c }}
          onClick={() => onChange(c)}
        >
          {value === c && <Check size={13} strokeWidth={3} aria-hidden />}
        </button>
      ))}
    </div>
  );
}
