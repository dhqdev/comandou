import { FolderTree, Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { CheckField } from '../../features/forms';
import { api, type Product } from '../../lib/api';
import { useRealtime } from '../../lib/realtime';
import type { Family } from './menu-data';

/** Famílias de itens: agrupam as vendas nos relatórios. */
export function FamiliesTab() {
  const canWrite = useCan('catalog:write');
  const [families, setFamilies] = useState<Family[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [editing, setEditing] = useState<Family | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [f, p] = await Promise.all([
        api<Family[]>('/item-families'),
        api<Product[]>('/products'),
      ]);
      setFamilies(f);
      setProducts(p);
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
  const without = products.filter((p) => !p.familyId).length;

  return (
    <Card
      title="Famílias de itens"
      bodyless
      actions={
        canWrite && (
          <Button icon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Nova família
          </Button>
        )
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {families !== null && without > 0 && families.length > 0 && (
        <p className="mn-banner">
          {without} {without === 1 ? 'item está' : 'itens estão'} sem família: nos relatórios eles
          aparecem juntos em “Sem família”.
        </p>
      )}
      {families === null ? (
        <div style={{ padding: 16 }}>
          <Skeleton height={120} />
        </div>
      ) : families.length === 0 ? (
        <EmptyState
          icon={<FolderTree size={20} />}
          title="Nenhuma família ainda"
          description="Ex.: Lanches, Bebidas, Sobremesas, Sabores de pizza. Os relatórios mostram quanto cada família vendeu."
        />
      ) : (
        <div className="mn-table-wrap">
          <table className="cm-table">
            <thead>
              <tr>
                <th>Família</th>
                <th className="cm-num">Itens</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {families.map((f) => (
                <tr key={f.id}>
                  <td>
                    <button className="mn-item-link" onClick={() => setEditing(f)}>
                      {f.name}
                    </button>
                    {f.countsAsProduct && (
                      <div className="cm-hint">Conta como produto na análise de cardápio</div>
                    )}
                  </td>
                  <td className="cm-num">{f.items}</td>
                  <td>{f.active ? <Badge tone="success">Ativa</Badge> : <Badge>Inativa</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <FamilyModal
        family={editing}
        products={products}
        canWrite={canWrite}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />
    </Card>
  );
}

/** Cadastro da família e quais itens fazem parte dela (dá para marcar vários de uma vez). */
export function FamilyModal({
  family,
  products,
  canWrite,
  onClose,
  onSaved,
}: {
  family: Family | 'new' | null;
  products: Product[];
  canWrite: boolean;
  onClose(): void;
  onSaved(f: Family): void;
}) {
  const toast = useToast();
  const isNew = family === 'new';
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [countsAsProduct, setCountsAsProduct] = useState(false);
  const [members, setMembers] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!family) return;
    setError(null);
    setSearch('');
    setName(family === 'new' ? '' : family.name);
    setActive(family === 'new' ? true : family.active);
    setCountsAsProduct(family === 'new' ? false : family.countsAsProduct);
    setMembers(
      family === 'new' ? [] : products.filter((p) => p.familyId === family.id).map((p) => p.id),
    );
  }, [family, products]);
  const term = search.trim().toLowerCase();
  const list = useMemo(
    () => products.filter((p) => !term || p.name.toLowerCase().includes(term)),
    [products, term],
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), active, countsAsProduct };
      const saved = isNew
        ? await api<Family>('/item-families', { method: 'POST', json: body })
        : await api<Family>(`/item-families/${(family as Family).id}`, {
            method: 'PATCH',
            json: body,
          });
      const want = new Set(members);
      for (const p of products) {
        const inFam = p.familyId === saved.id;
        if (inFam === want.has(p.id)) continue;
        await api(`/products/${p.id}`, {
          method: 'PATCH',
          json: { familyId: want.has(p.id) ? saved.id : null },
        });
      }
      toast(isNew ? 'Família criada' : 'Família salva', 'success');
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!family}
      onClose={onClose}
      size="lg"
      title={isNew ? 'Nova família' : name || 'Família'}
      footer={
        canWrite && (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={busy} disabled={!name.trim()} onClick={save}>
              Salvar
            </Button>
          </>
        )
      }
    >
      <div className="cm-form">
        <TextField
          label="Nome da família"
          wrapClass="cm-form__wide"
          placeholder="Ex.: Bebidas"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="cm-form__wide mn-checks">
          <CheckField
            label="Inativa"
            description="Some da escolha de família no cadastro do item."
            checked={!active}
            onChange={(v) => setActive(!v)}
          />
          <CheckField
            label="Vendido como complemento, conta como produto"
            description="Ligue na família dos sabores de pizza: na análise de cardápio a pizza meio a meio conta meia de cada sabor. Bordas e adicionais ficam em famílias com esta opção desligada."
            checked={countsAsProduct}
            onChange={setCountsAsProduct}
          />
        </div>
        <h3 className="cm-form__section">Itens desta família ({members.length})</h3>
        <div className="mn-picker cm-form__wide">
          <div className="mn-search mn-search--flat">
            <Search size={16} aria-hidden />
            <input
              className="cm-input"
              type="search"
              aria-label="Buscar item para a família"
              placeholder="Buscar item"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="mn-picker__list">
            {list.map((p) => (
              <label key={p.id} className="mn-check">
                <input
                  type="checkbox"
                  checked={members.includes(p.id)}
                  disabled={!canWrite}
                  onChange={(e) =>
                    setMembers((m) =>
                      e.target.checked ? [...m, p.id] : m.filter((x) => x !== p.id),
                    )
                  }
                />
                <span>{p.name}</span>
              </label>
            ))}
          </div>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}
