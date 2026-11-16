import { useLocation, useNavigate } from 'react-router';
import { BackupsPage } from './BackupsPage';
import { DbServersPage } from './DbServersPage';
import { MigrationsPage } from './MigrationsPage';
import { ServerPage } from './ServerPage';
import { VmPage } from './VmPage';
import { PageHead, Tabs } from './ui';

type Part = 'servidor' | 'vm' | 'bancos' | 'backups' | 'migracoes';

const PARTS: [Part, string][] = [
  ['servidor', 'Servidor'],
  ['vm', 'VM'],
  ['bancos', 'Bancos'],
  ['backups', 'Backups'],
  ['migracoes', 'Migrações'],
];

export const infraPath = (p: Part) => (p === 'servidor' ? '/servidor' : `/servidor/${p}`);

/**
 * Infraestrutura: Servidor, VM, Bancos, Backups e Migrações numa tela só, cada um na sua aba. O
 * endereço muda com a aba (/servidor, /servidor/vm, /servidor/bancos, /servidor/backups, /servidor/migracoes),
 * então dá para voltar e compartilhar.
 */
export function InfraPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const part: Part = pathname.startsWith('/servidor/vm')
    ? 'vm'
    : pathname.startsWith('/servidor/bancos')
      ? 'bancos'
      : pathname.startsWith('/servidor/backups')
        ? 'backups'
        : pathname.startsWith('/servidor/migracoes')
          ? 'migracoes'
          : 'servidor';
  return (
    <>
      <PageHead
        page
        title="Infraestrutura"
        sub={<span>Servidor, sistema da VM, bancos, backups e migrações num lugar só</span>}
      />
      <div className="adm-infra-tabs">
        <Tabs value={part} onChange={(p) => navigate(infraPath(p))} items={PARTS} />
      </div>
      {part === 'servidor' && <ServerPage />}
      {part === 'vm' && <VmPage />}
      {part === 'bancos' && <DbServersPage />}
      {part === 'backups' && <BackupsPage />}
      {part === 'migracoes' && <MigrationsPage />}
    </>
  );
}
