import { Send } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Alert, Button, Card, TextField, useToast } from '../../design-system';
import { CheckField } from '../../features/forms';
import { api } from '../../lib/api';
import { Section, Tag } from '../ui';
import type { MailSettings } from './types';

/** Resend: chave, remetente e o e-mail de teste. Todo e-mail do sistema sai por aqui. */
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
        Passo a passo do Resend (domínio, DNS e chave): <code>docs/email.md</code> no repositório.
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
    resendKey: '',
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
          ...(f.resendKey ? { resendKey: f.resendKey } : {}),
        },
      });
      setF((c) => ({ ...c, resendKey: '' }));
      toast('Resend salvo', 'success');
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

  const saved = (set: boolean) => (set ? 'Salva. Digite para trocar.' : '');

  return (
    <Section
      title="Resend"
      sub={s.ready ? <Tag level="ok">Funcionando</Tag> : <Tag level="warn">Não configurado</Tag>}
    >
      <Card>
        {!s.canStoreSecrets && (
          <Alert tone="warning">
            O servidor está sem a INTEGRATIONS_KEY: não dá para guardar chaves com segurança.
          </Alert>
        )}
        <form className="cm-form" onSubmit={save}>
          <div className="cm-form__block">
            <CheckField
              label="Enviar e-mails pelo Resend"
              description="Desligado, nenhum e-mail do sistema sai (ficam na fila até religar)."
              checked={f.enabled}
              onChange={(v) => setF({ ...f, enabled: v })}
            />
          </div>
          <h3 className="cm-form__section">Chave do Resend</h3>
          <TextField
            label="API Key"
            wrapClass="cm-form__wide"
            type="password"
            autoComplete="new-password"
            placeholder={saved(s.resendKeySet) || 're_...'}
            hint="resend.com › API Keys, com permissão Sending access."
            value={f.resendKey}
            onChange={set('resendKey')}
          />
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
