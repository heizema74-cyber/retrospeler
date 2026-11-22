// Opslag: reizen, planning, favorieten en notities in localStorage;
// foto's van het dagboek in IndexedDB (die kunnen groot zijn).
// Alles blijft op dit apparaat. Met Exporteren/Importeren zet je een reis over.

const KEY = 'travelly.v1';
const listeners = new Set();

function blank() {
  return { trips: [], activeTripId: null };
}

let state = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch {
    return blank();
  }
})();

export function getState() { return state; }

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Opslaan mislukt', e);
  }
  listeners.forEach((fn) => fn(state));
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export function getTrip(id) { return state.trips.find((t) => t.id === id) || null; }
export function activeTrip() { return getTrip(state.activeTripId) || state.trips[0] || null; }

export function createTrip({ city, start, end, persons, party, prefs }) {
  const trip = {
    id: uid('t'),
    city, start, end, persons, party: party || null,
    prefs: prefs || { interests: ['cultuur'], tempo: 'normaal' },
    plan: null,
    favorites: {},
    notes: [],
    todos: [],
    diary: [],
    createdAt: Date.now(),
  };
  state.trips.unshift(trip);
  state.activeTripId = trip.id;
  save();
  return trip;
}

export function updateTrip(id, patch) {
  const t = getTrip(id);
  if (!t) return;
  Object.assign(t, typeof patch === 'function' ? patch(t) || {} : patch);
  save();
  return t;
}

export async function deleteTrip(id) {
  const t = getTrip(id);
  if (!t) return;
  for (const e of t.diary || []) for (const pid of e.photos || []) await deletePhoto(pid);
  state.trips = state.trips.filter((x) => x.id !== id);
  if (state.activeTripId === id) state.activeTripId = state.trips[0]?.id || null;
  save();
}

export function setActive(id) { state.activeTripId = id; save(); }

export function toggleFavorite(trip, place) {
  trip.favorites = trip.favorites || {};
  if (trip.favorites[place.id]) delete trip.favorites[place.id];
  else trip.favorites[place.id] = {
    id: place.id, kind: place.kind, name: place.name, sub: place.sub || '',
    lat: place.lat, lon: place.lon, photo: place.photo || null, address: place.address || '', addedAt: Date.now(),
  };
  save();
  return !!trip.favorites[place.id];
}

// ---------- IndexedDB voor foto's ----------
let dbp;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('travelly', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}
function tx(mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction('photos', mode);
    const out = fn(t.objectStore('photos'));
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  }));
}
export const putPhoto = (rec) => tx('readwrite', (s) => s.put(rec));
export const deletePhoto = (id) => tx('readwrite', (s) => s.delete(id));
export function getPhoto(id) {
  return db().then((d) => new Promise((res, rej) => {
    const r = d.transaction('photos').objectStore('photos').get(id);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  }));
}

const urlCache = new Map();
export async function photoURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const rec = await getPhoto(id);
  if (!rec) return null;
  const u = URL.createObjectURL(rec.blob);
  urlCache.set(id, u);
  return u;
}

// Verklein een foto (max 1600 px) zodat de opslag niet volloopt.
export async function compressImage(file, max = 1600, quality = 0.82) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return { blob: file, w: 0, h: 0 };
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
  return { blob: blob || file, w, h };
}

// ---------- Export / import ----------
const blobToDataURL = (b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });

export async function exportTrip(trip) {
  const photos = {};
  for (const e of trip.diary || []) for (const id of e.photos || []) {
    const rec = await getPhoto(id);
    if (rec) photos[id] = await blobToDataURL(rec.blob);
  }
  return new Blob([JSON.stringify({ app: 'travelly', version: 1, trip, photos })], { type: 'application/json' });
}

export async function importTrip(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'travelly' || !data.trip) throw new Error('Dit is geen Travelly-bestand.');
  const trip = data.trip;
  if (getTrip(trip.id)) trip.id = uid('t');
  for (const [id, url] of Object.entries(data.photos || {})) {
    const blob = await (await fetch(url)).blob();
    await putPhoto({ id, tripId: trip.id, blob, created: Date.now() });
  }
  state.trips.unshift(trip);
  state.activeTripId = trip.id;
  save();
  return trip;
}
