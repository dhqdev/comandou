import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal } from '../design-system';
import './qr-scanner.css';

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (o: { formats: string[] }) => Detector;
  }
}

/**
 * Leitor de QR Code pela câmera do celular. Usa o leitor nativo do navegador quando existe
 * (Chrome/Android) e, no iPhone, a biblioteca jsQR (carregada só quando a câmera abre).
 */
export function QrScanner({
  open,
  onClose,
  onResult,
  title = 'Escanear QR Code',
  hint,
}: {
  open: boolean;
  onClose(): void;
  onResult(text: string): void;
  title?: string;
  hint?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onResult);
  done.current = onResult;

  useEffect(() => {
    if (!open) return;
    setError(null);
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este navegador não abre a câmera. Use o endereço com https ou digite a mesa.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch {
        setError('Permita o acesso à câmera para escanear o QR Code da mesa.');
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      const native = window.BarcodeDetector
        ? new window.BarcodeDetector({ formats: ['qr_code'] })
        : null;
      const jsQR = native ? null : (await import('jsqr')).default;
      const tick = async () => {
        if (stopped) return;
        try {
          if (v.readyState >= 2 && v.videoWidth) {
            let text: string | undefined;
            if (native) {
              text = (await native.detect(v))[0]?.rawValue;
            } else if (jsQR && ctx) {
              // Reduz o quadro: mais rápido e suficiente para um QR de mesa.
              const scale = Math.min(1, 640 / v.videoWidth);
              canvas.width = Math.round(v.videoWidth * scale);
              canvas.height = Math.round(v.videoHeight * scale);
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              text = jsQR(img.data, img.width, img.height, {
                inversionAttempts: 'dontInvert',
              })?.data;
            }
            if (text) {
              stopped = true;
              navigator.vibrate?.(60);
              done.current(text);
              return;
            }
          }
        } catch {
          /* quadro ruim: tenta o próximo */
        }
        timer = setTimeout(tick, 200);
      };
      void tick();
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="qr-scan">
        {error ? (
          <Alert tone="warning">{error}</Alert>
        ) : (
          <div className="qr-scan__view">
            <video ref={video} muted playsInline aria-label="Imagem da câmera" />
            <span className="qr-scan__frame" aria-hidden />
          </div>
        )}
        {hint && <p className="cm-hint">{hint}</p>}
        <Button variant="secondary" block onClick={onClose}>
          Fechar
        </Button>
      </div>
    </Modal>
  );
}
