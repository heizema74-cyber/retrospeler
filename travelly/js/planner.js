// Slimme planning: verdeelt bezienswaardigheden over de dagen.
// Houdt rekening met: weer (regen → binnen), sluitingsdagen (vaak maandag),
// seizoen (bv. Keukenhof alleen in het voorjaar), afstanden (wat dicht bij elkaar
// ligt komt op dezelfde dag), jullie interesses, het tempo en het reisgezelschap
// (met jonge kinderen: rustiger, speelpauze, middagdutje en vroeg eten).

import { distKm, walkMin, parseISO, tripDates, weatherInfo } from './api.js';
import { uid } from './store.js';
import { familyOf, kidFit } from './guide.js';

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toTime = (m) => { m = Math.round(m / 5) * 5; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

const TEMPO = { rustig: { n: 3, start: '10:00' }, normaal: { n: 4, start: '09:30' }, actief: { n: 6, start: '09:00' } };

const isWet = (w) => (w?.pop ?? 0) >= 60 || weatherInfo(w?.code).wet;

function score(s, date, w, prefs, fam) {
  const day = parseISO(date).getDay();
  const month = parseISO(date).getMonth() + 1;
  if (s.closed?.includes(day)) return -999;
  if (s.season && !s.season.includes(month)) return -999;
  let sc = (s.prio || 2) * 2;
  const i = prefs.interests || [];
  if (i.includes('cultuur') && (s.cat === 'museum' || s.cat === 'historisch')) sc += 2;
  if (i.includes('natuur') && (s.cat === 'natuur' || s.cat === 'dagtrip')) sc += 2.5;
  if (i.includes('wandelen') && (s.cat === 'wandelen' || s.cat === 'natuur')) sc += 2;
  if (fam) {
    const fit = kidFit(s, fam);
    if (fit) sc += fit.level === 'top' ? 5 : fit.level === 'deels' ? 0 : -6;
  }
  if (isWet(w)) sc += s.indoor ? 3 : -4;
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

export function makePlan(trip, allSights, restaurants = [], weather = []) {
  const dates = tripDates(trip);
  const prefs = { interests: ['cultuur'], tempo: 'normaal', ...trip.prefs };
  const fam = familyOf(trip);
  const young = fam && fam.youngest <= 5;
  const nap = fam && fam.youngest <= 3;
  const tempo = { ...(TEMPO[prefs.tempo] || TEMPO.normaal) };
  if (young) { tempo.n = Math.min(tempo.n, 3); tempo.start = '09:30'; }

  // Speelplekken gebruiken we als pauze, niet als bezienswaardigheid.
  const play = fam ? allSights.filter((s) => s.cat === 'spelen') : [];
  const sights = allSights.filter((s) => s.cat !== 'spelen' && !s.family).map((s) => (
    young && s.indoor && s.cat !== 'dagtrip' ? { ...s, dur: Math.min(s.dur, 75) } : s));
  const used = new Set();
  const usedFood = new Set();
  const usedPlay = new Set();
  const city = trip.city;
  const W = (d) => weather.find((w) => w.date === d);
  const kidFood = (r) => !fam || r.kids;

  // Dagtrip: alleen bij 3+ dagen, op de beste (droogste) middelste dag.
  let tripDay = null, dayTrip = null;
  if (dates.length >= 3) {
    const middle = dates.slice(1, -1);
    const options = sights.filter((s) => s.cat === 'dagtrip');
    let best = -Infinity;
    for (const d of middle) for (const s of options) {
      const sc = score(s, d, W(d), prefs, fam) - ((W(d)?.pop ?? 30) / 20);
      if (sc > best && sc >= 9) { best = sc; tripDay = d; dayTrip = s; }
    }
    if (dayTrip) used.add(dayTrip.id);
  }

  const days = dates.map((date, di) => {
    const first = di === 0, last = di === dates.length - 1 && dates.length > 1;
    const items = [];
    const add = (time, o) => items.push({ id: uid('i'), time: toTime(time), ...o });
    let t = toMin(first ? '10:30' : tempo.start);
    const end = last ? toMin('15:30') : toMin(young ? '16:00' : '17:15');
    let pos = { lat: city.lat, lon: city.lon };
    let lunched = false, played = false;
    const wet = isWet(W(date));

    if (first) {
      add(t, { kind: 'custom', icon: 'suitcase', title: `Aankomst in ${city.name}`, note: fam ? 'Bagage naar het hotel, iets drinken en even rondkijken.' : 'Bagage naar het hotel en eerst een kop koffie.' });
      t += 45;
    }

    const lunch = () => {
      const r = nearest(restaurants, pos, usedFood, (x) => x.meal !== 'diner' && kidFood(x))
        || nearest(restaurants, pos, usedFood, (x) => x.meal !== 'diner');
      t = Math.max(t, toMin(young ? '12:00' : '12:30'));
      if (r) { usedFood.add(r.id); add(t, { kind: 'food', refId: r.id, title: `Lunch bij ${r.name}`, lat: r.lat, lon: r.lon, sub: r.cuisine }); }
      else add(t, { kind: 'custom', icon: 'coffee', title: 'Lunch in de buurt' });
      t += 60; lunched = true;
      if (nap) {
        add(t, { kind: 'custom', icon: 'moon', title: 'Rustmoment / middagdutje', note: 'Een rustige wandeling met de buggy (bijvoorbeeld langs de singels), of even terug naar het hotel.' });
        t += 60;
      }
    };

    const playBreak = () => {
      if (!fam || played || wet) return;
      const pl = nearest(play, pos, usedPlay, () => true);
      if (!pl || distKm(pos, pl) > 2.5) return;
      const walk = walkMin(distKm(pos, pl));
      t += walk;
      usedPlay.add(pl.id);
      add(t, { kind: 'sight', refId: pl.id, title: `Speelpauze: ${pl.name}`, lat: pl.lat, lon: pl.lon, sub: pl.short || 'Spelen', walk });
      t += pl.dur;
      pos = pl;
      played = true;
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
        if (!lunched && t >= toMin(young ? '11:45' : '12:00')) lunch();
        if (fam && lunched && !played && count >= 2) playBreak();
        let best = null, bs = -Infinity;
        for (const s of sights) {
          if (used.has(s.id) || s.cat === 'dagtrip') continue;
          const sc = score(s, date, W(date), prefs, fam) - (count === 0 && !first ? 0 : distKm(pos, s) * (fam ? 2 : 3));
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
      if (!last || t < toMin('14:45')) playBreak();
    }

    if (last) {
      add(Math.max(t, toMin('15:30')), { kind: 'custom', icon: 'suitcase', title: 'Vertrek', note: 'Nog tijd over? Een laatste stroopwafel voor onderweg.' });
    } else if (fam) {
      add(Math.max(t, toMin('16:15')), { kind: 'custom', icon: 'coffee', title: 'Even bijkomen in het hotel' });
      const r = nearest(restaurants, pos, usedFood, (x) => x.meal !== 'lunch' && x.kids)
        || nearest(restaurants, pos, usedFood, (x) => x.meal !== 'lunch' && !/fine dining/i.test(x.cuisine || ''));
      if (r) { usedFood.add(r.id); add(toMin('17:30'), { kind: 'food', refId: r.id, title: `Vroeg eten bij ${r.name}`, lat: r.lat, lon: r.lon, sub: r.cuisine }); }
      else add(toMin('17:30'), { kind: 'custom', icon: 'food', title: 'Vroeg eten' });
    } else {
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
