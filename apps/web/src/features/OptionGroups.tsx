import { toCents } from '@pedemais/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  TextField,
  useToast,
} from '../design-system';
import { api, type Product } from '../lib/api';
import { brl, parseBrlInput } from '../lib/money';
import type { Sector } from '../lib/types';

export interface OptionGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  active: boolean;
  options: { id: string; name: string; priceDelta: string; position: number; active: boolean }[];
}

const rule = (g: { minSelect: number; maxSelect: number }) =>
  g.minSelect === 1 && g.maxSelect === 1
    ? 'Variação (escolha 1)'
    : g.minSelect > 0
      ? `Obrigatório: ${g.minSelect} a ${g.maxSelect}`
      : `Opcional: até ${g.maxSelect}`;

/** Grupos de adicionais/variações do restaurante. */
export function OptionGroupsCard({
  groups,
  canWrite,
  onChanged,
}: {
  groups: OptionGroup[];
  canWrite: boolean;
  onChanged(): void;
}) {
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  async function toggleOption(id: string, active: boolean) {
    try {
      await api(`/options/${id}`, { method: 'PATCH', json: { active } });
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }
  return (
    <Card
      title="Adicionais e variações"
      actions={
        canWrite && (
          <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
            Novo grupo
          </Button>
        )
      }
    >
      {groups.length === 0 ? (
        <EmptyState
          title="Nenhum grupo"
          description="Ex.: Tamanho (P/M/G) como variação, ou Adicionais (bacon, ovo) opcionais."
        />
      ) : (
        <div className="group-grid">
          {groups.map((g) => (
            <div key={g.id} className="group-tile">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>{g.name}</strong>
                <Badge tone="brand">{rule(g)}</Badge>
              </div>
              <ul className="plain-list">
                {g.options.map((o) => (
                  <li key={o.id} style={o.active ? undefined : { opacity: 0.5 }}>
                    <span>{o.name}</span>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {toCents(o.priceDelta) > 0 ? (
                        `+ ${brl(o.priceDelta)}`
                      ) : (
                        <span className="pm-hint">sem custo</span>
                      )}
                      {canWrite && (
                        <button className="link-btn" onClick={() => toggleOption(o.id, !o.active)}>
                          {o.active ? 'pausar' : 'ativar'}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <GroupModal
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          onChanged();
        }}
      />
    </Card>
  );
}

function GroupModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose(): void;
  onSaved(): void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'variation' | 'extras'>('extras');
  const [min, setMin] = useState('0');
  const [max, setMax] = useState('3');
  const [opts, setOpts] = useState([{ name: '', price: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minN = kind === 'variation' ? 1 : Number(min);
  const maxN = kind === 'variation' ? 1 : Number(max);
  const filled = opts.filter((o) => o.name.trim());
  const valid =
    name.trim() &&
    filled.length > 0 &&
    filled.every((o) => !o.price || parseBrlInput(o.price)) &&
    minN <= maxN &&
    maxN >= 1;
  async function save() {
    setBusy(true);
    try {
      await api('/option-groups', {
        method: 'POST',
        json: {
          name: name.trim(),
          minSelect: minN,
          maxSelect: maxN,
          options: filled.map((o) => ({
            name: o.name.trim(),
            priceDelta: o.price ? parseBrlInput(o.price) : undefined,
          })),
        },
      });
      setName('');
      setOpts([{ name: '', price: '' }]);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Novo grupo de opções" size="lg">
      <div style={{ display: 'grid', gap: 16 }}>
        <TextField
          label="Nome do grupo"
          placeholder="Ex.: Tamanho, Adicionais, Ponto da carne"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
        <div className="chips" role="radiogroup" aria-label="Tipo">
          <button
            className="chip"
            role="radio"
            aria-checked={kind === 'variation'}
            onClick={() => setKind('variation')}
          >
            Variação (escolhe 1)
          </button>
          <button
            className="chip"
            role="radio"
            aria-checked={kind === 'extras'}
            onClick={() => setKind('extras')}
          >
            Adicionais (várias)
          </button>
        </div>
        {kind === 'extras' && (
          <div className="two-cols">
            <TextField
              label="Mínimo"
              type="number"
              min={0}
              max={50}
              value={min}
              onChange={(e) => setMin(e.target.value)}
            />
            <TextField
              label="Máximo"
              type="number"
              min={1}
              max={50}
              value={max}
              onChange={(e) => setMax(e.target.value)}
              error={minN > maxN ? 'Menor que o mínimo' : undefined}
            />
          </div>
        )}
        <div style={{ display: 'grid', gap: 8 }}>
          <span className="pm-label">Opções</span>
          {opts.map((o, i) => (
            <div key={i} className="option-row">
              <input
                className="pm-input"
                placeholder="Nome (ex.: Bacon)"
                aria-label={`Opção ${i + 1}`}
                value={o.name}
                maxLength={80}
                onChange={(e) =>
                  setOpts((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))
                }
              />
              <input
                className="pm-input"
                placeholder="+ 0,00"
                inputMode="decimal"
                aria-label={`Preço adicional ${i + 1}`}
                value={o.price}
                aria-invalid={o.price && !parseBrlInput(o.price) ? true : undefined}
                onChange={(e) =>
                  setOpts((x) => x.map((y, j) => (j === i ? { ...y, price: e.target.value } : y)))
                }
              />
              <Button
                variant="ghost"
                aria-label="Remover opção"
                icon={<Trash2 size={14} />}
                disabled={opts.length === 1}
                onClick={() => setOpts((x) => x.filter((_, j) => j !== i))}
              />
            </div>
          ))}
          <Button
            variant="secondary"
            icon={<Plus size={14} />}
            onClick={() => setOpts((x) => [...x, { name: '', price: '' }])}
          >
            Mais uma opção
          </Button>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button loading={busy} disabled={!valid} onClick={save}>
          Salvar grupo
        </Button>
      </div>
    </Modal>
  );
}

/** Configura setor de produção e grupos de opções de um produto. */
export function ProductConfigModal({
  product,
  groups,
  sectors,
  linked,
  onClose,
  onSaved,
}: {
  product: Product | null;
  groups: OptionGroup[];
  sectors: Sector[];
  linked: string[];
  onClose(): void;
  onSaved(): void;
}) {
  const [sel, setSel] = useState<string[]>(linked);
  const [sectorId, setSectorId] = useState<string>(product?.sectorId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setSel(linked);
    setSectorId(product?.sectorId ?? '');
    setError(null);
  }, [product, linked]);
  async function save() {
    if (!product) return;
    setBusy(true);
    try {
      await api(`/products/${product.id}/option-groups`, {
        method: 'PUT',
        json: { groupIds: sel },
      });
      if ((product.sectorId ?? '') !== sectorId) {
        await api(`/products/${product.id}`, {
          method: 'PATCH',
          json: { sectorId: sectorId || null },
        });
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={!!product} onClose={onClose} title={`Configurar ${product?.name ?? ''}`}>
      <div style={{ display: 'grid', gap: 16 }}>
        <label className="pm-field">
          <span className="pm-label">Setor de produção</span>
          <select
            className="pm-input"
            value={sectorId}
            onChange={(e) => setSectorId(e.target.value)}
          >
            <option value="">Sem setor</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="picker__group">
          <legend>Grupos de opções (na ordem em que aparecem)</legend>
          {groups.length === 0 && (
            <span className="pm-hint">Crie grupos em “Adicionais e variações”.</span>
          )}
          {groups.map((g) => (
            <label key={g.id} className="picker__opt">
              <input
                type="checkbox"
                checked={sel.includes(g.id)}
                onChange={() =>
                  setSel((x) => (x.includes(g.id) ? x.filter((y) => y !== g.id) : [...x, g.id]))
                }
              />
              <span>{g.name}</span>
              <span className="pm-hint">{rule(g)}</span>
            </label>
          ))}
        </fieldset>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button loading={busy} onClick={save}>
          Salvar
        </Button>
      </div>
    </Modal>
  );
}
