import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { Dot, type Level } from '../ui';

/** O pedaço de GET /platform/credentials que as outras telas usam. */
export interface CredentialItem {
  id: string;
  configured: boolean | null;
  required: boolean;
  detail?: string;
  last4?: string;
  unreadable?: boolean;
}

/** Nome curto de cada chave do painel (o texto completo fica em Credenciais). */
const NAMES: Record<string, string> = {
  focus_master: 'Focus NFe · Token Master',
  openrouter_clients: 'OpenRouter · chave dos restaurantes',
  openrouter_owner: 'OpenRouter · sua chave',
  openrouter_site: 'OpenRouter · chave dos sites',
  resend: 'Resend',
  asaas: 'Asaas',
  pagbank: 'PagBank',
  backblaze: 'Backblaze B2',
  github_pipeline: 'GitHub · token da esteira',
};

// Uma tela com duas chaves (Tokens de IA) faz um pedido só.
let cache: { at: number; p: Promise<CredentialItem[]> } | null = null;
function loadItems(): Promise<CredentialItem[]> {
  if (!cache || Date.now() - cache.at > 5000) {
    const p = api<{ items: CredentialItem[] }>('/platform/credentials').then((o) => o.items);
    p.catch(() => (cache = null));
    cache = { at: Date.now(), p };
  }
  return cache.p;
}

/**
 * Nas telas de cada assunto, só diz qual chave está em uso (nome, ambiente e o final dela).
 * Cadastrar, trocar e testar é em Super Admin › Credenciais. `ids` em ordem: a primeira salva
 * é a que vale (ex.: sites usam a chave deles; sem ela, a sua; sem ela, a dos restaurantes).
 */
export function KeyInUse({
  ids,
  label = 'Chave em uso',
  extra,
  extraLevel,
}: {
  ids: string[];
  label?: string;
  /** Um dado a mais da tela (ex.: a conta conectada, o webhook). */
  extra?: ReactNode;
  extraLevel?: Level;
}) {
  const [items, setItems] = useState<CredentialItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadItems()
      .then((i) => alive && setItems(i))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);
  if (failed) return null;
  if (!items) return <p className="adm-keyuse adm-keyuse--loading">{label}: …</p>;

  const byId = new Map(items.map((i) => [i.id, i]));
  const used = ids.map((id) => byId.get(id)).find((i) => i?.configured);
  const first = ids[0]!;

  if (!used) {
    return (
      <p className="adm-keyuse">
        <Dot level={byId.get(first)?.required ? 'bad' : 'off'} />
        <span className="adm-keyuse__label">{label}:</span>
        <span>nenhuma</span>
        <Link to={`/credenciais#cred-${first}`} className="adm-keyuse__go">
          Cadastrar em Credenciais
        </Link>
      </p>
    );
  }
  const facts = [
    used.detail,
    used.unreadable ? 'não abre com a chave mestra, cole de novo' : null,
    used.last4 ? `termina em ${used.last4}` : null,
  ].filter(Boolean) as string[];
  const level: Level = used.unreadable ? 'bad' : (extraLevel ?? 'ok');
  return (
    <p className="adm-keyuse">
      <Dot level={level} />
      <span className="adm-keyuse__label">{label}:</span>
      <Link to={`/credenciais#cred-${used.id}`} className="adm-keyuse__name">
        {NAMES[used.id] ?? used.id}
      </Link>
      {facts.map((f) => (
        <span key={f} className="adm-keyuse__fact">
          {f}
        </span>
      ))}
      {extra && <span className="adm-keyuse__fact">{extra}</span>}
      {used.id !== first && (
        <span className="adm-keyuse__fact">sem a {NAMES[first]?.split(' · ')[1] ?? first}</span>
      )}
    </p>
  );
}
