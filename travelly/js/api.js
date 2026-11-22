// Gegevensbronnen (allemaal gratis en zonder sleutel):
//  - Open-Meteo: plaatsen zoeken en het weer (verwachting + klimaat van eerdere jaren)
//  - Wikipedia: bezienswaardigheden met foto's voor elke stad
//  - OpenStreetMap (Overpass): hotels en restaurants voor elke stad
// Resultaten worden een tijdje bewaard, zodat de app snel en zuinig blijft.

const WIKI_HEADERS = { 'Api-User-Agent': 'Travelly/1.0 (persoonlijke reisplanner)' };

// ---------- kleine hulpfuncties ----------
export const enc = encodeURIComponent;
export const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
export function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 864e5); }
export function tripDates(trip) {
  const n = Math.max(1, daysBetween(trip.start, trip.end) + 1);
  return Array.from({ length: Math.min(n, 21) }, (_, i) => addDays(trip.start, i));
}
const DAGEN = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MAANDEN_LANG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
export const fmt = {
  day: (s) => DAGEN[parseISO(s).getDay()],
  dayCap: (s) => { const d = DAGEN[parseISO(s).getDay()]; return d[0].toUpperCase() + d.slice(1); },
  short: (s) => { const d = parseISO(s); return `${d.getDate()} ${MAANDEN[d.getMonth()]}`; },
  long: (s) => { const d = parseISO(s); return `${d.getDate()} ${MAANDEN_LANG[d.getMonth()]} ${d.getFullYear()}`; },
  range: (a, b) => {
    const A = parseISO(a), B = parseISO(b);
    if (a === b) return fmt.short(a) + ' ' + A.getFullYear();
    return `${A.getDate()} ${MAANDEN[A.getMonth()]} – ${B.getDate()} ${MAANDEN[B.getMonth()]} ${B.getFullYear()}`;
  },
};

export function distKm(a, b) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export function distLabel(km) {
  if (km < 1) return `${Math.round(km * 1000 / 50) * 50} m`;
  return `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} km`;
}
export const walkMin = (km) => Math.max(2, Math.round(km * 1.3 / 5 * 60)); // omweg-factor 1,3, 5 km/u

// Wikimedia-thumbnail in een ander formaat opvragen (vaste maten laden het snelst).
export function wm(url, w = 500) {
  if (!url || !url.includes('/thumb/')) return url;
  const sizes = [250, 330, 500, 960, 1280];
  const size = sizes.find((s) => s >= w) || 1280;
  return url.replace(/\/(\d+)px-([^/]+)$/, `/${size}px-$2`);
}

// ---------- Google Maps ----------
export const gmaps = {
  place(p, city) {
    const q = [p.name, p.address, city].filter(Boolean).join(', ');
    return `https://www.google.com/maps/search/?api=1&query=${enc(q)}`;
  },
  route(p, city) {
    const dest = p.lat ? `${p.lat},${p.lon}` : [p.name, city].join(', ');
    return `https://www.google.com/maps/dir/?api=1&destination=${enc(dest)}&travelmode=walking`;
  },
  // Street View op die plek (opent in Google Maps), handig om de gevel te zien.
  streetview(p) {
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lon}`;
  },
  // Een hele dagroute: begin, eindpunt en maximaal 8 tussenstops.
  day(points, mode = 'walking') {
    const pts = points.filter((p) => p.lat);
    if (pts.length < 2) return pts[0] ? gmaps.route(pts[0]) : null;
    const ll = (p) => `${p.lat},${p.lon}`;
    const mid = pts.slice(1, -1).slice(0, 8).map(ll).join('|');
    return `https://www.google.com/maps/dir/?api=1&origin=${ll(pts[0])}&destination=${ll(pts[pts.length - 1])}` +
      (mid ? `&waypoints=${enc(mid)}` : '') + `&travelmode=${mode}`;
  },
};

// ---------- cache ----------
function cached(key, ttlMs, fn) {
  const k = 'travelly.c.' + key;
  try {
    const hit = JSON.parse(localStorage.getItem(k) || 'null');
    if (hit && Date.now() - hit.t < ttlMs) return Promise.resolve(hit.v);
  } catch { /* leeg */ }
  return fn().then((v) => {
    try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); } catch { pruneCache(); }
    return v;
  });
}
function pruneCache() {
  Object.keys(localStorage).filter((k) => k.startsWith('travelly.c.')).forEach((k) => localStorage.removeItem(k));
}

async function getJSON(url, opts = {}, timeout = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// ---------- plaatsen zoeken ----------
export async function searchCity(q) {
  if (!q || q.trim().length < 2) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${enc(q.trim())}&count=8&language=nl&format=json`;
  const j = await getJSON(url);
  return (j.results || []).map((r) => ({
    name: r.name, country: r.country || '', region: r.admin1 || '', lat: r.latitude, lon: r.longitude,
    population: r.population || 0, cc: r.country_code,
  }));
}

// ---------- weer ----------
// WMO-weercodes → Nederlandse omschrijving + icoon
export function weatherInfo(code) {
  if (code == null) return { label: 'Onbekend', icon: 'cloud', wet: false };
  if (code === 0) return { label: 'Zonnig', icon: 'sun', wet: false };
  if (code <= 2) return { label: 'Licht bewolkt', icon: 'cloudsun', wet: false };
  if (code === 3) return { label: 'Bewolkt', icon: 'cloud', wet: false };
  if (code <= 48) return { label: 'Mist', icon: 'fog', wet: false };
  if (code <= 57) return { label: 'Motregen', icon: 'drizzle', wet: true };
  if (code <= 67) return { label: 'Regen', icon: 'rain', wet: true };
  if (code <= 77) return { label: 'Sneeuw', icon: 'snow', wet: true };
  if (code <= 82) return { label: 'Buien', icon: 'rain', wet: true };
  if (code <= 86) return { label: 'Sneeuwbuien', icon: 'snow', wet: true };
  return { label: 'Onweer', icon: 'storm', wet: true };
}

export function currentWeather(lat, lon) {
  return cached(`now2.${lat.toFixed(2)},${lon.toFixed(2)}`, 30 * 60e3, async () => {
    const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m,precipitation,cloud_cover&timezone=auto`);
    const c = j.current;
    let code = c.weather_code;
    // "motregen" of "regen" terwijl er nu niets valt? Dan tonen we wat je ziet: zon of wolken.
    if (code >= 51 && code <= 67 && !(c.precipitation > 0)) code = c.cloud_cover < 25 ? 0 : c.cloud_cover < 70 ? 2 : 3;
    return { temp: c.temperature_2m, code, wind: c.wind_speed_10m };
  });
}

// De weerdienst geeft per dag het zwáárste weer (één uurtje motregen = "motregen").
// Wij kijken naar wat je overdag echt merkt: hoeveel regen, hoe lang, en hoeveel zon.
function dayCode(code, rain, hours, sun) {
  const severe = code >= 71; // sneeuw of onweer: altijd laten zien
  if (severe || rain >= 3 || hours >= 4) return code;
  if (rain >= 1 || hours >= 2) return sun != null && sun >= 0.5 ? 2 : 80; // vooral droog met een buitje, of echt buiig
  if (sun == null) return code >= 51 ? 3 : code;
  return sun >= 0.6 ? 0 : sun >= 0.3 ? 2 : 3;
}

// Per reisdag: echte verwachting (tot 15 dagen vooruit) of anders het gemiddelde van
// dezelfde dagen in de afgelopen 3 jaar ("zo is het meestal").
export async function tripWeather(trip) {
  const { lat, lon } = trip.city;
  const dates = tripDates(trip);
  const today = iso(new Date());
  const horizon = addDays(today, 15);
  const out = {};

  const fc = dates.filter((d) => d >= today && d <= horizon);
  if (fc.length) {
    const j = await cached(`fc2.${lat.toFixed(2)},${lon.toFixed(2)}.${fc[0]}.${fc[fc.length - 1]}`, 60 * 60e3, () => getJSON(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,precipitation_hours,sunshine_duration,daylight_duration,wind_speed_10m_max,sunrise,sunset` +
      `&start_date=${fc[0]}&end_date=${fc[fc.length - 1]}`));
    const D = j.daily;
    D.time.forEach((d, i) => {
      const rain = D.precipitation_sum[i] ?? 0, hours = D.precipitation_hours?.[i] ?? 0;
      const sun = D.daylight_duration?.[i] ? (D.sunshine_duration?.[i] ?? 0) / D.daylight_duration[i] : null;
      out[d] = {
        date: d, source: 'verwachting', code: dayCode(D.weather_code[i], rain, hours, sun),
        tmax: D.temperature_2m_max[i], tmin: D.temperature_2m_min[i],
        pop: D.precipitation_probability_max[i], rain, rainHours: hours, sun: sun == null ? null : Math.round(sun * 100),
        wind: D.wind_speed_10m_max[i], sunset: D.sunset[i]?.slice(11),
      };
    });
  }

  const rest = dates.filter((d) => !out[d]);
  if (rest.length) {
    const thisYear = new Date().getFullYear();
    const years = [1, 2, 3].map((k) => thisYear - k);
    const md = (d) => d.slice(5);
    const series = await Promise.all(years.map((y) => {
      // dezelfde kalenderdagen in jaar y
      const s = `${y}-${md(rest[0])}`; let e = `${y}-${md(rest[rest.length - 1])}`;
      if (e < s) e = `${y + 1}-${md(rest[rest.length - 1])}`; // reis over jaargrens
      const safeS = s.endsWith('02-29') ? s.replace('02-29', '02-28') : s;
      const safeE = e.endsWith('02-29') ? e.replace('02-29', '02-28') : e;
      return cached(`ar.${lat.toFixed(2)},${lon.toFixed(2)}.${safeS}.${safeE}`, 30 * 864e5, () => getJSON(
        `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&timezone=auto` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&start_date=${safeS}&end_date=${safeE}`)).catch(() => null);
    }));
    for (const d of rest) {
      const vals = [];
      for (const j of series) {
        if (!j?.daily) continue;
        const i = j.daily.time.findIndex((t) => t.slice(5) === md(d));
        if (i >= 0 && j.daily.temperature_2m_max[i] != null) vals.push({
          code: j.daily.weather_code[i], tmax: j.daily.temperature_2m_max[i], tmin: j.daily.temperature_2m_min[i], rain: j.daily.precipitation_sum[i] || 0,
        });
      }
      if (!vals.length) continue;
      const avg = (k) => vals.reduce((s, v) => s + v[k], 0) / vals.length;
      const wetDays = vals.filter((v) => v.rain >= 1).length;
      const pop = Math.round((wetDays / vals.length) * 100);
      const tmax = avg('tmax');
      // representatieve code: nat als het meestal regende, anders op basis van temperatuur/zon
      const code = pop >= 67 ? 61 : pop >= 34 ? 80 : tmax >= 17 ? 1 : 2;
      out[d] = { date: d, source: 'klimaat', code, tmax, tmin: avg('tmin'), pop, rain: avg('rain') };
    }
  }
  return dates.map((d) => out[d] || { date: d, source: 'onbekend' });
}

// ---------- Wikipedia: bezienswaardigheden in elke stad ----------
const SKIP = /(straat|laan|weg\b|plein\b|station|halte|gemeente|plaats in|dorp|wijk|buurt|school|college|ziekenhuis|voetbal|stadion|bedrijf|spoorlijn|snelweg|rivier|kanaal|persoon|politicus|metro|tram|bus|kantoor|winkelcentrum|parkeer|begraafplaats|sporthal|zwembad|kazerne|fabriek|polder|waterschap|provincie|regio|street|road|square|railway|municipality|district|neighbourhood|village|school|hospital|football|company|person|bridge|brug)/i;

// Inschatting voor steden zonder eigen gids. fee: 'gratis' | 'buiten' (gratis van buiten) | 'entree' | null (onbekend)
export function guessCategory(text) {
  const t = (text || '').toLowerCase();
  if (/museum|galerie|gallery|planetarium|tentoonstelling/.test(t)) return { cat: 'museum', indoor: true, dur: 100, fee: 'entree' };
  if (/kerk|kathedra|basiliek|kapel|synagoge|moskee|church|cathedral|basilica|chapel|abdij|klooster|abbey/.test(t)) return { cat: 'historisch', indoor: true, dur: 30, fee: null };
  if (/park|tuin|bos|garden|meer|strand|beach|natuur|duin|lake/.test(t)) return { cat: 'natuur', indoor: false, dur: 60, fee: 'gratis' };
  if (/zoo|dierentuin|pretpark|attractiepark/.test(t)) return { cat: 'natuur', indoor: false, dur: 150, fee: 'entree' };
  if (/kasteel|burcht|slot|castle|paleis|palace/.test(t)) return { cat: 'historisch', indoor: false, dur: 60, fee: 'buiten' };
  if (/theater|schouwburg|opera|concert/.test(t)) return { cat: 'historisch', indoor: true, dur: 45, fee: 'buiten' };
  // poorten, molens, torens, waag, stadhuis, oude gebouwen: vooral even langslopen
  return { cat: 'historisch', indoor: false, dur: 20, fee: 'buiten', walkby: true };
}

// Lunch, diner of allebei? Op basis van soort zaak, naam, keuken en (als bekend) openingstijden.
export function inferMeal(t) {
  const name = (t.name || '').toLowerCase();
  const c = (t.cuisine || '').toLowerCase();
  const allround = t.amenity === 'cafe' || /caf[eé]|brasserie|grand|eetcaf|herberg|lunch|bistro|pannenkoek|pancake|paviljoen|strandtent|bakker|koffie|coffee|tearoom|theehuis/.test(name)
    || /regional|dutch|pancake|sandwich|breakfast|brunch|coffee_shop|cake|bakery/.test(c);
  const dinnerCuisine = /chinese|indonesian|asian|indian|japanese|sushi|thai|vietnamese|korean|wok|steak|fine_dining|surinam|turkish|greek|argentinian|mexican|italian|pizza|spanish|tapas|lebanese|ethiopian|african|french/.test(c);
  let meal = t.amenity === 'cafe' ? 'lunch' : allround ? 'beide' : 'diner';
  if (dinnerCuisine && !allround) meal = 'diner';
  // openingstijden, bv. "Tu-Su 16:00-22:00"
  const oh = t.opening_hours || '';
  const spans = [...oh.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)].map((m) => [+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]]);
  if (spans.length) {
    const lunchOk = spans.some(([a, b]) => a <= 12 * 60 + 30 && (b >= 13 * 60 + 30 || b < a));
    const dinnerOk = spans.some(([a, b]) => b >= 20 * 60 || b < a);
    if (lunchOk && !dinnerOk) meal = 'lunch';
    else if (!lunchOk && dinnerOk) meal = 'diner';
    else if (lunchOk && dinnerOk && allround) meal = 'beide';
  }
  return { meal, allround: !!allround };
}

// Officiële website (P856) en bekendheid (aantal Wikipedia-talen) uit Wikidata.
async function wikidataInfo(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const j = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=claims|sitelinks&ids=${ids.slice(i, i + 50).join('|')}`, { headers: WIKI_HEADERS });
    for (const [q, e] of Object.entries(j.entities || {})) {
      const site = (e.claims?.P856 || []).map((c) => c.mainsnak?.datavalue?.value).find(Boolean);
      out[q] = { website: site || '', fame: Object.keys(e.sitelinks || {}).filter((k) => k.endsWith('wiki')).length };
    }
  }
  return out;
}

export function wikiSights(lat, lon, lang = 'nl') {
  return cached(`ws3.${lang}.${lat.toFixed(3)},${lon.toFixed(3)}`, 7 * 864e5, async () => {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*` +
      `&generator=geosearch&ggscoord=${lat}|${lon}&ggsradius=10000&ggslimit=80` +
      `&prop=pageimages|description|coordinates|pageprops&ppprop=wikibase_item&piprop=thumbnail&pithumbsize=960&colimit=max`;
    const j = await getJSON(url, { headers: WIKI_HEADERS });
    const pages = (j.query?.pages || []).filter((p) => p.thumbnail && p.coordinates && !SKIP.test(`${p.title} ${p.description || ''}`));
    const qids = pages.map((p) => p.pageprops?.wikibase_item).filter(Boolean);
    const wd = qids.length ? await wikidataInfo(qids).catch(() => ({})) : {};
    // Bekende plekken dicht bij het centrum eerst; kerkjes in omliggende dorpen zakken.
    const center = { lat, lon };
    const ranked = pages.map((p) => {
      const info = wd[p.pageprops?.wikibase_item] || {};
      const km = distKm(center, { lat: p.coordinates[0].lat, lon: p.coordinates[0].lon });
      return { p, info, km, score: Math.log2((info.fame || 1) + 1) * 2 - km * 0.6 };
    }).sort((a, b) => b.score - a.score);
    return ranked.slice(0, 40).map(({ p, info }, i) => {
      const g = guessCategory(`${p.title} ${p.description || ''}`);
      // Hoe belangrijk? Bekendheid (aantal Wikipedia-talen), musea/attracties hoger, 'even langslopen' lager.
      const fame = Math.log2((info.fame || 1) + 1);
      const prio = Math.min(5, Math.max(1, Math.round(fame * 0.9 + (g.cat === 'museum' ? 1.5 : 0) + (info.website ? 0.5 : 0) - (g.walkby ? 1 : 0))));
      return {
        id: `w${lang}${p.pageid}`, name: p.title.replace(/\s*\(.*\)$/, ''), ...g,
        prio, lat: p.coordinates[0].lat, lon: p.coordinates[0].lon,
        short: p.description ? p.description[0].toUpperCase() + p.description.slice(1) : '',
        photos: [p.thumbnail.source], wiki: [lang, p.title], website: info.website || '', rank: i,
      };
    });
  });
}

export function wikiSummary(lang, title) {
  return cached(`wsum.${lang}.${title}`, 14 * 864e5, async () => {
    const j = await getJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${enc(title.replace(/ /g, '_'))}`, { headers: WIKI_HEADERS });
    return {
      text: j.extract || '', desc: j.description || '',
      img: j.originalimage?.source ? wm(j.thumbnail?.source || j.originalimage.source, 960) : null,
      url: j.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${enc(title)}`,
    };
  });
}

// ---------- OpenStreetMap: hotels en restaurants in elke stad ----------
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

const CUISINE = {
  regional: 'Regionaal', dutch: 'Hollands', italian: 'Italiaans', pizza: 'Pizza', french: 'Frans', indian: 'Indiaas',
  chinese: 'Chinees', japanese: 'Japans', sushi: 'Sushi', thai: 'Thais', indonesian: 'Indonesisch', greek: 'Grieks',
  turkish: 'Turks', spanish: 'Spaans', tapas: 'Tapas', mexican: 'Mexicaans', steak_house: 'Steakhouse', fish: 'Vis',
  seafood: 'Vis', vegetarian: 'Vegetarisch', vegan: 'Vegan', burger: 'Burgers', pancake: 'Pannenkoeken', asian: 'Aziatisch',
  korean: 'Koreaans', vietnamese: 'Vietnamees', lebanese: 'Libanees', international: 'Internationaal', mediterranean: 'Mediterraan',
  argentinian: 'Argentijns', portuguese: 'Portugees', german: 'Duits', belgian: 'Belgisch', american: 'Amerikaans', breakfast: 'Ontbijt',
  european: 'Europees', cantonese: 'Kantonees', fish_and_chips: 'Vis & friet', friture: 'Snackbar', kebab: 'Kebab', grill: 'Grill',
  brasserie: 'Brasserie', bistro: 'Bistro', fine_dining: 'Fine dining', surinamese: 'Surinaams', ethiopian: 'Ethiopisch', eritrean: 'Eritrees',
  african: 'Afrikaans', middle_eastern: 'Midden-Oosters', syrian: 'Syrisch', persian: 'Perzisch', moroccan: 'Marokkaans',
  ice_cream: 'IJs', coffee_shop: 'Koffie', cake: 'Gebak', bagel: 'Bagels', pasta: 'Pasta', noodle: 'Noedels', ramen: 'Ramen',
  dim_sum: 'Dim sum', curry: 'Curry', fusion: 'Fusion', sandwich: 'Broodjes', brunch: 'Brunch', chicken: 'Kip', wok: 'Wok',
  frisian: 'Fries', local: 'Lokaal', crepe: 'Crêpes', waffle: 'Wafels', japanese_fusion: 'Japans', poke: 'Poké', soup: 'Soep',
};
export function cuisineLabel(c) {
  if (!c) return 'Restaurant';
  return c.split(';').map((x) => CUISINE[x.trim().toLowerCase()] || (x.trim()[0].toUpperCase() + x.trim().slice(1).replace(/_/g, ' '))).slice(0, 2).join(' · ');
}

// Gevelfoto van een pand op Wikimedia Commons, alleen als de bestandsnaam precies
// het adres én de stad noemt (zoals "Franeker - Voorstraat 12.jpg"). Zo tonen we nooit het buurpand.
export function commonsFacade(place, city) {
  const m = (place.address || '').match(/^(.+?)\s(\d+)([a-zA-Z]?)$/);
  if (!m || !city) return Promise.resolve(null);
  const street = m[1], nr = m[2] + m[3];
  return cached(`cf.${place.id}`, 30 * 864e5, async () => {
    const q = `intitle:"${street} ${nr}" ${city}`;
    const j = await getJSON(`https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&generator=search&gsrnamespace=6&gsrlimit=6&gsrsearch=${enc(q)}&prop=imageinfo&iiprop=url|size&iiurlwidth=500`, { headers: WIKI_HEADERS });
    const want = new RegExp(`${street.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+${nr}(?![0-9])`, 'i');
    const hit = (j.query?.pages || []).find((p) => {
      const t = p.title || '', inf = p.imageinfo?.[0];
      return /\.(jpe?g)$/i.test(t) && want.test(t) && t.toLowerCase().includes(city.toLowerCase()) && inf?.thumburl && inf.width >= inf.height * 0.5;
    });
    return hit ? { url: hit.imageinfo[0].thumburl, credit: hit.title.replace(/^File:/, '') } : null;
  }).catch(() => null);
}

// Geen keuken bekend in OpenStreetMap? Dan zegt de naam vaak genoeg.
const NAME_KIND = [
  [/grand[- ]?caf[eé]/i, 'Grand café'], [/brasserie/i, 'Brasserie'], [/eetcaf[eé]/i, 'Eetcafé'], [/bistro/i, 'Bistro'],
  [/pannenkoek|pancake/i, 'Pannenkoeken'], [/pizz/i, 'Pizza · Italiaans'], [/trattoria|ristorante|osteria/i, 'Italiaans'],
  [/sushi/i, 'Sushi · Japans'], [/wok/i, 'Wok · Aziatisch'], [/(chin\w*|kwong|wah|long|lotus|dragon|hong|ming|wong)\b/i, 'Chinees'],
  [/thai/i, 'Thais'], [/indi(a|s)|tandoori|masala/i, 'Indiaas'], [/griek|grieks|olymp|athene|kreta|rhodos|rodos|zorba|acropolis/i, 'Grieks'],
  [/tapas|bodega/i, 'Spaans · Tapas'], [/steak|grill/i, 'Grill · Vlees'], [/vis|fish|oester/i, 'Vis'], [/herberg|stadsherberg/i, 'Hollands'],
  [/lunch|broodje|bakker/i, 'Lunchroom'], [/strandpaviljoen|strandtent|paviljoen/i, 'Paviljoen'], [/caf[eé]/i, 'Café'],
];
export function inferCuisine(t) {
  const hit = NAME_KIND.find(([re]) => re.test(t.name || ''));
  // zegt de naam al wat voor zaak het is (brasserie, grand café, eetcafé…), dan staat dat voorop
  const strong = hit && /Grand café|Brasserie|Eetcafé|Bistro|Pannenkoeken/.test(hit[1]) ? hit[1] : null;
  if (t.cuisine) {
    const c = cuisineLabel(t.cuisine);
    return strong && !c.includes(strong) ? `${strong} · ${c.split(' · ')[0]}` : c;
  }
  if (strong) return strong;
  if (t.amenity === 'cafe') return 'Café / lunch';
  return hit ? hit[1] : 'Restaurant';
}

async function overpass(query) {
  let err;
  // niet te lang wachten: lukt het niet snel, dan neemt Nominatim het over
  for (const ep of OVERPASS.slice(0, 2)) {
    try {
      return await getJSON(ep, { method: 'POST', body: 'data=' + enc(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 12000);
    } catch (e) { err = e; }
  }
  throw err;
}

export function osmPlaces(lat, lon, kind) {
  return cached(`osm3.${kind}.${lat.toFixed(3)},${lon.toFixed(3)}`, 7 * 864e5, async () => {
    const q = kind === 'hotel'
      ? `[out:json][timeout:25];nwr["tourism"~"^(hotel|guest_house)$"]["name"](around:3500,${lat},${lon});out center tags 80;`
      : `[out:json][timeout:25];nwr["amenity"~"^(restaurant|cafe)$"]["name"](around:1500,${lat},${lon});out center tags 150;`;
    let elements;
    try {
      elements = (await overpass(q)).elements || [];
    } catch {
      // Overpass is soms overbelast: dan zoeken we via Nominatim (ook OpenStreetMap).
      elements = await nominatimPlaces(lat, lon, kind);
    }
    const items = elements.map((e) => {
      const t = e.tags || {};
      const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon;
      const address = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
      const base = { id: `o${e.type[0]}${e.id}`, name: t.name, lat: la, lon: lo, address, website: t.website || t['contact:website'] || '', phone: t.phone || t['contact:phone'] || '' };
      if (kind === 'hotel') return { ...base, stars: Number(t.stars) || null, style: t.tourism === 'guest_house' ? 'B&B / pension' : 'Hotel', text: '' };
      const cafe = t.amenity === 'cafe';
      const { meal, allround } = inferMeal(t);
      return { ...base, cuisine: inferCuisine(t), meal, allround, hours: t.opening_hours || '', text: '', menuUrl: t['website:menu'] || '' };
    }).filter((x) => x.lat && x.name);
    if (!items.length) throw new Error('geen resultaten');
    return items;
  });
}

// Reserve: Nominatim kent ook restaurants en hotels; we zetten de antwoorden om naar
// hetzelfde formaat als Overpass, zodat de rest van de app niets merkt.
async function nominatimPlaces(lat, lon, kind) {
  const d = kind === 'hotel' ? 0.035 : 0.02;
  const box = [lon - d, lat + d, lon + d, lat - d].map((x) => x.toFixed(4)).join(',');
  const terms = kind === 'hotel' ? ['hotel', 'guest house'] : ['restaurant', 'cafe'];
  const out = [];
  for (const term of terms) {
    const j = await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=50&addressdetails=1&extratags=1&bounded=1&viewbox=${box}&q=${enc(term)}`);
    for (const r of j) {
      if (!r.name) continue;
      const t = { ...(r.extratags || {}), name: r.name, 'addr:street': r.address?.road, 'addr:housenumber': r.address?.house_number };
      if (kind === 'hotel') t.tourism = r.type === 'guest_house' ? 'guest_house' : 'hotel';
      else t.amenity = r.type === 'cafe' ? 'cafe' : 'restaurant';
      out.push({ type: r.osm_type || 'node', id: r.osm_id, lat: Number(r.lat), lon: Number(r.lon), tags: t });
    }
  }
  const seen = new Set();
  return out.filter((e) => { const k = e.type + e.id; if (seen.has(k)) return false; seen.add(k); return true; });
}
