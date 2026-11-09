import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** QR Code do Pix copia e cola (gerado no próprio aparelho, sem enviar o código a ninguém). */
export function PixQr({
  code,
  size = 220,
  className,
  label = 'QR Code do Pix',
}: {
  code: string;
  size?: number;
  className?: string;
  label?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(code, { margin: 1, width: size * 2, errorCorrectionLevel: 'M' })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [code, size]);
  return (
    <span
      className={className ? `pix-qr ${className}` : 'pix-qr'}
      style={{ width: size, height: size }}
    >
      {src ? <img src={src} alt={label} width={size} height={size} /> : null}
    </span>
  );
}

/** Copia o texto; sem acesso à área de transferência, seleciona o campo para copiar na mão. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
