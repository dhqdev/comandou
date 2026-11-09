import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Spinner } from '../design-system';
import { api } from '../lib/api';
import { staffTableLink } from '../lib/staff-app';

/**
 * QR Code colado na mesa (/mesa/<id>), lido pela câmera do celular:
 * - cliente (sem login da equipe): abre o cardápio já com a mesa escolhida, e o pedido vai para a
 *   comanda dela;
 * - equipe logada: abre a mesa no app que o aparelho usa (garçom no app do garçom, os outros no
 *   Salão do painel), com a comanda aberta ou o pedido novo da mesa livre.
 * Dentro do app, "Escanear mesa" lê o mesmo QR sem passar por aqui (table-state.ts).
 */
export function TableLinkPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    let alive = true;
    api<{ user: { role: string } }>('/auth/me')
      .then((me) => alive && navigate(staffTableLink(id, me.user?.role), { replace: true }))
      .catch(() => alive && navigate(`/pedir?mesa=${encodeURIComponent(id)}`, { replace: true }));
    return () => {
      alive = false;
    };
  }, [id, navigate]);
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100dvh' }}>
      <Spinner label="Abrindo a mesa" />
    </div>
  );
}
