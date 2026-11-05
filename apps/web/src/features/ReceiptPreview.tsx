import { Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Spinner, useToast } from '../design-system';
import { api } from '../lib/api';
import { paperCss } from '../lib/pos-device';

export type ReceiptTarget = {
  kind: 'order' | 'tab';
  id: string;
  /** "delivery": via de entrega do pedido (vai com o motoboy). Padrão: conferência. */
  doc?: 'receipt' | 'delivery';
};

/** Imprime um texto de bobina pelo navegador (sem o app de impressão). */
function browserPrint(text: string) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  const pre = doc.createElement('pre');
  pre.textContent = text;
  const style = doc.createElement('style');
  // Largura da bobina deste aparelho (58 mm na maquininha, 80 mm no caixa): Ajustes › Este aparelho.
  const paper = paperCss();
  style.textContent = `${paper.page}body{margin:0}pre{font:${paper.font}/1.3 ui-monospace,Menlo,Consolas,monospace;white-space:pre;margin:0}`;
  doc.head.appendChild(style);
  doc.body.appendChild(pre);
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 1000);
}

/**
 * Comprovante de fechamento (conferência de conta): mostra como vai sair, no modelo do
 * restaurante (Impressão > Modelos), e imprime na térmica do caixa ou pelo navegador.
 */
export function ReceiptPreview({
  target,
  onClose,
}: {
  target: ReceiptTarget | null;
  onClose(): void;
}) {
  const toast = useToast();
  const [data, setData] = useState<{ text: string; agent: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = target ? `/${target.kind === 'tab' ? 'tabs' : 'orders'}/${target.id}` : null;
  const delivery = target?.kind === 'order' && target.doc === 'delivery';

  useEffect(() => {
    setData(null);
    setError(null);
    if (!base) return;
    api<{ text: string; agent: boolean }>(`${base}/${delivery ? 'delivery-slip' : 'receipt'}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [base, delivery]);

  async function print() {
    if (!data || !target) return;
    if (!data.agent) {
      browserPrint(data.text);
      return;
    }
    setBusy(true);
    try {
      if (target.kind === 'tab') await api(`${base}/print`, { method: 'POST' });
      else
        await api(`${base}/print`, {
          method: 'POST',
          json: { kind: delivery ? 'delivery' : 'receipt' },
        });
      toast('Enviado para a impressora do caixa', 'success');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={delivery ? 'Via de entrega' : 'Comprovante de fechamento'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button icon={<Printer size={16} />} loading={busy} disabled={!data} onClick={print}>
            Imprimir
          </Button>
        </>
      }
    >
      <p className="cm-hint">
        Pré-visualização, nada foi impresso ainda.{' '}
        {data && !data.agent
          ? 'Sem o app de impressão ligado, o Imprimir usa a impressora do navegador.'
          : 'O formato vem de Impressão > Modelos de impressão.'}
      </p>
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : !data ? (
        <Spinner />
      ) : (
        <pre className="receipt-paper" aria-label="Comprovante">
          {data.text}
        </pre>
      )}
    </Modal>
  );
}
