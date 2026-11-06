import { BookOpen, Pencil, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert, Badge, Button, Card, EmptyState, Skeleton, useToast } from '../../design-system';
import { useCan } from '../../app/auth';
import { ImagePicker } from '../../features/ImagePicker';
import {
  fold,
  ListTable,
  ListToolbar,
  useListView,
  type ListField,
  type ListSort,
  type ListTab,
} from '../../features/list-view';
import { api, Category, Product, type ProductAvailability } from '../../lib/api';
import { useLinkParam } from '../../lib/deep-link';
import { useRealtime } from '../../lib/realtime';
import { brl } from '../../lib/money';
import type { Family, GroupLink, OptionGroup } from './menu-data';
import type { Sector } from '../../lib/types';
import { CategoryModal, categoryIcon } from './CategoryModal';

const ITEM_TABS: ListTab[] = [
  { id: 'todos', label: 'Todos', filters: {} },
  { id: 'disponiveis', label: 'Disponíveis', filters: { sale: ['available'], active: ['yes'] } },
  { id: 'esgotados', label: 'Esgotados', filters: { sale: ['soldout', 'nostock'] } },
  { id: 'pausados', label: 'Pausados', filters: { active: ['no'] } },
];

/** Categorias à esquerda, itens da categoria (ou da busca) à direita. */
export function ItemsTab() {
  const canWrite = useCan('catalog:write');
  const toast = useToast();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [links, setLinks] = useState<GroupLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [catModal, setCatModal] = useState<Category | 'new' | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  // Estoque pela ficha técnica: item com insumo acabado não vende (mesmo sem marcar esgotado).
  const [stock, setStock] = useState<Map<string, ProductAvailability>>(new Map());
  const stockOut = useCallback((id: string) => !!stock.get(id)?.out, [stock]);
  const newItem = (categoryId?: string | null) =>
    navigate(`/cardapio/itens/novo${categoryId ? `?categoria=${categoryId}` : ''}`);

  const groupNames = useCallback(
    (productId: string) =>
      links
        .filter((l) => l.productId === productId)
        .map((l) => groups.find((g) => g.id === l.groupId)?.name)
        .filter((n): n is string => !!n),
    [links, groups],
  );
  const fields = useMemo<ListField<Product>[]>(
    () => [
      {
        key: 'category',
        label: 'Categoria',
        value: (p) => p.categoryId,
        options: (categories ?? []).map((c) => ({ value: c.id, label: c.name })),
        pinned: true,
      },
      {
        key: 'sale',
        label: 'Situação',
        value: (p) => (p.soldOut ? 'soldout' : stockOut(p.id) ? 'nostock' : 'available'),
        options: [
          { value: 'available', label: 'Disponível' },
          { value: 'soldout', label: 'Esgotado' },
          { value: 'nostock', label: 'Sem estoque' },
        ],
        pinned: true,
      },
      {
        key: 'family',
        label: 'Família',
        value: (p) => p.familyId ?? 'none',
        options: [
          ...families.map((f) => ({ value: f.id, label: f.name })),
          { value: 'none', label: 'Sem família' },
        ],
      },
      {
        key: 'active',
        label: 'Ativo',
        value: (p) => (p.active ? 'yes' : 'no'),
        options: [
          { value: 'yes', label: 'Ativo' },
          { value: 'no', label: 'Pausado' },
        ],
      },
      { key: 'groups', label: 'Complementos', value: (p) => groupNames(p.id) },
      {
        key: 'photo',
        label: 'Foto',
        value: (p) => (p.imageId ? 'yes' : 'no'),
        options: [
          { value: 'yes', label: 'Com foto' },
          { value: 'no', label: 'Sem foto' },
        ],
      },
      {
        key: 'weight',
        label: 'Venda por peso',
        value: (p) => (p.soldByWeight ? 'yes' : 'no'),
        options: [
          { value: 'yes', label: 'Por peso' },
          { value: 'no', label: 'Por unidade' },
        ],
      },
    ],
    [categories, families, groupNames, stockOut],
  );
  const sorts = useMemo<ListSort<Product>[]>(
    () => [
      {
        key: 'category',
        label: 'Categoria',
        get: (p) =>
          `${String(categories?.findIndex((c) => c.id === p.categoryId) ?? 0).padStart(4, '0')} ${fold(p.name)}`,
        asc: true,
      },
      { key: 'name', label: 'Nome', get: (p) => fold(p.name), asc: true },
      { key: 'price', label: 'Preço', get: (p) => Number(p.price) },
    ],
    [categories],
  );
  const lv = useListView({
    id: 'cardapio-itens',
    rows: products,
    fields,
    tabs: ITEM_TABS,
    search: (p) => `${p.name} ${p.code ?? ''} ${p.barcode ?? ''}`,
    sorts,
  });
  const chosen = lv.filters.category ?? [];
  const selected = chosen.length === 1 ? chosen[0]! : null;
  const setSelected = (id: string | null) => lv.setField('category', id ? [id] : []);

  // Vindo da busca: abre a categoria certa (o item é destacado pelo "foco") ou um cadastro.
  useLinkParam('categoria', setSelected, categories !== null);
  useLinkParam(
    'acao',
    (a) => {
      if (!canWrite) return;
      if (a === 'categoria') setCatModal('new');
      if (a === 'produto' && categories?.length) newItem(selected ?? categories[0]?.id);
    },
    categories !== null,
  );

  const load = useCallback(async () => {
    try {
      const [c, p, f, g, l] = await Promise.all([
        api<Category[]>('/categories'),
        api<Product[]>('/products'),
        api<Family[]>('/item-families').catch(() => [] as Family[]),
        api<OptionGroup[]>('/option-groups'),
        api<GroupLink[]>('/product-option-groups'),
      ]);
      setCategories(c);
      setProducts(p);
      setFamilies(f);
      setGroups(g);
      setLinks(l);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const loadStock = useCallback(() => {
    api<ProductAvailability[]>('/stock/availability')
      .then((r) => setStock(new Map(r.map((a) => [a.productId, a]))))
      .catch(() => setStock(new Map()));
  }, []);
  useEffect(loadStock, [loadStock]);
  useEffect(() => {
    if (!canWrite) return;
    api<Sector[]>('/sectors')
      .then((s) => setSectors(s.filter((x) => x.active)))
      .catch(() => setSectors([]));
  }, [canWrite]);
  useRealtime((e) => {
    if (e.type === 'menu.changed') void load();
    if (e.type === 'stock.changed' || e.type === 'menu.changed') loadStock();
  });
  const outList = (products ?? []).filter((p) => p.active && !p.soldOut && stockOut(p.id));

  const visible = lv.visible;
  const countBy = (id: string) => (products ?? []).filter((p) => p.categoryId === id).length;

  async function patch(p: Product, json: Partial<Product>, msg?: string) {
    try {
      // Só reflete na tela depois da confirmação do servidor.
      const updated = await api<Product>(`/products/${p.id}`, { method: 'PATCH', json });
      setProducts((list) => list?.map((x) => (x.id === p.id ? updated : x)) ?? null);
      if (msg) toast(msg, 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  async function setCategoryPhoto(c: Category, imageId: string | null) {
    try {
      const updated = await api<Category>(`/categories/${c.id}`, {
        method: 'PATCH',
        json: { imageId },
      });
      setCategories((list) => list?.map((x) => (x.id === c.id ? updated : x)) ?? null);
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  return (
    <>
      {error && <Alert tone="danger">Não foi possível carregar o cardápio: {error}</Alert>}
      {outList.length > 0 && (
        <Alert tone="danger">
          <strong>
            {outList.length === 1
              ? `${outList[0]!.name} está sem estoque`
              : `${outList.length} itens estão sem estoque`}
          </strong>{' '}
          e não dá para vender até dar entrada nos insumos
          {outList.length === 1 ? ` (falta ${stock.get(outList[0]!.id)!.missing.join(', ')})` : ''}.{' '}
          <Link to="/estoque/fichas">Ver fichas técnicas e estoque</Link>
        </Alert>
      )}
      <div className="menu-grid">
        <Card
          title="Categorias"
          bodyless
          actions={
            canWrite && (
              <Button
                variant="secondary"
                icon={<Plus size={16} />}
                onClick={() => setCatModal('new')}
              >
                Nova
              </Button>
            )
          }
        >
          {categories === null ? (
            <div style={{ padding: 16, display: 'grid', gap: 8 }}>
              <Skeleton height={80} />
            </div>
          ) : categories.length === 0 ? (
            <EmptyState title="Sem categorias" />
          ) : (
            <ul className="cat-list">
              {categories.map((c) => (
                <li key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {canWrite && (
                    <ImagePicker
                      label="Foto da categoria"
                      width={36}
                      value={c.imageId}
                      onChange={(id) => setCategoryPhoto(c, id)}
                    />
                  )}
                  <button
                    className="cat-item"
                    style={{ flex: 1 }}
                    aria-current={c.id === selected}
                    onClick={() => setSelected(c.id === selected ? null : c.id)}
                  >
                    <span>
                      {!c.imageId && <span aria-hidden>{categoryIcon(c)} </span>}
                      {c.name}
                    </span>
                    <Badge>{countBy(c.id)}</Badge>
                  </button>
                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Editar categoria ${c.name}`}
                      title="Editar categoria"
                      icon={<Pencil size={14} />}
                      onClick={() => setCatModal(c)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title={(selected && categories?.find((c) => c.id === selected)?.name) || 'Itens'}
          bodyless
          actions={
            canWrite && (
              <Button
                icon={<Plus size={16} />}
                onClick={() => newItem(selected ?? categories?.[0]?.id)}
              >
                Adicionar item
              </Button>
            )
          }
        >
          <ListToolbar
            lv={lv}
            searchLabel="Buscar item"
            placeholder="Buscar por nome, código ou código de barras"
            summary={visible && `${visible.length} ${visible.length === 1 ? 'item' : 'itens'}`}
          />
          {visible === null ? (
            <div style={{ padding: 16 }}>
              <Skeleton height={120} />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<BookOpen size={20} />}
              title={products?.length ? 'Nenhum item encontrado' : 'Nenhum item cadastrado'}
              description={
                canWrite && !products?.length
                  ? 'Adicione o primeiro item para começar a vender.'
                  : 'Tente outra busca ou tire algum filtro.'
              }
            />
          ) : (
            <ListTable>
              <table className="cm-table lv-table mn-items">
                <thead>
                  <tr>
                    <th style={{ width: 72 }}>Foto</th>
                    <th>Item</th>
                    <th>Situação</th>
                    <th className="cm-num">Preço</th>
                    {canWrite && <th />}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => {
                    const opts = groupNames(p.id).join(', ');
                    return (
                      <tr key={p.id} data-search-id={`produto-${p.id}`}>
                        <td className="mn-items__photo">
                          <ImagePicker
                            label={`Foto de ${p.name}`}
                            value={p.imageId}
                            disabled={!canWrite}
                            onChange={(id) =>
                              patch(p, { imageId: id }, id ? 'Foto salva' : 'Foto removida')
                            }
                          />
                        </td>
                        <td className="mn-items__name">
                          <button
                            className="mn-item-link"
                            onClick={() => navigate(`/cardapio/itens/${p.id}`)}
                          >
                            {p.name}
                          </button>
                          <div className="mn-item-meta">
                            {p.code && <span>{p.code}</span>}
                            {!p.active && <span>Pausado</span>}
                            {p.soldByWeight && <span>Por peso</span>}
                            {!selected && (
                              <span>{categories?.find((c) => c.id === p.categoryId)?.name}</span>
                            )}
                          </div>
                          {opts && <div className="cm-hint">Opções: {opts}</div>}
                        </td>
                        <td className="mn-items__state">
                          <SaleState p={p} stock={stock.get(p.id)} />
                        </td>
                        <td className="cm-num mn-items__price">{brl(p.price)}</td>
                        {canWrite && (
                          <td className="cm-num mn-items__acts" style={{ whiteSpace: 'nowrap' }}>
                            <Button
                              variant="ghost"
                              className="mn-hide-sm"
                              onClick={() => navigate(`/cardapio/itens/${p.id}`)}
                            >
                              Editar
                            </Button>{' '}
                            <Button
                              variant="secondary"
                              onClick={() => patch(p, { soldOut: !p.soldOut })}
                            >
                              {p.soldOut ? 'Reativar' : 'Esgotar'}
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ListTable>
          )}
        </Card>
      </div>
      <CategoryModal
        open={catModal !== null}
        category={catModal === 'new' ? null : catModal}
        sectors={sectors}
        onClose={() => setCatModal(null)}
        onSaved={async (c) => {
          const isNew = catModal === 'new';
          setCatModal(null);
          toast(isNew ? 'Categoria criada' : 'Categoria salva', 'success');
          await load();
          if (isNew) setSelected(c.id);
        }}
      />
    </>
  );
}

/** Situação de venda: esgotado à mão, sem estoque pela ficha (com o que falta) ou disponível. */
function SaleState({ p, stock }: { p: Product; stock?: ProductAvailability }) {
  if (p.soldOut) return <Badge tone="danger">Esgotado</Badge>;
  if (stock?.out)
    return (
      <span title={`Falta ${stock.missing.join(', ')}`}>
        <Badge tone="danger">Sem estoque</Badge>
        <div className="cm-hint">Falta {stock.missing.join(', ')}</div>
      </span>
    );
  if (stock && stock.portions !== null && stock.portions <= 5)
    return (
      <Badge tone="warning">
        Restam {stock.portions} {stock.portions === 1 ? 'unidade' : 'unidades'}
      </Badge>
    );
  return <Badge tone="success">Disponível</Badge>;
}
