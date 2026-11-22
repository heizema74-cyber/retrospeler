// Kaarten met Leaflet en OpenStreetMap (met een zachte kleurfilter in de CSS).
import { icon } from './icons.js';

const L = window.L;
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const KIND_ICON = { sight: 'landmark', hotel: 'bed', food: 'food', custom: 'pin', fav: 'heart' };

export function makeMap(el, { lat, lon, zoom = 14, interactive = true } = {}) {
  const map = L.map(el, {
    zoomControl: false, attributionControl: true,
    dragging: interactive, scrollWheelZoom: interactive, touchZoom: interactive, doubleClickZoom: interactive, boxZoom: false, keyboard: interactive,
    tap: interactive,
  }).setView([lat, lon], zoom);
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTR }).addTo(map);
  map.attributionControl.setPrefix('');
  if (interactive) L.control.zoom({ position: 'bottomright' }).addTo(map);
  // kaart veilig opruimen, ook als er nog iets aan het laden of animeren is
  const remove = map.remove.bind(map);
  map.remove = () => { if (map._dead) return map; map._dead = true; try { map.stop(); remove(); } catch { /* al weg */ } return map; };
  setTimeout(() => { if (!map._dead) map.invalidateSize(); }, 50);
  return map;
}

export function marker(map, p, { kind = p.kind, label = '', active = false, onClick } = {}) {
  if (map._dead) return { remove() {} };
  const html = label
    ? `<div class="mk mk-${kind} mk-num${active ? ' on' : ''}">${label}</div>`
    : `<div class="mk mk-${kind}${active ? ' on' : ''}">${icon(KIND_ICON[kind] || 'pin')}</div>`;
  const m = L.marker([p.lat, p.lon], {
    icon: L.divIcon({ html, className: 'mk-wrap', iconSize: [34, 34], iconAnchor: [17, 17] }),
    title: p.name || p.title || '',
    keyboard: true,
    riseOnHover: true,
    // restaurants en hotels liggen boven de bezienswaardigheden, zodat je ze kunt aantikken
    zIndexOffset: kind === 'food' || kind === 'hotel' ? 500 : 0,
  }).addTo(map);
  if (onClick) m.on('click', () => { m.setZIndexOffset(2000); onClick(p, m); });
  return m;
}

export function line(map, pts) {
  if (map._dead) return null;
  if (pts.length < 2) return null;
  return L.polyline(pts.map((p) => [p.lat, p.lon]), { color: '#5B6B55', weight: 3, opacity: 0.7, dashArray: '2 7', lineCap: 'round' }).addTo(map);
}

export function fit(map, pts, pad = 40) {
  if (map._dead) return;
  const ok = pts.filter((p) => p.lat);
  if (!ok.length) return;
  if (ok.length === 1) { map.setView([ok[0].lat, ok[0].lon], 15); return; }
  map.fitBounds(L.latLngBounds(ok.map((p) => [p.lat, p.lon])), { padding: [pad, pad], maxZoom: 16 });
}

export function userLocation(map) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    const ll = [pos.coords.latitude, pos.coords.longitude];
    L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#3D7BF7', fillOpacity: 1 }).addTo(map);
    map.setView(ll, 16);
  }, () => alert('Je locatie is niet beschikbaar. Sta locatietoegang toe in je browser.'), { enableHighAccuracy: true, timeout: 10000 });
}
