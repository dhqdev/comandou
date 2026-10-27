import { BookOpen, Plus, Search } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Skeleton,
  TextField,
  useToast,
} from '../../design-system';
import { useCan } from '../../app/auth';
import { ImagePicker } from '../../features/ImagePicker';
import { api, Category, Product } from '../../lib/api';
import { useLinkParam } from '../../lib/deep-link';
import { useRealtime } from '../../lib/realtime';
import { brl } from '../../lib/money';
import type { Family, GroupLink, OptionGroup } from './menu-data';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

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
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState(false);
  const newItem = (categoryId?: string | null) =>
    navigate(`/cardapio/itens/novo${categoryId ? `?categoria=${categoryId}` : ''}`);

  // Vindo da busca: abre a categoria certa (o item é destacado pelo "foco") ou um cadastro.
  useLinkParam('categoria', setSelected, categories !== null);
  useLinkParam(
    'acao',
    (a) => {
      if (!canWrite) return;
      if (a === 'categoria') setNewCategory(true);
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
      setSelected((s) => s ?? c[0]?.id ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'menu.changed') void load();
  });

  const term = fold(search.trim());
  const visible = useMemo(() => {
    const all = products ?? [];
    if (term)
      return all.filter(
        (p) =>
          fold(p.name).includes(term) ||
          fold(p.code ?? '').includes(term) ||
          (p.barcode ?? '').includes(term),
      );
    return all.filter((p) => p.categoryId === selected);
  }, [products, selected, term]);
  const countBy = (id: string) => (products ?? []).filter((p) => p.categoryId === id).length;
  const groupNames = (productId: string) =>
    links
      .filter((l) => l.productId === productId)
      .map((l) => groups.find((g) => g.id === l.groupId)?.name)
      .filter(Boolean)
      .join(', ');

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
      <div className="menu-grid">
        <Card
          title="Categorias"
          bodyless
          actions={
            canWrite && (
              <Button
                variant="secondary"
                icon={<Plus size={16} />}
                onClick={() => setNewCategory(true)}
              >
                Nova
              </Button>
            )
          }
        >
          {categories === null ? (
            <div style={{ padding: 16, display: 'grid', gap: 8 }}>
              <Skeleton height={36} />
              <Skeleton height={36} />
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
                    aria-current={!term && c.id === selected}
                    onClick={() => {
                      setSearch('');
                      setSelected(c.id);
                    }}
                  >
                    {c.name}
                    <Badge>{countBy(c.id)}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title={
            term
              ? `Busca: ${visible.length} ${visible.length === 1 ? 'item' : 'itens'}`
              : (categories?.find((c) => c.id === selected)?.name ?? 'Itens')
          }
          bodyless
          actions={
            canWrite &&
            selected && (
              <Button icon={<Plus size={16} />} onClick={() => newItem(selected)}>
                Adicionar item
              </Button>
            )
          }
        >
          <div className="mn-search">
            <Search size={16} aria-hidden />
            <input
              className="cm-input"
              type="search"
              aria-label="Buscar item"
              placeholder="Buscar por nome, código ou código de barras"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {products === null ? (
            <div style={{ padding: 16 }}>
              <Skeleton height={120} />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<BookOpen size={20} />}
              title={term ? 'Nenhum item encontrado' : 'Nenhum item nesta categoria'}
              description={
                canWrite && !term ? 'Adicione o primeiro item para começar a vender.' : undefined
              }
            />
          ) : (
            <div className="mn-table-wrap">
              <table className="cm-table mn-items">
                <thead>
                  <tr>
                    <th style={{ width: 72 }}>Foto</th>
                    <th>Item</th>
                    <th className="mn-hide-sm">Família</th>
                    <th>Situação</th>
                    <th className="cm-num">Preço</th>
                    {canWrite && <th />}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => {
                    const fam = families.find((f) => f.id === p.familyId);
                    const opts = groupNames(p.id);
                    return (
                      <tr key={p.id} data-search-id={`produto-${p.id}`}>
                        <td>
                          <ImagePicker
                            label={`Foto de ${p.name}`}
                            value={p.imageId}
                            disabled={!canWrite}
                            onChange={(id) =>
                              patch(p, { imageId: id }, id ? 'Foto salva' : 'Foto removida')
                            }
                          />
                        </td>
                        <td>
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
                          </div>
                          {opts && <div className="cm-hint">Opções: {opts}</div>}
                        </td>
                        <td className="mn-hide-sm">
                          {fam ? fam.name : <span className="cm-hint">Sem família</span>}
                        </td>
                        <td>
                          {p.soldOut ? (
                            <Badge tone="danger">Esgotado</Badge>
                          ) : (
                            <Badge tone="success">Disponível</Badge>
                          )}
                        </td>
                        <td className="cm-num">{brl(p.price)}</td>
                        {canWrite && (
                          <td className="cm-num" style={{ whiteSpace: 'nowrap' }}>
                            <Button
                              variant="ghost"
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
            </div>
          )}
        </Card>
      </div>
      <CategoryModal
        open={newCategory}
        onClose={() => setNewCategory(false)}
        onSaved={async (c) => {
          setNewCategory(false);
          toast('Categoria criada', 'success');
          await load();
          setSelected(c.id);
        }}
      />
    </>
  );
}

function CategoryModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose(): void;
  onSaved(c: Category): void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const c = await api<Category>('/categories', { method: 'POST', json: { name } });
      setName('');
      onSaved(c);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} title="Nova categoria" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
        <TextField
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
        />
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" loading={busy} disabled={!name.trim()}>
          Salvar
        </Button>
      </form>
    </Modal>
  );
}
