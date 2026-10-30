import { fromCents, toCents } from '@comandou/shared';
import { ArrowLeft, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  Skeleton,
  TextField,
  useToast,
  HelpLabel,
  HelpScope,
} from '../../design-system';
import { useCan } from '../../app/auth';
import { api, type Category, type Product } from '../../lib/api';
import { brl, parseBrlInput } from '../../lib/money';
import { MENU_KIND, priceDiff, toInput, type MenuDef } from './menu-data';
import { MENUS_HELP } from '../../features/help/menu-help';

interface Row {
  on: boolean;
  price: string;
}

/** Itens do cardápio e preço próprio de cada um (vazio = preço do item). */
export function MenuEditor() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const canWrite = useCan('catalog:write');
  const [menu, setMenu] = useState<MenuDef | null>(null);
  const [name, setName] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [search, setSearch] = useState('');
  const [pct, setPct] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [menus, c, p, items] = await Promise.all([
          api<MenuDef[]>('/menus'),
          api<Category[]>('/categories'),
          api<Product[]>('/products'),
          api<{ productId: string; price: string | null }[]>(`/menus/${id}/items`),
        ]);
        const m = menus.find((x) => x.id === id);
        if (!m) throw new Error('Cardápio não encontrado');
        setMenu(m);
        setName(m.name);
        setCategories(c);
        setProducts(p);
        const map: Record<string, Row> = {};
        for (const prod of p) {
          const it = items.find((i) => i.productId === prod.id);
          map[prod.id] = { on: !!it, price: toInput(it?.price) };
        }
        setRows(map);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id]);

  const term = search.trim().toLowerCase();
  const grouped = useMemo(
    () =>
      categories
        .map((c) => ({
          c,
          items: products.filter(
            (p) =>
              p.categoryId === c.id &&
              (!term ||
                p.name.toLowerCase().includes(term) ||
                (p.code ?? '').toLowerCase().includes(term)),
          ),
        }))
        .filter((g) => g.items.length),
    [categories, products, term],
  );
  const set = (pid: string, r: Partial<Row>) => {
    setDirty(true);
    setRows((x) => ({ ...x, [pid]: { ...x[pid]!, ...r } }));
  };
  const visibleIds = grouped.flatMap((g) => g.items.map((p) => p.id));
  const onCount = Object.values(rows).filter((r) => r.on).length;
  const invalid = Object.values(rows).some((r) => r.on && r.price && !parseBrlInput(r.price));
  const pctN = Number(pct.replace(',', '.'));
  const pctOk = pct.trim() !== '' && Number.isFinite(pctN) && pctN > -90 && pctN <= 300;

  function applyPct() {
    if (!pctOk) return;
    setDirty(true);
    setRows((x) => {
      const copy = { ...x };
      for (const pid of visibleIds) {
        const p = products.find((y) => y.id === pid)!;
        if (!copy[pid]!.on) continue;
        const cents = Math.round((toCents(p.price) * (100 + pctN)) / 100);
        copy[pid] = { ...copy[pid]!, price: toInput(fromCents(cents)) };
      }
      return copy;
    });
  }
  function bulk(r: Partial<Row>) {
    setDirty(true);
    setRows((x) => {
      const copy = { ...x };
      for (const pid of visibleIds) copy[pid] = { ...copy[pid]!, ...r };
      return copy;
    });
  }

  async function save() {
    if (!menu) return;
    setBusy(true);
    try {
      if (name.trim() && name.trim() !== menu.name)
        await api(`/menus/${id}`, { method: 'PATCH', json: { name: name.trim() } });
      await api(`/menus/${id}/items`, {
        method: 'PUT',
        json: {
          items: Object.entries(rows)
            .filter(([, r]) => r.on)
            .map(([productId, r]) => ({
              productId,
              price: r.price ? parseBrlInput(r.price) : null,
            })),
        },
      });
      setDirty(false);
      setMenu({ ...menu, name: name.trim() || menu.name });
      toast('Cardápio salvo', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!menu) return;
    try {
      const r = await api<MenuDef>(`/menus/${id}`, {
        method: 'PATCH',
        json: { active: !menu.active },
      });
      setMenu({ ...menu, active: r.active });
      toast(r.active ? 'Cardápio ativado' : 'Cardápio pausado', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  async function remove() {
    if (!menu || !window.confirm(`Apagar o cardápio ${menu.name}?`)) return;
    try {
      await api(`/menus/${id}`, { method: 'DELETE' });
      toast('Cardápio apagado', 'success');
      navigate('/cardapio/cardapios');
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  return (
    <HelpScope dict={MENUS_HELP}>
      <>
        <div className="mn-crumbs">
          <div className="mn-crumbs__path">
            <Link to="/cardapio/cardapios" className="mn-crumbs__back">
              <ArrowLeft size={16} aria-hidden /> Cardápios
            </Link>
            <span aria-hidden>/</span>
            <h1>{menu?.name ?? 'Cardápio'}</h1>
            {menu && (menu.active ? <Badge tone="success">Ativo</Badge> : <Badge>Pausado</Badge>)}
          </div>
          {canWrite && menu && (
            <div className="actions-row">
              {!menu.active && (
                <Button variant="ghost" onClick={remove}>
                  Apagar
                </Button>
              )}
              <Button variant="secondary" onClick={toggleActive}>
                {menu.active ? 'Pausar' : 'Ativar'}
              </Button>
              <Button loading={busy} disabled={invalid || !dirty} onClick={save}>
                Salvar
              </Button>
            </div>
          )}
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        {!menu ? (
          !error && <Skeleton height={240} />
        ) : (
          <>
            <Card>
              <div className="cm-form">
                <TextField
                  label="Nome do cardápio"
                  value={name}
                  maxLength={60}
                  disabled={!canWrite}
                  onChange={(e) => {
                    setName(e.target.value);
                    setDirty(true);
                  }}
                />
                <div className="cm-field">
                  <HelpLabel as="span">Vale em</HelpLabel>
                  <span className="mn-static">
                    {MENU_KIND[menu.kind].label}: {MENU_KIND[menu.kind].where.toLowerCase()}
                  </span>
                </div>
                {!menu.active && (
                  <p className="cm-hint cm-form__wide" style={{ margin: 0 }}>
                    Pausado: não aparece em lugar nenhum. Ao ativar, ele substitui o{' '}
                    {MENU_KIND[menu.kind].label} atual.
                  </p>
                )}
              </div>
            </Card>
            <Card title={`Itens no cardápio (${onCount} de ${products.length})`} bodyless>
              <div className="mn-toolbar">
                <div className="mn-search mn-search--flat">
                  <Search size={16} aria-hidden />
                  <input
                    className="cm-input"
                    type="search"
                    aria-label="Buscar item no cardápio"
                    placeholder="Buscar item"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {canWrite && (
                  <div className="mn-toolbar__tools">
                    <Button variant="ghost" size="sm" onClick={() => bulk({ on: true })}>
                      Marcar todos
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => bulk({ price: '' })}>
                      Usar preço do item
                    </Button>
                    <span className="mn-pct">
                      <input
                        className="cm-input cm-num"
                        aria-label="Reajuste em %"
                        inputMode="decimal"
                        placeholder="+10"
                        value={pct}
                        onChange={(e) => setPct(e.target.value)}
                      />
                      <span>%</span>
                      <Button variant="secondary" size="sm" disabled={!pctOk} onClick={applyPct}>
                        Reajustar
                      </Button>
                    </span>
                  </div>
                )}
              </div>
              {grouped.map(({ c, items }) => (
                <section key={c.id} className="mn-menu-cat">
                  <h3>{c.name}</h3>
                  {items.map((p) => {
                    const r = rows[p.id]!;
                    const parsed = r.price ? parseBrlInput(r.price) : null;
                    const diff = parsed ? priceDiff(toCents(p.price), toCents(parsed)) : null;
                    return (
                      <div key={p.id} className="mn-menu-row" data-off={!r.on || undefined}>
                        <label className="mn-check">
                          <input
                            type="checkbox"
                            checked={r.on}
                            disabled={!canWrite}
                            onChange={(e) => set(p.id, { on: e.target.checked })}
                          />
                          <span>
                            <strong>{p.name}</strong>
                            {p.code && <small className="cm-hint"> {p.code}</small>}
                          </span>
                        </label>
                        <span className="mn-menu-row__base cm-hint">Item: {brl(p.price)}</span>
                        <input
                          className="cm-input cm-num"
                          aria-label={`Preço de ${p.name} neste cardápio`}
                          inputMode="decimal"
                          placeholder={brl(p.price)}
                          disabled={!canWrite || !r.on}
                          value={r.price}
                          aria-invalid={(r.price && !parsed) || undefined}
                          onChange={(e) => set(p.id, { price: e.target.value })}
                        />
                        <span className="mn-menu-row__diff">{diff ?? ''}</span>
                      </div>
                    );
                  })}
                </section>
              ))}
            </Card>
          </>
        )}
      </>
    </HelpScope>
  );
}
