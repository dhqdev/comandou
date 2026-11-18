import { useEffect, useState } from 'react';
import { Modal, useToast } from '../design-system';
import { installKind, type InstallKind } from '../pages/public/InstallHint';
import { canPromptInstall, isStandalone, promptInstall } from '../platform/pwa';

/** Como instalar neste aparelho quando o navegador não abre o pedido sozinho. */
function Steps({ kind, name }: { kind: InstallKind | null; name: string }) {
  if (kind === 'ios')
    return (
      <ol className="cm-install__steps">
        <li>Abra este endereço no Safari.</li>
        <li>
          Toque em <strong>Compartilhar</strong> (quadrado com seta para cima).
        </li>
        <li>
          Escolha <strong>Adicionar à Tela de Início</strong> e confirme.
        </li>
      </ol>
    );
  if (kind === 'android' || kind === 'phone')
    return (
      <ol className="cm-install__steps">
        <li>
          No Chrome, toque no menu <strong>⋮</strong> (canto de cima).
        </li>
        <li>
          Escolha <strong>Instalar app</strong> (ou <strong>Adicionar à tela inicial</strong>).
        </li>
      </ol>
    );
  if (kind === 'mac')
    return (
      <ol className="cm-install__steps">
        <li>
          No Safari, abra o menu <strong>Arquivo</strong>.
        </li>
        <li>
          Escolha <strong>Adicionar ao Dock</strong> e confirme.
        </li>
      </ol>
    );
  return (
    <ol className="cm-install__steps">
      <li>
        <strong>Chrome:</strong> clique no ícone de instalar no fim da barra de endereço (um monitor
        com uma seta) ou no menu <strong>⋮</strong> › Transmitir, salvar e compartilhar ›{' '}
        <strong>Instalar página como app</strong>.
      </li>
      <li>
        <strong>Edge:</strong> menu <strong>…</strong> › Aplicativos ›{' '}
        <strong>Instalar este site como um aplicativo</strong>.
      </li>
      <li>
        O Firefox não instala apps: abra este endereço no Chrome ou no Edge. Já instalou? Procure
        por {name} no menu Iniciar (Windows) ou no Launchpad (Mac).
      </li>
    </ol>
  );
}

/**
 * "Instalar o app" do menu de perfil: no Chrome e no Edge (computador ou Android) abre o pedido
 * de instalação do próprio navegador; nos outros (iPhone, Safari do Mac ou quando o navegador não
 * ofereceu), mostra o passo a passo. Instalado, o sistema abre na própria janela, com ícone na
 * área de trabalho, no menu Iniciar ou no Dock, como um programa. Some quando já está no app.
 */
export function useInstallApp(name = 'Comandou') {
  const toast = useToast();
  const [help, setHelp] = useState(false);
  const [done, setDone] = useState(() => isStandalone());
  useEffect(() => {
    const installed = () => {
      setDone(true);
      setHelp(false);
      toast(`${name} instalado: abra pelo ícone na área de trabalho ou no menu`, 'success');
    };
    window.addEventListener('cm-installed', installed);
    return () => window.removeEventListener('cm-installed', installed);
  }, [name, toast]);

  const start = async () => {
    if (await promptInstall()) return;
    setHelp(true);
  };
  const kind = help
    ? installKind({
        ua: navigator.userAgent,
        touchPoints: navigator.maxTouchPoints ?? 0,
        standalone: false,
        canPrompt: canPromptInstall(),
      })
    : null;
  const modal = (
    <Modal open={help} title="Instalar o app" onClose={() => setHelp(false)}>
      <div className="cm-install">
        <p className="cm-install__lead">
          Com o app instalado, o {name} abre na própria janela, sem a barra do navegador, e ganha um
          ícone para abrir com um clique.
        </p>
        <Steps kind={kind} name={name} />
      </div>
    </Modal>
  );
  return { show: !done, start, modal };
}
