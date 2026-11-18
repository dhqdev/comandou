import { ExternalLink } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { SiteAiPage } from './SiteAiPage';
import { SitePage } from './SitePage';
import { PageHead, Tabs } from './ui';

type Part = 'cadastro' | 'ia';

const PARTS: [Part, string][] = [
  ['cadastro', 'Cadastro pelo site'],
  ['ia', 'Site com IA'],
];

const sitePath = (p: Part) => (p === 'cadastro' ? '/site' : '/site/ia');

/** Endereço do site público: o mesmo domínio do painel, sem o "admin.". */
const siteUrl = () =>
  `${window.location.protocol}//${window.location.hostname.replace(/^admin\./, '')}${
    window.location.port ? `:${window.location.port}` : ''
  }/`;

/**
 * Super Admin › Site: tudo do site público numa tela, como a Infraestrutura. "Cadastro pelo site"
 * (ligar, limite por dia, testes criados) e "Site com IA" (a loja montada pela IA, com modelo e
 * limites de tokens). O endereço muda com a aba (/site e /site/ia).
 */
export function SiteArea() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const part: Part = pathname.startsWith('/site/ia') ? 'ia' : 'cadastro';
  return (
    <>
      <PageHead
        page
        title="Site"
        sub={<span>O site público do Comandou, por onde chega quem quer testar o sistema</span>}
        actions={
          <a className="adm-action" href={siteUrl()} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> Abrir o site
          </a>
        }
      />
      <div className="adm-infra-tabs">
        <Tabs value={part} onChange={(p) => navigate(sitePath(p))} items={PARTS} />
      </div>
      {part === 'cadastro' && <SitePage />}
      {part === 'ia' && <SiteAiPage />}
    </>
  );
}
