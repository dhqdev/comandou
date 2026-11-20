import { Monitor, Send, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, TextField, useToast, Skeleton } from '../../design-system';
import { CheckField } from '../../features/forms';
import { api } from '../../lib/api';
import { useLoad } from '../OverviewPages';
import { Section } from '../ui';
import type { MailTemplates } from './types';

/**
 * Modelos: todos os e-mails do sistema com dados de exemplo (como o cliente vê, no tamanho do
 * computador ou do celular), o teste de cada um na sua caixa de entrada e a chave dos avisos
 * automáticos de teste grátis e cobrança.
 */
export function TemplatesTab() {
  const toast = useToast();
  const res = useLoad<MailTemplates>('/platform/mail/templates');
  const data = res.data;
  const [id, setId] = useState<string | null>(null);
  const [phone, setPhone] = useState(false);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState<'test' | 'toggle' | null>(null);
  const [lifecycle, setLifecycle] = useState<boolean | null>(null);
  useEffect(() => {
    if (data) setLifecycle(data.lifecycleEnabled);
  }, [data]);

  if (res.error) return <Alert tone="danger">{res.error}</Alert>;
  if (!data)
    return (
      <Card>
        <Skeleton variant="grid" />
      </Card>
    );
  const current = data.items.find((t) => t.id === id) ?? data.items[0]!;

  const toggle = async (on: boolean) => {
    setLifecycle(on);
    setBusy('toggle');
    try {
      await api('/platform/mail/lifecycle', { method: 'PUT', json: { enabled: on } });
      toast(on ? 'Avisos automáticos ligados' : 'Avisos automáticos desligados', 'success');
    } catch (err) {
      setLifecycle(!on);
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      await api(`/platform/mail/templates/${current.id}/test`, {
        method: 'POST',
        json: { to: to.trim() },
      });
      toast(`"${current.label}" enviado para ${to.trim()}`, 'success');
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Section title="Avisos automáticos">
        <Card>
          <CheckField
            label="Avisar o restaurante sobre o teste grátis e a mensalidade"
            description="Teste acabando (na véspera) e encerrado, mensalidade vencendo (3 dias antes), vencida, sistema pausado e pagamento recebido. Cada aviso sai uma vez só, para o e-mail de cobrança do restaurante."
            checked={!!lifecycle}
            disabled={busy === 'toggle'}
            onChange={(v) => void toggle(v)}
          />
        </Card>
      </Section>
      <Section title="Modelos" sub={`${data.items.length} e-mails, com dados de exemplo`}>
        <div className="mail-tpl">
          <nav className="mail-tpl__list" aria-label="Modelos de e-mail">
            {data.items.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`mail-tpl__item${t.id === current.id ? ' is-active' : ''}`}
                aria-current={t.id === current.id ? 'true' : undefined}
                onClick={() => setId(t.id)}
              >
                <strong>{t.label}</strong>
                <span>{t.when}</span>
              </button>
            ))}
          </nav>
          <div className="mail-tpl__view">
            <div className="mail-tpl__bar">
              <div className="mail-tpl__subject">
                <span>Assunto</span>
                <strong>{current.subject}</strong>
              </div>
              <div className="mail-tpl__sizes" role="group" aria-label="Tamanho da prévia">
                <Button
                  size="sm"
                  variant={phone ? 'ghost' : 'secondary'}
                  icon={<Monitor size={15} />}
                  aria-pressed={!phone}
                  onClick={() => setPhone(false)}
                >
                  Computador
                </Button>
                <Button
                  size="sm"
                  variant={phone ? 'secondary' : 'ghost'}
                  icon={<Smartphone size={15} />}
                  aria-pressed={phone}
                  onClick={() => setPhone(true)}
                >
                  Celular
                </Button>
              </div>
            </div>
            <div className={`mail-tpl__frame${phone ? ' is-phone' : ''}`}>
              <iframe title={`Prévia: ${current.label}`} srcDoc={current.html} sandbox="" />
            </div>
            <form
              className="mail__test"
              onSubmit={(e) => {
                e.preventDefault();
                void test();
              }}
            >
              <TextField
                label="Mandar este modelo para"
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
                disabled={!data.ready || !/^\S+@\S+\.\S+$/.test(to.trim()) || !!busy}
              >
                Enviar teste
              </Button>
            </form>
          </div>
        </div>
      </Section>
    </>
  );
}
