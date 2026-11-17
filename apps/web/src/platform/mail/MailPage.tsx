import { useLocation, useNavigate } from 'react-router';
import { Alert, Card, Spinner } from '../../design-system';
import { useLoad } from '../OverviewPages';
import { PageHead, Tabs } from '../ui';
import './mail.css';
import { OutboxTab } from './Outbox';
import { SettingsTab } from './Settings';
import { TemplatesTab } from './Templates';
import type { Overview } from './types';

type Part = 'resend' | 'modelos' | 'envios';

const PARTS: [Part, string][] = [
  ['resend', 'Resend'],
  ['modelos', 'Modelos'],
  ['envios', 'Envios'],
];

export const mailPath = (p: Part) => (p === 'resend' ? '/email' : `/email/${p}`);

/**
 * Super Admin › E-mail: a configuração do Resend (por onde saem todos os e-mails do sistema), os
 * modelos (prévia de cada e-mail e os avisos automáticos) e os envios, com reenviar e cancelar. Guia: docs/email.md.
 */
export function MailPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const segment = pathname.split('/')[2] ?? '';
  const part: Part = PARTS.find(([p]) => p === segment)?.[0] ?? 'resend';
  const overview = useLoad<Overview>('/platform/mail');
  const data = overview.data;
  return (
    <>
      <PageHead
        page
        title="E-mail"
        sub="Boas-vindas, códigos de senha, avisos de cobrança e contratos saem pelo Resend"
      />
      <div className="adm-infra-tabs">
        <Tabs value={part} onChange={(p) => navigate(mailPath(p))} items={PARTS} />
      </div>
      {overview.error && <Alert tone="danger">{overview.error}</Alert>}
      {!data ? (
        <Card>
          <Spinner />
        </Card>
      ) : (
        <>
          {!data.settings.ready && part !== 'resend' && (
            <Alert tone="info">
              O Resend ainda não está configurado: nenhum e-mail do sistema sai.{' '}
              <button type="button" className="mail-link" onClick={() => navigate('/email')}>
                Configurar
              </button>
            </Alert>
          )}
          {part === 'resend' && (
            <SettingsTab settings={data.settings} onChanged={overview.reload} />
          )}
          {part === 'modelos' && <TemplatesTab />}
          {part === 'envios' && <OutboxTab />}
        </>
      )}
    </>
  );
}
