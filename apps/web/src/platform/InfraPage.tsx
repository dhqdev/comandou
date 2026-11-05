import { useLocation, useNavigate } from 'react-router';
import { BackupsPage } from './BackupsPage';
import { DbServersPage } from './DbServersPage';
import { ServerPage } from './ServerPage';
import { PageHead, Tabs } from './ui';

type Part = 'servidor' | 'bancos' | 'backups';

const PARTS: [Part, string][] = [
  ['servidor', 'Servidor'],
  ['bancos', 'Bancos'],
  ['backups', 'Backups'],
];

export const infraPath = (p: Part) => (p === 'servidor' ? '/servidor' : `/servidor/${p}`);

/**
 * Infraestrutura: Servidor, Bancos e Backups numa tela só, cada um na sua aba. O endereço muda
 * com a aba (/servidor, /servidor/bancos, /servidor/backups), então dá para voltar e compartilhar.
 */
export function InfraPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const part: Part = pathname.startsWith('/servidor/bancos')
    ? 'bancos'
    : pathname.startsWith('/servidor/backups')
      ? 'backups'
      : 'servidor';
  return (
    <>
      <PageHead
        page
        title="Infraestrutura"
        sub={<span>Servidor, bancos dos restaurantes e backups num lugar só</span>}
      />
      <div className="adm-infra-tabs">
        <Tabs value={part} onChange={(p) => navigate(infraPath(p))} items={PARTS} />
      </div>
      {part === 'servidor' && <ServerPage />}
      {part === 'bancos' && <DbServersPage />}
      {part === 'backups' && <BackupsPage />}
    </>
  );
}
