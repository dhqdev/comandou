import { linkPlaces, safeAppPath as sharedSafePath } from '@comandou/shared';
import { ArrowRight } from 'lucide-react';
import { Fragment, ReactNode, useMemo } from 'react';
import { Link } from 'react-router';
import { useGuideAccess } from '../../design-system/fix-guide';

/**
 * Markdown bem pequeno para as respostas do assistente: parágrafos, listas (- e 1.),
 * **negrito**, *itálico*, `código` e [tela](/caminho), que vira um botão para a tela.
 * Monta elementos do React (nada de HTML cru).
 */

const host = () => (typeof window === 'undefined' ? undefined : window.location.host);

/**
 * Só caminhos internos do app ("/caixa", "/fiscal/configuracao?foco=…"); nada de fora. Caminho
 * que não cai numa tela que existe (a IA inventou) vira texto, não um link para "não encontrada".
 * Endereço inteiro do próprio Comandou vira só o caminho.
 */
export function safeAppPath(raw: string): string | null {
  return sharedSafePath(raw, host());
}

/** Garçom, cozinha e entregador usam o app deles: as telas da loja não abrem para eles. */
const OWN_APP_ROLES = new Set(['waiter', 'kitchen', 'driver']);

type Go = (() => void) | undefined;

function inline(text: string, key: string, onGo?: Go): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\[[^\]\n]+\]\([^)\s]+\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${n++}`;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t);
    if (link) {
      const to = safeAppPath(link[2]!);
      const label = link[1]!.replace(/\*\*/g, '');
      out.push(
        to ? (
          <Link key={k} className="tc-golink" to={to} onClick={onGo}>
            {label}
            <ArrowRight size={12} aria-hidden />
          </Link>
        ) : (
          <strong key={k}>{label}</strong>
        ),
      );
    } else if (t.startsWith('**'))
      out.push(<strong key={k}>{inline(t.slice(2, -2), k, onGo)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({
  text: raw,
  onNavigate,
  autoLink,
}: {
  text: string;
  onNavigate?: () => void;
  /**
   * Resposta do assistente: o nome de lugar em negrito ("**Conta › Uso de IA**") vira o botão
   * que leva até lá, só para o que a pessoa abre (as respostas antigas também ganham o link).
   */
  autoLink?: boolean;
}) {
  const access = useGuideAccess();
  const text = useMemo(() => {
    if (!autoLink || !access || OWN_APP_ROLES.has(access.role)) return raw;
    const can = (perms?: string[]) => !perms?.length || perms.some((p) => access.perms.includes(p));
    return linkPlaces(raw, can, { host: host() });
  }, [raw, autoLink, access]);
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      const k = `p${blocks.length}`;
      blocks.push(
        <p key={k}>
          {para.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {inline(l, `${k}-${i}`, onNavigate)}
            </Fragment>
          ))}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const k = `l${blocks.length}`;
      const items = list.items.map((it, i) => (
        <li key={i}>{inline(it, `${k}-${i}`, onNavigate)}</li>
      ));
      blocks.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>);
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((ul ?? ol)![1]!);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      blocks.push(
        <p key={`h${blocks.length}`}>
          <strong>{inline(h[1]!, `h${blocks.length}`, onNavigate)}</strong>
        </p>,
      );
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <>{blocks}</>;
}
