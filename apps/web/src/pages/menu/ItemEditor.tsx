import { formatBRL, toCents } from '@comandou/shared';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  Select,
  Skeleton,
  TextField,
  useToast,
  HelpLabel,
  HelpScope,
  HelpTip,
} from '../../design-system';
import { useCan } from '../../app/auth';
import { CheckField, fmtQty, parseQtyInput, SelectField, Tabs } from '../../features/forms';
import { ImagePicker } from '../../features/ImagePicker';
import { fmtFactor, fmtPct } from '../../features/pricing';
import { fmtCost, recipeStock, toMilli, valueCents } from '../../features/stock-math';
import { api, type Category, type Product } from '../../lib/api';
import { brl, parseBrlInput } from '../../lib/money';
import type {
  FiscalRule,
  FiscalRulesResponse,
  RecipeLine,
  Sector,
  StockItem,
} from '../../lib/types';
import { FamilyModal } from './FamiliesTab';
import { GroupEditor } from './GroupsTab';
import {
  GROUP_KIND,
  MENU_KIND,
  UNITS,
  groupRule,
  priceDiff,
  toInput,
  type Family,
  type GroupLink,
  type MenuDef,
  type OptionGroup,
} from './menu-data';
import '../stock.css';
import { ITEM_HELP } from '../../features/help/menu-help';
import { TourButton } from '../../features/tour/PageTour';

type Tab = 'principal' | 'complementos' | 'ficha';

interface Form {
  code: string;
  name: string;
  description: string;
  imageId: string | null;
  categoryId: string;
  familyId: string;
  price: string;
  unit: string;
  soldByWeight: boolean;
  /** Tara em gramas (texto do campo): pote, prato ou marmita descontado do peso da balança. */
  weightTareG: string;
  sectorId: string;
  featured: boolean;
  badge: string;
  active: boolean;
  soldOut: boolean;
  cost: string;
  ncm: string;
  cfop: string;
  fiscalCode: string;
  fiscalOrigin: string;
  fiscalRuleId: string;
  cest: string;
  barcodeType: 'fixed' | 'weight' | 'value';
  barcode: string;
}

const blank = (categoryId: string): Form => ({
  code: '',
  name: '',
  description: '',
  imageId: null,
  categoryId,
  familyId: '',
  price: '',
  unit: 'UN',
  soldByWeight: false,
  weightTareG: '',
  sectorId: '',
  featured: false,
  badge: '',
  active: true,
  soldOut: false,
  cost: '',
  ncm: '',
  cfop: '',
  fiscalCode: '',
  fiscalOrigin: '',
  fiscalRuleId: '',
  cest: '',
  barcodeType: 'fixed',
  barcode: '',
});

const formOf = (p: Product): Form => ({
  code: p.code ?? '',
  name: p.name,
  description: p.description ?? '',
  imageId: p.imageId ?? null,
  categoryId: p.categoryId,
  familyId: p.familyId ?? '',
  price: toInput(p.price),
  unit: p.fiscalUnit ?? 'UN',
  soldByWeight: !!p.soldByWeight,
  weightTareG: Number(p.weightTare ?? 0) > 0 ? String(Math.round(Number(p.weightTare) * 1000)) : '',
  sectorId: p.sectorId ?? '',
  featured: !!p.featured,
  badge: p.badge ?? '',
  active: p.active,
  soldOut: p.soldOut,
  cost: toInput(p.cost),
  ncm: p.ncm ?? '',
  cfop: p.cfop ?? '',
  fiscalCode: p.fiscalCode ?? '',
  fiscalOrigin: p.fiscalOrigin == null ? '' : String(p.fiscalOrigin),
  fiscalRuleId: p.fiscalRuleId ?? '',
  cest: p.cest ?? '',
  barcodeType: p.barcodeType ?? 'fixed',
  barcode: p.barcode ?? '',
});

type MenuSel = Record<string, { on: boolean; price: string }>;
type Line = { stockItemId: string; quantity: string };

/**
 * Cadastro completo do item, em abas: Principal (dados, venda, cardápios, custo, fiscal),
 * Complementos (grupos na ordem em que aparecem) e Ficha técnica (insumos e custo).
 */
export function ItemEditor() {
  const { id = 'novo' } = useParams();
  const isNew = id === 'novo';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const canWrite = useCan('catalog:write');
  const canStock = useCan('stock:read');
  const canStockWrite = useCan('stock:write');
  const [tab, setTab] = useState<Tab>('principal');
  const [product, setProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [fiscalRules, setFiscalRules] = useState<FiscalRule[]>([]);
  useEffect(() => {
    api<FiscalRulesResponse>('/fiscal/rules')
      .then((r) => setFiscalRules(r.rules.filter((x) => x.active)))
      .catch(() => setFiscalRules([]));
  }, []);
  const [families, setFamilies] = useState<Family[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [menus, setMenus] = useState<MenuDef[]>([]);
  const [menuSel, setMenuSel] = useState<MenuSel>({});
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [initialGroups, setInitialGroups] = useState<string[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [initialLines, setInitialLines] = useState('[]');
  const [addGroup, setAddGroup] = useState('');
  const [newGroup, setNewGroup] = useState(false);
  const [newFamily, setNewFamily] = useState(false);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Carga antiga (outro item aberto antes de terminar, ou o StrictMode montando duas vezes no
    // desenvolvimento) não pode chegar depois e apagar o que a pessoa já digitou.
    let live = true;
    void (async () => {
      try {
        const [c, f, s, m, g, links, all] = await Promise.all([
          api<Category[]>('/categories'),
          api<Family[]>('/item-families').catch(() => [] as Family[]),
          canWrite ? api<Sector[]>('/sectors').catch(() => [] as Sector[]) : Promise.resolve([]),
          api<MenuDef[]>('/menus'),
          api<OptionGroup[]>('/option-groups'),
          api<GroupLink[]>('/product-option-groups'),
          api<Product[]>('/products'),
        ]);
        if (!live) return;
        setCategories(c);
        setFamilies(f);
        setSectors(s.filter((x) => x.active));
        setMenus(m);
        setGroups(g);
        setAllProducts(all);
        if (isNew) {
          const cat = params.get('categoria') ?? c[0]?.id ?? '';
          // Item novo já vem com a cozinha da categoria.
          const sector = c.find((x) => x.id === cat)?.sectorId ?? '';
          setForm({ ...blank(cat), sectorId: sector });
          // Item novo entra nos cardápios ativos, com o preço do item.
          setMenuSel(Object.fromEntries(m.map((x) => [x.id, { on: x.active, price: '' }])));
          setGroupIds([]);
          setInitialGroups([]);
        } else {
          const [p, pm] = await Promise.all([
            api<Product>(`/products/${id}`),
            api<{ menuId: string; price: string | null }[]>(`/products/${id}/menus`),
          ]);
          if (!live) return;
          setProduct(p);
          setForm(formOf(p));
          setMenuSel(
            Object.fromEntries(
              m.map((x) => {
                const it = pm.find((y) => y.menuId === x.id);
                return [x.id, { on: !!it, price: toInput(it?.price) }];
              }),
            ),
          );
          const mine = links
            .filter((l) => l.productId === id)
            .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
            .map((l) => l.groupId);
          setGroupIds(mine);
          setInitialGroups(mine);
        }
        if (canStock) {
          const [items, rec] = await Promise.all([
            api<StockItem[]>('/stock/items'),
            api<{ products: (RecipeLine & { productId: string })[] }>('/stock/recipes'),
          ]);
          if (!live) return;
          setStockItems(items);
          const mine = isNew
            ? []
            : rec.products
                .filter((r) => r.productId === id)
                .map((r) => ({ stockItemId: r.stockItemId, quantity: fmtQty(r.quantity) }));
          setLines(mine);
          setInitialLines(JSON.stringify(mine));
        }
        setError(null);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [id]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  // ---------------------------------------------------------------- custos
  const itemById = useMemo(() => new Map(stockItems.map((i) => [i.id, i])), [stockItems]);
  const parsedLines = lines.map((l) => ({
    stockItemId: l.stockItemId,
    quantity: parseQtyInput(l.quantity),
  }));
  const recipeCents = parsedLines.reduce((s, l) => {
    const it = itemById.get(l.stockItemId);
    return it && l.quantity ? s + (toMilli(l.quantity) / 1000) * Number(it.avgCost) * 100 : s;
  }, 0);
  const hasRecipe = parsedLines.some((l) => l.stockItemId && l.quantity);
  // Com o estoque de hoje: quantas unidades dá para vender e qual insumo falta.
  const stockNow = recipeStock(parsedLines, itemById, !!form?.soldByWeight);
  const stockOut = canStock && stockNow.missing.length > 0;
  const priceParsed = form ? parseBrlInput(form.price) : null;
  const priceCents = priceParsed ? toCents(priceParsed) : 0;
  const costParsed = form?.cost ? parseBrlInput(form.cost) : null;
  const costCents = hasRecipe ? recipeCents : costParsed ? toCents(costParsed) : null;
  const marginPct =
    costCents !== null && priceCents > 0 ? ((priceCents - costCents) / priceCents) * 100 : null;

  // ---------------------------------------------------------------- validação
  const errs = form
    ? {
        name: !form.name.trim() ? 'Obrigatório' : undefined,
        price: !priceParsed ? 'Use o formato 12,90' : undefined,
        cost: form.cost && !costParsed ? 'Use o formato 4,50' : undefined,
        ncm: form.ncm && !/^\d{8}$/.test(form.ncm) ? '8 dígitos' : undefined,
        cfop: form.cfop && !/^\d{4}$/.test(form.cfop) ? '4 dígitos' : undefined,
        fiscalCode:
          form.fiscalCode && !/^\d{2,3}$/.test(form.fiscalCode) ? '2 ou 3 dígitos' : undefined,
        cest: form.cest && !/^\d{7}$/.test(form.cest) ? '7 dígitos' : undefined,
        barcode:
          form.barcode && !/^\d{4,14}$/.test(form.barcode) ? 'Só números, de 4 a 14' : undefined,
        weightTare:
          form.soldByWeight && form.weightTareG && !/^\d{1,4}$/.test(form.weightTareG.trim())
            ? 'Em gramas, só números (ex.: 20)'
            : undefined,
        menus: Object.values(menuSel).some((m) => m.on && m.price && !parseBrlInput(m.price))
          ? 'Preço inválido'
          : undefined,
        recipe:
          hasRecipe &&
          (!parsedLines.every((l) => l.stockItemId && l.quantity && Number(l.quantity) > 0) ||
            new Set(parsedLines.map((l) => l.stockItemId)).size !== parsedLines.length)
            ? 'Confira os insumos'
            : undefined,
      }
    : {};
  const firstErr = Object.entries(errs).find(([, v]) => v);
  const invalid = !form || !form.categoryId || !!firstErr;

  async function save() {
    if (!form || invalid) return;
    setBusy(true);
    setError(null);
    try {
      const fields = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        price: priceParsed!,
        categoryId: form.categoryId,
        sectorId: form.sectorId || null,
        imageId: form.imageId,
        featured: form.featured,
        badge: form.badge.trim() || null,
        code: form.code.trim() || null,
        familyId: form.familyId || null,
        cost: hasRecipe ? null : costParsed,
        soldByWeight: form.soldByWeight,
        weightTare: form.soldByWeight
          ? (Number(form.weightTareG.trim() || '0') / 1000).toFixed(3)
          : '0.000',
        barcode: form.barcode || null,
        barcodeType: form.barcodeType,
        fiscalUnit: form.unit || null,
        ncm: form.ncm || null,
        cfop: form.cfop || null,
        fiscalCode: form.fiscalCode || null,
        fiscalOrigin: form.fiscalOrigin === '' ? null : Number(form.fiscalOrigin),
        fiscalRuleId: form.fiscalRuleId || null,
        cest: form.cest || null,
      };
      const menusBody = Object.entries(menuSel)
        .filter(([, m]) => m.on)
        .map(([menuId, m]) => ({ menuId, price: m.price ? parseBrlInput(m.price) : null }));
      let saved: Product;
      if (isNew) {
        const { description, code, ...rest } = fields;
        saved = await api<Product>('/products', {
          method: 'POST',
          json: {
            ...rest,
            description: description ?? undefined,
            code: code ?? undefined,
            menus: menusBody,
          },
        });
      } else {
        saved = await api<Product>(`/products/${id}`, {
          method: 'PATCH',
          json: { ...fields, active: form.active, soldOut: form.soldOut },
        });
        await api(`/products/${id}/menus`, { method: 'PUT', json: { menus: menusBody } });
      }
      if (JSON.stringify(groupIds) !== JSON.stringify(initialGroups))
        await api(`/products/${saved.id}/option-groups`, {
          method: 'PUT',
          json: { groupIds },
        });
      if (canStockWrite && JSON.stringify(lines) !== initialLines)
        await api(`/stock/recipes/products/${saved.id}`, {
          method: 'PUT',
          json: { lines: parsedLines.filter((l) => l.stockItemId && l.quantity) },
        });
      setInitialGroups(groupIds);
      setInitialLines(JSON.stringify(lines));
      setProduct(saved);
      setForm(formOf(saved));
      toast(isNew ? 'Item criado' : 'Item salvo', 'success');
      if (isNew) navigate(`/cardapio/itens/${saved.id}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const title = isNew ? form?.name.trim() || 'Novo item' : (product?.name ?? 'Item');
  const linked = groupIds
    .map((g) => groups.find((x) => x.id === g))
    .filter(Boolean) as OptionGroup[];
  const available = groups.filter((g) => !groupIds.includes(g.id));
  const moveGroup = (i: number, d: -1 | 1) =>
    setGroupIds((ids) => {
      const j = i + d;
      if (j < 0 || j >= ids.length) return ids;
      const c = [...ids];
      [c[i], c[j]] = [c[j]!, c[i]!];
      return c;
    });

  return (
    <HelpScope dict={ITEM_HELP}>
      <>
        <div className="mn-crumbs">
          <div className="mn-crumbs__path">
            <Link to="/cardapio" className="mn-crumbs__back">
              <ArrowLeft size={16} aria-hidden /> Itens
            </Link>
            <span aria-hidden>/</span>
            <h1>{title}</h1>
            {product && !product.active && <Badge>Pausado</Badge>}
            {product?.soldOut && <Badge tone="danger">Esgotado</Badge>}
            {!product?.soldOut && stockOut && <Badge tone="danger">Sem estoque</Badge>}
          </div>
          <div className="mn-crumbs__tools">
            <TourButton tour="item" />
            {canWrite && (
              <Button loading={busy} disabled={invalid} onClick={save} title={firstErr?.[1]}>
                Salvar
              </Button>
            )}
          </div>
        </div>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            ['principal', 'Principal'],
            ['complementos', `Complementos${groupIds.length ? ` (${groupIds.length})` : ''}`],
            ['ficha', 'Ficha técnica'],
          ]}
        />
        {error && <Alert tone="danger">{error}</Alert>}
        {!form ? (
          !error && <Skeleton height={320} />
        ) : tab === 'principal' ? (
          <Card>
            <div className="mn-item-top">
              <div className="mn-item-photo">
                <ImagePicker
                  label="Foto do item"
                  width={148}
                  value={form.imageId}
                  disabled={!canWrite}
                  onChange={(img) => set('imageId', img)}
                />
                <span className="cm-hint">Foto quadrada; pode arrastar o arquivo.</span>
              </div>
              <div className="cm-form">
                <TextField
                  label="Código (opcional)"
                  placeholder={isNew ? 'Gerado ao salvar (IT-000001)' : undefined}
                  value={form.code}
                  maxLength={30}
                  onChange={(e) => set('code', e.target.value.toUpperCase())}
                />
                <TextField
                  label="Nome do item"
                  value={form.name}
                  maxLength={120}
                  error={form.name && errs.name}
                  onChange={(e) => set('name', e.target.value)}
                  required
                />
                <div className="cm-field cm-form__wide">
                  <HelpLabel htmlFor="item-desc">Descrição (opcional)</HelpLabel>
                  <textarea
                    id="item-desc"
                    className="cm-input"
                    rows={3}
                    maxLength={1000}
                    placeholder="Ingredientes, tamanho, observações"
                    value={form.description}
                    onChange={(e) => set('description', e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="cm-form mn-item-form">
              <h3 className="cm-form__section">Venda</h3>
              <SelectField
                label="Categoria"
                value={form.categoryId}
                onChange={(e) => {
                  set('categoryId', e.target.value);
                  const sector = categories.find((c) => c.id === e.target.value)?.sectorId;
                  if (isNew && sector && !form.sectorId) set('sectorId', sector);
                }}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Preço"
                inputMode="decimal"
                placeholder="0,00"
                value={form.price}
                error={form.price ? errs.price : undefined}
                hint={
                  form.soldByWeight
                    ? 'Preço do quilo'
                    : 'Preço base, usado nos cardápios sem preço próprio'
                }
                onChange={(e) => set('price', e.target.value)}
                required
              />
              <SelectField
                label="Unidade de medida"
                value={form.unit}
                onChange={(e) => set('unit', e.target.value)}
              >
                {UNITS.map(([u, label]) => (
                  <option key={u} value={u}>
                    {u} · {label}
                  </option>
                ))}
                {!UNITS.some(([u]) => u === form.unit) && (
                  <option value={form.unit}>{form.unit}</option>
                )}
              </SelectField>
              <div className="cm-field">
                <span className="mn-label-row">
                  <HelpLabel htmlFor="item-family">Família</HelpLabel>
                  {canWrite && (
                    <button type="button" className="link-btn" onClick={() => setNewFamily(true)}>
                      + Nova
                    </button>
                  )}
                </span>
                <Select
                  id="item-family"
                  value={form.familyId}
                  onChange={(e) => set('familyId', e.target.value)}
                >
                  <option value="">Sem família</option>
                  {families
                    .filter((f) => f.active || f.id === form.familyId)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </Select>
                <span className="cm-hint">Agrupa as vendas deste item nos relatórios.</span>
              </div>
              <SelectField
                label="Cozinha (KDS)"
                value={form.sectorId}
                onChange={(e) => set('sectorId', e.target.value)}
              >
                <option value="">Nenhuma</option>
                {sectors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Selo no cardápio online (opcional)"
                placeholder="Ex.: Novo, Picante"
                maxLength={20}
                value={form.badge}
                onChange={(e) => set('badge', e.target.value)}
              />
              <div className="cm-form__wide mn-checks">
                <CheckField
                  label="Vendido por peso"
                  description="O preço é do quilo e a quantidade vai em kg (balança ou digitada)."
                  checked={form.soldByWeight}
                  onChange={(v) => {
                    set('soldByWeight', v);
                    if (v) set('unit', 'KG');
                    else if (form.unit === 'KG') set('unit', 'UN');
                  }}
                />
                {form.soldByWeight && (
                  <TextField
                    label="Tara (g)"
                    inputMode="numeric"
                    placeholder="0"
                    value={form.weightTareG}
                    error={errs.weightTare}
                    hint="Peso do pote, prato ou marmita. É descontado do que a balança mostra."
                    onChange={(e) =>
                      set('weightTareG', e.target.value.replace(/\D/g, '').slice(0, 4))
                    }
                  />
                )}
                <CheckField
                  label="Destaque no cardápio online"
                  description="Aparece no topo, na faixa de destaques."
                  checked={form.featured}
                  onChange={(v) => set('featured', v)}
                />
                {!isNew && (
                  <>
                    <CheckField
                      label="Esgotado"
                      description="Continua no cardápio, mas não dá para pedir."
                      checked={form.soldOut}
                      onChange={(v) => set('soldOut', v)}
                    />
                    <CheckField
                      label="Pausado"
                      description="Sai de todos os cardápios até ser reativado."
                      checked={!form.active}
                      onChange={(v) => set('active', !v)}
                    />
                  </>
                )}
              </div>

              <h3 className="cm-form__section cm-sec-help">
                Cardápios <HelpTip label="Cardápios" />
              </h3>
              <div className="cm-form__wide mn-item-menus">
                {menus.map((m) => {
                  const sel = menuSel[m.id] ?? { on: false, price: '' };
                  const parsed = sel.price ? parseBrlInput(sel.price) : null;
                  const diff = parsed ? priceDiff(priceCents, toCents(parsed)) : null;
                  return (
                    <div key={m.id} className="mn-item-menu" data-off={!sel.on || undefined}>
                      <label className="mn-check">
                        <input
                          type="checkbox"
                          checked={sel.on}
                          onChange={(e) =>
                            setMenuSel((x) => ({ ...x, [m.id]: { ...sel, on: e.target.checked } }))
                          }
                        />
                        <span>
                          <strong>{m.name}</strong>
                          <span className="cm-hint">
                            {' '}
                            {MENU_KIND[m.kind].where}
                            {!m.active && ' · pausado'}
                          </span>
                        </span>
                      </label>
                      <input
                        className="cm-input cm-num"
                        aria-label={`Preço no ${m.name}`}
                        inputMode="decimal"
                        placeholder={priceParsed ? brl(priceParsed) : 'Preço do item'}
                        disabled={!sel.on}
                        value={sel.price}
                        aria-invalid={(sel.price && !parsed) || undefined}
                        onChange={(e) =>
                          setMenuSel((x) => ({ ...x, [m.id]: { ...sel, price: e.target.value } }))
                        }
                      />
                      <span className="mn-menu-row__diff">{diff ?? ''}</span>
                    </div>
                  );
                })}
                <span className="cm-hint">
                  Preço vazio usa o preço do item. Ex.: no delivery, cobrar 10% a mais por causa da
                  taxa do app.
                </span>
              </div>

              <h3 className="cm-form__section">Custo e margem</h3>
              <TextField
                label="Custo"
                inputMode="decimal"
                placeholder="0,00"
                value={hasRecipe ? (recipeCents / 100).toFixed(2).replace('.', ',') : form.cost}
                disabled={hasRecipe}
                error={errs.cost}
                hint={
                  hasRecipe
                    ? 'Calculado pela ficha técnica (custo médio dos insumos).'
                    : 'Sem ficha técnica, os relatórios usam este custo.'
                }
                onChange={(e) => set('cost', e.target.value)}
              />
              <div className="st-preview st-preview--compact cm-form__wide">
                <div>
                  <span>Preço</span>
                  <strong>{formatBRL(priceCents)}</strong>
                </div>
                <div>
                  <span>Custo</span>
                  <strong>{costCents === null ? '—' : formatBRL(costCents)}</strong>
                </div>
                <div
                  data-tone={marginPct === null ? undefined : marginPct < 0 ? 'danger' : 'success'}
                >
                  <span>Margem</span>
                  <strong>{fmtPct(marginPct)}</strong>
                </div>
                <div>
                  <span>Markup</span>
                  <strong>{costCents ? fmtFactor(priceCents / costCents) : '—'}</strong>
                </div>
              </div>

              <h3 className="cm-form__section">Fiscal e código de barras</h3>
              <SelectField
                label="Padrão fiscal"
                value={form.fiscalRuleId}
                onChange={(e) => set('fiscalRuleId', e.target.value)}
              >
                <option value="">Automático (pelo NCM ou o padrão da empresa)</option>
                {fiscalRules.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} · {r.name} (CFOP {r.cfop}, {r.icmsCst})
                  </option>
                ))}
              </SelectField>
              <TextField
                label="CEST"
                inputMode="numeric"
                maxLength={7}
                placeholder="Só com substituição tributária"
                value={form.cest}
                error={errs.cest}
                hint="Bebidas e outros itens com ICMS-ST (7 dígitos)."
                onChange={(e) => set('cest', e.target.value.replace(/\D/g, ''))}
              />
              <TextField
                label="NCM"
                inputMode="numeric"
                maxLength={8}
                placeholder="Ex.: 21069090"
                value={form.ncm}
                error={errs.ncm}
                hint="Classificação fiscal, exigida na NFC-e. Vazio usa o NCM padrão."
                onChange={(e) => set('ncm', e.target.value.replace(/\D/g, ''))}
              />
              <TextField
                label="CFOP"
                inputMode="numeric"
                maxLength={4}
                placeholder="Vem do padrão fiscal"
                value={form.cfop}
                error={errs.cfop}
                onChange={(e) => set('cfop', e.target.value.replace(/\D/g, ''))}
              />
              <TextField
                label="CSOSN / CST do ICMS"
                inputMode="numeric"
                maxLength={3}
                placeholder="Vem do padrão fiscal"
                value={form.fiscalCode}
                error={errs.fiscalCode}
                onChange={(e) => set('fiscalCode', e.target.value.replace(/\D/g, ''))}
              />
              <SelectField
                label="Origem"
                value={form.fiscalOrigin}
                onChange={(e) => set('fiscalOrigin', e.target.value)}
              >
                <option value="">Padrão (0, nacional)</option>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </SelectField>
              <div className="cm-field">
                <HelpLabel as="span">Tipo de código de barras</HelpLabel>
                <div className="mn-radios" role="radiogroup" aria-label="Tipo de código de barras">
                  {(
                    [
                      ['fixed', 'Fixo'],
                      ['weight', 'Peso variável'],
                      ['value', 'Valor variável'],
                    ] as const
                  ).map(([v, label]) => (
                    <label key={v} className="mn-check">
                      <input
                        type="radio"
                        name="barcode-type"
                        checked={form.barcodeType === v}
                        onChange={() => set('barcodeType', v)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <span className="cm-hint">
                  Peso e valor variável: etiqueta de balança (começa com 2).
                </span>
              </div>
              <TextField
                label="Código de barras (EAN)"
                inputMode="numeric"
                maxLength={14}
                placeholder="Ex.: 7891000000017"
                value={form.barcode}
                error={errs.barcode}
                hint="Usado para achar o item na leitura do scanner e na busca."
                onChange={(e) => set('barcode', e.target.value.replace(/\D/g, ''))}
              />
            </div>
          </Card>
        ) : tab === 'complementos' ? (
          <Card title="Grupos de complementos do item">
            <div className="mn-linked">
              <p className="cm-hint" style={{ margin: 0 }}>
                Aparecem nesta ordem ao pedir o item (no PDV, no garçom e no cardápio online).
              </p>
              {linked.length === 0 && (
                <p className="mn-empty">Nenhum grupo. Adicione tamanhos, adicionais ou sabores.</p>
              )}
              {linked.map((g, i) => (
                <div key={g.id} className="mn-linked__row">
                  <div>
                    <strong>{g.name}</strong>
                    <div className="mn-item-meta">
                      <span>{GROUP_KIND[g.kind]?.label}</span>
                      <span>{groupRule(g)}</span>
                      {!g.active && <span>Pausado</span>}
                    </div>
                    <div className="cm-hint mn-clamp">
                      {g.options
                        .filter((o) => o.active)
                        .map((o) =>
                          toCents(o.priceDelta) > 0 ? `${o.name} (+${brl(o.priceDelta)})` : o.name,
                        )
                        .join(', ')}
                    </div>
                  </div>
                  {canWrite && (
                    <span className="mn-opts__tools">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Subir ${g.name}`}
                        icon={<ArrowUp size={14} />}
                        disabled={i === 0}
                        onClick={() => moveGroup(i, -1)}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Descer ${g.name}`}
                        icon={<ArrowDown size={14} />}
                        disabled={i === linked.length - 1}
                        onClick={() => moveGroup(i, 1)}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Tirar ${g.name}`}
                        icon={<X size={14} />}
                        onClick={() => setGroupIds((ids) => ids.filter((x) => x !== g.id))}
                      />
                    </span>
                  )}
                </div>
              ))}
              {canWrite && (
                <div className="mn-linked__add">
                  <SelectField
                    label="Adicionar grupo"
                    value={addGroup}
                    onChange={(e) => {
                      if (e.target.value) setGroupIds((ids) => [...ids, e.target.value]);
                      setAddGroup('');
                    }}
                  >
                    <option value="">Escolha um grupo…</option>
                    {available.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} · {groupRule(g)}
                      </option>
                    ))}
                  </SelectField>
                  <Button
                    variant="secondary"
                    icon={<Plus size={16} />}
                    onClick={() => setNewGroup(true)}
                  >
                    Criar grupo
                  </Button>
                </div>
              )}
            </div>
          </Card>
        ) : (
          <Card title="Ficha técnica">
            {!canStock ? (
              <p className="cm-hint">A ficha técnica fica com quem cuida do estoque.</p>
            ) : (
              <div className="st-recipe">
                <p className="cm-hint" style={{ margin: 0 }}>
                  Quanto de cada insumo sai por unidade vendida
                  {form.soldByWeight
                    ? ' (por 1 kg vendido: cada venda baixa a ficha × o peso, 350 g baixam 0,35 da ficha)'
                    : ''}
                  . A venda baixa o estoque e o custo entra nos relatórios.
                </p>
                {stockItems.length === 0 && (
                  <p className="cm-hint" style={{ margin: 0 }}>
                    Cadastre os insumos em <Link to="/estoque">Estoque</Link> para montar a ficha.
                  </p>
                )}
                {lines.length > 0 && (
                  <div className="st-recipe__head" aria-hidden>
                    <span>Insumo</span>
                    <span>Quantidade</span>
                    <span className="cm-num">Custo</span>
                    <span />
                  </div>
                )}
                {lines.map((l, idx) => {
                  const it = itemById.get(l.stockItemId);
                  const pl = parsedLines[idx]!;
                  return (
                    <div key={idx} className="st-recipe__line">
                      <SelectField
                        label="Insumo"
                        value={l.stockItemId}
                        disabled={!canStockWrite}
                        onChange={(e) =>
                          setLines((ls) =>
                            ls.map((x, i) =>
                              i === idx ? { ...x, stockItemId: e.target.value } : x,
                            ),
                          )
                        }
                      >
                        <option value="">Escolha…</option>
                        {stockItems
                          .filter((i) => i.active || i.id === l.stockItemId)
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name} ({i.unit})
                            </option>
                          ))}
                      </SelectField>
                      <TextField
                        label={`Quantidade${it ? ` (${it.unit})` : ''}`}
                        inputMode="decimal"
                        value={l.quantity}
                        disabled={!canStockWrite}
                        onChange={(e) =>
                          setLines((ls) =>
                            ls.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)),
                          )
                        }
                      />
                      <div className="st-recipe__cost">
                        <span className="cm-hint">Custo</span>
                        <strong>
                          {formatBRL(
                            it && pl.quantity ? valueCents(toMilli(pl.quantity), it.avgCost) : 0,
                          )}
                        </strong>
                        {it && (
                          <span className="cm-hint">
                            {fmtCost(it.avgCost)}/{it.unit}
                          </span>
                        )}
                        {it && (
                          <span
                            className="cm-hint"
                            style={
                              stockNow.lines.find((x) => x.stockItemId === it.id)?.short
                                ? { color: 'var(--cm-danger)', fontWeight: 600 }
                                : undefined
                            }
                          >
                            Tem {fmtQty(it.quantity)} {it.unit}
                          </span>
                        )}
                      </div>
                      {canStockWrite && (
                        <Button
                          variant="ghost"
                          aria-label="Remover insumo"
                          icon={<Trash2 size={16} />}
                          onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                        />
                      )}
                    </div>
                  );
                })}
                {stockNow.lines.length > 0 && (
                  <Alert tone={stockOut ? 'danger' : 'info'}>
                    {stockOut
                      ? `Sem estoque: falta ${stockNow.missing.join(', ')}. O item não vende até dar entrada no estoque.`
                      : stockNow.portions === null
                        ? 'Tem estoque para vender.'
                        : `Com o estoque de hoje dá para vender ${stockNow.portions} ${stockNow.portions === 1 ? 'unidade' : 'unidades'}.`}
                  </Alert>
                )}
                {lines.length > 0 && (
                  <div className="st-preview st-preview--compact">
                    <div>
                      <span>Preço de venda</span>
                      <strong>{formatBRL(priceCents)}</strong>
                    </div>
                    <div data-tone="brand">
                      <span>Custo da ficha</span>
                      <strong>{formatBRL(recipeCents)}</strong>
                    </div>
                    <div>
                      <span>CMV</span>
                      <strong>
                        {priceCents > 0 ? fmtPct((recipeCents / priceCents) * 100) : '—'}
                      </strong>
                    </div>
                    <div>
                      <span>Markup</span>
                      <strong>{recipeCents > 0 ? fmtFactor(priceCents / recipeCents) : '—'}</strong>
                    </div>
                  </div>
                )}
                {errs.recipe && <span className="cm-error-text">{errs.recipe}</span>}
                {canStockWrite && stockItems.length > 0 && (
                  <div>
                    <Button
                      variant="secondary"
                      icon={<Plus size={16} />}
                      onClick={() => setLines((ls) => [...ls, { stockItemId: '', quantity: '' }])}
                    >
                      Adicionar insumo
                    </Button>
                  </div>
                )}
                <p className="cm-hint" style={{ margin: 0 }}>
                  A ficha é salva junto com o item, no botão Salvar.
                </p>
              </div>
            )}
          </Card>
        )}
        <GroupEditor
          group={newGroup ? 'new' : null}
          canWrite={canWrite}
          onClose={() => setNewGroup(false)}
          onSaved={(g) => {
            setNewGroup(false);
            setGroups((x) => [...x, g]);
            setGroupIds((ids) => [...ids, g.id]);
          }}
        />
        <FamilyModal
          family={newFamily ? 'new' : null}
          products={allProducts}
          canWrite={canWrite}
          onClose={() => setNewFamily(false)}
          onSaved={(f) => {
            setNewFamily(false);
            setFamilies((x) => [...x, f]);
            set('familyId', f.id);
          }}
        />
      </>
    </HelpScope>
  );
}
