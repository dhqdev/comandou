import { PIX_KEY_TYPE_LABELS, type PixKeyType } from '@comandou/shared';
import { Check, Copy, FileText, ImageUp, Loader2, RefreshCw } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { copyText, PixQr } from '../../features/PixQr';
import { ApiError } from '../../lib/api';
import { brl } from '../../lib/money';
import './pixpay.css';

const MAX_SIDE = 2000;
const MAX_INPUT = 30 * 1024 * 1024;
const MAX_PDF = 3 * 1024 * 1024;

/** Comprovante pronto para enviar: foto já reduzida no aparelho (WebP) ou o PDF do banco. */
export interface ReceiptFile {
  blob: Blob;
  name: string;
  /** Prévia da foto (object URL); PDF não tem. */
  preview: string | null;
  width?: number;
  height?: number;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Prepara o comprovante: PDF vai como está (até 3 MB); foto ou print é reduzido para o lado maior
 * de 2000 px (o texto continua legível) e vira WebP, então um print de 3 MB vira ~200 KB.
 */
export async function prepareReceipt(file: File): Promise<ReceiptFile> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    if (file.size > MAX_PDF)
      throw new Error('PDF maior que 3 MB. Mande um print da tela do comprovante.');
    return { blob: new Blob([file], { type: 'application/pdf' }), name: file.name, preview: null };
  }
  if (!file.type.startsWith('image/'))
    throw new Error('Escolha a foto (print) ou o PDF do comprovante');
  if (file.size > MAX_INPUT) throw new Error('Arquivo muito grande');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Não foi possível ler esta imagem. Tente um print (JPG ou PNG).');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Seu navegador não conseguiu preparar a imagem');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  let blob = await toBlob(canvas, 'image/webp', 0.88);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.88);
  if (!blob) throw new Error('Não foi possível preparar a imagem');
  return { blob, name: file.name, preview: URL.createObjectURL(blob), width: w, height: h };
}

/** Manda o comprovante do pedido (rota do link do pedido ou da conta do cliente). */
export async function sendReceipt(path: string, r: ReceiptFile) {
  const qs = r.width && r.height ? `?w=${r.width}&h=${r.height}` : '';
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}${qs}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': r.blob.type,
        'X-Comandou-Request': '1',
        Accept: 'application/json',
      },
      body: r.blob,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão. Toque em enviar de novo.');
  }
  const body = (await res.json().catch(() => undefined)) as { message?: string } | undefined;
  if (!res.ok)
    throw new ApiError(
      res.status,
      res.status === 413
        ? 'Arquivo grande demais (até 3 MB)'
        : (body?.message ?? `Erro ${res.status}`),
    );
  return body as { status: 'submitted'; at: string };
}

/** Escolher o comprovante: mostra a prévia da foto (ou o nome do PDF) e deixa trocar. */
export function ReceiptPicker({
  value,
  onChange,
  invalid,
  disabled,
}: {
  value: ReceiptFile | null;
  onChange(r: ReceiptFile | null): void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A prévia (object URL) sai da memória quando troca ou some.
  useEffect(
    () => () => {
      if (value?.preview) URL.revokeObjectURL(value.preview);
    },
    [value],
  );

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await prepareReceipt(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div
      className="pixpay__file"
      data-invalid={invalid || undefined}
      data-has={!!value || undefined}
    >
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/*,application/pdf"
        className="pixpay__input"
        disabled={disabled || busy}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      {value ? (
        <div className="pixpay__chosen">
          {value.preview ? (
            <img src={value.preview} alt="Comprovante anexado" className="pixpay__thumb" />
          ) : (
            <span className="pixpay__thumb pixpay__thumb--pdf" aria-hidden>
              <FileText size={22} />
            </span>
          )}
          <span className="pixpay__chosen-text">
            <strong>
              <Check size={15} aria-hidden /> Comprovante anexado
            </strong>
            <small>{value.name}</small>
          </span>
          <label htmlFor={id} className="link pixpay__swap">
            <RefreshCw size={14} aria-hidden /> Trocar
          </label>
        </div>
      ) : (
        <label htmlFor={id} className="pixpay__drop">
          {busy ? (
            <Loader2 size={20} className="pixpay__spin" aria-hidden />
          ) : (
            <ImageUp size={20} aria-hidden />
          )}
          <span>
            <strong>{busy ? 'Preparando…' : 'Anexar comprovante'}</strong>
            <small>Print da tela ou PDF do app do banco</small>
          </span>
        </label>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Pagar com Pix: valor, botão de copiar o código (o mais usado no celular), o QR Code (para pagar
 * com outro aparelho) e para quem vai o dinheiro. Sem `code`, o valor ainda não fechou.
 */
export function PixPay({
  code,
  amount,
  payee,
  pending,
  children,
}: {
  code: string | null;
  amount: string;
  payee: { name: string; keyType: PixKeyType; keyLabel: string } | null;
  /** Por que o código ainda não aparece (ex.: falta a taxa de entrega). */
  pending?: string;
  /** O comprovante (escolher e enviar) vem embaixo. */
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => setCopied(false), [code]);

  async function copy() {
    if (!code) return;
    if (await copyText(code)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } else {
      // Sem área de transferência (navegador antigo): seleciona para copiar na mão.
      field.current?.focus();
      field.current?.select();
    }
  }

  return (
    <div className="pixpay">
      {code ? (
        <div className="pixpay__pay">
          <PixQr code={code} size={168} className="pixpay__qr" label="QR Code do Pix do pedido" />
          <div className="pixpay__body">
            <p className="pixpay__amount">
              Pague <strong>{brl(amount)}</strong> com Pix
            </p>
            <ol className="pixpay__steps">
              <li>Copie o código e pague no app do seu banco (ou leia o QR Code).</li>
              <li>Anexe o print do comprovante aqui embaixo.</li>
            </ol>
            <button
              type="button"
              className="btn-line pixpay__copy"
              data-done={copied || undefined}
              onClick={() => void copy()}
            >
              {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
              {copied ? 'Código copiado' : 'Copiar código Pix'}
            </button>
            <input
              ref={field}
              className="pixpay__code"
              readOnly
              value={code}
              aria-label="Pix copia e cola"
              onFocus={(e) => e.currentTarget.select()}
            />
            {payee && (
              <small className="pixpay__payee">
                Para <strong>{payee.name}</strong> · {PIX_KEY_TYPE_LABELS[payee.keyType]}{' '}
                {payee.keyLabel}
              </small>
            )}
          </div>
        </div>
      ) : (
        <p className="form-hint pixpay__pending">{pending ?? 'O código Pix aparece aqui.'}</p>
      )}
      {children}
    </div>
  );
}
