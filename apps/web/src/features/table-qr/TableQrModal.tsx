import {
  BookOpen,
  CakeSlice,
  Camera,
  Coffee,
  Croissant,
  CupSoda,
  Hamburger,
  IceCreamCone,
  Pizza,
  Printer,
  Salad,
  Sandwich,
  Soup,
  Utensils,
  Wine,
  type LucideIcon,
} from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../app/auth';
import {
  BRAND_CACHED_EVENT,
  brandTokens,
  Button,
  cachedBranding,
  COMANDOU_BRAND,
  isHex,
  Modal,
  onColor,
  Segmented,
  Skeleton,
} from '../../design-system';
import { printDocument } from '../../lib/print-doc';
import type { DiningTable } from '../../lib/types';
import { qrArtSvg } from './qr-art';
import { sheetCss, TABLE_QR_CSS, type QrCardSize } from './table-qr-css';

export type QrCardStyle = 'moderno' | 'colorido' | 'classico';

export const tableLink = (id: string) => `${window.location.origin}/mesa/${id}`;

const PREFS = 'cm-table-qr';
interface Prefs {
  style: QrCardStyle;
  size: QrCardSize;
  logo: boolean;
}
const DEFAULT_PREFS: Prefs = { style: 'moderno', size: 'grande', logo: true };
function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Prefs) };
  } catch {
    return DEFAULT_PREFS;
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS, JSON.stringify(p));
  } catch {
    /* modo privado: só não lembra */
  }
}

/** Cores do cartão a partir da cor da marca (sempre com contraste para o leitor de QR). */
export function cardColors(brand: string | null | undefined) {
  const t = brandTokens(isHex(brand) ? brand : COMANDOU_BRAND).light;
  const bg = t['--cm-brand-600']!;
  return {
    ink: t['--cm-brand-700']!, // ≥ 4,5:1 sobre o branco
    bg,
    on: onColor(bg),
    soft: t['--cm-brand-200']!,
  };
}

/** Logo como data: (a folha imprime na hora, sem esperar a imagem chegar). */
async function inlineImage(url: string): Promise<string> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return url;
    const blob = await res.blob();
    return await new Promise((ok) => {
      const r = new FileReader();
      r.onload = () => ok(typeof r.result === 'string' ? r.result : url);
      r.onerror = () => ok(url);
      r.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}

/** Desenhos de comida espalhados no fundo (posição em %, giro em graus). */
const DECO: [LucideIcon, number, number, number][] = [
  [Pizza, 4, 3, -18],
  [Coffee, 82, 4, 14],
  [Croissant, 3, 30, 12],
  [Wine, 86, 27, -10],
  [IceCreamCone, 4, 56, -8],
  [Hamburger, 85, 54, 16],
  [Soup, 2, 92, 10],
  [CupSoda, 88, 92, -14],
  [Salad, 3, 66, 6],
  [CakeSlice, 86, 66, -12],
  [Sandwich, 44, 1, 8],
];

export function QrCard({
  table,
  svg,
  style,
  colors,
  storeName,
  logo,
}: {
  table: DiningTable;
  svg: string;
  style: QrCardStyle;
  colors: ReturnType<typeof cardColors>;
  storeName: string;
  logo: string | null;
}) {
  const vars = {
    '--q-brand': style === 'classico' ? '#111' : colors.ink,
    '--q-num': style === 'colorido' ? colors.on : style === 'classico' ? '#111' : colors.ink,
    '--q-bg': colors.bg,
    '--q-on': colors.on,
    '--q-soft': colors.soft,
  } as CSSProperties;
  return (
    <article className={`tqr tqr--${style}`} style={vars} aria-label={`Mesa ${table.label}`}>
      <div className="tqr__deco" aria-hidden>
        {DECO.map(([Icon, x, y, rot], i) => (
          <Icon key={i} style={{ left: `${x}%`, top: `${y}%`, transform: `rotate(${rot}deg)` }} />
        ))}
      </div>
      <header className="tqr__head">
        {logo && style !== 'classico' && <img className="tqr__logo" src={logo} alt="" />}
        {storeName && <span className="tqr__store">{storeName}</span>}
      </header>
      <div className="tqr__table" data-long={table.label.length > 4 || undefined}>
        <span>Mesa</span>
        <strong>{table.label}</strong>
      </div>
      <div className="tqr__code" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="tqr__cta">
        <b>Aponte a câmera do celular</b>
        <span>Veja o cardápio e peça daqui mesmo</span>
      </p>
      <ol className="tqr__steps">
        <li>
          <Camera aria-hidden />
          Aponte
        </li>
        <li>
          <BookOpen aria-hidden />
          Escolha
        </li>
        <li>
          <Utensils aria-hidden />
          Peça
        </li>
      </ol>
    </article>
  );
}

/** Folha para imprimir: um cartão por mesa. Cliente que lê abre o cardápio; a equipe abre a mesa. */
export function TableQrModal({
  open,
  onClose,
  tables,
}: {
  open: boolean;
  onClose(): void;
  tables: DiningTable[];
}) {
  const { me } = useAuth();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [branding, setBranding] = useState(cachedBranding);
  const [logo, setLogo] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, string> | null>(null);
  const set = (p: Partial<Prefs>) =>
    setPrefs((v) => {
      const next = { ...v, ...p };
      savePrefs(next);
      return next;
    });

  useEffect(() => {
    const sync = () => setBranding(cachedBranding());
    window.addEventListener(BRAND_CACHED_EVENT, sync);
    return () => window.removeEventListener(BRAND_CACHED_EVENT, sync);
  }, []);
  const logoUrl = branding?.logoUrl || branding?.faviconUrl || null;
  useEffect(() => {
    if (!open || !logoUrl) return setLogo(null);
    let alive = true;
    void inlineImage(logoUrl).then((u) => alive && setLogo(u));
    return () => {
      alive = false;
    };
  }, [open, logoUrl]);

  const colors = useMemo(() => cardColors(branding?.brandColor), [branding?.brandColor]);
  const centerLogo = prefs.logo && prefs.style !== 'classico' ? logo : null;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setCodes(null);
    void (async () => {
      const QRCode = (await import('qrcode')).default;
      const out: Record<string, string> = {};
      for (const t of tables) {
        const m = QRCode.create(tableLink(t.id), {
          errorCorrectionLevel: centerLogo ? 'H' : 'M',
        }).modules;
        out[t.id] = qrArtSvg(m, {
          color: prefs.style === 'classico' ? '#111111' : colors.ink,
          shape: prefs.style === 'classico' ? 'square' : 'dots',
          logo: centerLogo,
          title: `QR Code da mesa ${t.label}`,
        });
      }
      if (alive) setCodes(out);
    })();
    return () => {
      alive = false;
    };
  }, [open, tables, prefs.style, centerLogo, colors.ink]);

  const storeName = me?.tenant.name ?? '';
  function print() {
    const sheet = document.querySelector('.tqr-sheet');
    if (!sheet) return;
    printDocument({ title: 'QR das mesas', html: sheet.outerHTML, css: sheetCss(prefs.size) });
  }

  return (
    <Modal open={open} onClose={onClose} title="QR Code das mesas" size="xl">
      <style>{TABLE_QR_CSS}</style>
      <p className="cm-hint" style={{ marginTop: 0 }}>
        Imprima e cole um em cada mesa. O cliente aponta a câmera e o cardápio já abre nessa mesa: o
        pedido dele cai na comanda dela (precisa da loja online ligada). O garçom usa Escanear mesa
        no app, ou a câmera do celular em que está logado, e abre a comanda. A cor e a logo vêm da
        Loja online.
      </p>
      <div className="tqr-opts">
        <Segmented
          label="Estilo do cartão"
          value={prefs.style}
          onChange={(style) => set({ style })}
          options={[
            { value: 'moderno', label: 'Moderno' },
            { value: 'colorido', label: 'Colorido' },
            { value: 'classico', label: 'Clássico' },
          ]}
        />
        <Segmented
          label="Tamanho na folha"
          value={prefs.size}
          onChange={(size) => set({ size })}
          options={[
            { value: 'grande', label: '4 por folha' },
            { value: 'pequeno', label: '9 por folha' },
          ]}
        />
        {logo && prefs.style !== 'classico' && (
          <Segmented
            label="Logo no meio do QR"
            value={prefs.logo ? 'sim' : 'nao'}
            onChange={(v) => set({ logo: v === 'sim' })}
            options={[
              { value: 'sim', label: 'Logo no meio' },
              { value: 'nao', label: 'Sem logo' },
            ]}
          />
        )}
      </div>
      <div className="tqr-sheet tqr-preview">
        {tables.map((t) =>
          codes?.[t.id] ? (
            <QrCard
              key={t.id}
              table={t}
              svg={codes[t.id]!}
              style={prefs.style}
              colors={colors}
              storeName={storeName}
              logo={logo}
            />
          ) : (
            <div key={t.id} className="tqr-wait">
              <Skeleton variant="qr" />
            </div>
          ),
        )}
      </div>
      <div className="actions-row">
        <Button variant="primary" icon={<Printer size={16} />} onClick={print} disabled={!codes}>
          Imprimir
        </Button>
      </div>
    </Modal>
  );
}
