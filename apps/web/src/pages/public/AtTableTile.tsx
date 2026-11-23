import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router';
import { useToast } from '../../design-system';
import { WaiterArt } from './art';
import { useStore } from './context';
import { tableIdFromQr } from './store';

// A câmera só baixa quando o cliente toca (quem pede entrega nunca carrega o leitor).
const QrScanner = lazy(() =>
  import('../../features/QrScanner').then((m) => ({ default: m.QrScanner })),
);

/**
 * "Estou no restaurante" do cardápio online: o cliente (com a conta aberta ou não) lê o QR Code
 * da mesa pela câmera e o cardápio vira o da mesa: pede para ela, sem entrega nem retirada. Serve
 * para quem usa o app instalado, que não abre pelo QR lido na câmera do celular.
 */
export function AtTableTile() {
  const { menu, table, enterTable } = useStore();
  const [scan, setScan] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  if (table || !menu.store.tables || !menu.store.isOpen) return null;
  return (
    <>
      <button type="button" className="sf-tile sf-tile--attable" onClick={() => setScan(true)}>
        <WaiterArt className="sf-tile__art" />
        <span className="sf-tile__text">
          <strong>Está no restaurante?</strong>
          <small>Leia o QR Code da mesa</small>
        </span>
      </button>
      {scan && (
        <Suspense fallback={null}>
          <QrScanner
            open
            onClose={() => setScan(false)}
            title="Pedir na mesa"
            hint="Aponte para o QR Code colado na mesa. O pedido vai direto para ela."
            onResult={(text) => {
              setScan(false);
              const id = tableIdFromQr(text, window.location.host);
              if (!id) return toast('Este QR Code não é de uma mesa deste restaurante', 'danger');
              enterTable(id);
              navigate('/pedir', { replace: true });
              window.scrollTo({ top: 0 });
            }}
          />
        </Suspense>
      )}
    </>
  );
}
