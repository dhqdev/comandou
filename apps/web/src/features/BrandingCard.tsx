import { Check, Palette, RotateCcw } from 'lucide-react';
import { CSSProperties, useEffect, useMemo, useState } from 'react';
import {
  brandTokens,
  BRAND_EVENT,
  Branding,
  Button,
  Card,
  COMANDOU_ACCENT,
  COMANDOU_BRAND,
  CornerStyle,
  FontStyle,
  isHex,
  onColor,
  Segmented,
  useTheme,
  useToast,
} from '../design-system';
import { api } from '../lib/api';
import { mediaUrl } from '../lib/media';
import type { StoreSettings } from '../lib/types';
import { ImagePicker } from './ImagePicker';
import './branding-card.css';

const BRAND_PRESETS = [
  { name: 'Laranja Comandou', hex: COMANDOU_BRAND },
  { name: 'Vermelho', hex: '#d62828' },
  { name: 'Vinho', hex: '#8c1c3a' },
  { name: 'Rosa', hex: '#e0457b' },
  { name: 'Roxo', hex: '#7b4ae2' },
  { name: 'Azul', hex: '#1f6feb' },
  { name: 'Turquesa', hex: '#0f9d9a' },
  { name: 'Verde', hex: '#2b9348' },
  { name: 'Oliva', hex: '#6b8e23' },
  { name: 'Café', hex: '#8b5a2b' },
  { name: 'Grafite', hex: '#2f3437' },
];
const ACCENT_PRESETS = [
  { name: 'Mostarda', hex: COMANDOU_ACCENT },
  { name: 'Amarelo', hex: '#ffd23f' },
  { name: 'Limão', hex: '#a3d633' },
  { name: 'Coral', hex: '#ff6b5a' },
  { name: 'Rosa', hex: '#f472b6' },
  { name: 'Céu', hex: '#38bdf8' },
  { name: 'Lilás', hex: '#b197fc' },
];

type Draft = Pick<StoreSettings, 'brandColor' | 'accentColor' | 'fontStyle' | 'cornerStyle'>;
const draftOf = (s: StoreSettings): Draft => ({
  brandColor: s.brandColor,
  accentColor: s.accentColor,
  fontStyle: s.fontStyle,
  cornerStyle: s.cornerStyle,
});
const same = (a: Draft, b: Draft) =>
  a.brandColor === b.brandColor &&
  a.accentColor === b.accentColor &&
  a.fontStyle === b.fontStyle &&
  a.cornerStyle === b.cornerStyle;

/** Identidade para a prévia e para o restante do sistema. */
export const brandingFrom = (s: StoreSettings, d: Draft = draftOf(s)): Branding => ({
  ...d,
  faviconUrl: mediaUrl(s.faviconImageId ?? s.logoImageId),
  logoUrl: mediaUrl(s.logoImageId),
  staffApp: s.brandStaffApp,
});

/** Bolinhas de cor + seletor livre (#rrggbb). `null` = cor padrão do Comandou. */
function ColorChoice({
  label,
  value,
  presets,
  fallback,
  disabled,
  onChange,
}: {
  label: string;
  value: string | null;
  presets: { name: string; hex: string }[];
  fallback: string;
  disabled?: boolean;
  onChange(v: string | null): void;
}) {
  const current = value ?? fallback;
  const [text, setText] = useState(current);
  useEffect(() => setText(current), [current]);
  const custom = !presets.some((p) => p.hex === current);
  return (
    <fieldset className="bc-color" disabled={disabled}>
      <legend className="cm-label">{label}</legend>
      <div className="bc-swatches" role="radiogroup" aria-label={label}>
        {presets.map((p) => (
          <button
            key={p.hex}
            type="button"
            role="radio"
            aria-checked={p.hex === current}
            className="bc-swatch"
            title={p.name}
            aria-label={p.name}
            style={{ '--bc-c': p.hex, '--bc-on': onColor(p.hex) } as CSSProperties}
            onClick={() => onChange(p.hex === fallback ? null : p.hex)}
          >
            {p.hex === current && <Check size={16} aria-hidden />}
          </button>
        ))}
        <label
          className="bc-swatch bc-swatch--custom"
          title="Outra cor"
          data-on={custom || undefined}
          style={{ '--bc-c': current, '--bc-on': onColor(current) } as CSSProperties}
        >
          <Palette size={16} aria-hidden />
          <input
            type="color"
            aria-label={`${label}: outra cor`}
            value={current}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
          />
        </label>
        <input
          className="cm-input bc-hex"
          aria-label={`${label} em hexadecimal`}
          maxLength={7}
          spellCheck={false}
          value={text}
          onChange={(e) => {
            const v = e.target.value.trim().toLowerCase();
            setText(v);
            const hex = v.startsWith('#') ? v : `#${v}`;
            if (isHex(hex)) onChange(hex === fallback ? null : hex);
          }}
          onBlur={() => setText(current)}
        />
      </div>
    </fieldset>
  );
}

/** Amostra com os tons gerados: é assim que botões, chips, selos e links vão ficar. */
function Sample({ draft }: { draft: Draft }) {
  const [theme] = useTheme();
  const style = useMemo(() => {
    const vars: Record<string, string> = {};
    if (draft.brandColor) {
      const t = brandTokens(draft.brandColor);
      Object.assign(vars, t.light, theme === 'dark' ? t.dark : {});
    }
    if (draft.accentColor) {
      vars['--cm-accent-500'] = draft.accentColor;
      vars['--cm-on-accent'] = onColor(draft.accentColor);
    }
    return vars as CSSProperties;
  }, [draft.brandColor, draft.accentColor, theme]);
  return (
    <div
      className="bc-sample"
      style={style}
      data-corner={draft.cornerStyle}
      data-font={draft.fontStyle}
      aria-hidden
    >
      <span className="bc-sample__btn">Adicionar · R$ 32,90</span>
      <span className="bc-sample__chip">Pizzas</span>
      <span className="bc-sample__tag">Mais vendido</span>
      <span className="bc-sample__link">Ver sacola</span>
    </div>
  );
}

/**
 * Identidade visual da loja: cores, fonte, cantos e ícone. Tudo nasce das duas cores; os tons
 * claros e escuros e a cor do texto por cima são calculados para continuar legíveis.
 */
export function BrandingCard({
  settings,
  canManage,
  onSaved,
  onDraft,
}: {
  settings: StoreSettings;
  canManage: boolean;
  onSaved(s: StoreSettings): void;
  /** Mostra a identidade ainda não salva na prévia do celular. */
  onDraft(b: Branding | null): void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftOf(settings));
  const [busy, setBusy] = useState(false);
  const saved = draftOf(settings);
  const dirty = !same(draft, saved);

  useEffect(() => {
    onDraft(dirty ? brandingFrom(settings, draft) : null);
  }, [draft, dirty, settings, onDraft]);

  async function save(patch: Partial<StoreSettings>, ok: string) {
    setBusy(true);
    try {
      const s = await api<StoreSettings>('/store/settings', { method: 'PATCH', json: patch });
      onSaved(s);
      if ('brandColor' in patch) setDraft(draftOf(s));
      window.dispatchEvent(new Event(BRAND_EVENT));
      toast(ok, 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const isDefault =
    !draft.brandColor &&
    !draft.accentColor &&
    draft.fontStyle === 'padrao' &&
    draft.cornerStyle === 'padrao';

  return (
    <Card
      title="Cores e identidade"
      actions={
        canManage && !isDefault ? (
          <Button
            variant="ghost"
            icon={<RotateCcw size={15} />}
            disabled={busy}
            onClick={() =>
              set({
                brandColor: null,
                accentColor: null,
                fontStyle: 'padrao',
                cornerStyle: 'padrao',
              })
            }
          >
            Voltar ao padrão
          </Button>
        ) : undefined
      }
    >
      <div className="bc">
        <ColorChoice
          label="Cor principal"
          value={draft.brandColor}
          presets={BRAND_PRESETS}
          fallback={COMANDOU_BRAND}
          disabled={!canManage}
          onChange={(brandColor) => set({ brandColor })}
        />
        <ColorChoice
          label="Cor de destaque (selos e estrelas)"
          value={draft.accentColor}
          presets={ACCENT_PRESETS}
          fallback={COMANDOU_ACCENT}
          disabled={!canManage}
          onChange={(accentColor) => set({ accentColor })}
        />
        <Sample draft={draft} />
        <p className="cm-hint bc-hint">
          Botões, abas, preços, links e destaques do cardápio mudam juntos. Os tons claros, escuros
          e a cor do texto por cima são ajustados sozinhos para continuar fáceis de ler, no tema
          claro e no escuro.
        </p>
        <div className="bc-row">
          <div className="bc-field">
            <span className="cm-label">Letra do cardápio</span>
            <Segmented<FontStyle>
              label="Letra do cardápio"
              value={draft.fontStyle}
              onChange={(fontStyle) => canManage && set({ fontStyle })}
              options={[
                { value: 'padrao', label: 'Moderna' },
                { value: 'sistema', label: 'Do celular' },
                { value: 'classica', label: 'Clássica' },
                { value: 'arredondada', label: 'Arredondada' },
              ]}
            />
          </div>
          <div className="bc-field">
            <span className="cm-label">Cantos</span>
            <Segmented<CornerStyle>
              label="Cantos"
              value={draft.cornerStyle}
              onChange={(cornerStyle) => canManage && set({ cornerStyle })}
              options={[
                { value: 'reto', label: 'Retos' },
                { value: 'padrao', label: 'Suaves' },
                { value: 'arredondado', label: 'Redondos' },
              ]}
            />
          </div>
        </div>
        {canManage && (
          <div className="bc-actions">
            <Button
              loading={busy}
              disabled={!dirty}
              onClick={() => save(draft, 'Identidade salva: o cardápio já está com as novas cores')}
            >
              Salvar identidade
            </Button>
            {dirty && (
              <Button variant="ghost" disabled={busy} onClick={() => setDraft(saved)}>
                Descartar
              </Button>
            )}
            {dirty && (
              <small className="bc-muted">A prévia ao lado já mostra como vai ficar.</small>
            )}
          </div>
        )}

        <hr className="bc-sep" />

        <div className="bc-favicon">
          <ImagePicker
            label="Ícone"
            width={72}
            value={settings.faviconImageId}
            disabled={!canManage || busy}
            onChange={(id) =>
              save({ faviconImageId: id }, id ? 'Ícone salvo' : 'Ícone removido: vale o logo')
            }
          />
          <div>
            <strong>Ícone da aba e do atalho (favicon)</strong>
            <p className="cm-hint">
              Aparece na aba do navegador e quando o cliente adiciona o cardápio à tela inicial. Use
              uma imagem quadrada e simples. Sem ícone, usamos o logo.
            </p>
          </div>
        </div>

        <label className="os-toggle">
          <span>
            <strong>Usar as cores também no sistema da equipe</strong>
            <small>PDV, pedidos, cozinha, cardápio e as demais telas ganham a cor da loja.</small>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              checked={settings.brandStaffApp}
              disabled={!canManage || busy}
              onChange={(e) =>
                save(
                  { brandStaffApp: e.target.checked },
                  e.target.checked
                    ? 'O sistema da equipe agora usa as cores da loja'
                    : 'O sistema da equipe voltou às cores do Comandou',
                )
              }
            />
            <span className="switch__track" aria-hidden />
          </span>
        </label>
      </div>
    </Card>
  );
}
