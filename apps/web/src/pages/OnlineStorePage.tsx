import { toCents } from '@comandou/shared';
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  ImagePlus,
  Link2,
  Pencil,
  Plus,
  RotateCw,
  Smartphone,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../app/auth';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Segmented,
  Select,
  Spinner,
  TextField,
  useToast,
} from '../design-system';
import { ImagePicker } from '../features/ImagePicker';
import { SlideTabs } from '../features/SlideTabs';
import { StoreSettingsCard } from '../features/StoreSettingsCard';
import { api, Category, Product } from '../lib/api';
import { mediaUrl } from '../lib/media';
import { brl } from '../lib/money';
import type { StoreBanner, StoreSettings } from '../lib/types';
import './online-store.css';

type Tab = 'aparencia' | 'banners' | 'destaques' | 'funcionamento';
const BADGES = ['Novo', 'Mais vendido', 'Picante', 'Vegano', 'Promoção', 'Do chef'];

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange(v: boolean): void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="os-toggle">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <span className="switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="switch__track" aria-hidden />
      </span>
    </label>
  );
}

/** Aparência: capa, logo, tema, títulos e o que aparece no cardápio. */
function AppearanceTab({ onSaved, canManage }: { onSaved(): void; canManage: boolean }) {
  const toast = useToast();
  const [s, setS] = useState<StoreSettings | null>(null);
  const [form, setForm] = useState({ headline: '', featuredTitle: '', about: '' });
  const [busy, setBusy] = useState(false);
  const fill = (x: StoreSettings) => {
    setS(x);
    setForm({
      headline: x.headline ?? '',
      featuredTitle: x.featuredTitle ?? '',
      about: x.about ?? '',
    });
  };
  useEffect(() => {
    api<StoreSettings>('/store/settings').then(fill, (e: Error) => toast(e.message, 'danger'));
  }, [toast]);

  async function save(patch: Partial<StoreSettings>, ok = 'Aparência salva') {
    setBusy(true);
    try {
      fill(await api<StoreSettings>('/store/settings', { method: 'PATCH', json: patch }));
      toast(ok, 'success');
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  if (!s) return <Spinner />;
  return (
    <div className="os-stack">
      <Card title="Capa e logo">
        <div className="os-images">
          <div className="os-images__item">
            <span className="cm-label">Capa (aparece atrás da saudação)</span>
            <ImagePicker
              label="Capa"
              ratio="16 / 7"
              width="100%"
              value={s.coverImageId}
              disabled={!canManage || busy}
              onChange={(id) => save({ coverImageId: id }, id ? 'Capa salva' : 'Capa removida')}
            />
          </div>
          <div className="os-images__item os-images__item--logo">
            <span className="cm-label">Logo</span>
            <ImagePicker
              label="Logo"
              width={112}
              value={s.logoImageId}
              disabled={!canManage || busy}
              onChange={(id) => save({ logoImageId: id }, id ? 'Logo salvo' : 'Logo removido')}
            />
          </div>
        </div>
      </Card>
      <Card title="Tema do cardápio">
        <Segmented
          label="Tema"
          value={s.theme}
          onChange={(theme) => save({ theme }, 'Tema salvo')}
          options={[
            { value: 'auto', label: 'Automático' },
            { value: 'light', label: 'Claro' },
            { value: 'dark', label: 'Escuro' },
          ]}
        />
        <p className="cm-hint" style={{ margin: '10px 0 0' }}>
          Automático segue o celular do cliente (e ele pode trocar na conta). Claro ou escuro vale
          para todo mundo.
        </p>
      </Card>
      <Card title="Textos">
        <form
          className="os-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save({
              headline: form.headline.trim() || null,
              featuredTitle: form.featuredTitle.trim() || null,
              about: form.about.trim() || null,
            });
          }}
        >
          <TextField
            label="Título de boas-vindas"
            placeholder="Bateu a fome? Peça agora!"
            hint="A última palavra ganha a cor laranja."
            maxLength={60}
            value={form.headline}
            disabled={!canManage}
            onChange={(e) => setForm({ ...form, headline: e.target.value })}
          />
          <TextField
            label="Título da faixa de destaques"
            placeholder="Destaques"
            maxLength={40}
            value={form.featuredTitle}
            disabled={!canManage}
            onChange={(e) => setForm({ ...form, featuredTitle: e.target.value })}
          />
          <TextField
            label="Sobre a loja"
            placeholder="Ex.: Hambúrgueres artesanais desde 2015."
            maxLength={500}
            value={form.about}
            disabled={!canManage}
            onChange={(e) => setForm({ ...form, about: e.target.value })}
          />
          {canManage && (
            <div>
              <Button type="submit" loading={busy}>
                Salvar textos
              </Button>
            </div>
          )}
        </form>
      </Card>
      <Card title="O que aparece">
        <div className="os-toggles">
          <Toggle
            label="Mostrar “Mais pedidos”"
            hint="Faixa com o que mais saiu nos últimos 30 dias."
            checked={s.showPopular}
            disabled={!canManage || busy}
            onChange={(v) => save({ showPopular: v })}
          />
          <Toggle
            label="Clientes podem criar conta"
            hint="Login com celular e senha: endereços salvos e histórico de pedidos."
            checked={s.accountsEnabled}
            disabled={!canManage || busy}
            onChange={(v) => save({ accountsEnabled: v })}
          />
        </div>
      </Card>
    </div>
  );
}

const EMPTY_BANNER = {
  title: '',
  subtitle: '',
  tag: '',
  cta: 'Pedir agora',
  imageId: null as string | null,
  targetType: 'none' as StoreBanner['targetType'],
  targetId: '',
  active: true,
};

/** Banners do topo do cardápio: imagem, textos e para onde levam. */
function BannersTab({
  onSaved,
  products,
  categories,
}: {
  onSaved(): void;
  products: Product[];
  categories: Category[];
}) {
  const toast = useToast();
  const [list, setList] = useState<StoreBanner[] | null>(null);
  const [edit, setEdit] = useState<StoreBanner | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY_BANNER);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api<StoreBanner[]>('/store/banners').then(setList, (e: Error) => toast(e.message, 'danger')),
    [toast],
  );
  useEffect(() => {
    void load();
  }, [load]);

  function open(b: StoreBanner | 'new') {
    setEdit(b);
    setForm(
      b === 'new'
        ? EMPTY_BANNER
        : {
            title: b.title,
            subtitle: b.subtitle ?? '',
            tag: b.tag ?? '',
            cta: b.cta ?? '',
            imageId: b.imageId,
            targetType: b.targetType,
            targetId: b.targetId ?? '',
            active: b.active,
          },
    );
  }
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast(ok, 'success');
      await load();
      onSaved();
      return true;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    const json = {
      title: form.title.trim(),
      subtitle: form.subtitle.trim() || null,
      tag: form.tag.trim() || null,
      cta: form.cta.trim() || null,
      imageId: form.imageId,
      targetType: form.targetType,
      targetId: form.targetType === 'none' ? null : form.targetId || null,
      active: form.active,
    };
    const ok = await run(
      () =>
        edit === 'new'
          ? api('/store/banners', { method: 'POST', json })
          : api(`/store/banners/${(edit as StoreBanner).id}`, { method: 'PATCH', json }),
      'Banner salvo',
    );
    if (ok) setEdit(null);
  }
  async function move(i: number, dir: -1 | 1) {
    if (!list) return;
    const a = list[i]!;
    const b = list[i + dir];
    if (!b) return;
    await run(async () => {
      await api(`/store/banners/${a.id}`, { method: 'PATCH', json: { position: i + dir } });
      await api(`/store/banners/${b.id}`, { method: 'PATCH', json: { position: i } });
    }, 'Ordem salva');
  }
  const targetName = (b: StoreBanner) =>
    b.targetType === 'product'
      ? `Abre: ${products.find((p) => p.id === b.targetId)?.name ?? 'produto'}`
      : b.targetType === 'category'
        ? `Mostra: ${categories.find((c) => c.id === b.targetId)?.name ?? 'categoria'}`
        : 'Só informativo';
  const missingTarget = form.targetType !== 'none' && !form.targetId;

  return (
    <Card
      title="Banners e promoções"
      actions={
        <Button
          icon={<Plus size={16} />}
          onClick={() => open('new')}
          disabled={(list?.length ?? 0) >= 12}
        >
          Novo banner
        </Button>
      }
    >
      {list === null ? (
        <Spinner />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<ImagePlus size={20} />}
          title="Nenhum banner ainda"
          description="Banners aparecem no topo do cardápio, passando sozinhos. Use para combos, promoções do dia e novidades."
        />
      ) : (
        <ul className="os-banners">
          {list.map((b, i) => (
            <li key={b.id} className="os-banner" data-off={!b.active || undefined}>
              <div
                className="os-banner__thumb"
                style={b.imageUrl ? { backgroundImage: `url(${b.imageUrl})` } : undefined}
              >
                {b.tag && <span>{b.tag}</span>}
              </div>
              <div className="os-banner__text">
                <strong>{b.title}</strong>
                {b.subtitle && <small>{b.subtitle}</small>}
                <small className="os-muted">{targetName(b)}</small>
              </div>
              <label className="switch" title={b.active ? 'Aparecendo' : 'Escondido'}>
                <input
                  type="checkbox"
                  checked={b.active}
                  aria-label="Banner ativo"
                  onChange={(e) =>
                    run(
                      () =>
                        api(`/store/banners/${b.id}`, {
                          method: 'PATCH',
                          json: { active: e.target.checked },
                        }),
                      e.target.checked ? 'Banner no ar' : 'Banner escondido',
                    )
                  }
                />
                <span className="switch__track" aria-hidden />
              </label>
              <div className="os-banner__actions">
                <Button
                  variant="ghost"
                  aria-label="Subir"
                  icon={<ArrowUp size={16} />}
                  disabled={i === 0 || busy}
                  onClick={() => move(i, -1)}
                />
                <Button
                  variant="ghost"
                  aria-label="Descer"
                  icon={<ArrowDown size={16} />}
                  disabled={i === list.length - 1 || busy}
                  onClick={() => move(i, 1)}
                />
                <Button
                  variant="ghost"
                  aria-label="Editar"
                  icon={<Pencil size={16} />}
                  onClick={() => open(b)}
                />
                <Button
                  variant="ghost"
                  aria-label="Apagar"
                  icon={<Trash2 size={16} />}
                  onClick={() =>
                    window.confirm('Apagar este banner?') &&
                    run(() => api(`/store/banners/${b.id}`, { method: 'DELETE' }), 'Banner apagado')
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={edit !== null}
        title={edit === 'new' ? 'Novo banner' : 'Editar banner'}
        onClose={() => setEdit(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              Cancelar
            </Button>
            <Button loading={busy} disabled={!form.title.trim() || missingTarget} onClick={submit}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="os-form">
          <div>
            <span className="cm-label">Imagem (opcional, formato largo)</span>
            <ImagePicker
              label="Imagem do banner"
              ratio="16 / 7"
              width="100%"
              value={form.imageId}
              onChange={(id) => setForm({ ...form, imageId: id })}
            />
          </div>
          <TextField
            label="Título"
            required
            maxLength={60}
            placeholder="Ex.: Combo do dia"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <TextField
            label="Subtítulo (opcional)"
            maxLength={120}
            placeholder="Ex.: Burger + fritas + refri"
            value={form.subtitle}
            onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
          />
          <div className="os-grid2">
            <TextField
              label="Selo (opcional)"
              maxLength={24}
              placeholder="Ex.: 20% OFF"
              value={form.tag}
              onChange={(e) => setForm({ ...form, tag: e.target.value })}
            />
            <TextField
              label="Texto do botão"
              maxLength={24}
              placeholder="Pedir agora"
              value={form.cta}
              onChange={(e) => setForm({ ...form, cta: e.target.value })}
            />
          </div>
          <label className="cm-field">
            <span className="cm-label">Ao tocar no banner</span>
            <Select
              value={form.targetType}
              onChange={(e) =>
                setForm({
                  ...form,
                  targetType: e.target.value as StoreBanner['targetType'],
                  targetId: '',
                })
              }
            >
              <option value="none">Nada (só informativo)</option>
              <option value="product">Abrir um produto</option>
              <option value="category">Mostrar uma categoria</option>
            </Select>
          </label>
          {form.targetType !== 'none' && (
            <label className="cm-field">
              <span className="cm-label">
                {form.targetType === 'product' ? 'Produto' : 'Categoria'}
              </span>
              <Select
                value={form.targetId}
                onChange={(e) => setForm({ ...form, targetId: e.target.value })}
              >
                <option value="">Escolha…</option>
                {(form.targetType === 'product'
                  ? products.filter((p) => p.active)
                  : categories.filter((c) => c.active)
                ).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <Toggle
            label="Aparecendo no cardápio"
            checked={form.active}
            onChange={(v) => setForm({ ...form, active: v })}
          />
        </div>
      </Modal>
    </Card>
  );
}

/** Destaques: quais pratos vão para a faixa de cima e o selo de cada um. */
function HighlightsTab({
  products,
  categories,
  onChange,
}: {
  products: Product[];
  categories: Category[];
  onChange(p: Product): void;
}) {
  const toast = useToast();
  const [badges, setBadges] = useState<Record<string, string>>({});
  async function patch(p: Product, json: Partial<Product>, ok: string) {
    try {
      onChange(await api<Product>(`/products/${p.id}`, { method: 'PATCH', json }));
      toast(ok, 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }
  const featured = products.filter((p) => p.featured && p.active).length;
  return (
    <Card title="Destaques e selos">
      <p className="cm-hint" style={{ margin: '0 0 14px' }}>
        <Sparkles size={14} style={{ verticalAlign: -2 }} /> Pratos em destaque aparecem numa faixa
        no topo do cardápio ({featured} agora). O selo é uma etiqueta curta no cartão, como “Novo”
        ou “Picante”. Fotos e preços continuam em <strong>Cardápio</strong>.
      </p>
      <datalist id="os-badges">
        {BADGES.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      {categories
        .filter((c) => c.active)
        .map((c) => {
          const items = products.filter((p) => p.categoryId === c.id && p.active);
          if (!items.length) return null;
          return (
            <section key={c.id} className="os-cat">
              <h3>{c.name}</h3>
              <ul className="os-products">
                {items.map((p) => {
                  const url = mediaUrl(p.imageId);
                  const draft = badges[p.id] ?? p.badge ?? '';
                  return (
                    <li key={p.id} className="os-product" data-on={p.featured || undefined}>
                      <span
                        className="os-product__img"
                        style={url ? { backgroundImage: `url(${url})` } : undefined}
                      />
                      <span className="os-product__name">
                        <strong>{p.name}</strong>
                        <small>{brl(p.price)}</small>
                      </span>
                      <input
                        className="cm-input os-product__badge"
                        list="os-badges"
                        maxLength={20}
                        placeholder="Selo (opcional)"
                        aria-label={`Selo de ${p.name}`}
                        value={draft}
                        onChange={(e) => setBadges({ ...badges, [p.id]: e.target.value })}
                        onBlur={() => {
                          if (draft.trim() === (p.badge ?? '')) return;
                          void patch(
                            p,
                            { badge: draft.trim() || null },
                            draft.trim() ? 'Selo salvo' : 'Selo removido',
                          );
                        }}
                      />
                      <label className="switch" title="Destaque">
                        <input
                          type="checkbox"
                          checked={!!p.featured}
                          aria-label={`Destacar ${p.name}`}
                          onChange={(e) =>
                            patch(
                              p,
                              { featured: e.target.checked },
                              e.target.checked ? 'Em destaque' : 'Fora dos destaques',
                            )
                          }
                        />
                        <span className="switch__track" aria-hidden />
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
    </Card>
  );
}

/** Loja online: tudo que o cliente vê no cardápio (/pedir), com prévia ao lado. */
export function OnlineStorePage() {
  const { me } = useAuth();
  const toast = useToast();
  const canManage = !!me?.permissions.includes('settings:manage');
  const [tab, setTab] = useState<Tab>('aparencia');
  const [preview, setPreview] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const refresh = useCallback(() => setPreview((n) => n + 1), []);
  useEffect(() => {
    api<Product[]>('/products').then(setProducts, () => undefined);
    api<Category[]>('/categories').then(setCategories, () => undefined);
  }, []);
  const link = `${window.location.origin}/pedir`;
  const sorted = useMemo(
    () => [...products].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [products],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Loja online</h1>
          <p className="page-sub">
            O cardápio em que o cliente pede pelo celular: aparência, banners, destaques e
            funcionamento.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            icon={<Link2 size={16} />}
            onClick={() =>
              navigator.clipboard
                ?.writeText(link)
                .then(() => toast('Link copiado', 'success'))
                .catch(() => toast(link))
            }
          >
            Copiar link
          </Button>
          <a className="cm-btn cm-btn--primary" href="/pedir" target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> Abrir cardápio
          </a>
        </div>
      </div>
      {!canManage && <Alert tone="info">Somente gerentes alteram a loja online.</Alert>}
      <div className="os-layout">
        <div className="os-main">
          <SlideTabs
            label="Seções da loja online"
            value={tab}
            onChange={(v) => setTab(v as Tab)}
            tabs={[
              { value: 'aparencia', label: 'Aparência' },
              { value: 'banners', label: 'Banners' },
              { value: 'destaques', label: 'Destaques' },
              { value: 'funcionamento', label: 'Funcionamento' },
            ]}
          />
          <div className="os-panel" key={tab}>
            {tab === 'aparencia' && <AppearanceTab onSaved={refresh} canManage={canManage} />}
            {tab === 'banners' && (
              <BannersTab onSaved={refresh} products={sorted} categories={categories} />
            )}
            {tab === 'destaques' && (
              <HighlightsTab
                products={sorted}
                categories={categories}
                onChange={(p) => {
                  setProducts((l) => l.map((x) => (x.id === p.id ? p : x)));
                  refresh();
                }}
              />
            )}
            {tab === 'funcionamento' && <StoreSettingsCard canManage={canManage} />}
          </div>
        </div>
        <aside className="os-preview" aria-label="Prévia do cardápio">
          <div className="os-preview__head">
            <Smartphone size={16} /> Prévia
            <Badge tone="success">ao vivo</Badge>
            <Button
              variant="ghost"
              aria-label="Atualizar prévia"
              icon={<RotateCw size={15} />}
              onClick={refresh}
            />
          </div>
          <div className="os-phone">
            <iframe key={preview} src="/pedir" title="Prévia do cardápio online" />
          </div>
          <p className="cm-hint">
            {products.some((p) => toCents(p.price) > 0)
              ? 'A prévia se atualiza a cada alteração salva.'
              : 'Cadastre produtos em Cardápio para eles aparecerem aqui.'}
          </p>
        </aside>
      </div>
    </>
  );
}
