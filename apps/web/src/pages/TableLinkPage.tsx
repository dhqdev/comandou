import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Spinner } from '../design-system';
import { api } from '../lib/api';

/**
 * QR Code colado na mesa (/mesa/<id>). Quem é da equipe (logado) cai direto na mesa, no Salão;
 * o cliente que aponta a câmera vai para o cardápio online.
 */
export function TableLinkPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    let alive = true;
    api('/auth/me')
      .then(() => alive && navigate(`/mesas?mesa=${encodeURIComponent(id)}`, { replace: true }))
      .catch(() => alive && navigate('/pedir', { replace: true }));
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
