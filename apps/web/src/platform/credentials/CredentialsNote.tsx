import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Dot, type Level } from '../ui';

/**
 * Aviso curto nas telas de cada assunto: a chave daquele serviço agora se cadastra em
 * Super Admin › Credenciais (com o passo a passo).
 */
export function CredentialsNote({
  id,
  level,
  children,
}: {
  /** id da credencial no catálogo (vira a âncora #cred-<id>). */
  id: string;
  level: Level;
  children: ReactNode;
}) {
  return (
    <p className="adm-cred-note">
      <Dot level={level} />
      <span>{children}</span>
      <Link to={`/credenciais#cred-${id}`}>Abrir em Credenciais</Link>
    </p>
  );
}
