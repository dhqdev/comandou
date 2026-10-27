import { ArrowLeft, ArrowRight, Command, Moon, CircleUserRound } from 'lucide-react';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Button, Mascot, Modal } from '../design-system';
import './welcome-tour.css';

/**
 * Apresentação do primeiro acesso: um passo por tela que a pessoa pode usar (respeita as
 * permissões, então o garçom vê o salão e a cozinha, o dono vê tudo). Fica marcada como vista
 * neste aparelho, por usuário; dá para rever em Conta › Rever apresentação.
 */
export interface TourScreen {
  key: string;
  label: string;
  icon: ReactNode;
}

const ABOUT: Record<string, { title: string; text: string; tips: string[] }> = {
  '/': {
    title: 'PDV: vendas no balcão',
    text: 'Lance vendas de balcão, retirada e telefone em poucos toques. Escolha os itens, o cliente e a forma de pagamento.',
    tips: ['Busque produtos pelo nome ou código', 'Aceita Pix, cartão, dinheiro e vale'],
  },
  '/pedidos': {
    title: 'Pedidos em tempo real',
    text: 'Todo pedido cai aqui na hora: loja online, salão, balcão e delivery. Aceite, acompanhe o andamento e finalize.',
    tips: ['Um som avisa quando chega pedido novo', 'Toque no pedido para ver detalhes e imprimir'],
  },
  '/mesas': {
    title: 'Salão e mesas',
    text: 'O mapa do salão mostra quais mesas estão livres, ocupadas ou pedindo a conta. Abra comandas, lance itens e feche a conta.',
    tips: [
      'Divida a conta por pessoa ou por item',
      'Cada mesa tem um QR Code para o cliente pedir',
    ],
  },
  '/cozinha': {
    title: 'Cozinha',
    text: 'Cada item vai para a tela da cozinha do setor certo, por ordem de chegada. Marque "em preparo" e "pronto" e o salão fica sabendo.',
    tips: ['Os pedidos atrasados mudam de cor', 'Funciona em TV ou tablet na parede'],
  },
  '/caixa': {
    title: 'Caixa',
    text: 'Abra o caixa no começo do turno, registre sangrias e suprimentos e confira o fechamento com o total de cada forma de pagamento.',
    tips: ['O fechamento mostra diferenças na hora', 'Cada operador tem o seu histórico'],
  },
  '/entregas': {
    title: 'Entregas',
    text: 'Distribua os pedidos de delivery entre os entregadores e acompanhe quem saiu, quem está na rua e o que já foi entregue.',
    tips: ['Taxa de entrega por bairro ou por distância', 'O cliente acompanha o pedido pelo link'],
  },
  '/cardapio': {
    title: 'Cardápio',
    text: 'Cadastre categorias, produtos, fotos, preços e adicionais. O que você muda aqui aparece na hora no PDV, no salão e na loja online.',
    tips: ['Pause um item esgotado com um toque', 'Adicionais com mínimo e máximo de escolhas'],
  },
  gestao: {
    title: 'Gestão do negócio',
    text: 'Loja online, clientes, financeiro, relatórios e equipe ficam reunidos neste menu.',
    tips: ['Cadastre a equipe com o papel de cada um', 'Relatórios mostram o que mais vendeu'],
  },
  sistema: {
    title: 'Sistema e ajustes',
    text: 'Impressoras, nota fiscal, WhatsApp, plano e os ajustes da loja: horários, cores, taxas e formas de pagamento.',
    tips: ['Configure a impressora da cozinha e do caixa', 'Defina os horários de funcionamento'],
  },
};

const storageKey = (tenantId: string, userId: string) => `cm-tour:${tenantId}:${userId}`;

export function tourSeen(tenantId: string, userId: string) {
  try {
    return localStorage.getItem(storageKey(tenantId, userId)) === 'done';
  } catch {
    // Sem armazenamento não dá para lembrar: melhor não mostrar a cada recarga.
    return true;
  }
}

function markSeen(tenantId: string, userId: string) {
  try {
    localStorage.setItem(storageKey(tenantId, userId), 'done');
  } catch {
    /* sem armazenamento */
  }
}

type Step = { kind: 'welcome' } | { kind: 'screen'; screen: TourScreen } | { kind: 'done' };

export function WelcomeTour({
  open,
  onClose,
  tenantId,
  userId,
  userName,
  tenantName,
  screens,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  userId: string;
  userName: string;
  tenantName: string;
  screens: TourScreen[];
}) {
  const steps: Step[] = [
    { kind: 'welcome' },
    ...screens.filter((s) => ABOUT[s.key]).map((screen) => ({ kind: 'screen' as const, screen })),
    { kind: 'done' },
  ];
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const last = steps.length - 1;
  const step = steps[Math.min(index, last)]!;

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const finish = useCallback(() => {
    markSeen(tenantId, userId);
    onClose();
  }, [tenantId, userId, onClose]);

  const go = useCallback(
    (to: number) => {
      if (to < 0) return;
      if (to > last) return finish();
      setDir(to > index ? 1 : -1);
      setIndex(to);
    },
    [index, last, finish],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(index + 1);
      if (e.key === 'ArrowLeft') go(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, go]);

  const firstName = userName.split(' ')[0] ?? userName;

  return (
    <Modal
      open={open}
      onClose={finish}
      title={index === 0 ? 'Boas-vindas' : `Passo ${index} de ${last}`}
      footer={
        <div className="tour__footer">
          {index < last ? (
            <Button variant="ghost" onClick={finish}>
              Pular
            </Button>
          ) : (
            <span />
          )}
          <div className="tour__nav">
            {index > 0 && (
              <Button
                variant="secondary"
                icon={<ArrowLeft size={16} />}
                onClick={() => go(index - 1)}
              >
                Voltar
              </Button>
            )}
            <Button onClick={() => go(index + 1)}>
              {index === 0 ? 'Começar' : index === last ? 'Ir para o painel' : 'Próximo'}
              {index < last && <ArrowRight size={16} />}
            </Button>
          </div>
        </div>
      }
    >
      <div className="tour">
        <div className="tour__progress" aria-hidden>
          {steps.map((_, i) => (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              className={i === index ? 'is-on' : i < index ? 'is-past' : ''}
              onClick={() => go(i)}
            />
          ))}
        </div>

        <div key={index} className={`tour__slide tour__slide--${dir > 0 ? 'next' : 'prev'}`}>
          {step.kind === 'welcome' && (
            <>
              <div className="tour__hero">
                <Mascot size={92} mood="joy" animated />
              </div>
              <h3 className="tour__title">Olá, {firstName}! Bem-vindo ao Comandou.</h3>
              <p className="tour__text">
                Este é o painel de <b>{tenantName}</b>. Em menos de um minuto mostramos o que cada
                tela faz para você já começar a usar.
              </p>
            </>
          )}

          {step.kind === 'screen' && (
            <>
              <div className="tour__hero">
                <span className="tour__icon">{step.screen.icon}</span>
              </div>
              <span className="tour__chip">Menu › {step.screen.label}</span>
              <h3 className="tour__title">{ABOUT[step.screen.key]!.title}</h3>
              <p className="tour__text">{ABOUT[step.screen.key]!.text}</p>
              <ul className="tour__tips">
                {ABOUT[step.screen.key]!.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          )}

          {step.kind === 'done' && (
            <>
              <div className="tour__hero">
                <Mascot size={92} mood="wink" animated />
              </div>
              <h3 className="tour__title">Tudo pronto!</h3>
              <p className="tour__text">Três atalhos que ajudam no dia a dia:</p>
              <ul className="tour__shortcuts">
                <li>
                  <span className="tour__key">
                    <Command size={15} />
                  </span>
                  <span>
                    <b>Ctrl + K</b> abre a busca: ache pedidos, produtos, clientes e telas.
                  </span>
                </li>
                <li>
                  <span className="tour__key">
                    <Moon size={15} />
                  </span>
                  <span>
                    O botão de <b>sol e lua</b> troca entre tema claro e escuro.
                  </span>
                </li>
                <li>
                  <span className="tour__key">
                    <CircleUserRound size={15} />
                  </span>
                  <span>
                    Em <b>Conta</b> você troca a senha e pode rever esta apresentação.
                  </span>
                </li>
              </ul>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
