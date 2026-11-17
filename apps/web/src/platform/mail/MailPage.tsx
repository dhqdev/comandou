import { useLocation, useNavigate } from 'react-router';
import { Alert, Card, Spinner } from '../../design-system';
import { useLoad } from '../OverviewPages';
import { PageHead, Tabs } from '../ui';
import { BookingTab } from './Booking';
import { CalendarTab } from './Calendar';
import { InboxTab } from './Inbox';
import './mail.css';
import { OutboxTab } from './Outbox';
import { SettingsTab } from './Settings';
import type { Overview } from './types';

type Part = 'caixas' | 'agenda' | 'agendamento' | 'envios' | 'configurar';

const PARTS: [Part, string][] = [
  ['caixas', 'Caixas'],
  ['agenda', 'Agenda'],
  ['agendamento', 'Agendamento'],
  ['envios', 'Envios'],
  ['configurar', 'Configurar'],
];

export const mailPath = (p: Part) => (p === 'caixas' ? '/email' : `/email/${p}`);

/**
 * Super Admin › E-mail: caixas do domínio (ler, escrever, responder), agenda com convites,
 * página pública de agendamento, envios do sistema e a configuração (provedor, domínios,
 * caixas, regras e recebimento pela Cloudflare). Guia: docs/email.md.
 */
export function MailPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const part: Part =
    PARTS.find(([p]) => p !== 'caixas' && pathname.startsWith(`/email/${p}`))?.[0] ?? 'caixas';
  const overview = useLoad<Overview>('/platform/mail');
  const data = overview.data;
  const needsSetup = data && (!data.settings.ready || !data.mailboxes.length);
  return (
    <>
      <PageHead
        page
        title="E-mail"
        sub="Caixas do seu domínio, agenda, agendamento e todos os e-mails que o sistema manda"
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
          {needsSetup && part !== 'configurar' && (
            <Alert tone="info">
              {!data.settings.ready
                ? 'O envio ainda não está configurado: nenhum e-mail do sistema sai até escolher o provedor. '
                : 'Nenhuma caixa criada ainda. '}
              <button
                type="button"
                className="mail-link"
                onClick={() => navigate('/email/configurar')}
              >
                Abrir Configurar
              </button>
            </Alert>
          )}
          {part === 'caixas' && <InboxTab overview={data} onChanged={overview.reload} />}
          {part === 'agenda' && <CalendarTab mailboxes={data.mailboxes} />}
          {part === 'agendamento' && <BookingTab mailboxes={data.mailboxes} />}
          {part === 'envios' && <OutboxTab />}
          {part === 'configurar' && <SettingsTab overview={data} onChanged={overview.reload} />}
        </>
      )}
    </>
  );
}
