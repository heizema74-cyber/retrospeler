// Eén laag tussen de schermen en de gegevens: voor Leiden de eigen gids,
// voor elke andere stad automatisch samengesteld uit Wikipedia en OpenStreetMap.

import { LEIDEN } from './data/leiden.js';
import { wikiSights, osmPlaces, osmSights, enrichOsmSights, distKm, parseISO, tripDates, commonsFacade } from './api.js';

export const GUIDES = { leiden: LEIDEN };

export const FEATURED = [
  { name: 'Leiden', country: 'Nederland', region: 'Zuid-Holland', lat: 52.1590, lon: 4.4890, guide: 'leiden', sub: 'Historisch, sfeervol en verrassend', photo: LEIDEN.hero[0] },
  { name: 'Amsterdam', country: 'Nederland', region: 'Noord-Holland', lat: 52.3731, lon: 4.8922, sub: 'Cultuur & gezelligheid' },
  { name: 'Utrecht', country: 'Nederland', region: 'Utrecht', lat: 52.0907, lon: 5.1214, sub: 'Historie & hip' },
  { name: 'Den Haag', country: 'Nederland', region: 'Zuid-Holland', lat: 52.0799, lon: 4.3113, sub: 'Strand & stad' },
  { name: 'Delft', country: 'Nederland', region: 'Zuid-Holland', lat: 52.0116, lon: 4.3571, sub: 'Blauw & grachten' },
  { name: 'Haarlem', country: 'Nederland', region: 'Noord-Holland', lat: 52.3874, lon: 4.6462, sub: 'Hofjes & musea' },
];

export function guideFor(city) {
  if (city.guide && GUIDES[city.guide]) return GUIDES[city.guide];
  const key = city.name?.toLowerCase();
  if (GUIDES[key] && distKm(city, GUIDES[key]) < 15) return GUIDES[key];
  return null;
}

export const CAT = {
  museum: { label: 'Museum', icon: 'museum' },
  historisch: { label: 'Historisch', icon: 'landmark' },
  natuur: { label: 'Natuur', icon: 'tree' },
  wandelen: { label: 'Wandelen', icon: 'walk' },
  dagtrip: { label: 'Dagtrip', icon: 'suitcase' },
  spelen: { label: 'Spelen', icon: 'smile' },
  dieren: { label: 'Dieren', icon: 'tree' },
  uitje: { label: 'Uitje', icon: 'sparkles' },
  film: { label: 'Film & theater', icon: 'ticket' },
};

// ---------- reisgezelschap ----------
// party: { type: 'stel' | 'gezin' | 'vrienden' | 'solo', adults, kids: [leeftijden] }
export function partyOf(trip) {
  if (trip.party) return trip.party;
  const kids = trip.prefs?.interests?.includes('kinderen');
  return { type: kids ? 'gezin' : trip.persons === 1 ? 'solo' : trip.persons === 2 ? 'stel' : 'vrienden', adults: kids ? 2 : trip.persons, kids: [] };
}
export function familyOf(trip) {
  const p = partyOf(trip);
  if (p.type !== 'gezin') return null;
  const kids = (p.kids || []).filter((a) => a != null).map(Number);
  return { kids, youngest: kids.length ? Math.min(...kids) : 4, oldest: kids.length ? Math.max(...kids) : 6, label: agesLabel(kids) };
}
export function agesLabel(kids) {
  if (!kids.length) return 'jullie kinderen';
  const a = kids.slice().sort((x, y) => x - y).map((k) => (k === 0 ? 'baby' : String(k)));
  const list = a.length === 1 ? a[0] : a.slice(0, -1).join(', ') + ' en ' + a[a.length - 1];
  return `${list}${a[a.length - 1] === 'baby' ? '' : ' jaar'}`;
}
export function partyLabel(trip) {
  const p = partyOf(trip);
  const ad = p.adults ?? trip.persons;
  if (p.type === 'gezin') return `${ad} ${ad === 1 ? 'volwassene' : 'volwassenen'} · ${p.kids?.length || 0} ${p.kids?.length === 1 ? 'kind' : 'kinderen'}`;
  if (p.type === 'stel') return 'Met z\'n tweeën';
  if (p.type === 'solo') return 'Alleen';
  return `${ad} personen`;
}

// Hoe geschikt is een plek voor de kinderen? → { ok: [leeftijden], label, level: 'top' | 'deels' | 'nee' }
export function kidFit(place, fam) {
  const f = place.fam || genericFam(place);
  if (!f || !fam) return null;
  const ages = fam.kids.length ? fam.kids : [fam.youngest];
  const ok = ages.filter((a) => a >= f.min);
  const level = ok.length === ages.length ? 'top' : ok.length ? 'deels' : 'nee';
  const label = !fam.kids.length ? (f.min <= 4 ? 'Leuk met kinderen' : `Vanaf ${f.min} jaar`)
    : level === 'top' ? (ages.length > 1 ? `Leuk voor ${agesLabel(ages)}` : `Leuk voor ${agesLabel(ages)}`)
    : level === 'deels' ? `Leuk voor ${agesLabel(ok)}` : `Pas vanaf ${f.min} jaar`;
  return { ...f, ok, level, label };
}

// Voor steden zonder eigen gids: een redelijke inschatting per soort plek.
export function genericFam(p) {
  if (p.kind && p.kind !== 'sight') return null;
  switch (p.cat) {
    case 'natuur': return { min: 0, buggy: 'ja', text: 'Buiten, met ruimte om te rennen: meestal fijn met kinderen.' };
    case 'museum': return { min: 5, buggy: null, text: 'Vraag bij de kassa naar een kinderroute of speurtocht, en houd het bezoek kort met jonge kinderen.' };
    case 'spelen': return { min: 0, buggy: 'ja', text: '' };
    case 'dieren': return { min: 0, buggy: 'ja', text: 'Dieren kijken: voor alle leeftijden.' };
    case 'uitje': return { min: 3, buggy: 'deels', text: '' };
    case 'film': return { min: 4, buggy: 'ja', text: 'Kijk in het programma naar voorstellingen voor kinderen.' };
    default: return { min: 4, buggy: 'deels', text: 'Kort bezoek; vertel er een verhaal bij, dan blijft het spannend.' };
  }
}

const memo = new Map();
// alles wat al eens geladen is, op id: zo opent een detailpagina meteen
const registry = new Map();

function decorate(list, kind, center) {
  return list.map((p) => {
    const d = {
      ...p,
      kind,
      km: distKm(center, p),
      photo: p.photos?.[0] || null,
      sub: kind === 'sight' ? (['dieren', 'uitje', 'film'].includes(p.cat) && p.short && p.short.length < 22 ? p.short : CAT[p.cat]?.label || '') : kind === 'hotel' ? (p.style || 'Hotel') : (p.cuisine || 'Restaurant'),
    };
    registry.set(d.id, d);
    return d;
  });
}

export async function sightsFor(city) {
  const g = guideFor(city);
  if (g) return decorate(g.sights, 'sight', g);
  const k = `s${city.lat},${city.lon}`;
  if (!memo.has(k)) {
    memo.set(k, Promise.allSettled([
      osmSights(city.lat, city.lon).then(enrichOsmSights),
      wikiSights(city.lat, city.lon, 'nl').then((r) => (r.length >= 6 ? r : wikiSights(city.lat, city.lon, 'en'))),
    ]).then(([o, w]) => {
      if (o.status === 'rejected' && w.status === 'rejected') throw o.reason;
      return decorate(mergeSights(o.value || [], w.value || []), 'sight', city);
    }).catch((e) => { memo.delete(k); throw e; }));
  }
  return memo.get(k);
}

// OpenStreetMap (wat je kunt doen) + Wikipedia (foto's en verhalen), zonder dubbele plekken.
const norm = (s = '') => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s*\(.*\)/, '').replace(/[^a-z0-9]+/g, ' ').trim();
function mergeSights(osm, wiki) {
  const out = osm.map((s) => ({ ...s }));
  for (const w of wiki) {
    const twin = out.find((s) => (s.wiki && w.wiki && s.wiki[1] === w.wiki[1])
      || (norm(s.name) === norm(w.name) && distKm(s, w) < 0.4)
      || (distKm(s, w) < 0.08 && (norm(s.name).includes(norm(w.name)) || norm(w.name).includes(norm(s.name)))));
    if (twin) {
      // aanvullen: foto, korte omschrijving, Wikipedia, website, bekendheid
      if (!twin.photos?.length && w.photos?.length) twin.photos = w.photos;
      if (!twin.wiki) twin.wiki = w.wiki;
      if (!twin.website && w.website) twin.website = w.website;
      if (w.short && (!twin.short || /^(Museum|Toren|Molen|Kerk|Historisch|Bezienswaardigheid)$/.test(twin.short))) twin.short = w.short;
      twin.prio = Math.max(twin.prio || 1, w.prio || 1);
    } else out.push(w);
  }
  // musea, dierentuinen en uitjes met foto of Wikipedia eerst; daarna de rest
  return out.sort((a, b) => (b.prio || 1) - (a.prio || 1)).slice(0, 90);
}

export async function placesFor(city, kind) {
  const g = guideFor(city);
  if (g) return decorate(kind === 'hotel' ? g.hotels : g.restaurants, kind, g);
  const k = `${kind}${city.lat},${city.lon}`;
  if (!memo.has(k)) {
    memo.set(k, osmPlaces(city.lat, city.lon, kind)
      .then((r) => decorate(r, kind, city).sort((a, b) => a.km - b.km))
      .catch((e) => { memo.delete(k); throw e; }));
  }
  return memo.get(k);
}

// Zelf toegevoegde plekken van een reis (trip.custom), in hetzelfde formaat als de rest.
export function customFor(trip, kind) {
  return decorate((trip.custom || []).filter((c) => c.kind === kind), kind, trip.city);
}
export async function sightsForTrip(trip) {
  return [...customFor(trip, 'sight'), ...await sightsFor(trip.city).catch((e) => (trip.custom?.length ? [] : Promise.reject(e)))];
}
export async function placesForTrip(trip, kind) {
  return [...customFor(trip, kind), ...await placesFor(trip.city, kind).catch((e) => (customFor(trip, kind).length ? [] : Promise.reject(e)))];
}

// Gevelfoto's zoeken voor restaurants/hotels zonder foto (steden zonder eigen gids).
// Geeft het aantal gevonden foto's terug; de plekken zelf worden bijgewerkt.
export async function facadePhotos(city, list) {
  const todo = list.filter((p) => !p.photo && p.address && p.km < 2).slice(0, 30);
  let found = 0;
  for (let i = 0; i < todo.length; i += 3) {
    const res = await Promise.all(todo.slice(i, i + 3).map((p) => commonsFacade(p, city.name)));
    res.forEach((r, k) => {
      if (!r) return;
      const p = todo[i + k];
      Object.assign(p, { photos: [r.url], photo: r.url, photoCredit: r.credit });
      found++;
    });
  }
  return found;
}

// Zoekt een plek op id. Eerst in wat al geladen is (direct), anders in alle bronnen
// tegelijk; zodra één bron hem heeft, is hij er (een trage bron houdt niets meer op).
export async function findPlace(city, id) {
  if (registry.has(id)) return registry.get(id);
  const kinds = id.startsWith('o') ? ['food', 'hotel', 'sight'] : ['sight', 'food', 'hotel'];
  const load = (k) => (k === 'sight' ? sightsFor(city) : placesFor(city, k)).then((l) => l.find((p) => p.id === id) || Promise.reject(new Error('niet hier')));
  return Promise.any(kinds.map(load)).catch(() => null);
}

// ---------- advies op basis van datums en weer ----------
function inRange(mmdd, from, to) { return from <= to ? mmdd >= from && mmdd <= to : mmdd >= from || mmdd <= to; }

export function adviceFor(trip, weather = []) {
  const g = guideFor(trip.city);
  const dates = tripDates(trip);
  const out = [];
  const seen = new Set();
  const events = g?.events || GENERIC_EVENTS;
  for (const ev of events) {
    const hit = dates.find((d) => {
      const mmdd = d.slice(5), m = parseISO(d).getMonth() + 1;
      if (ev.date) return mmdd === ev.date;
      if (ev.from) return inRange(mmdd, ev.from, ev.to);
      if (ev.months) return ev.months.includes(m);
      return false;
    });
    if (hit && !seen.has(ev.id)) { seen.add(ev.id); out.push({ ...ev, when: hit }); }
  }
  const wk = g?.weekdayTips || GENERIC_WEEKDAY;
  const days = new Set(dates.map((d) => parseISO(d).getDay()));
  for (const [wd, text] of Object.entries(wk)) if (days.has(Number(wd))) out.push({ id: 'wd' + wd, title: text.split(':')[0], text: text.split(':').slice(1).join(':').trim(), icon: 'calendar' });

  const fam = familyOf(trip);
  if (fam) {
    const young = fam.youngest <= 3;
    out.push({ id: 'fam', icon: 'baby', title: `Op reis met ${fam.label === 'jullie kinderen' ? 'kinderen' : 'kinderen van ' + fam.label}`, text: `De planning houdt een rustiger tempo aan, met een speelpauze en vroeg eten${young ? ', en ruimte voor een middagdutje' : ''}. Bij elke plek zie je of het leuk is voor jullie kinderen.` });
  }
  const wet = weather.filter((w) => w.pop >= 60).length;
  const warm = weather.filter((w) => w.tmax >= 24).length;
  if (wet) out.push({ id: 'rain', icon: 'umbrella', title: wet === 1 ? 'Eén natte dag verwacht' : `${wet} natte dagen verwacht`, text: 'De slimme planning zet op die dagen musea en binnenactiviteiten. Neem een paraplu mee.' });
  if (warm) out.push({ id: 'warm', icon: 'sun', title: 'Warm weer', text: 'Plan musea op het heetst van de dag en ga \'s avonds het water op of een terras op.' });
  return out;
}

const GENERIC_EVENTS = [
  { id: 'koningsdag', date: '04-27', title: 'Koningsdag', text: 'In Nederland is het feest: vrijmarkten en muziek. Druk en gezellig; reserveer je diner.', icon: 'sparkles' },
  { id: 'voorjaar', months: [3, 4, 5], title: 'Voorjaar', text: 'Lange lichte dagen en bloeiende parken. Ideaal voor wandelingen; houd rekening met buien.', icon: 'flower' },
  { id: 'zomer', months: [6, 7, 8], title: 'Zomer', text: 'Terrassen, water en lange avonden. Kom vroeg bij populaire plekken.', icon: 'sun' },
  { id: 'herfst', months: [9, 10, 11], title: 'Herfst', text: 'Mooie kleuren en minder toeristen. Wissel buiten en binnen af.', icon: 'tree' },
  { id: 'winter', months: [12, 1, 2], title: 'Winter', text: 'Kortere dagen: plan musea in de middag en geniet van de lichtjes.', icon: 'moon' },
];
const GENERIC_WEEKDAY = { 1: 'Maandag: veel musea zijn op maandag dicht. Plan dan wandelingen en buitenplekken.' };
