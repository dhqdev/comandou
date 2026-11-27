import {
  ChartPie,
  ChevronRight,
  CircleCheck,
  Compass,
  CreditCard,
  Download,
  KeyRound,
  LifeBuoy,
  LogOut,
  Moon,
  Settings,
  Sparkles,
  Store,
  Sun,
  UserRound,
  Volume2,
  VolumeX,
  Wand2,
} from 'lucide-react';
import { CSSProperties, MouseEvent, ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAccountTools } from '../app/account-tools';
import { useAuth } from '../app/auth';
import { clickPoint, switchTheme, useTheme } from '../design-system';
import { openTeamChat } from '../features/chat/TeamChat';
import { SoundSettings } from '../features/SoundControl';
import { api } from '../lib/api';
import { useSoundSettings } from '../lib/sounds';
import { MyDataModal, RestaurantDataModal } from './account/AccountForms';
import { MyPhoto } from '../features/MyPhoto';
import './account.css';

/** Situação da assinatura (o mesmo aviso da faixa do topo). */
interface Notice {
  level: 'none' | 'info' | 'warning' | 'blocked';
  trial?: { daysLeft: number } | null;
}

type Tone = 'success' | 'info' | 'warning' | 'danger';

interface Action {
  key: string;
  title: string;
  text: string;
  icon: ReactNode;
  /** Abre uma tela. */
  to?: string;
  /** Ou faz algo aqui mesmo (janela, tema, instalar). */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Bolinha + frase curta embaixo (ex.: situação da assinatura). */
  status?: { tone: Tone; text: string };
  /** Marca "novo" ao lado do título. */
  isNew?: boolean;
  /** Só mostra, sem toque (ex.: app já instalado). */
  done?: boolean;
}

function noticeStatus(n: Notice | null): Action['status'] {
  if (!n) return undefined;
  if (n.trial) {
    const d = n.trial.daysLeft;
    return {
      tone: d <= 3 ? 'warning' : 'info',
      text:
        d <= 0 ? 'Teste grátis termina hoje' : `Teste grátis · ${d} ${d === 1 ? 'dia' : 'dias'}`,
    };
  }
  if (n.level === 'blocked') return { tone: 'danger', text: 'Bloqueado: veja como liberar' };
  if (n.level === 'warning') return { tone: 'warning', text: 'Precisa de atenção' };
  if (n.level === 'info') return { tone: 'info', text: 'Fatura perto de vencer' };
  return { tone: 'success', text: 'Em dia' };
}

/** Bolinha do cartão Uso de IA: quanto do limite do mês já foi. */
function aiStatus(percent: number | null): Action['status'] {
  if (percent === null) return undefined;
  const p = Math.round(percent);
  return {
    tone: p >= 100 ? 'danger' : p >= 80 ? 'warning' : 'success',
    text: p >= 100 ? 'Limite do mês acabou' : `${p}% do limite do mês`,
  };
}

/**
 * Conta (toque no nome, no pé do menu; no celular, no cartão do topo da tela Mais): quem está
 * usando e, em blocos grandes, tudo o que é da pessoa e do restaurante (assinatura, ajustes,
 * ajuda, tema, instalar, senha e sair). Cada bloco só aparece para quem tem a permissão.
 */
export function AccountPage() {
  const { me } = useAuth();
  const tools = useAccountTools();
  const [theme] = useTheme();
  const perms = me?.permissions ?? [];
  const can = (...list: string[]) => list.some((p) => perms.includes(p));
  const seesPlan = can('plan:read');

  const [notice, setNotice] = useState<Notice | null>(null);
  // Quanto do limite de IA do mês já foi usado (a bolinha do cartão Uso de IA).
  const [aiPercent, setAiPercent] = useState<number | null>(null);
  useEffect(() => {
    if (!seesPlan) return;
    let alive = true;
    api<Notice>('/subscription/notice')
      .then((r) => alive && setNotice(r))
      .catch(() => undefined);
    api<{ usage: { percent: number | null } }>('/chat/ai')
      .then((r) => alive && setAiPercent(r.usage?.percent ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [seesPlan]);

  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const [form, setForm] = useState<'me' | 'restaurant' | null>(null);
  // Sons de aviso: saíram do topo (pedido do David) e moram aqui, em Este aparelho.
  const sound = useSoundSettings();
  const [soundOpen, setSoundOpen] = useState(false);
  const isOwner = me?.user.role === 'owner';
  const sections: { key: string; title: string; items: Action[] }[] = [
    {
      key: 'restaurante',
      title: 'Seu restaurante',
      items: [
        ...(isOwner
          ? [
              {
                key: 'dados-restaurante',
                title: 'Dados do restaurante',
                text: 'Nome, razão social, CPF ou CNPJ, responsável, telefone e e-mail de cobrança.',
                icon: <Store />,
                onClick: () => setForm('restaurant'),
              },
            ]
          : []),
        ...(seesPlan
          ? [
              {
                key: 'assinatura',
                title: 'Assinatura',
                text: 'Plano, faturas, forma de pagamento e contrato.',
                icon: <CreditCard />,
                to: '/plano',
                status: noticeStatus(notice),
              },
              {
                key: 'uso-ia',
                title: 'Uso de IA',
                text: 'Quanto o restaurante já usou de IA e em que partes do sistema usa mais.',
                icon: <ChartPie />,
                to: '/conta/uso-ia',
                status: aiStatus(aiPercent),
              },
            ]
          : []),
        ...(can('settings:manage', 'orders:read')
          ? [
              {
                key: 'ajustes',
                title: 'Ajustes',
                text: 'Dados da loja, setores de produção, mesas, caixas e preferências.',
                icon: <Settings />,
                to: '/configuracoes',
              },
            ]
          : []),
      ],
    },
    {
      key: 'ajuda',
      title: 'Ajuda e novidades',
      items: [
        {
          key: 'novidades',
          title: 'Novidades',
          text: 'O que mudou em cada versão do Comandou.',
          icon: <Sparkles />,
          to: '/novidades',
          isNew: tools.unseen,
        },
        ...(seesPlan
          ? [
              {
                key: 'suporte',
                title: 'Falar com a Comandou',
                text: 'Tire dúvidas ou peça ajuda pelo chat com a nossa equipe.',
                icon: <LifeBuoy />,
                onClick: () => openTeamChat('suporte'),
              },
            ]
          : []),
        ...(can('settings:manage')
          ? [
              {
                key: 'inicio',
                title: 'Primeiros passos',
                text: 'A IA monta o cardápio e a loja com você, a partir do que já existe.',
                icon: <Wand2 />,
                onClick: tools.openOnboarding,
              },
            ]
          : []),
        {
          key: 'tour',
          title: 'Rever apresentação',
          text: 'Passeio rápido pelas telas, mostrando o que fazer em cada uma.',
          icon: <Compass />,
          onClick: tools.openTour,
        },
      ],
    },
    {
      key: 'aparelho',
      title: 'Este aparelho',
      items: [
        {
          key: 'tema',
          title: theme === 'dark' ? 'Tema escuro' : 'Tema claro',
          text:
            nextTheme === 'dark'
              ? 'Toque para usar o escuro, que cansa menos à noite.'
              : 'Toque para voltar ao tema claro.',
          icon: theme === 'dark' ? <Moon /> : <Sun />,
          onClick: (e) => switchTheme(nextTheme, clickPoint(e, e.currentTarget)),
        },
        {
          key: 'sons',
          title: 'Sons de aviso',
          text: 'Volume, repetir até atender, som gravado e o som de cada aviso.',
          icon: sound.enabled ? <Volume2 /> : <VolumeX />,
          onClick: () => setSoundOpen(true),
          status: sound.enabled
            ? { tone: 'success', text: `Ligados · volume ${Math.round(sound.volume * 100)}%` }
            : { tone: 'warning', text: 'Desligados neste aparelho' },
        },
        tools.install.show
          ? {
              key: 'instalar',
              title: 'Instalar o app',
              text: 'Abre na própria janela, sem a barra do navegador, com ícone na tela.',
              icon: <Download />,
              onClick: () => tools.install.start(),
            }
          : {
              key: 'instalado',
              title: 'App instalado',
              text: 'Você está usando o Comandou como aplicativo neste aparelho.',
              icon: <CircleCheck />,
              done: true,
            },
      ],
    },
    {
      key: 'voce',
      title: 'Você',
      items: [
        {
          key: 'meus-dados',
          title: 'Meus dados',
          text: 'Sua foto, seu nome e o e-mail com que você entra no sistema.',
          icon: <UserRound />,
          onClick: () => setForm('me'),
        },
        {
          key: 'senha',
          title: 'Trocar senha',
          text: 'Escolha uma senha nova para entrar no sistema.',
          icon: <KeyRound />,
          onClick: tools.openPassword,
        },
      ],
    },
  ];

  return (
    <div className="acc">
      <header className="acc__me">
        {/* Tocar na foto abre Meus dados, onde se põe ou troca a foto. */}
        <button
          type="button"
          className="acc__avatar"
          onClick={() => setForm('me')}
          aria-label="Trocar a foto do perfil"
          title="Trocar a foto"
        >
          <MyPhoto />
        </button>
        <div className="acc__who">
          <h1 className="acc__name">{me?.user.name}</h1>
          {me?.user.email && <p className="acc__email">{me.user.email}</p>}
          <p className="acc__role">
            {me?.user.roleLabel}
            <span aria-hidden> · </span>
            {me?.tenant.name}
          </p>
        </div>
      </header>

      {/* Tela larga (notebook): grupo de 3+ blocos ocupa a linha toda; os de 2 ficam lado a lado,
          e cada grupo põe os blocos numa linha só (account.css, @container). */}
      <div className="acc__sections">
        {sections
          .filter((s) => s.items.length > 0)
          .map((s) => (
            <section
              key={s.key}
              className="acc__group"
              aria-labelledby={`acc-${s.key}`}
              data-span={s.items.length > 2 || undefined}
              style={{ '--n': s.items.length } as CSSProperties}
            >
              <h2 className="acc__title" id={`acc-${s.key}`}>
                {s.title}
              </h2>
              <div className="acc__grid">
                {s.items.map((a) => (
                  <ActionCard key={a.key} action={a} />
                ))}
              </div>
            </section>
          ))}
      </div>

      <button type="button" className="acc__logout" onClick={tools.logout}>
        <LogOut aria-hidden />
        Sair
      </button>
      <p className="acc__foot">Comandou v{__APP_VERSION__}</p>
      <MyDataModal open={form === 'me'} onClose={() => setForm(null)} />
      <RestaurantDataModal open={form === 'restaurant'} onClose={() => setForm(null)} />
      <SoundSettings open={soundOpen} onClose={() => setSoundOpen(false)} />
    </div>
  );
}

function ActionCard({ action: a }: { action: Action }) {
  const body = (
    <>
      <span className="acc-card__icon" aria-hidden>
        {a.icon}
      </span>
      <span className="acc-card__body">
        <span className="acc-card__title">
          {a.title}
          {a.isNew && (
            <span className="acc-card__new">
              <span className="cm-sr-only">, </span>novo
            </span>
          )}
        </span>
        <span className="acc-card__text">{a.text}</span>
        {a.status && (
          <span className="acc-card__status" data-tone={a.status.tone}>
            <span className="cm-dot" aria-hidden />
            {a.status.text}
          </span>
        )}
      </span>
      {!a.done && <ChevronRight className="acc-card__chev" aria-hidden />}
    </>
  );
  // O assistente de IA aponta cada bloco por "/conta?foco=conta-<key>" (o bloco pisca).
  const focus = `conta-${a.key}`;
  if (a.done)
    return (
      <div className="acc-card" data-done data-search-id={focus}>
        {body}
      </div>
    );
  if (a.to)
    return (
      <Link to={a.to} className="acc-card" data-search-id={focus}>
        {body}
      </Link>
    );
  return (
    <button type="button" className="acc-card" data-search-id={focus} onClick={a.onClick}>
      {body}
    </button>
  );
}
