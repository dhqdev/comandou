import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocateFixed } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { signalOf, type LatLng } from './live-geo';
import './live-map.css';

export interface MapRider {
  id: string;
  /** Texto curto embaixo da moto (ex.: "#123"). */
  label: string;
  /** Nome no balão ao tocar. */
  title?: string;
  position: LatLng | null;
  heading?: number | null;
  at?: string | null;
  trail?: LatLng[];
  destination?: LatLng | null;
  /** Cor do entregador; sem cor, usa a cor da loja. */
  color?: string;
}

/** Cores para diferenciar entregadores no mapa do painel (a primeira é a cor da loja). */
export const RIDER_COLORS = [
  'var(--cm-brand-600)',
  '#1c7ed6',
  '#2f9e44',
  '#ae3ec9',
  '#e03131',
  '#0c8599',
  '#5c7cfa',
];

const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';
const BRAZIL: LatLng = [-15.78, -47.93];

const BIKE_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>';
const STORE_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M2 7h20"/></svg>';
const HOME_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>';

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? '&#39;',
  );

/** Leaflet desenha em SVG/HTML com cor literal: troca var(--x) pelo valor do tema atual. */
function resolveColor(el: HTMLElement, c: string) {
  const m = /^var\((--[\w-]+)\)$/.exec(c.trim());
  if (!m) return c;
  return (
    getComputedStyle(el).getPropertyValue(m[1]!).trim() || '#e23a00'
  ); /* só se o token faltar */
}

function riderIcon(r: MapRider, color: string, selected: boolean) {
  const signal = signalOf(r.at);
  const heading = r.heading ?? null;
  return L.divIcon({
    className: 'live-rider-wrap',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -20],
    html: `<div class="live-rider" data-signal="${signal}"${selected ? ' data-selected' : ''} style="--rider:${color}">
      <span class="live-rider__pulse"></span>
      ${heading == null ? '' : `<span class="live-rider__arrow" style="transform:rotate(${heading}deg)"></span>`}
      <span class="live-rider__badge">${BIKE_SVG}</span>
      <span class="live-rider__label">${esc(r.label)}</span>
    </div>`,
  });
}

const storeIcon = L.divIcon({
  className: 'live-pin-wrap',
  html: `<div class="live-pin live-pin--store">${STORE_SVG}</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});
const destIcon = (color: string) =>
  L.divIcon({
    className: 'live-pin-wrap',
    html: `<div class="live-pin live-pin--dest" style="--rider:${color}">${HOME_SVG}</div>`,
    iconSize: [30, 38],
    iconAnchor: [15, 36],
  });

interface Anim {
  marker: L.Marker;
  from: L.LatLng;
  to: L.LatLng;
  start: number;
  frame?: number;
  key: string;
}

/**
 * Mapa ao vivo das entregas (OpenStreetMap). Mostra a loja, cada entregador com a direção em que
 * anda, o caminho percorrido e o destino. A moto desliza até a nova posição a cada atualização.
 * O mapa só se reenquadra sozinho até a pessoa mexer nele; o botão de mira volta ao enquadramento.
 */
export function LiveMap({
  riders,
  store,
  focusId,
  onSelect,
  className = '',
  showDestinations = true,
  emptyHint,
}: {
  riders: MapRider[];
  store?: LatLng | null;
  focusId?: string | null;
  onSelect?(id: string): void;
  className?: string;
  showDestinations?: boolean;
  emptyHint?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const shapes = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, Anim>());
  const touched = useRef(false);
  const programmatic = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [, force] = useState(0);

  // Cria o mapa uma vez.
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(BRAZIL, 4);
    m.attributionControl.setPrefix(
      '<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>',
    );
    L.tileLayer(TILE, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m);
    shapes.current = L.layerGroup().addTo(m);
    const mark = () => {
      if (!programmatic.current) {
        touched.current = true;
        force((n) => n + 1);
      }
    };
    m.on('dragstart', mark);
    m.on('zoomstart', mark);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    const all = markers.current;
    return () => {
      ro.disconnect();
      for (const a of all.values()) if (a.frame) cancelAnimationFrame(a.frame);
      all.clear();
      m.remove();
      map.current = null;
    };
  }, []);

  function colorOf(r: MapRider) {
    return resolveColor(el.current!, r.color ?? 'var(--cm-brand-600)');
  }

  // Motos: cria, atualiza o ícone e desliza até a posição nova.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    for (const r of riders) {
      if (!r.position) continue;
      seen.add(r.id);
      const color = colorOf(r);
      const selected = focusId === r.id;
      const key = `${color}|${selected}|${signalOf(r.at)}|${r.heading ?? ''}|${r.label}`;
      const to = L.latLng(r.position[0], r.position[1]);
      const cur = markers.current.get(r.id);
      if (!cur) {
        const marker = L.marker(to, {
          icon: riderIcon(r, color, selected),
          zIndexOffset: selected ? 1000 : 500,
          keyboard: true,
          title: r.title ?? r.label,
        }).addTo(m);
        marker.on('click', () => onSelectRef.current?.(r.id));
        markers.current.set(r.id, { marker, from: to, to, start: 0, key });
        continue;
      }
      if (cur.key !== key) {
        cur.marker.setIcon(riderIcon(r, color, selected));
        cur.marker.setZIndexOffset(selected ? 1000 : 500);
        cur.key = key;
      }
      if (!cur.to.equals(to)) {
        if (cur.frame) cancelAnimationFrame(cur.frame);
        cur.from = cur.marker.getLatLng();
        cur.to = to;
        cur.start = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - cur.start) / 1200);
          const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
          cur.marker.setLatLng([
            cur.from.lat + (cur.to.lat - cur.from.lat) * e,
            cur.from.lng + (cur.to.lng - cur.from.lng) * e,
          ]);
          cur.frame = t < 1 ? requestAnimationFrame(step) : undefined;
        };
        cur.frame = requestAnimationFrame(step);
      }
    }
    for (const [id, a] of markers.current)
      if (!seen.has(id)) {
        if (a.frame) cancelAnimationFrame(a.frame);
        a.marker.remove();
        markers.current.delete(id);
      }
  });

  // Caminho percorrido, destinos e loja (redesenhados a cada atualização; são poucos pontos).
  useEffect(() => {
    const g = shapes.current;
    if (!g || !el.current) return;
    g.clearLayers();
    if (store)
      L.marker(store, { icon: storeIcon, title: 'Restaurante', zIndexOffset: 100 }).addTo(g);
    for (const r of riders) {
      const color = colorOf(r);
      const dim = !!focusId && focusId !== r.id;
      const line = [...(r.trail ?? [])];
      if (r.position) line.push(r.position);
      if (line.length > 1)
        L.polyline(line, {
          color,
          weight: dim ? 3 : 5,
          opacity: dim ? 0.35 : 0.85,
          lineCap: 'round',
          lineJoin: 'round',
          className: 'live-trail',
        }).addTo(g);
      if (showDestinations && r.destination) {
        if (r.position && !dim)
          L.polyline([r.position, r.destination], {
            color,
            weight: 2,
            opacity: 0.7,
            dashArray: '2 8',
            lineCap: 'round',
            interactive: false,
          }).addTo(g);
        L.marker(r.destination, {
          icon: destIcon(color),
          title: r.title ? `Destino de ${r.title}` : 'Destino',
          opacity: dim ? 0.5 : 1,
        })
          .on('click', () => onSelectRef.current?.(r.id))
          .addTo(g);
      }
    }
  });

  function fit() {
    const m = map.current;
    if (!m) return;
    const b = L.latLngBounds([]);
    const focus = focusId ? riders.find((r) => r.id === focusId) : null;
    const list = focus ? [focus] : riders;
    for (const r of list) {
      if (r.position) b.extend(r.position);
      if (showDestinations && r.destination) b.extend(r.destination);
    }
    if (!focus && store) b.extend(store);
    if (!b.isValid()) {
      if (store) b.extend(store);
      else return;
    }
    programmatic.current = true;
    const ne = b.getNorthEast();
    const sw = b.getSouthWest();
    if (ne.equals(sw)) m.setView(ne, 16, { animate: true });
    else m.fitBounds(b, { padding: [48, 48], maxZoom: 17, animate: true });
    window.setTimeout(() => (programmatic.current = false), 400);
  }

  // Enquadra quando chegam dados, quando muda o foco e acompanha enquanto ninguém mexeu.
  const ids = riders
    .filter((r) => r.position || r.destination)
    .map((r) => r.id)
    .join(',');
  const focusPos = focusId ? riders.find((r) => r.id === focusId)?.position?.join(',') : '';
  useEffect(() => {
    touched.current = false;
    force((n) => n + 1);
  }, [focusId]);
  useEffect(() => {
    if (!touched.current) fit();
    // fit lê riders/store do render atual.
  }, [ids, focusId, focusPos, store?.[0], store?.[1]]);

  const hasAny = riders.some((r) => r.position);
  return (
    <div className={`live-map ${className}`}>
      <div ref={el} className="live-map__canvas" role="region" aria-label="Mapa das entregas" />
      {touched.current && (
        <button
          type="button"
          className="live-map__recenter"
          onClick={() => {
            touched.current = false;
            force((n) => n + 1);
            fit();
          }}
        >
          <LocateFixed size={16} /> Centralizar
        </button>
      )}
      {!hasAny && emptyHint && <div className="live-map__empty">{emptyHint}</div>}
    </div>
  );
}
