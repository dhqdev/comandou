import type { CSSProperties } from 'react';

/**
 * Carregamento do sistema: o esqueleto do que vai chegar (blocos cinza com brilho que passa), no
 * lugar e no tamanho do conteúdo. A tela não pula quando os dados chegam e a pessoa já vê o formato
 * do que vem. Pedido do David (0.205): "o formato de carregar os componentes seja por skeleton".
 *
 * - `list` (padrão): linhas com bolinha, texto e valor (pedidos, clientes, conversas).
 * - `table`: cabeçalho e linhas de tabela (estoque, financeiro, notas).
 * - `cards`: números da visão geral (2 colunas no celular, 4 no computador).
 * - `grid`: produtos em quadradinhos (PDV, Nova venda, garçom, cardápio).
 * - `form`: rótulos e campos (ajustes, cadastro).
 * - `detail`: título, números e linhas (janela de pedido, cliente, item).
 * - `board`: colunas lado a lado (cozinha, chamados).
 * - `chat`: balões de conversa.
 * - `page`: título, números e lista (tela inteira abrindo).
 * - `qr`: quadrado do QR Code.
 *
 * Ação em andamento (entrar, salvar, enviar, buscar) continua com `Spinner`: aí não há conteúdo
 * para desenhar.
 */
export type SkeletonVariant =
  'list' | 'table' | 'cards' | 'grid' | 'form' | 'detail' | 'board' | 'chat' | 'page' | 'qr';

export interface SkeletonProps {
  variant?: SkeletonVariant;
  /** Linhas (list, table, form, detail) ou itens (cards, grid, board). */
  rows?: number;
  /** Altura aproximada do conteúdo que vai chegar (sem `rows`, vira o número de linhas). */
  height?: number;
  /** Só `qr`: lado do quadrado. */
  size?: number;
  label?: string;
  className?: string;
}

/** Um bloco do esqueleto, para montar o formato de uma tela específica. */
export function Bone({
  w,
  h = 12,
  r,
  style,
  className,
}: {
  w?: number | string;
  h?: number | string;
  /** Raio: número em px ou 'full' (bolinha). */
  r?: number | 'full';
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span
      className={`cm-bone${className ? ` ${className}` : ''}`}
      aria-hidden
      style={{
        width: w,
        height: h,
        borderRadius: r === 'full' ? 999 : r,
        ...style,
      }}
    />
  );
}

/** Larguras que variam linha a linha: esqueleto igual em toda linha parece grade, não texto. */
const W = ['72%', '58%', '84%', '46%', '66%', '52%', '78%', '40%'];
const w = (i: number) => W[i % W.length];

function ListRows({ rows }: { rows: number }) {
  return (
    <div className="cm-sk__list">
      {Array.from({ length: rows }, (_, i) => (
        <div className="cm-sk__row" key={i}>
          <Bone w={36} h={36} r="full" />
          <div className="cm-sk__lines">
            <Bone w={w(i)} h={12} />
            <Bone w={w(i + 3)} h={10} style={{ opacity: 0.7 }} />
          </div>
          <Bone w={56} h={12} />
        </div>
      ))}
    </div>
  );
}

function TableRows({ rows }: { rows: number }) {
  return (
    <div className="cm-sk__table">
      <div className="cm-sk__thead">
        <Bone w="22%" h={10} />
        <Bone w="16%" h={10} />
        <Bone w="12%" h={10} />
        <Bone w="10%" h={10} />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div className="cm-sk__tr" key={i}>
          <Bone w={`${18 + ((i * 7) % 12)}%`} h={12} />
          <Bone w={`${10 + ((i * 5) % 8)}%`} h={12} />
          <Bone w="10%" h={12} />
          <Bone w="8%" h={12} />
        </div>
      ))}
    </div>
  );
}

function Cards({ count }: { count: number }) {
  return (
    <div className="cm-sk__cards">
      {Array.from({ length: count }, (_, i) => (
        <div className="cm-sk__card" key={i}>
          <Bone w="50%" h={10} />
          <Bone w="70%" h={22} />
        </div>
      ))}
    </div>
  );
}

function Tiles({ count }: { count: number }) {
  return (
    <div className="cm-sk__grid">
      {Array.from({ length: count }, (_, i) => (
        <div className="cm-sk__tile" key={i}>
          <Bone w="100%" h="auto" className="cm-sk__photo" />
          <Bone w={w(i)} h={12} />
          <Bone w="40%" h={10} />
        </div>
      ))}
    </div>
  );
}

function Form({ rows }: { rows: number }) {
  return (
    <div className="cm-sk__form">
      {Array.from({ length: rows }, (_, i) => (
        <div className="cm-sk__field" key={i}>
          <Bone w={`${22 + ((i * 9) % 18)}%`} h={10} />
          <Bone w="100%" h={40} r={10} />
        </div>
      ))}
    </div>
  );
}

function Board({ count }: { count: number }) {
  return (
    <div className="cm-sk__board">
      {Array.from({ length: count }, (_, c) => (
        <div className="cm-sk__col" key={c}>
          <Bone w="45%" h={12} />
          {Array.from({ length: 3 - (c % 2) }, (_, i) => (
            <div className="cm-sk__ticket" key={i}>
              <Bone w="60%" h={12} />
              <Bone w={w(i + c)} h={10} />
              <Bone w="35%" h={10} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Chat() {
  return (
    <div className="cm-sk__chat">
      {[64, 48, 72, 40, 56].map((pct, i) => (
        <Bone
          key={i}
          w={`${pct}%`}
          h={i % 2 ? 40 : 52}
          r={16}
          className={i % 2 ? 'cm-sk__mine' : undefined}
        />
      ))}
    </div>
  );
}

export function Skeleton({
  variant = 'list',
  rows,
  height,
  size = 220,
  label = 'Carregando',
  className,
}: SkeletonProps) {
  const lines = rows ?? (height ? Math.max(2, Math.min(8, Math.round(height / 52))) : 4);
  let body;
  switch (variant) {
    case 'table':
      body = <TableRows rows={rows ?? 6} />;
      break;
    case 'cards':
      body = <Cards count={rows ?? 4} />;
      break;
    case 'grid':
      body = <Tiles count={rows ?? 8} />;
      break;
    case 'form':
      body = <Form rows={rows ?? 4} />;
      break;
    case 'board':
      body = <Board count={rows ?? 3} />;
      break;
    case 'chat':
      body = <Chat />;
      break;
    case 'qr':
      body = <Bone w={size} h={size} r={12} style={{ maxWidth: '100%', aspectRatio: '1' }} />;
      break;
    case 'detail':
      body = (
        <>
          <div className="cm-sk__head">
            <Bone w="40%" h={18} />
            <Bone w="24%" h={12} />
          </div>
          <Cards count={2} />
          <ListRows rows={rows ?? 3} />
        </>
      );
      break;
    case 'page':
      body = (
        <>
          <Bone w={180} h={22} />
          <Cards count={4} />
          <ListRows rows={rows ?? 5} />
        </>
      );
      break;
    default:
      body = <ListRows rows={lines} />;
  }
  return (
    <div
      className={`cm-sk cm-sk--${variant}${className ? ` ${className}` : ''}`}
      role="status"
      aria-busy="true"
    >
      {body}
      <span className="cm-sr-only">{label}</span>
    </div>
  );
}

/**
 * Moldura do app carregando (topo, menu lateral no computador, abas no celular e a tela no meio):
 * o mesmo desenho do esqueleto do index.html, então a abertura passa de um para o outro sem pulo.
 * `plain` tira a moldura da equipe (cardápio, links do cliente).
 */
export function AppSkeleton({ plain }: { plain?: boolean }) {
  return (
    <div className={`cm-appsk${plain ? ' cm-appsk--plain' : ''}`} role="status" aria-busy="true">
      <div className="cm-appsk__top">
        <Bone w={32} h={32} r={9} />
        <Bone w={120} h={14} />
        <Bone w={32} h={32} r="full" style={{ marginLeft: 'auto' }} />
      </div>
      <div className="cm-appsk__side" aria-hidden>
        {['70%', '55%', '64%', '48%', '60%'].map((x, i) => (
          <Bone key={i} w={x} h={14} />
        ))}
      </div>
      <div className="cm-appsk__main">
        <Skeleton variant="page" rows={3} />
      </div>
      <div className="cm-appsk__tabs" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <Bone key={i} w={28} h={28} />
        ))}
      </div>
      <span className="cm-sr-only">Carregando</span>
    </div>
  );
}
