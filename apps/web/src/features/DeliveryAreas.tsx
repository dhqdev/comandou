import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  ArrowDown,
  ArrowUp,
  Circle as CircleIcon,
  Crosshair,
  MapPin,
  Pencil,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Spinner, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import { brl, parseBrlInput } from '../lib/money';
import type { DeliveryZone } from '../lib/types';
import './delivery-areas.css';

type LatLng = [number, number];
interface StoreSpot {
  lat: string | null;
  lng: string | null;
  address: string | null;
  deliveryFee: string;
}
interface GeoResult {
  lat: number;
  lng: number;
  label: string;
}

const COLORS = ['#ea8a0b', '#2f9e44', '#1c7ed6', '#ae3ec9', '#e03131', '#0c8599', '#5c7cfa'];
const BRAZIL: LatLng = [-15.78, -47.93];
const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

/** O que está sendo desenhado/editado no mapa agora. */
type Draft =
  | { mode: 'store' }
  | {
      mode: 'polygon' | 'radius';
      id?: string;
      points: LatLng[];
      radiusKm: string;
      name: string;
      fee: string;
      minOrder: string;
      etaMin: string;
      etaMax: string;
      color: string;
    };

const pin = (cls: string, html = '') =>
  L.divIcon({ className: `zone-pin ${cls}`, html, iconSize: [18, 18], iconAnchor: [9, 9] });
const STORE_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2 2.7 2.7 0 0 1-2-1 2.7 2.7 0 0 1-4 0 2.7 2.7 0 0 1-4 0 2.7 2.7 0 0 1-4 0 2.7 2.7 0 0 1-2 1 2 2 0 0 1-2-2V7"/></svg>';
const storeIcon = L.divIcon({
  className: 'zone-store',
  html: STORE_SVG,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});
const kmText = (m: number) =>
  `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
const moneyIn = (v: string | null) => (v ? v.replace('.', ',') : '');

/**
 * Áreas de entrega no mapa (OpenStreetMap). Cada área tem taxa, pedido mínimo e tempo próprios;
 * o cardápio online pede o ponto do endereço e cobra a taxa da área onde ele cai.
 */
export function DeliveryAreas({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const [zones, setZones] = useState<DeliveryZone[] | null>(null);
  const [store, setStore] = useState<StoreSpot | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const load = useCallback(async () => {
    try {
      const r = await api<{ zones: DeliveryZone[]; store: StoreSpot }>('/delivery-zones');
      setZones(r.zones);
      setStore(r.store);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const storePoint: LatLng | null =
    store?.lat && store.lng ? [Number(store.lat), Number(store.lng)] : null;

  // Cria o mapa uma vez.
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(BRAZIL, 4);
    m.attributionControl.setPrefix(
      '<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>',
    );
    L.tileLayer(TILE, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      const d = draftRef.current;
      const p: LatLng = [round(e.latlng.lat), round(e.latlng.lng)];
      if (d?.mode === 'store') void saveStore(p);
      else if (d?.mode === 'polygon') setDraft({ ...d, points: [...d.points, p] });
      else if (d?.mode === 'radius') setDraft({ ...d, points: [p] });
    });
    map.current = m;
    // O mapa nasce dentro de uma aba: recalcula o tamanho quando ela aparece.
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
    // saveStore é estável o bastante (usa só setters e api).
  }, []);

  // Centraliza na loja (ou nas áreas) quando os dados chegam.
  const centered = useRef(false);
  useEffect(() => {
    const m = map.current;
    if (!m || !zones || centered.current) return;
    centered.current = true;
    const bounds = L.latLngBounds([]);
    if (storePoint) bounds.extend(storePoint);
    for (const z of zones) {
      if (z.kind === 'polygon') z.polygon?.forEach((p) => bounds.extend(p));
      else if (z.centerLat && z.centerLng && z.radiusM)
        bounds.extend(L.latLng(Number(z.centerLat), Number(z.centerLng)).toBounds(z.radiusM * 2));
    }
    if (bounds.isValid()) m.fitBounds(bounds.pad(0.15), { maxZoom: 15 });
  }, [zones, storePoint]);

  // Desenha loja, áreas e o rascunho.
  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    if (storePoint)
      L.marker(storePoint, { icon: storeIcon, keyboard: false }).bindTooltip('Sua loja').addTo(g);
    for (const z of zones ?? []) {
      if (draft && 'id' in draft && draft.id === z.id) continue;
      const style = {
        color: z.color,
        weight: 2,
        fillOpacity: z.active ? 0.18 : 0.04,
        dashArray: z.active ? undefined : '6 6',
      };
      const tip = `${z.name} · ${Number(z.fee) ? brl(z.fee) : 'grátis'}`;
      if (z.kind === 'polygon' && z.polygon) L.polygon(z.polygon, style).bindTooltip(tip).addTo(g);
      else if (z.centerLat && z.centerLng && z.radiusM)
        L.circle([Number(z.centerLat), Number(z.centerLng)], { ...style, radius: z.radiusM })
          .bindTooltip(tip)
          .addTo(g);
    }
    if (draft && draft.mode !== 'store') {
      const style = { color: draft.color, weight: 3, fillOpacity: 0.25 };
      if (draft.mode === 'polygon') {
        if (draft.points.length >= 3) L.polygon(draft.points, style).addTo(g);
        else if (draft.points.length === 2) L.polyline(draft.points, style).addTo(g);
        draft.points.forEach((p, i) => {
          const mk = L.marker(p, { icon: pin('zone-pin--vertex', String(i + 1)), draggable: true })
            .bindTooltip('Arraste para ajustar')
            .addTo(g);
          mk.on('dragend', () => {
            const ll = mk.getLatLng();
            setDraft((d) =>
              d && d.mode === 'polygon'
                ? {
                    ...d,
                    points: d.points.map((q, j) => (j === i ? [round(ll.lat), round(ll.lng)] : q)),
                  }
                : d,
            );
          });
        });
      } else {
        const center = draft.points[0] ?? storePoint;
        const r = Number(draft.radiusKm.replace(',', '.')) * 1000;
        if (center && r > 0) L.circle(center, { ...style, radius: r }).addTo(g);
        if (center) L.marker(center, { icon: pin('zone-pin--center') }).addTo(g);
      }
    }
  }, [zones, draft, storePoint]);

  async function saveStore(p: LatLng) {
    try {
      await api('/store/settings', { method: 'PATCH', json: { storeLat: p[0], storeLng: p[1] } });
      setStore((s) => (s ? { ...s, lat: String(p[0]), lng: String(p[1]) } : s));
      setDraft(null);
      map.current?.setView(p, Math.max(map.current.getZoom(), 14));
      toast('Local da loja salvo', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  function startNew(mode: 'polygon' | 'radius') {
    const n = (zones?.length ?? 0) + 1;
    setDraft({
      mode,
      points: mode === 'radius' && storePoint ? [storePoint] : [],
      radiusKm: '3',
      name: mode === 'radius' ? `Até 3 km` : `Área ${n}`,
      fee: '',
      minOrder: '',
      etaMin: '',
      etaMax: '',
      color: COLORS[(zones?.length ?? 0) % COLORS.length]!,
    });
  }

  function startEdit(z: DeliveryZone) {
    setDraft({
      mode: z.kind,
      id: z.id,
      points:
        z.kind === 'polygon'
          ? (z.polygon ?? [])
          : z.centerLat && z.centerLng
            ? [[Number(z.centerLat), Number(z.centerLng)]]
            : [],
      radiusKm: z.radiusM ? String(z.radiusM / 1000).replace('.', ',') : '3',
      name: z.name,
      fee: moneyIn(z.fee),
      minOrder: moneyIn(z.minOrder),
      etaMin: z.etaMin ? String(z.etaMin) : '',
      etaMax: z.etaMax ? String(z.etaMax) : '',
      color: z.color,
    });
    const m = map.current;
    if (m && z.kind === 'polygon' && z.polygon?.length)
      m.fitBounds(L.latLngBounds(z.polygon).pad(0.2));
  }

  async function saveDraft() {
    if (!draft || draft.mode === 'store') return;
    const fee = parseBrlInput(draft.fee || '0');
    const minOrder = draft.minOrder.trim() ? parseBrlInput(draft.minOrder) : null;
    if (fee === null || (draft.minOrder.trim() && minOrder === null)) {
      toast('Confira os valores (ex.: 7,50)', 'danger');
      return;
    }
    const radiusM = Math.round(Number(draft.radiusKm.replace(',', '.')) * 1000);
    const center = draft.points[0] ?? storePoint;
    const body = {
      name: draft.name.trim() || 'Área',
      color: draft.color,
      kind: draft.mode,
      polygon: draft.mode === 'polygon' ? draft.points : null,
      centerLat: draft.mode === 'radius' ? (center?.[0] ?? null) : null,
      centerLng: draft.mode === 'radius' ? (center?.[1] ?? null) : null,
      radiusM: draft.mode === 'radius' ? radiusM : null,
      fee,
      minOrder,
      etaMin: draft.etaMin ? Number(draft.etaMin) : null,
      etaMax: draft.etaMax ? Number(draft.etaMax) : null,
      ...(draft.id ? {} : { position: zones?.length ?? 0 }),
    };
    setBusy(true);
    try {
      await api(draft.id ? `/delivery-zones/${draft.id}` : '/delivery-zones', {
        method: draft.id ? 'PATCH' : 'POST',
        json: body,
      });
      toast(draft.id ? 'Área atualizada' : 'Área de entrega criada', 'success');
      setDraft(null);
      void load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function patch(z: DeliveryZone, json: Partial<DeliveryZone>, ok?: string) {
    try {
      await api(`/delivery-zones/${z.id}`, { method: 'PATCH', json });
      if (ok) toast(ok, 'success');
      void load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }
  async function remove(z: DeliveryZone) {
    if (!window.confirm(`Apagar a área "${z.name}"?`)) return;
    try {
      await api(`/delivery-zones/${z.id}`, { method: 'DELETE' });
      toast('Área apagada', 'success');
      void load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }
  async function move(i: number, dir: -1 | 1) {
    const list = [...(zones ?? [])];
    const j = i + dir;
    if (!list[i] || !list[j]) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    try {
      await Promise.all(
        list.map((z, k) =>
          z.position === k
            ? null
            : api(`/delivery-zones/${z.id}`, { method: 'PATCH', json: { position: k } }),
        ),
      );
      void load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  const drawing = draft && draft.mode !== 'store' ? draft : null;
  const canSave =
    !!drawing &&
    (drawing.mode === 'polygon'
      ? drawing.points.length >= 3
      : !!(drawing.points[0] ?? storePoint) && Number(drawing.radiusKm.replace(',', '.')) > 0);
  const hint = useMemo(() => {
    if (draft?.mode === 'store') return 'Toque no mapa no ponto exato da loja.';
    if (draft?.mode === 'polygon')
      return draft.points.length < 3
        ? `Toque no mapa para marcar os cantos da área (${draft.points.length}/3 no mínimo).`
        : 'Continue marcando ou arraste os pontos para ajustar. Depois salve.';
    if (draft?.mode === 'radius')
      return 'O círculo sai da loja. Toque no mapa para mudar o centro, se quiser.';
    return null;
  }, [draft]);

  return (
    <div className="areas">
      {error && <Alert tone="danger">{error}</Alert>}
      {store && !storePoint && !draft && (
        <Alert tone="warning">
          Marque onde fica a loja no mapa: ela é o centro das áreas por raio e ajuda a achar os
          endereços dos clientes.
        </Alert>
      )}
      <div className="areas__layout">
        <div className="areas__mapwrap">
          {canEdit && (
            <StoreSearch
              onPick={(r) => {
                map.current?.setView([r.lat, r.lng], 16);
                if (!storePoint || draft?.mode === 'store')
                  void saveStore([round(r.lat), round(r.lng)]);
              }}
            />
          )}
          {canEdit && !draft && (
            <div className="areas__tools">
              <Button icon={<Pencil size={16} />} onClick={() => startNew('polygon')}>
                Desenhar área
              </Button>
              <Button
                variant="secondary"
                icon={<CircleIcon size={16} />}
                onClick={() => startNew('radius')}
                disabled={!storePoint}
                title={storePoint ? undefined : 'Marque a loja no mapa primeiro'}
              >
                Área por raio
              </Button>
              <Button
                variant="ghost"
                icon={<MapPin size={16} />}
                onClick={() => setDraft({ mode: 'store' })}
              >
                {storePoint ? 'Mudar local da loja' : 'Marcar a loja'}
              </Button>
              <Button
                variant="ghost"
                icon={<Crosshair size={16} />}
                onClick={() =>
                  navigator.geolocation?.getCurrentPosition(
                    (p) => map.current?.setView([p.coords.latitude, p.coords.longitude], 16),
                    () => toast('Não foi possível pegar sua localização', 'danger'),
                  )
                }
              >
                Onde estou
              </Button>
            </div>
          )}
          {draft?.mode === 'store' && (
            <div className="areas__tools">
              <Button variant="secondary" onClick={() => setDraft(null)}>
                Cancelar
              </Button>
            </div>
          )}
          {hint && <div className="areas__hint">{hint}</div>}
          <div ref={el} className="areas__map" data-drawing={draft ? draft.mode : undefined} />
        </div>

        <div className="areas__side">
          {drawing ? (
            <Card title={drawing.id ? 'Editar área' : 'Nova área de entrega'}>
              <div className="areas__form">
                <TextField
                  label="Nome"
                  value={drawing.name}
                  maxLength={60}
                  onChange={(e) => setDraft({ ...drawing, name: e.target.value })}
                />
                {drawing.mode === 'radius' && (
                  <TextField
                    label="Raio (km)"
                    inputMode="decimal"
                    value={drawing.radiusKm}
                    onChange={(e) => {
                      const radiusKm = e.target.value;
                      // Nome automático acompanha o raio ("Até 2 km") até a pessoa trocar.
                      const auto = /^Até [\d.,]+ km$/.test(drawing.name);
                      setDraft({
                        ...drawing,
                        radiusKm,
                        name: auto && radiusKm ? `Até ${radiusKm} km` : drawing.name,
                      });
                    }}
                  />
                )}
                <div className="areas__row">
                  <TextField
                    label="Taxa de entrega (R$)"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={drawing.fee}
                    onChange={(e) => setDraft({ ...drawing, fee: e.target.value })}
                  />
                  <TextField
                    label="Pedido mínimo (R$)"
                    inputMode="decimal"
                    placeholder="o da loja"
                    value={drawing.minOrder}
                    onChange={(e) => setDraft({ ...drawing, minOrder: e.target.value })}
                  />
                </div>
                <div className="areas__row">
                  <TextField
                    label="Tempo mín. (min)"
                    inputMode="numeric"
                    value={drawing.etaMin}
                    onChange={(e) =>
                      setDraft({ ...drawing, etaMin: e.target.value.replace(/\D/g, '') })
                    }
                  />
                  <TextField
                    label="Tempo máx. (min)"
                    inputMode="numeric"
                    value={drawing.etaMax}
                    onChange={(e) =>
                      setDraft({ ...drawing, etaMax: e.target.value.replace(/\D/g, '') })
                    }
                  />
                </div>
                <div className="areas__colors" role="radiogroup" aria-label="Cor">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={drawing.color === c}
                      aria-label={`Cor ${c}`}
                      style={{ background: c }}
                      onClick={() => setDraft({ ...drawing, color: c })}
                    />
                  ))}
                </div>
                {drawing.mode === 'polygon' && (
                  <div className="actions-row">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Undo2 size={14} />}
                      disabled={!drawing.points.length}
                      onClick={() => setDraft({ ...drawing, points: drawing.points.slice(0, -1) })}
                    >
                      Desfazer ponto
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!drawing.points.length}
                      onClick={() => setDraft({ ...drawing, points: [] })}
                    >
                      Recomeçar
                    </Button>
                  </div>
                )}
                <div className="actions-row">
                  <Button variant="secondary" onClick={() => setDraft(null)}>
                    Cancelar
                  </Button>
                  <Button loading={busy} disabled={!canSave} onClick={saveDraft}>
                    Salvar área
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <Card title="Áreas de entrega" bodyless>
              {zones === null ? (
                <div style={{ padding: 16 }}>
                  <Spinner />
                </div>
              ) : zones.length === 0 ? (
                <p className="cm-hint areas__empty">
                  Nenhuma área ainda: o cardápio cobra a taxa fixa da loja (
                  {store ? brl(store.deliveryFee) : '…'}) para qualquer endereço. Desenhe as áreas
                  para cobrar por região e recusar endereços longe demais.
                </p>
              ) : (
                <ul className="areas__list">
                  {zones.map((z, i) => (
                    <li key={z.id} data-off={!z.active || undefined}>
                      <span className="areas__dot" style={{ background: z.color }} />
                      <div className="areas__info">
                        <strong>{z.name}</strong>
                        <span className="cm-hint">
                          {Number(z.fee) ? brl(z.fee) : 'Entrega grátis'}
                          {z.minOrder && ` · mín. ${brl(z.minOrder)}`}
                          {z.etaMin && z.etaMax && ` · ${z.etaMin}–${z.etaMax} min`}
                          {z.kind === 'radius' && z.radiusM && ` · raio ${kmText(z.radiusM)}`}
                        </span>
                      </div>
                      {canEdit && (
                        <div className="areas__actions">
                          <button
                            className="icon-btn"
                            aria-label="Subir"
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                          >
                            <ArrowUp size={16} />
                          </button>
                          <button
                            className="icon-btn"
                            aria-label="Descer"
                            disabled={i === zones.length - 1}
                            onClick={() => move(i, 1)}
                          >
                            <ArrowDown size={16} />
                          </button>
                          <button
                            className="icon-btn"
                            aria-label={`Editar ${z.name}`}
                            onClick={() => startEdit(z)}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="icon-btn"
                            aria-label={`Apagar ${z.name}`}
                            onClick={() => remove(z)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                      {canEdit && (
                        <button
                          className="link-btn areas__toggle"
                          onClick={() =>
                            patch(
                              z,
                              { active: !z.active },
                              z.active ? 'Área pausada' : 'Área ativada',
                            )
                          }
                        >
                          {z.active ? 'pausar' : <Badge tone="warning">pausada · ativar</Badge>}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {zones && zones.length > 1 && (
                <p className="cm-hint areas__empty">
                  Áreas que se sobrepõem: vale a de cima. Deixe as mais perto da loja primeiro.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Busca de endereço (OpenStreetMap, pela API) para achar e marcar a loja. */
function StoreSearch({ onPick }: { onPick(r: GeoResult): void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 3) return;
    setBusy(true);
    try {
      setResults(await api<GeoResult[]>(`/geocode?q=${encodeURIComponent(q.trim())}`));
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="areas__search" onSubmit={search}>
      <label className="home__search">
        <Search size={16} aria-hidden />
        <input
          placeholder="Buscar endereço (rua, número, cidade)"
          aria-label="Buscar endereço no mapa"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setResults(null);
          }}
        />
      </label>
      <Button type="submit" variant="secondary" loading={busy}>
        Buscar
      </Button>
      {results && (
        <ul className="areas__results">
          {results.length === 0 && (
            <li className="cm-hint">Nada encontrado. Tente com a cidade.</li>
          )}
          {results.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              <button
                type="button"
                onClick={() => {
                  setResults(null);
                  onPick(r);
                }}
              >
                <MapPin size={14} /> {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
