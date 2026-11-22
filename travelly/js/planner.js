// Slimme planning: verdeelt bezienswaardigheden over de dagen.
// Houdt rekening met: weer (regen → binnen), sluitingsdagen (vaak maandag),
// seizoen (bv. Keukenhof alleen in het voorjaar), afstanden (wat dicht bij elkaar
// ligt komt op dezelfde dag), jullie interesses en het gewenste tempo.

import { distKm, walkMin, parseISO, tripDates, weatherInfo } from './api.js';
import { uid } from './store.js';

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toTime = (m) => { m = Math.round(m / 5) * 5; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

const TEMPO = { rustig: { n: 3, start: '10:00' }, normaal: { n: 4, start: '09:30' }, actief: { n: 6, start: '09:00' } };

function score(s, date, w, prefs) {
  const day = parseISO(date).getDay();
  const month = parseISO(date).getMonth() + 1;
  if (s.closed?.includes(day)) return -999;
  if (s.season && !s.season.includes(month)) return -999;
  const wi = weatherInfo(w?.code);
  const wet = (w?.pop ?? 0) >= 60 || wi.wet;
  let sc = (s.prio || 2) * 2;
  const i = prefs.interests || [];
  if (i.includes('cultuur') && (s.cat === 'museum' || s.cat === 'historisch')) sc += 2;
  if (i.includes('natuur') && (s.cat === 'natuur' || s.cat === 'dagtrip')) sc += 2.5;
  if (i.includes('wandelen') && (s.cat === 'wandelen' || s.cat === 'natuur')) sc += 2;
  if (i.includes('kinderen') && s.kids) sc += 2.5;
  if (wet) sc += s.indoor ? 3 : -4;
  else if (!s.indoor && (w?.tmax ?? 15) >= 14) sc += 1.5;
  return sc;
}

function nearest(list, from, used, filter) {
  let best = null, bd = Infinity;
  for (const r of list) {
    if (used.has(r.id) || !filter(r)) continue;
    const d = distKm(from, r);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

export function makePlan(trip, sights, restaurants = [], weather = []) {
  const dates = tripDates(trip);
  const prefs = { interests: ['cultuur'], tempo: 'normaal', ...trip.prefs };
  const tempo = TEMPO[prefs.tempo] || TEMPO.normaal;
  const used = new Set();
  const usedFood = new Set();
  const city = trip.city;
  const W = (d) => weather.find((w) => w.date === d);

  // Dagtrip: alleen bij 3+ dagen, op de beste (droogste) middelste dag.
  let tripDay = null, dayTrip = null;
  if (dates.length >= 3) {
    const middle = dates.slice(1, -1);
    const options = sights.filter((s) => s.cat === 'dagtrip');
    let best = -Infinity;
    for (const d of middle) for (const s of options) {
      const sc = score(s, d, W(d), prefs) - ((W(d)?.pop ?? 30) / 20);
      if (sc > best && sc >= 9) { best = sc; tripDay = d; dayTrip = s; }
    }
    if (dayTrip) used.add(dayTrip.id);
  }

  const days = dates.map((date, di) => {
    const first = di === 0, last = di === dates.length - 1 && dates.length > 1;
    const items = [];
    const add = (time, o) => items.push({ id: uid('i'), time: toTime(time), ...o });
    let t = toMin(first ? '10:30' : tempo.start);
    const end = last ? toMin('15:30') : toMin('17:15');
    let pos = { lat: city.lat, lon: city.lon };
    let lunched = false;

    if (first) {
      add(t, { kind: 'custom', icon: 'suitcase', title: `Aankomst in ${city.name}`, note: 'Bagage naar het hotel en eerst een kop koffie.' });
      t += 45;
    }

    const lunch = () => {
      const r = nearest(restaurants, pos, usedFood, (x) => x.meal !== 'diner');
      t = Math.max(t, toMin('12:30'));
      if (r) { usedFood.add(r.id); add(t, { kind: 'food', refId: r.id, title: `Lunch bij ${r.name}`, lat: r.lat, lon: r.lon, sub: r.cuisine }); }
      else add(t, { kind: 'custom', icon: 'coffee', title: 'Lunch in de buurt' });
      t += 60; lunched = true;
    };

    if (date === tripDay && dayTrip) {
      add(t, { kind: 'sight', refId: dayTrip.id, title: dayTrip.name, lat: dayTrip.lat, lon: dayTrip.lon, sub: 'Dagtrip', note: dayTrip.tip || '' });
      t += dayTrip.dur + 45;
      pos = dayTrip;
      lunched = true;
    } else {
      const n = first || last ? Math.max(2, tempo.n - 1) : tempo.n;
      let count = 0;
      while (count < n && t < end) {
        if (!lunched && t >= toMin('12:00')) lunch();
        let best = null, bs = -Infinity;
        for (const s of sights) {
          if (used.has(s.id) || s.cat === 'dagtrip') continue;
          const sc = score(s, date, W(date), prefs) - (count === 0 && !first ? 0 : distKm(pos, s) * 3);
          if (sc > bs) { bs = sc; best = s; }
        }
        if (!best || bs < -100) break;
        const walk = count === 0 && !first ? 0 : walkMin(distKm(pos, best));
        if (t + walk + best.dur > end + 30) break;
        t += walk;
        used.add(best.id);
        add(t, { kind: 'sight', refId: best.id, title: best.name, lat: best.lat, lon: best.lon, sub: best.short || '', note: best.tip || '', walk });
        t += best.dur + 10;
        pos = best;
        count++;
      }
      if (!lunched && t <= toMin('14:30')) lunch();
    }

    if (last) {
      add(Math.max(t, toMin('15:30')), { kind: 'custom', icon: 'suitcase', title: 'Vertrek', note: 'Nog tijd over? Een laatste stroopwafel voor onderweg.' });
    } else {
      const w = W(date);
      const wet = (w?.pop ?? 0) >= 60;
      add(Math.max(t, toMin('17:00')), { kind: 'custom', icon: wet ? 'coffee' : 'sun', title: wet ? 'Vrije tijd / even bijkomen' : 'Vrije tijd / terras of shoppen' });
      const r = nearest(restaurants, pos, usedFood, (x) => x.meal !== 'lunch');
      if (r) { usedFood.add(r.id); add(toMin('19:00'), { kind: 'food', refId: r.id, title: `Diner bij ${r.name}`, lat: r.lat, lon: r.lon, sub: r.cuisine }); }
      else add(toMin('19:00'), { kind: 'custom', icon: 'food', title: 'Diner' });
    }
    return { date, items };
  });

  return { generatedAt: Date.now(), days };
}

export function sortItems(day) {
  day.items.sort((a, b) => a.time.localeCompare(b.time));
}
