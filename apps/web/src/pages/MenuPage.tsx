import { BookOpen, Plus } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
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
} from '../design-system';
import { useCan } from '../app/auth';
import { ImagePicker } from '../features/ImagePicker';
import { OptionGroup, OptionGroupsCard, ProductConfigModal } from '../features/OptionGroups';
import { api, Category, Product } from '../lib/api';
import { useRealtime } from '../lib/realtime';
import type { Sector } from '../lib/types';
import { brl, parseBrlInput } from '../lib/money';

export function MenuPage() {
  const canWrite = useCan('catalog:write');
  const toast = useToast();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<'category' | 'product' | null>(null);
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [links, setLinks] = useState<{ productId: string; groupId: string }[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [configuring, setConfiguring] = useState<Product | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, p, g, l, s] = await Promise.all([
        api<Category[]>('/categories'),
        api<Product[]>('/products'),
        api<OptionGroup[]>('/option-groups'),
        api<{ productId: string; groupId: string }[]>('/product-option-groups'),
        api<Sector[]>('/sectors').catch(() => [] as Sector[]),
      ]);
      setCategories(c);
      setProducts(p);
      setGroups(g);
      setLinks(l);
      setSectors(s.filter((x) => x.active));
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
  const linkedOf = useCallback(
    (productId: string) => links.filter((l) => l.productId === productId).map((l) => l.groupId),
    [links],
  );
  const configLinks = useMemo(
    () => (configuring ? linkedOf(configuring.id) : []),
    [configuring, linkedOf],
  );

  const visible = useMemo(
    () => (products ?? []).filter((p) => p.categoryId === selected),
    [products, selected],
  );
  const countBy = (id: string) => (products ?? []).filter((p) => p.categoryId === id).length;

  async function setPhoto(p: Product, imageId: string | null) {
    try {
      const updated = await api<Product>(`/products/${p.id}`, {
        method: 'PATCH',
        json: { imageId },
      });
      setProducts((list) => list?.map((x) => (x.id === p.id ? updated : x)) ?? null);
      toast(imageId ? 'Foto salva' : 'Foto removida', 'success');
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

  async function toggleSoldOut(p: Product) {
    try {
      // Só reflete na tela depois da confirmação do servidor.
      const updated = await api<Product>(`/products/${p.id}`, {
        method: 'PATCH',
        json: { soldOut: !p.soldOut },
      });
      setProducts((list) => list?.map((x) => (x.id === p.id ? updated : x)) ?? null);
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  return (
    <>
      <div>
        <h1 className="page-title">Cardápio</h1>
        <p className="page-sub">
          Categorias, produtos e fotos exibidos no PDV e no{' '}
          <a href="/pedir" target="_blank" rel="noreferrer">
            cardápio online
          </a>
          . Toque na miniatura para enviar a foto (pode arrastar o arquivo).
        </p>
      </div>
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
                onClick={() => setModal('category')}
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
                    aria-current={c.id === selected}
                    onClick={() => setSelected(c.id)}
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
          title={categories?.find((c) => c.id === selected)?.name ?? 'Produtos'}
          bodyless
          actions={
            canWrite &&
            selected && (
              <Button icon={<Plus size={16} />} onClick={() => setModal('product')}>
                Adicionar item
              </Button>
            )
          }
        >
          {products === null ? (
            <div style={{ padding: 16 }}>
              <Skeleton height={120} />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<BookOpen size={20} />}
              title="Nenhum produto nesta categoria"
              description={canWrite ? 'Adicione o primeiro item para começar a vender.' : undefined}
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="cm-table">
                <thead>
                  <tr>
                    <th style={{ width: 72 }}>Foto</th>
                    <th>Produto</th>
                    <th>Situação</th>
                    <th className="cm-num">Preço</th>
                    {canWrite && <th />}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <ImagePicker
                          label={`Foto de ${p.name}`}
                          value={p.imageId}
                          disabled={!canWrite}
                          onChange={(id) => setPhoto(p, id)}
                        />
                      </td>
                      <td>
                        <strong>{p.name}</strong>
                        {p.description && <div className="cm-hint">{p.description}</div>}
                        {linkedOf(p.id).length > 0 && (
                          <div className="cm-hint">
                            Opções:{' '}
                            {linkedOf(p.id)
                              .map((id) => groups.find((g) => g.id === id)?.name)
                              .filter(Boolean)
                              .join(', ')}
                          </div>
                        )}
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
                          <Button variant="ghost" onClick={() => setConfiguring(p)}>
                            Configurar
                          </Button>{' '}
                          <Button variant="secondary" onClick={() => toggleSoldOut(p)}>
                            {p.soldOut ? 'Reativar' : 'Esgotar'}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      <OptionGroupsCard groups={groups} canWrite={canWrite} onChanged={load} />
      <ProductConfigModal
        product={configuring}
        groups={groups.filter((g) => g.active)}
        sectors={sectors}
        linked={configLinks}
        onClose={() => setConfiguring(null)}
        onSaved={async () => {
          setConfiguring(null);
          toast('Produto atualizado', 'success');
          await load();
        }}
      />
      <CategoryModal
        open={modal === 'category'}
        onClose={() => setModal(null)}
        onSaved={async (c) => {
          setModal(null);
          toast('Categoria criada', 'success');
          await load();
          setSelected(c.id);
        }}
      />
      {selected && (
        <ProductModal
          open={modal === 'product'}
          categoryId={selected}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            toast('Produto adicionado', 'success');
            await load();
          }}
        />
      )}
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

function ProductModal({
  open,
  categoryId,
  onClose,
  onSaved,
}: {
  open: boolean;
  categoryId: string;
  onClose(): void;
  onSaved(): void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseBrlInput(price);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!parsed) return;
    setBusy(true);
    try {
      await api('/products', {
        method: 'POST',
        json: { categoryId, name, description: description || undefined, price: parsed },
      });
      setName('');
      setDescription('');
      setPrice('');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} title="Adicionar item" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
        <TextField
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
        />
        <TextField
          label="Descrição"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <TextField
          label="Preço"
          inputMode="decimal"
          placeholder="0,00"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          error={price && !parsed ? 'Use o formato 12,90' : undefined}
          hint="Valor em reais"
          required
        />
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" loading={busy} disabled={!name.trim() || !parsed}>
          Salvar
        </Button>
      </form>
    </Modal>
  );
}
