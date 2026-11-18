import { Send } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Button, Card, TextField, useToast } from '../../design-system';
import { CheckField } from '../../features/forms';
import { api } from '../../lib/api';
import { KeyInUse } from '../credentials/KeyInUse';
import { Section, Tag } from '../ui';
import type { MailSettings } from './types';

/**
 * Resend: liga e desliga o envio, o remetente e o e-mail de teste. A chave do Resend fica em
 * Super Admin › Credenciais. Todo e-mail do sistema sai por aqui.
 */
export function SettingsTab({
  settings,
  onChanged,
}: {
  settings: MailSettings;
  onChanged(): void;
}) {
  return (
    <>
      <SendSettings settings={settings} onSaved={onChanged} />
      <p className="cm-hint mail__guide">
        Passo a passo do Resend (domínio, DNS e chave) em Super Admin › Credenciais e em{' '}
        <code>docs/email.md</code> no repositório.
      </p>
    </>
  );
}

function SendSettings({ settings: s, onSaved }: { settings: MailSettings; onSaved(): void }) {
  const toast = useToast();
  const [f, setF] = useState({
    // Primeira vez: já vem ligado (é o único jeito de mandar e-mail).
    enabled: s.enabled || !s.resendKeySet,
    fromAddress: s.fromAddress,
    fromName: s.fromName,
    replyTo: s.replyTo,
  });
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [to, setTo] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy('save');
    try {
      await api('/platform/mail/settings', {
        method: 'PUT',
        json: {
          enabled: f.enabled,
          fromAddress: f.fromAddress.trim(),
          fromName: f.fromName.trim(),
          replyTo: f.replyTo.trim(),
        },
      });
      toast('E-mail salvo', 'success');
      onSaved();
      return true;
    } catch (err) {
      toast((err as Error).message, 'danger');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      await api('/platform/mail/settings/test', { method: 'POST', json: { to: to.trim() } });
      toast(`E-mail de teste enviado para ${to.trim()}`, 'success');
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Resend"
      sub={s.ready ? <Tag level="ok">Funcionando</Tag> : <Tag level="warn">Não configurado</Tag>}
    >
      <Card>
        <KeyInUse ids={['resend']} />
        <form className="cm-form" onSubmit={save}>
          <div className="cm-form__block">
            <CheckField
              label="Enviar e-mails pelo Resend"
              description="Desligado, nenhum e-mail do sistema sai (ficam na fila até religar)."
              checked={f.enabled}
              onChange={(v) => setF({ ...f, enabled: v })}
            />
          </div>
          <h3 className="cm-form__section">Remetente</h3>
          <TextField
            label="E-mail remetente"
            type="email"
            placeholder="nao-responda@seudominio.com.br"
            hint="Um endereço do domínio verificado no Resend."
            value={f.fromAddress}
            onChange={set('fromAddress')}
          />
          <TextField
            label="Nome do remetente"
            value={f.fromName}
            onChange={set('fromName')}
            maxLength={80}
          />
          <TextField
            label="Responder para (opcional)"
            type="email"
            placeholder="contato@seudominio.com.br"
            hint="Quando alguém responde um e-mail do sistema, a resposta vai para cá."
            value={f.replyTo}
            onChange={set('replyTo')}
          />
          <div className="cm-form__block mail__buttons">
            <Button type="submit" loading={busy === 'save'} disabled={!!busy}>
              Salvar
            </Button>
          </div>
        </form>
        {s.ready && (
          <form
            className="mail__test"
            onSubmit={async (e) => {
              e.preventDefault();
              await test();
            }}
          >
            <TextField
              label="Enviar teste para"
              type="email"
              placeholder="voce@exemplo.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <Button
              type="submit"
              variant="secondary"
              icon={<Send size={15} />}
              loading={busy === 'test'}
              disabled={!/^\S+@\S+\.\S+$/.test(to.trim()) || !!busy}
            >
              Enviar teste
            </Button>
          </form>
        )}
      </Card>
    </Section>
  );
}
