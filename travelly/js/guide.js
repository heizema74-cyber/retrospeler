// Eén laag tussen de schermen en de gegevens: voor Leiden de eigen gids,
// voor elke andere stad automatisch samengesteld uit Wikipedia en OpenStreetMap.

import { LEIDEN } from './data/leiden.js';
import { wikiSights, osmPlaces, distKm, parseISO, tripDates } from './api.js';

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
};

const memo = new Map();

function decorate(list, kind, center) {
  return list.map((p) => ({
    ...p,
    kind,
    km: distKm(center, p),
    photo: p.photos?.[0] || null,
    sub: kind === 'sight' ? (CAT[p.cat]?.label || '') : kind === 'hotel' ? (p.style || 'Hotel') : (p.cuisine || 'Restaurant'),
  }));
}

export async function sightsFor(city) {
  const g = guideFor(city);
  if (g) return decorate(g.sights, 'sight', g);
  const k = `s${city.lat},${city.lon}`;
  if (!memo.has(k)) {
    memo.set(k, wikiSights(city.lat, city.lon, 'nl')
      .then((r) => (r.length >= 6 ? r : wikiSights(city.lat, city.lon, 'en')))
      .then((r) => decorate(r, 'sight', city))
      .catch((e) => { memo.delete(k); throw e; }));
  }
  return memo.get(k);
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

export async function findPlace(city, id) {
  for (const fn of [() => sightsFor(city), () => placesFor(city, 'hotel'), () => placesFor(city, 'food')]) {
    try {
      const hit = (await fn()).find((p) => p.id === id);
      if (hit) return hit;
    } catch { /* bron niet bereikbaar */ }
  }
  return null;
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
