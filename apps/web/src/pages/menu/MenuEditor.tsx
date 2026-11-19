import { toCents } from '@comandou/shared';
import { ArrowLeft, Pause, Pencil, Percent, Play, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  ItemThumb,
  Skeleton,
  TextField,
  useToast,
  HelpLabel,
  HelpScope,
  SaveNote,
  type SaveNoteState,
} from '../../design-system';
import { useCan } from '../../app/auth';
import { api, type Category, type Product } from '../../lib/api';
import { mediaUrl } from '../../lib/media';
import { brl, parseBrlInput } from '../../lib/money';
import type { Sector } from '../../lib/types';
import { MENUS_HELP } from '../../features/help/menu-help';
import { CategoryModal, categoryIcon } from './CategoryModal';
import { kindWhere, MENU_KIND, priceDiff, toInput, type MenuDef } from './menu-data';
import { IfoodConnectionField } from './IfoodConnections';
import { IfoodDriftCard } from './IfoodDriftCard';
import { IfoodSyncCard } from './IfoodSyncCard';
import { PriceAdjustModal } from './PriceAdjustModal';
import {
  describeMenuChanges,
  invalidPrices,
  itemsChanged,
  nameChanged,
  type MenuRow as Row,
  type MenuSnapshot,
} from './menu-changes';

/** Espera depois da última mudança antes de gravar (dá tempo de terminar de digitar o preço). */
const AUTOSAVE_MS = 800;

/**
 * Editor do cardápio: categorias em abas, itens com foto, preço próprio e liga/desliga.
 * Reajustar preços muda vários de uma vez; Nova categoria cria com ícone e cozinha.
 * Sem botão Salvar: cada mudança é gravada sozinha e um cartão pequeno embaixo diz o que mudou.
 */
export function MenuEditor() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const canWrite = useCan('catalog:write');
  const [menu, setMenu] = useState<MenuDef | null>(null);
  const [name, setName] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [catSel, setCatSel] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<SaveNoteState | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [catModal, setCatModal] = useState<Category | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
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
      saved.current = { name: m.name, rows: map };
      current.current = { name: m.name, rows: map };
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!canWrite) return;
    api<Sector[]>('/sectors')
      .then((s) => setSectors(s.filter((x) => x.active)))
      .catch(() => setSectors([]));
  }, [canWrite]);

  const term = search.trim().toLowerCase();
  const grouped = useMemo(
    () =>
      categories
        .filter((c) => !catSel || c.id === catSel)
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
        .filter((g) => g.items.length || g.c.id === catSel),
    [categories, products, term, catSel],
  );
  const set = (pid: string, r: Partial<Row>) => {
    setRows((x) => ({ ...x, [pid]: { ...x[pid]!, ...r } }));
  };
  const visibleIds = grouped.flatMap((g) => g.items.map((p) => p.id));
  const onCount = Object.values(rows).filter((r) => r.on).length;
  const countIn = (cid: string) =>
    products.filter((p) => p.categoryId === cid && rows[p.id]?.on).length;

  function bulk(r: Partial<Row>) {
    setRows((x) => {
      const copy = { ...x };
      for (const pid of visibleIds) copy[pid] = { ...copy[pid]!, ...r };
      return copy;
    });
  }

  // Salvamento automático. `saved` é o que o servidor tem; `current`, o que está na tela.
  // Uma gravação por vez: mudança no meio de uma gravação entra na seguinte.
  const saved = useRef<MenuSnapshot | null>(null);
  const current = useRef<MenuSnapshot | null>(null);
  const products$ = useRef(products);
  const inFlight = useRef(false);
  const again = useRef(false);
  const noteId = useRef(0);
  products$.current = products;
  if (saved.current) current.current = { name, rows };
  const pending = (snap = current.current) =>
    !!saved.current &&
    !!snap &&
    (nameChanged(saved.current, snap) || itemsChanged(saved.current, snap));
  const unsaved = saving || pending({ name, rows });
  const show = (state: SaveNoteState['state'], lines: string[]) =>
    setNote({ id: ++noteId.current, state, lines });

  const flush = useCallback(async (): Promise<void> => {
    const base = saved.current;
    const snap = current.current;
    if (!base || !snap) return;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    const bad = invalidPrices(snap, products$.current);
    if (bad.length) {
      show(
        'invalid',
        bad.map((p) => `Preço de ${p.name}: use o formato 12,90`),
      );
      return;
    }
    const doName = nameChanged(base, snap);
    const doItems = itemsChanged(base, snap);
    if (!doName && !doItems) return;
    inFlight.current = true;
    setSaving(true);
    show('saving', []);
    try {
      if (doName) await api(`/menus/${id}`, { method: 'PATCH', json: { name: snap.name.trim() } });
      if (doItems)
        await api(`/menus/${id}/items`, {
          method: 'PUT',
          json: {
            items: Object.entries(snap.rows)
              .filter(([, r]) => r.on)
              .map(([productId, r]) => ({
                productId,
                price: r.price ? parseBrlInput(r.price) : null,
              })),
          },
        });
      const lines = describeMenuChanges(base, snap, products$.current);
      saved.current = {
        name: doName ? snap.name.trim() : base.name,
        rows: doItems ? snap.rows : base.rows,
      };
      if (doName) setMenu((m) => (m ? { ...m, name: snap.name.trim() } : m));
      show('saved', lines);
    } catch (e) {
      show('error', [(e as Error).message]);
      again.current = false;
      return;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
    // Mudou algo enquanto gravava: grava de novo.
    if (again.current || pending()) {
      again.current = false;
      await flush();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Cada mudança (nome, liga/desliga, preço) agenda a gravação.
  useEffect(() => {
    if (!canWrite || !saved.current) return;
    if (!pending({ name, rows })) {
      // Voltou ao que já estava salvo: o aviso de "corrija" não vale mais.
      setNote((n) => (n?.state === 'invalid' ? null : n));
      return;
    }
    const t = setTimeout(() => void flush(), AUTOSAVE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, rows, canWrite, flush]);

  // Saindo da tela (outra página do sistema) com algo esperando: grava na hora.
  useEffect(
    () => () => {
      if (pending()) void flush();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flush],
  );
  // Fechando a aba ou recarregando no meio de uma gravação: o navegador pergunta antes.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

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

  const selectedCat = categories.find((c) => c.id === catSel) ?? null;

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
            {menu && <Badge tone="info">{MENU_KIND[menu.kind].label}</Badge>}
            {menu && (menu.active ? <Badge tone="success">Ativo</Badge> : <Badge>Pausado</Badge>)}
          </div>
          {canWrite && menu && (
            <div className="actions-row mn-editor-actions">
              {/* No celular os botões viram só o ícone (o nome fica no aria-label). */}
              {!menu.active && (
                <Button
                  variant="ghost"
                  icon={<Trash2 size={16} />}
                  aria-label="Apagar"
                  title="Apagar"
                  onClick={remove}
                >
                  <span className="mn-btn-text">Apagar</span>
                </Button>
              )}
              <Button
                variant="ghost"
                icon={menu.active ? <Pause size={16} /> : <Play size={16} />}
                aria-label={menu.active ? 'Pausar' : 'Ativar'}
                onClick={toggleActive}
              >
                <span className="mn-btn-text">{menu.active ? 'Pausar' : 'Ativar'}</span>
              </Button>
              <Button
                variant="secondary"
                icon={<Percent size={16} />}
                aria-label="Reajustar preços"
                title="Reajustar preços"
                onClick={() => setAdjusting(true)}
              >
                <span className="mn-btn-text">Reajustar preços</span>
              </Button>
              <Button
                variant="secondary"
                icon={<Plus size={16} />}
                aria-label="Nova categoria"
                title="Nova categoria"
                onClick={() => setCatModal('new')}
              >
                <span className="mn-btn-text">Nova categoria</span>
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
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => void flush()}
                />
                <div className="cm-field">
                  <HelpLabel as="span">Vale em</HelpLabel>
                  <span className="mn-static">
                    {MENU_KIND[menu.kind].label}: {kindWhere(menu.kind)}
                  </span>
                </div>
                {menu.kind === 'ifood' && (
                  <IfoodConnectionField
                    menu={menu}
                    disabled={!canWrite}
                    onChange={(c) => setMenu({ ...menu, ...c })}
                  />
                )}
                {menu.kind === 'ifood'
                  ? !menu.active && (
                      <p className="cm-hint cm-form__wide" style={{ margin: 0 }}>
                        Pausado: as alterações só vão ao iFood quando você tocar em Sincronizar.
                      </p>
                    )
                  : !menu.active && (
                      <p className="cm-hint cm-form__wide" style={{ margin: 0 }}>
                        Pausado: não aparece em lugar nenhum. Ao ativar, ele substitui o{' '}
                        {MENU_KIND[menu.kind].label} atual.
                      </p>
                    )}
              </div>
            </Card>
            {/* Cartões extras por tipo de cardápio (ex.: integração) entram aqui. */}
            {menu.kind === 'ifood' && (
              <IfoodSyncCard
                key={menu.ifoodConnectionId ?? 'sem-loja'}
                menuId={menu.id}
                active={menu.active}
                canWrite={canWrite}
                dirty={unsaved}
              />
            )}
            {menu.kind === 'ifood' && menu.ifoodConnectionId && (
              <IfoodDriftCard
                key={`drift-${menu.ifoodConnectionId}`}
                menuId={menu.id}
                canWrite={canWrite}
              />
            )}
            <Card title={`Itens no cardápio (${onCount} de ${products.length})`} bodyless>
              <div className="mn-chips" role="tablist" aria-label="Categorias do cardápio">
                <button
                  role="tab"
                  className="mn-chip"
                  aria-selected={!catSel}
                  onClick={() => setCatSel(null)}
                >
                  Todas <span className="mn-chip__n">{onCount}</span>
                </button>
                {categories.map((c) => (
                  <span key={c.id} className="mn-chip-wrap">
                    <button
                      role="tab"
                      className="mn-chip"
                      aria-selected={c.id === catSel}
                      onClick={() => setCatSel(c.id === catSel ? null : c.id)}
                    >
                      <span aria-hidden>{categoryIcon(c)}</span> {c.name}{' '}
                      <span className="mn-chip__n">{countIn(c.id)}</span>
                    </button>
                    {canWrite && c.id === catSel && (
                      <button
                        className="mn-chip__edit"
                        aria-label={`Editar categoria ${c.name}`}
                        title="Editar categoria"
                        onClick={() => setCatModal(c)}
                      >
                        <Pencil size={13} aria-hidden />
                      </button>
                    )}
                  </span>
                ))}
              </div>
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
                      Ligar todos
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => bulk({ price: '' })}>
                      Usar preço do item
                    </Button>
                    <Button
                      size="sm"
                      icon={<Plus size={14} />}
                      onClick={() =>
                        navigate(`/cardapio/itens/novo${catSel ? `?categoria=${catSel}` : ''}`)
                      }
                    >
                      Novo item
                    </Button>
                  </div>
                )}
              </div>
              {grouped.length === 0 && (
                <p className="cm-hint" style={{ padding: 16, margin: 0 }}>
                  {term ? 'Nenhum item encontrado.' : 'Nenhuma categoria ainda.'}
                </p>
              )}
              {grouped.map(({ c, items }) => (
                <section key={c.id} className="mn-menu-cat">
                  {!catSel && (
                    <h3>
                      <span aria-hidden>{categoryIcon(c)}</span> {c.name}
                    </h3>
                  )}
                  {items.length === 0 && (
                    <p className="cm-hint" style={{ padding: '8px 16px', margin: 0 }}>
                      Nenhum item em {selectedCat?.name ?? c.name}.
                    </p>
                  )}
                  {items.map((p) => {
                    const r = rows[p.id]!;
                    const parsed = r.price ? parseBrlInput(r.price) : null;
                    const diff = parsed ? priceDiff(toCents(p.price), toCents(parsed)) : null;
                    return (
                      <div key={p.id} className="mn-menu-row" data-off={!r.on || undefined}>
                        <span className="mn-menu-row__item">
                          <ItemThumb src={mediaUrl(p.imageId)} name={p.name} size={40} />
                          <span className="mn-menu-row__name">
                            <strong>{p.name}</strong>
                            <small className="cm-hint">
                              {[
                                p.code,
                                p.fiscalUnit || 'UN',
                                !p.active && 'Pausado',
                                p.soldOut && 'Esgotado',
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </small>
                          </span>
                        </span>
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
                          onBlur={() => void flush()}
                        />
                        <span className="mn-menu-row__diff">{diff ?? ''}</span>
                        <span className="mn-menu-row__acts">
                          <label className="mn-switch">
                            <input
                              type="checkbox"
                              role="switch"
                              aria-label={`${p.name} no cardápio`}
                              checked={r.on}
                              disabled={!canWrite}
                              onChange={(e) => set(p.id, { on: e.target.checked })}
                            />
                            <span aria-hidden />
                          </label>
                          {canWrite && (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Editar ${p.name}`}
                              title="Editar item"
                              icon={<Pencil size={15} />}
                              onClick={() => navigate(`/cardapio/itens/${p.id}`)}
                            />
                          )}
                        </span>
                      </div>
                    );
                  })}
                </section>
              ))}
            </Card>
          </>
        )}
        {menu && (
          <PriceAdjustModal
            open={adjusting}
            menuId={menu.id}
            menuName={menu.name}
            categories={categories}
            blocked={unsaved}
            initialCategoryId={catSel}
            onClose={() => setAdjusting(false)}
            onApplied={async (r) => {
              setAdjusting(false);
              const n = r.items.length + r.options.length;
              toast(`${n} ${n === 1 ? 'preço reajustado' : 'preços reajustados'}`, 'success');
              await load();
            }}
          />
        )}
        <SaveNote note={note} onRetry={() => void flush()} />
        <CategoryModal
          open={catModal !== null}
          category={catModal === 'new' ? null : catModal}
          sectors={sectors}
          onClose={() => setCatModal(null)}
          onSaved={(c) => {
            const isNew = catModal === 'new';
            setCatModal(null);
            setCategories((list) =>
              isNew ? [...list, c] : list.map((x) => (x.id === c.id ? c : x)),
            );
            if (isNew) setCatSel(c.id);
            toast(isNew ? 'Categoria criada' : 'Categoria salva', 'success');
          }}
        />
      </>
    </HelpScope>
  );
}
