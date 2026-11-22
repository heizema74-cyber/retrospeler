// Travelly – persoonlijke reisgids. Alle schermen en de navigatie.
import { icon } from './icons.js';
import * as S from './store.js';
import {
  fmt, iso, addDays, daysBetween, tripDates, distLabel, walkMin, distKm, wm, gmaps, enc,
  searchCity, tripWeather, currentWeather, weatherInfo, wikiSummary,
} from './api.js';
import { FEATURED, guideFor, sightsFor, placesFor, findPlace, adviceFor, CAT, partyOf, familyOf, partyLabel, kidFit, facadePhotos, sightsForTrip, placesForTrip, customFor } from './guide.js';
import { makePlan, sortItems, explainDay } from './planner.js';
import { makeMap, marker, line, fit, userLocation } from './map.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
let cleanup = [];

// ------------------------------------------------------------------ helpers
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2200);
}

function sheet(html, { onMount, wide = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${html}</div>`;
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  const close = () => { wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 250); window.removeEventListener('keydown', onKey); };
  const onKey = (e) => e.key === 'Escape' && close();
  window.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  onMount?.(wrap.firstElementChild, close);
  return close;
}

const weatherMemo = new Map();
function weatherFor(trip) {
  const k = `${trip.id}.${trip.start}.${trip.end}`;
  if (!weatherMemo.has(k)) weatherMemo.set(k, tripWeather(trip).catch((e) => { weatherMemo.delete(k); console.warn(e); return []; }));
  return weatherMemo.get(k);
}

function header(title, { back = '#/', action = '', sub = '' } = {}) {
  return `<header class="pagehead">
    <a class="iconbtn" href="${back}" aria-label="Terug">${icon('left')}</a>
    <div class="pagehead-t"><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>
    <div class="pagehead-a">${action}</div>
  </header>`;
}

function photoOrPh(p, w = 500, cls = '') {
  if (p.photo) return `<img class="${cls}" src="${esc(wm(p.photo, w))}" alt="" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph ph-${p.kind}',innerHTML:this.dataset.ph||''}))" data-ph='${icon(p.kind === 'hotel' ? 'bed' : p.kind === 'food' ? 'food' : 'landmark')}'>`;
  return `<div class="ph ph-${p.kind} ${cls}">${icon(p.kind === 'hotel' ? 'bed' : p.kind === 'food' ? 'food' : CAT[p.cat]?.icon || 'landmark')}<span>${esc(initials(p.name))}</span></div>`;
}
const initials = (n = '') => n.replace(/^(Hotel|Restaurant|Boutique hotel|Boutique Hotel|Stadscafé|Grand Café|Pannenkoekenhuis)\s+/i, '').replace(/['’]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function favBtn(trip, p, cls = '') {
  const on = !!trip.favorites?.[p.id];
  return `<button class="fav ${cls}${on ? ' on' : ''}" data-fav="${esc(p.id)}" aria-label="${on ? 'Verwijder uit favorieten' : 'Bewaar als favoriet'}" aria-pressed="${on}">${icon('heart')}</button>`;
}

function placeCard(trip, p, { compact = false } = {}) {
  const meta = [p.sub, p.km != null ? kmLabel(p.km) : null].filter(Boolean).join(' · ');
  return `<article class="pcard${compact ? ' compact' : ''}">
    <a class="pcard-img" href="#/r/${trip.id}/p/${enc(p.id)}">${photoOrPh(p, compact ? 250 : 500)}</a>
    <a class="pcard-body" href="#/r/${trip.id}/p/${enc(p.id)}">
      <h3>${esc(p.name)}</h3>
      <p class="meta">${esc(meta)}${feeBadge(p)}${p.custom ? ' <span class="fee own">Zelf toegevoegd</span>' : ''}</p>
      ${!compact && (p.short || p.text) ? `<p class="desc">${esc(p.short || p.text)}</p>` : ''}
      ${cardFit(trip, p)}
      ${p.kind === 'food' && p.menu?.dishes?.length ? `<p class="meta small dishline">${icon('food')} ${esc(p.menu.dishes.slice(0, 3).join(' · '))}</p>` : ''}
      ${p.kind === 'food' && (p.address || p.meal) ? `<p class="meta small">${p.address ? esc(p.address) : ''}${p.meal === 'lunch' ? `${p.address ? ' · ' : ''}overdag` : p.meal === 'diner' ? `${p.address ? ' · ' : ''}'s avonds` : ''}</p>` : ''}
      ${p.kind === 'hotel' && p.address ? `<p class="meta small">${p.stars ? '★'.repeat(p.stars) + ' · ' : ''}${esc(p.address)}</p>` : ''}
    </a>
    ${favBtn(trip, p)}
  </article>`;
}

// "in de omgeving · 3,4 km" voor alles verder dan 2 km van het centrum
const kmLabel = (km) => (km > 2 ? `in de omgeving · ${distLabel(km)}` : distLabel(km));

const FEE = { gratis: ['Gratis', 'free'], buiten: ['Gratis van buiten', 'free'], entree: ['Entree', 'paid'] };
function feeBadge(p) {
  const f = p.kind === 'sight' && FEE[p.fee];
  return f ? ` <span class="fee ${f[1]}">${f[0]}</span>` : '';
}

function cardFit(trip, p) {
  if (p.kind === 'food') return p.kids && familyOf(trip) ? `<p class="kidfit top">${icon('smile')} Kindvriendelijk</p>` : '';
  const f = kidFit(p, familyOf(trip));
  return f ? `<p class="kidfit ${f.level}">${icon(f.level === 'nee' ? 'info' : 'smile')} ${esc(f.label)}</p>` : '';
}

function skeleton(n = 4) {
  return Array.from({ length: n }, () => '<div class="pcard skel"><div class="pcard-img"></div><div class="pcard-body"><i></i><i></i><i></i></div></div>').join('');
}

function errorBox(msg, retry = true) {
  return `<div class="empty">${icon('cloud')}<p>${esc(msg)}</p>${retry ? '<button class="btn ghost" onclick="location.reload()">Opnieuw proberen</button>' : ''}</div>`;
}

function wxBadge(w, { big = false } = {}) {
  if (!w || w.tmax == null) return '';
  const wi = weatherInfo(w.code);
  return `<span class="wx${big ? ' big' : ''}" title="${wi.label}${w.source === 'klimaat' ? ' (gemiddeld)' : ''}">${icon(wi.icon, 'wx-' + wi.icon)}<b>${Math.round(w.tmax)}°</b></span>`;
}

// Favoriet-knoppen werken overal hetzelfde.
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-fav]');
  if (!b) return;
  e.preventDefault();
  const trip = currentTrip();
  if (!trip) return;
  const p = await findPlace(trip.city, b.dataset.fav) || trip.favorites[b.dataset.fav];
  if (!p) return;
  const on = S.toggleFavorite(trip, { ...p, photo: p.photo || null });
  $$(`[data-fav="${CSS.escape(b.dataset.fav)}"]`).forEach((x) => { x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
  toast(on ? 'Bewaard bij favorieten' : 'Verwijderd uit favorieten');
});

let routeTrip = null;
const currentTrip = () => routeTrip || S.activeTrip();

// ------------------------------------------------------------------ router
const routes = [
  [/^\/?$/, home],
  [/^\/nieuw$/, newTrip],
  [/^\/reizen$/, trips],
  [/^\/meer$/, more],
  [/^\/r\/([^/]+)$/, overview],
  [/^\/r\/([^/]+)\/zien$/, (id) => listPage(id, 'sight')],
  [/^\/r\/([^/]+)\/hotels$/, (id) => listPage(id, 'hotel')],
  [/^\/r\/([^/]+)\/eten$/, (id) => listPage(id, 'food')],
  [/^\/r\/([^/]+)\/p\/(.+)$/, detail],
  [/^\/r\/([^/]+)\/kaart$/, mapPage],
  [/^\/r\/([^/]+)\/planning$/, planning],
  [/^\/r\/([^/]+)\/weer$/, weatherPage],
  [/^\/r\/([^/]+)\/notities$/, notes],
  [/^\/r\/([^/]+)\/dagboek$/, diary],
  [/^\/r\/([^/]+)\/favorieten$/, favorites],
  [/^\/r\/([^/]+)\/instellingen$/, settings],
];

// Snelkoppelingen in de navigatie (planning, dagboek…) gaan naar de actieve reis.
function navHref(section) {
  const t = S.activeTrip();
  return t ? `#/r/${t.id}/${section}` : '#/nieuw';
}

function updateNav(path) {
  const t = S.activeTrip();
  $$('[data-nav]').forEach((a) => {
    const s = a.dataset.nav;
    a.href = s === 'home' ? '#/' : s === 'reizen' ? '#/reizen' : s === 'meer' ? '#/meer' : navHref(s);
    const active = s === 'home' ? (path === '/' || path === '' || (t && path === `/r/${t.id}`)) : path.endsWith('/' + s) || path === '/' + s;
    a.classList.toggle('active', !!active);
  });
  const list = $('#side-trips');
  if (list) list.innerHTML = S.getState().trips.slice(0, 6).map((x) => `<a href="#/r/${x.id}" class="${t?.id === x.id ? 'cur' : ''}"><span>${esc(x.city.name)}</span><small>${fmt.short(x.start)}</small></a>`).join('');
}

async function router() {
  cleanup.forEach((fn) => { try { fn(); } catch { /* */ } });
  // vensters (bewerken, foto) sluiten zodra je naar een ander scherm gaat
  $$('.sheet-wrap').forEach((w) => w.remove());
  cleanup = [];
  const path = decodeURI(location.hash.replace(/^#/, '').split('?')[0]) || '/';
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (!m) continue;
    const args = m.slice(1).map(decodeURIComponent);
    if (path.startsWith('/r/')) {
      const trip = S.getTrip(args[0]);
      if (!trip) { location.hash = '#/'; return; }
      routeTrip = trip;
      if (S.getState().activeTripId !== trip.id) S.setActive(trip.id);
    } else routeTrip = null;
    updateNav(path);
    document.body.dataset.page = fn.name || 'page';
    view.classList.remove('in');
    await fn(...args);
    void view.offsetWidth;
    view.classList.add('in');
    if (!path.includes('/kaart')) window.scrollTo(0, 0);
    return;
  }
  location.hash = '#/';
}

window.addEventListener('hashchange', router);

// ------------------------------------------------------------------ HOME
async function home() {
  const trip = S.activeTrip();
  if (!trip) return welcome();
  const g = guideFor(trip.city);
  const hero = g?.hero?.[0] || trip.city.photo;
  const nDays = tripDates(trip).length;
  view.innerHTML = `
  <section class="home">
    <div class="hero" style="${hero ? `--img:url('${esc(wm(hero, 1280))}')` : ''}">
      <div class="hero-top">
        <a class="brand-mini" href="#/reizen">${logo()}<span>Travelly</span></a>
        <a class="iconbtn glass" href="#/r/${trip.id}/instellingen" aria-label="Reis aanpassen">${icon('settings')}</a>
      </div>
      <a class="hero-text" href="#/r/${trip.id}">
        <h1>${esc(trip.city.name)}</h1>
        <p>${fmt.range(trip.start, trip.end)} · ${trip.persons} pers. ${icon('right')}</p>
        </a>
      ${g?.slogan ? `<span class="script">${esc(g.slogan)}</span>` : ''}
    </div>
    <div class="home-card">
      <nav class="tiles">
        ${tile(`#/r/${trip.id}/zien`, 'landmark', 'Bezienswaardigheden')}
        ${tile(`#/r/${trip.id}/hotels`, 'bed', 'Hotels')}
        ${tile(`#/r/${trip.id}/eten`, 'food', 'Restaurants')}
        ${tile(`#/r/${trip.id}/planning`, 'calendar', 'Planning')}
        ${tile(`#/r/${trip.id}/kaart`, 'map', 'Kaart')}
        ${tile(`#/r/${trip.id}/weer`, 'cloudsun', 'Weer')}
        ${tile(`#/r/${trip.id}/notities`, 'note', 'Notities')}
        ${tile(`#/r/${trip.id}/dagboek`, 'book', 'Dagboek')}
      </nav>
      <a class="wxcard" href="#/r/${trip.id}/weer" id="home-wx"><div class="wx-load">Weer laden…</div></a>
    </div>
    <div class="home-grid">
      <section class="block" id="home-plan"></section>
      <section class="block" id="home-advice"></section>
      <section class="block">
        <div class="block-h"><h2>Must-sees</h2><a href="#/r/${trip.id}/zien">Alles ${icon('right')}</a></div>
        <div class="hscroll" id="home-sights">${skeleton(3)}</div>
      </section>
${familyOf(trip) && g?.familyTips ? `<section class="block"><div class="block-h"><h2>Met kinderen in ${esc(trip.city.name)}</h2></div><div class="tips">${g.familyTips.map((t) => `<div class="tip fam">${icon('baby')}<div><b>${esc(t.title)}</b><p>${esc(t.text)}</p></div></div>`).join('')}</div></section>` : ''}
      ${g?.tips ? `<section class="block">
        <div class="block-h"><h2>Insider tips</h2></div>
        <div class="tips">${g.tips.slice(0, 3).map((t) => `<div class="tip">${icon('lightbulb')}<div><b>${esc(t.title)}</b><p>${esc(t.text)}</p></div></div>`).join('')}</div>
      </section>` : ''}
    </div>
  </section>`;

  // weer nu + reisdagen
  currentWeather(trip.city.lat, trip.city.lon).then((w) => {
    const wi = weatherInfo(w.code);
    const el = $('#home-wx');
    if (el) el.innerHTML = `${icon(wi.icon, 'wx-big wx-' + wi.icon)}<div><b>${Math.round(w.temp)}°</b><span>${wi.label} · nu in ${esc(trip.city.name)}</span></div><span class="wx-more">Bekijk het weer ${icon('right')}</span>`;
  }).catch(() => { const el = $('#home-wx'); if (el) el.innerHTML = `${icon('cloudsun', 'wx-big')}<div><b>Weer</b><span>Bekijk de verwachting</span></div>`; });

  const weather = await weatherFor(trip);
  const advice = adviceFor(trip, weather);
  const adv = $('#home-advice');
  if (adv) adv.innerHTML = advice.length ? `<div class="block-h"><h2>Advies voor jullie data</h2><a href="#/r/${trip.id}">Meer ${icon('right')}</a></div>
    <div class="advice">${advice.slice(0, 3).map(adviceItem).join('')}</div>` : '';

  const plan = $('#home-plan');
  if (plan) {
    if (trip.plan?.days?.length) {
      const today = iso(new Date());
      const day = trip.plan.days.find((d) => d.date === today) || trip.plan.days[0];
      const w = weather.find((x) => x.date === day.date);
      plan.innerHTML = `<div class="block-h"><h2>${day.date === today ? 'Vandaag' : 'Dag 1'} · ${fmt.dayCap(day.date)} ${fmt.short(day.date)}</h2><a href="#/r/${trip.id}/planning">Planning ${icon('right')}</a></div>
        <ol class="mini-tl">${day.items.slice(0, 5).map((it) => `<li><time>${it.time}</time><span>${esc(it.title)}</span></li>`).join('')}</ol>
        ${w ? `<div class="mini-wx">${wxBadge(w)} ${weatherInfo(w.code).label}</div>` : ''}`;
    } else {
      plan.innerHTML = `<div class="cta-plan">${icon('wand')}<div><h2>Laat je planning maken</h2><p>${nDays} ${nDays === 1 ? 'dag' : 'dagen'}, afgestemd op het weer, openingstijden en afstanden.</p></div><a class="btn" href="#/r/${trip.id}/planning">Maak planning</a></div>`;
    }
  }

  sightsForTrip(trip).then((list) => {
    const el = $('#home-sights');
    const fam = familyOf(trip);
    const fitScore = (s) => { const f = kidFit(s, fam); return f ? (f.level === 'top' ? 3 : f.level === 'deels' ? 1 : -4) : 0; };
    if (el) el.innerHTML = list.filter((s) => s.cat !== 'dagtrip' && s.cat !== 'spelen').sort((a, b) => (b.prio + fitScore(b)) - (a.prio + fitScore(a))).slice(0, 8).map((p) => miniCard(trip, p)).join('');
  }).catch(() => { const el = $('#home-sights'); if (el) el.innerHTML = errorBox('Bezienswaardigheden konden niet geladen worden.'); });
}

const tile = (href, ic, label) => `<a class="tile" href="${href}">${icon(ic)}<span>${label}</span></a>`;

function miniCard(trip, p) {
  return `<a class="mcard" href="#/r/${trip.id}/p/${enc(p.id)}">${photoOrPh(p, 500)}<div><b>${esc(p.name)}</b><small>${esc(p.sub)}${p.km != null ? ' · ' + distLabel(p.km) : ''}</small></div></a>`;
}

function adviceItem(a) {
  return `<div class="adv">${icon(a.icon || 'info')}<div><b>${esc(a.title)}</b>${a.when ? `<small>${fmt.dayCap(a.when)} ${fmt.short(a.when)}</small>` : ''}<p>${esc(a.text)}</p></div></div>`;
}

function logo() {
  return `<svg class="logo" viewBox="0 0 32 40" aria-hidden="true"><path d="M16 38s13-12.6 13-23A13 13 0 0 0 3 15c0 10.4 13 23 13 23Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 22c-3-2.3-5.5-4.3-5.5-7a2.9 2.9 0 0 1 5.5-1.2A2.9 2.9 0 0 1 21.5 15c0 2.7-2.5 4.7-5.5 7Z" fill="currentColor" opacity=".85"/></svg>`;
}

// ------------------------------------------------------------------ WELKOM
function welcome() {
  view.innerHTML = `
  <section class="welcome">
    <div class="welcome-hero" style="--img:url('${esc(wm(FEATURED[0].photo, 1280))}')">
      <div class="welcome-brand">${logo()}<h1>Travelly</h1><p>Plan. Explore. Remember.</p></div>
    </div>
    <div class="welcome-body">
      <h2>Jouw persoonlijke reisgids,<br>waar je ook bent.</h2>
      <ul class="features">
        <li>${icon('pin')} Ontdek de mooiste plekken</li>
        <li>${icon('calendar')} Maak je eigen planning, of laat hem maken</li>
        <li>${icon('bed')} Bekijk hotels & restaurants op de kaart</li>
        <li>${icon('heart')} Bewaar favorieten</li>
        <li>${icon('camera')} Leg herinneringen vast in je dagboek</li>
      </ul>
      <a class="btn big" href="#/nieuw">${icon('plus')} Plan een nieuwe reis</a>
      <button class="btn ghost" id="imp">${icon('upload')} Reis importeren</button>
    </div>
  </section>`;
  $('#imp').onclick = importFlow;
}

function importFlow() {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
  inp.onchange = async () => {
    try { const t = await S.importTrip(inp.files[0]); toast('Reis geïmporteerd'); location.hash = `#/r/${t.id}`; }
    catch (e) { alert(e.message || 'Importeren mislukt'); }
  };
  inp.click();
}

// ------------------------------------------------------------------ REISGEZELSCHAP
const PARTY = [['stel', "Met z'n tweeën", 'couple'], ['gezin', 'Gezin', 'baby'], ['vrienden', 'Vrienden', 'friends'], ['solo', 'Alleen', 'user']];
const ageOpt = (sel) => Array.from({ length: 18 }, (_, a) => `<option value="${a}"${a === sel ? ' selected' : ''}>${a === 0 ? 'jonger dan 1' : a + ' jaar'}</option>`).join('');

// Tekent en bewaakt de keuze "wie gaan er mee"; party wordt direct aangepast.
function partyEditor(box, party) {
  const draw = () => {
    const showAdults = party.type === 'gezin' || party.type === 'vrienden';
    box.innerHTML = `
      <div class="ptypes">${PARTY.map(([k, l, ic]) => `<button type="button" class="ptype${party.type === k ? ' on' : ''}" data-pt="${k}">${icon(ic)}<span>${l}</span></button>`).join('')}</div>
      ${showAdults ? `<div class="prow"><span>Volwassenen</span><div class="stepper"><button type="button" data-s="-1" aria-label="Minder">${icon('minus')}</button><output>${party.adults}</output><button type="button" data-s="1" aria-label="Meer">${icon('plus')}</button></div></div>` : ''}
      ${party.type === 'gezin' ? `<div class="kids">
        ${party.kids.map((a, i) => `<div class="kid">${icon('smile')}<span>Kind ${i + 1}</span><select data-kid="${i}" aria-label="Leeftijd kind ${i + 1}">${ageOpt(a)}</select><button type="button" class="iconbtn sm" data-rmkid="${i}" aria-label="Verwijder kind ${i + 1}">${icon('x')}</button></div>`).join('')}
        <button type="button" class="btn small ghost" data-addkid>${icon('plus')} Kind toevoegen</button>
        <p class="hint">${icon('info')} Planning, tips en de plekken die we laten zien worden afgestemd op de leeftijden.</p>
      </div>` : ''}`;
  };
  box.onclick = (e) => {
    const t = e.target.closest('[data-pt]');
    if (t) {
      party.type = t.dataset.pt;
      if (party.type === 'stel') party.adults = 2;
      if (party.type === 'solo') party.adults = 1;
      if (party.type === 'vrienden') party.adults = Math.max(3, party.adults);
      if (party.type === 'gezin') { party.adults = Math.min(Math.max(1, party.adults), 2); if (!party.kids.length) party.kids = [4]; }
      return draw();
    }
    const s = e.target.closest('[data-s]');
    if (s) { party.adults = Math.min(12, Math.max(1, party.adults + Number(s.dataset.s))); return draw(); }
    if (e.target.closest('[data-addkid]')) { if (party.kids.length < 8) party.kids.push(4); return draw(); }
    const rm = e.target.closest('[data-rmkid]');
    if (rm) { party.kids.splice(Number(rm.dataset.rmkid), 1); if (!party.kids.length) party.type = 'stel'; return draw(); }
  };
  box.onchange = (e) => { const k = e.target.closest('[data-kid]'); if (k) party.kids[Number(k.dataset.kid)] = Number(k.value); };
  draw();
}
const partyClean = (p) => ({ type: p.type, adults: p.adults, kids: p.type === 'gezin' ? p.kids.slice() : [] });
const partyCount = (p) => p.adults + (p.type === 'gezin' ? p.kids.length : 0);

// ------------------------------------------------------------------ NIEUWE REIS
function newTrip() {
  const start = addDays(iso(new Date()), 14);
  const st = { city: null, start, end: addDays(start, 2), party: { type: 'stel', adults: 2, kids: [] }, interests: ['cultuur', 'wandelen'], tempo: 'normaal', plan: true };
  view.innerHTML = `
  ${header('Nieuwe reis', { back: S.activeTrip() ? '#/' : '#/' })}
  <form class="form" id="nf" autocomplete="off">
    <section class="fsec">
      <label class="flabel" for="q">Waar ga je naartoe?</label>
      <div class="search">${icon('search')}<input id="q" type="search" placeholder="Zoek een stad…" enterkeyhint="search"></div>
      <div id="sugg" class="sugg"></div>
      <div id="picked"></div>
    </section>
    <section class="fsec">
      <span class="flabel">Wanneer?</span>
      <div class="dates">
        <label>Aankomst<input type="date" id="d1" value="${st.start}" required></label>
        <label>Vertrek<input type="date" id="d2" value="${st.end}" required></label>
      </div>
      <div class="chips" id="quick">
        <button type="button" class="chip" data-n="2">Weekend</button>
        <button type="button" class="chip" data-n="3">3 dagen</button>
        <button type="button" class="chip" data-n="5">5 dagen</button>
        <button type="button" class="chip" data-n="7">Week</button>
      </div>
      <p class="hint" id="dlen"></p>
    </section>
    <section class="fsec">
      <span class="flabel">Wie gaan er mee?</span>
      <div class="party" id="partybox"></div>
    </section>
    <section class="fsec">
      <span class="flabel">Waar houden jullie van?</span>
      <div class="chips" id="ints">
        ${[['cultuur', 'Cultuur & musea'], ['wandelen', 'Wandelen & grachten'], ['natuur', 'Natuur & parken']].map(([k, l]) => `<button type="button" class="chip${st.interests.includes(k) ? ' on' : ''}" data-i="${k}">${l}</button>`).join('')}
      </div>
      <span class="flabel">Tempo</span>
      <div class="seg" id="tempo">
        ${[['rustig', 'Rustig'], ['normaal', 'Normaal'], ['actief', 'Actief']].map(([k, l]) => `<button type="button" class="${st.tempo === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}
      </div>
      <label class="check"><input type="checkbox" id="free"> Liefst gratis uitjes</label>
    </section>
    <label class="check"><input type="checkbox" id="autoplan" checked> Maak meteen een slimme planning</label>
    <button class="btn big" type="submit" id="go" disabled>Maak mijn reis ${icon('right')}</button>
  </form>`;

  const sugg = $('#sugg'), q = $('#q'), picked = $('#picked');
  const showFeatured = () => {
    sugg.innerHTML = `<p class="hint">Populair</p>` + FEATURED.map((c, i) => `<button type="button" class="city" data-f="${i}">${c.photo ? `<img src="${esc(wm(c.photo, 250))}" alt="">` : `<span class="city-ph">${esc(c.name[0])}</span>`}<span><b>${esc(c.name)}</b><small>${esc(c.sub)}</small></span>${c.guide ? '<em>Gids</em>' : ''}</button>`).join('');
  };
  const pick = (c) => {
    st.city = c;
    picked.innerHTML = `<div class="picked">${icon('pin')}<div><b>${esc(c.name)}</b><small>${esc([c.region, c.country].filter(Boolean).join(', '))}</small></div><button type="button" class="iconbtn" id="unpick" aria-label="Andere stad">${icon('x')}</button></div>`;
    sugg.innerHTML = ''; q.value = ''; q.parentElement.hidden = true;
    $('#unpick').onclick = () => { st.city = null; picked.innerHTML = ''; q.parentElement.hidden = false; showFeatured(); check(); };
    check();
  };
  showFeatured();
  sugg.addEventListener('click', (e) => {
    const b = e.target.closest('.city');
    if (!b) return;
    if (b.dataset.f) pick(FEATURED[b.dataset.f]);
    else pick(JSON.parse(b.dataset.c));
  });
  let timer;
  q.addEventListener('input', () => {
    clearTimeout(timer);
    if (q.value.trim().length < 2) return showFeatured();
    timer = setTimeout(async () => {
      try {
        const res = await searchCity(q.value);
        sugg.innerHTML = res.length ? res.map((c) => `<button type="button" class="city" data-c='${esc(JSON.stringify(c))}'><span class="city-ph">${icon('pin')}</span><span><b>${esc(c.name)}</b><small>${esc([c.region, c.country].filter(Boolean).join(', '))}</small></span>${guideFor(c) ? '<em>Gids</em>' : ''}</button>`).join('') : '<p class="hint">Geen plaatsen gevonden.</p>';
      } catch { sugg.innerHTML = '<p class="hint">Zoeken lukt nu niet. Controleer je internetverbinding.</p>'; }
    }, 250);
  });

  const d1 = $('#d1'), d2 = $('#d2');
  const check = () => {
    if (d2.value < d1.value) d2.value = d1.value;
    const n = daysBetween(d1.value, d2.value) + 1;
    $('#dlen').textContent = `${n} ${n === 1 ? 'dag' : 'dagen'} · ${fmt.dayCap(d1.value)} ${fmt.short(d1.value)} t/m ${fmt.day(d2.value)} ${fmt.short(d2.value)}`;
    $('#go').disabled = !st.city || n > 21;
    if (n > 21) $('#dlen').textContent += ' · maximaal 21 dagen';
  };
  d1.onchange = () => { if (d2.value < d1.value) d2.value = addDays(d1.value, 2); check(); };
  d2.onchange = check;
  $('#quick').onclick = (e) => { const b = e.target.closest('[data-n]'); if (!b) return; d2.value = addDays(d1.value, b.dataset.n - 1); check(); };
  partyEditor($('#partybox'), st.party);
  $('#ints').onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b) return; b.classList.toggle('on'); st.interests = $$('#ints .on').map((x) => x.dataset.i); };
  $('#tempo').onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; $$('#tempo button').forEach((x) => x.classList.toggle('on', x === b)); st.tempo = b.dataset.t; };
  check();

  $('#nf').onsubmit = async (e) => {
    e.preventDefault();
    if (!st.city) return;
    $('#go').disabled = true;
    $('#go').innerHTML = 'Even geduld…';
    const c = st.city;
    const trip = S.createTrip({
      city: { name: c.name, country: c.country, region: c.region, lat: c.lat, lon: c.lon, guide: c.guide || guideFor(c)?.id || null },
      start: d1.value, end: d2.value, persons: partyCount(st.party), party: partyClean(st.party), prefs: { interests: st.interests, tempo: st.tempo, free: $('#free').checked },
    });
    if ($('#autoplan').checked) await buildPlan(trip).catch(() => {});
    location.hash = `#/r/${trip.id}`;
  };
}

async function buildPlan(trip) {
  const [sights, food, weather] = await Promise.all([
    sightsForTrip(trip),
    placesForTrip(trip, 'food').catch(() => []),
    weatherFor(trip),
  ]);
  const plan = makePlan(trip, sights, food, weather);
  S.updateTrip(trip.id, { plan });
  return plan;
}

// ------------------------------------------------------------------ REIZEN
function trips() {
  const st = S.getState();
  view.innerHTML = `${header('Mijn reizen', { back: '#/', action: `<a class="iconbtn" href="#/nieuw" aria-label="Nieuwe reis">${icon('plus')}</a>` })}
  <div class="trips">
    ${st.trips.map((t) => {
      const g = guideFor(t.city); const img = g?.hero?.[0] || t.city.photo;
      return `<div class="tripwrap"><a class="tripcard${t.id === st.activeTripId ? ' cur' : ''}" href="#/r/${t.id}" style="${img ? `--img:url('${esc(wm(img, 960))}')` : ''}">
        <div><h3>${esc(t.city.name)}</h3><p>${fmt.range(t.start, t.end)} · ${t.persons} pers.</p></div>${icon('right')}</a>
        <button class="iconbtn glass tripdel" data-del="${t.id}" aria-label="Reis naar ${esc(t.city.name)} verwijderen">${icon('trash')}</button></div>`;
    }).join('') || '<div class="empty">Nog geen reizen.</div>'}
    <a class="btn big" href="#/nieuw">${icon('plus')} Nieuwe reis</a>
    <button class="btn ghost" id="imp">${icon('upload')} Reis importeren</button>
  </div>`;
  $('#imp').onclick = importFlow;
  $('.trips').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    e.preventDefault();
    const t = S.getTrip(b.dataset.del);
    if (!t || !confirm(`De reis naar ${t.city.name} (${fmt.range(t.start, t.end)}) met alle notities en foto's verwijderen?`)) return;
    await S.deleteTrip(t.id);
    toast(`Reis naar ${t.city.name} verwijderd`);
    trips();
    updateNav('/reizen');
  });
}

function more() {
  const t = S.activeTrip();
  view.innerHTML = `${header('Meer', { back: '#/' })}
  <div class="menu">
    ${t ? `
    <a href="#/r/${t.id}">${icon('info')}<span>Over ${esc(t.city.name)}</span>${icon('right')}</a>
    <a href="#/r/${t.id}/kaart">${icon('map')}<span>Kaart</span>${icon('right')}</a>
    <a href="#/r/${t.id}/weer">${icon('cloudsun')}<span>Weer</span>${icon('right')}</a>
    <a href="#/r/${t.id}/notities">${icon('note')}<span>Notities & to-do</span>${icon('right')}</a>
    <a href="#/r/${t.id}/instellingen">${icon('settings')}<span>Reis aanpassen / exporteren</span>${icon('right')}</a>` : ''}
    <a href="#/reizen">${icon('suitcase')}<span>Mijn reizen</span>${icon('right')}</a>
    <a href="#/nieuw">${icon('plus')}<span>Nieuwe reis</span>${icon('right')}</a>
  </div>
  <p class="credits">Gegevens: Wikipedia &amp; Wikimedia Commons (foto's), OpenStreetMap (kaart, hotels, restaurants), Open-Meteo (weer). Openingstijden en datums kunnen wijzigen; controleer ze altijd even.</p>`;
}

// ------------------------------------------------------------------ OVERZICHT (de gids)
async function overview(id) {
  const trip = S.getTrip(id);
  const g = guideFor(trip.city);
  const nDays = tripDates(trip).length;
  const hero = g?.hero || (trip.city.photo ? [trip.city.photo] : []);
  view.innerHTML = `
  <section class="guide">
    ${header(trip.city.name, { back: '#/', action: `<a class="iconbtn" href="#/r/${id}/instellingen" aria-label="Reis aanpassen">${icon('edit')}</a>` })}
    <nav class="tabs"><a class="on" href="#/r/${id}">Overzicht</a><a href="#/r/${id}/zien">Bezienswaardigheden</a><a href="#/r/${id}/hotels">Hotels</a><a href="#/r/${id}/eten">Restaurants</a></nav>
    <div class="gallery" id="ov-gal">${hero.length ? hero.map((h) => `<img src="${esc(wm(h, 1280))}" alt="">`).join('') : '<div class="ph ph-sight big">' + icon('landmark') + '</div>'}</div>
    <div class="guide-body">
      <h2 class="serif xl">${esc(trip.city.name)}</h2>
      <p class="tagline" id="ov-tag">${esc(g?.tagline || trip.city.region || '')}</p>
      <div class="stats">
        <div>${icon('calendar')}<b>${nDays} ${nDays === 1 ? 'dag' : 'dagen'}</b><small>${fmt.range(trip.start, trip.end)}</small></div>
        <div>${icon(familyOf(trip) ? 'baby' : 'users')}<b>${esc(partyLabel(trip))}</b><small>${familyOf(trip) ? esc(familyOf(trip).label) : (trip.prefs?.tempo || 'normaal') + ' tempo'}</small></div>
        <div id="ov-wx">${icon('cloudsun')}<b>…</b><small>weer</small></div>
      </div>
      <p class="intro" id="ov-intro">${esc(g?.intro || '')}</p>
      ${g?.facts ? `<div class="facts">${g.facts.map((f) => `<div><b>${f.value}</b><small>${f.label}</small></div>`).join('')}</div>` : ''}
      <a class="btn big" href="#/r/${id}/planning">${trip.plan ? 'Bekijk reisplanning' : 'Maak reisplanning'} ${icon('right')}</a>
      <section class="block" id="ov-adv"></section>
${familyOf(trip) && g?.familyTips ? `<section class="block"><div class="block-h"><h2>Met kinderen in ${esc(trip.city.name)}</h2></div><div class="tips">${g.familyTips.map((t) => `<div class="tip fam">${icon('baby')}<div><b>${esc(t.title)}</b><p>${esc(t.text)}</p></div></div>`).join('')}</div></section>` : ''}
      ${g?.tips ? `<section class="block"><div class="block-h"><h2>Insider tips</h2></div><div class="tips">${g.tips.map((t) => `<div class="tip">${icon('lightbulb')}<div><b>${esc(t.title)}</b><p>${esc(t.text)}</p></div></div>`).join('')}</div></section>` : ''}
      <section class="block">
        <div class="block-h"><h2>Op de kaart</h2><a href="#/r/${id}/kaart">Grote kaart ${icon('right')}</a></div>
        <div class="minimap" id="ov-map"></div>
        <a class="btn ghost" target="_blank" rel="noopener" href="${gmaps.place({ name: trip.city.name }, trip.city.country)}">${icon('external')} Open in Google Maps</a>
      </section>
    </div>
  </section>`;

  if (!g) {
    wikiSummary('nl', trip.city.name).then((s) => {
      if (s.text) $('#ov-intro') && ($('#ov-intro').textContent = s.text);
      if (s.img && !trip.city.photo) { S.updateTrip(id, (t) => { t.city.photo = s.img; }); const gal = $('#ov-gal'); if (gal) gal.innerHTML = `<img src="${esc(s.img)}" alt="">`; }
    }).catch(() => {});
  }
  const map = makeMap($('#ov-map'), { lat: trip.city.lat, lon: trip.city.lon, zoom: 14, interactive: false });
  cleanup.push(() => map.remove());
  sightsForTrip(trip).then((list) => { list.filter((s) => s.km < 5 && s.cat !== 'spelen').forEach((p) => marker(map, p)); }).catch(() => {});

  const weather = await weatherFor(trip);
  const ws = weather.filter((w) => w.tmax != null);
  if (ws.length) {
    const avg = Math.round(ws.reduce((s, w) => s + w.tmax, 0) / ws.length);
    const code = ws[Math.floor(ws.length / 2)].code;
    const el = $('#ov-wx');
    if (el) el.innerHTML = `${icon(weatherInfo(code).icon)}<b>${avg}°C</b><small>${ws[0].source === 'klimaat' ? 'gemiddeld' : weatherInfo(code).label}</small>`;
  }
  const adv = adviceFor(trip, weather);
  const el = $('#ov-adv');
  if (el && adv.length) el.innerHTML = `<div class="block-h"><h2>Advies voor jullie data</h2></div><div class="advice">${adv.map(adviceItem).join('')}</div>`;
}

// ------------------------------------------------------------------ LIJSTEN
const LISTS = {
  sight: { title: 'Bezienswaardigheden', path: 'zien', filters: [['top', 'Aanbevolen'], ['gratis', 'Gratis'], ['museum', 'Musea'], ['uitjes', 'Uitjes'], ['film', 'Film & theater'], ['historisch', 'Historisch'], ['natuur', 'Natuur'], ['wandelen', 'Wandelen'], ['binnen', 'Bij regen'], ['dagtrip', 'Dagtrips']] },
  hotel: { title: 'Hotels', path: 'hotels', filters: [['all', 'Alles'], ['centrum', 'Dichtbij centrum'], ['boutique', 'Boutique'], ['station', 'Bij station']] },
  food: { title: 'Restaurants', path: 'eten', filters: [['all', 'Alles'], ['lunch', 'Lunch'], ['diner', 'Diner'], ['dichtbij', 'Dichtbij']] },
};

async function listPage(id, kind) {
  const trip = S.getTrip(id);
  const L = LISTS[kind];
  const fam = familyOf(trip);
  const filters = L.filters.slice();
  if (fam && kind === 'sight') filters.splice(1, 0, ['kids', 'Met kinderen'], ['spelen', 'Spelen']);
  if (kind === 'food') filters.splice(1, 0, ['kids', 'Kindvriendelijk']);
  let filter = filters[0][0];
  let cuisine = '';
  view.innerHTML = `
  ${header(L.title, { back: `#/r/${id}`, action: `<button class="iconbtn" id="addplace" aria-label="Zelf een plek toevoegen">${icon('plus')}</button><a class="iconbtn" href="#/r/${id}/kaart?${kind}" aria-label="Op de kaart">${icon('map')}</a>`, sub: esc(trip.city.name) })}
  <div class="chips scroll" id="flt">${filters.map(([k, l], i) => `<button class="chip${i === 0 ? ' on' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
  <div class="chips scroll" id="cuis" hidden></div>
  <div class="list" id="list">${skeleton(5)}</div>
  ${kind !== 'sight' ? `<p class="credits">${guideFor(trip.city) ? 'Selectie van Travelly. ' : 'Uit OpenStreetMap. '}Foto's, prijzen en reviews vind je via ${icon('external')} Google Maps op de detailpagina.</p>` : ''}`;

  $('#addplace').onclick = () => addPlace(trip, kind);
  let all;
  try {
    all = kind === 'sight' ? await sightsForTrip(trip) : await placesForTrip(trip, kind);
    if (!all.length) throw new Error('leeg');
  } catch {
    $('#list').innerHTML = `<div class="empty">${icon('cloud')}<p>${kind === 'sight' ? 'Bezienswaardigheden' : kind === 'hotel' ? 'Hotels' : 'Restaurants'} konden niet geladen worden. Probeer het straks opnieuw, of voeg zelf een plek toe.</p><button class="btn" onclick="document.getElementById('addplace').click()">${icon('plus')} Plek toevoegen</button></div>`;
    return;
  }
  if (kind === 'food') {
    const cs = [...new Set(all.map((r) => r.cuisine).filter(Boolean))].sort();
    if (cs.length > 2) {
      const el = $('#cuis');
      el.hidden = false;
      el.innerHTML = `<button class="chip small on" data-c="">Alle keukens</button>` + cs.map((c) => `<button class="chip small" data-c="${esc(c)}">${esc(c)}</button>`).join('');
      el.onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; $$('#cuis .chip').forEach((x) => x.classList.toggle('on', x === b)); cuisine = b.dataset.c; draw(); };
    }
  }
  const draw = () => {
    let l = all.slice();
    if (kind === 'sight') {
      const fs = (s) => { const f = kidFit(s, fam); return f ? (f.level === 'top' ? 3 : f.level === 'deels' ? 1 : -4) : 0; };
      if (filter === 'top') l = l.filter((s) => s.custom || (s.cat !== 'dagtrip' && s.cat !== 'spelen' && s.cat !== 'film')).sort((a, b) => (!!b.custom - !!a.custom) || (b.prio + fs(b)) - (a.prio + fs(a)) || (a.rank ?? 0) - (b.rank ?? 0) || a.km - b.km);
      else if (filter === 'kids') l = l.filter((s) => s.cat !== 'dagtrip' && kidFit(s, fam)?.level !== 'nee').sort((a, b) => fs(b) - fs(a) || b.prio - a.prio);
      else if (filter === 'binnen') l = l.filter((s) => s.indoor && s.cat !== 'spelen');
      else if (filter === 'uitjes') l = l.filter((s) => ['dieren', 'uitje', 'spelen'].includes(s.cat)).sort((a, b) => b.prio - a.prio || a.km - b.km);
      else if (filter === 'gratis') l = l.filter((s) => s.fee === 'gratis' || s.fee === 'buiten').sort((a, b) => b.prio - a.prio || a.km - b.km);
      else l = l.filter((s) => s.cat === filter);
      // plekken verder weg apart, onder 'In de omgeving'
      if (filter !== 'dagtrip') {
        const near = l.filter((s) => !(s.km > 2)), far = l.filter((s) => s.km > 2).sort((a, b) => a.km - b.km);
        if (far.length && near.length) {
          $('#list').innerHTML = near.map((p) => placeCard(trip, p)).join('') +
            `<h2 class="list-h">${icon('route')} In de omgeving <small>verder dan 2 km van het centrum</small></h2>` + far.map((p) => placeCard(trip, p)).join('');
          return;
        }
      }
    } else if (kind === 'hotel') {
      if (filter === 'centrum') l = l.filter((h) => h.km < 0.8).sort((a, b) => a.km - b.km);
      if (filter === 'boutique') l = l.filter((h) => /boutique|suites|design|klein/i.test(h.style + h.name));
      if (filter === 'station') l = l.filter((h) => /station/i.test(h.style + h.text) || h.km > 0.6 && h.lat > trip.city.lat + 0.004);
    } else {
      if (filter === 'kids') l = l.filter((r) => r.kids);
      if (filter === 'lunch') l = l.filter((r) => r.meal !== 'diner');
      if (filter === 'diner') l = l.filter((r) => r.meal !== 'lunch');
      if (filter === 'dichtbij') l = l.sort((a, b) => a.km - b.km);
      if (cuisine) l = l.filter((r) => r.cuisine === cuisine);
    }
    $('#list').innerHTML = l.length ? l.map((p) => placeCard(trip, p)).join('') : '<div class="empty">Niets gevonden met dit filter.</div>';
  };
  $('#flt').onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; $$('#flt .chip').forEach((x) => x.classList.toggle('on', x === b)); filter = b.dataset.k; draw(); };
  draw();
  // Andere steden: gevelfoto's op de achtergrond erbij zoeken en de lijst daarna bijwerken.
  if (kind !== 'sight' && !guideFor(trip.city)) {
    const here = location.hash;
    facadePhotos(trip.city, all).then((n) => { if (n && location.hash === here) draw(); }).catch(() => {});
  }
}

// ------------------------------------------------------------------ ZELF EEN PLEK TOEVOEGEN
const ADD_TYPES = {
  sight: [['museum', 'Museum'], ['uitje', 'Uitje (bowling, zwembad, speeltuin…)'], ['dieren', 'Dieren'], ['historisch', 'Historisch'], ['natuur', 'Natuur & parken'], ['film', 'Film & theater'], ['wandelen', 'Wandelen']],
  food: [['Restaurant', 'Restaurant'], ['Grand café', 'Grand café / brasserie'], ['Café / lunch', 'Café / lunch'], ['Chinees', 'Chinees / Aziatisch'], ['Italiaans', 'Italiaans / pizza'], ['Hollands', 'Hollands'], ['Pannenkoeken', 'Pannenkoeken']],
  hotel: [['Hotel', 'Hotel'], ['B&B / pension', 'B&B / pension'], ['Vakantiehuis', 'Vakantiehuis']],
};

function addPlace(trip, kind) {
  const types = ADD_TYPES[kind];
  sheet(`
    <h2 class="sheet-t">Zelf een plek toevoegen</h2>
    <p class="hint">${icon('info')} Mis je iets? Zoek het op naam of adres in ${esc(trip.city.name)}. Het komt in je lijst, op de kaart en in de planning.</p>
    <form class="form tight" id="apf">
      <label>Naam of adres<div class="search">${icon('search')}<input id="apq" placeholder="Bijv. Bowling Franeker" required></div></label>
      <div id="apres" class="sugg"></div>
      <label>Naam<input id="apname" placeholder="Bijv. Kaatsmuseum" required></label>
      <label>Soort<select id="apt">${types.map(([k, l]) => `<option value="${esc(k)}">${l}</option>`).join('')}</select></label>
      <label>Notitie (optioneel)<input id="apn" placeholder="Bijv. tip van een vriend"></label>
      <button class="btn" type="submit" id="apgo" disabled>${icon('plus')} Toevoegen</button>
    </form>`, {
    onMount(el, close) {
      let chosen = null, timer;
      const res = $('#apres', el), q = $('#apq', el);
      const search = async () => {
        const v = q.value.trim();
        if (v.length < 3) { res.innerHTML = ''; return; }
        res.innerHTML = '<p class="hint">Zoeken…</p>';
        const { lat, lon } = trip.city, d = 0.15, dl = d / Math.cos(lat * Math.PI / 180);
        try {
          const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=1&viewbox=${lon - dl},${lat + d},${lon + dl},${lat - d}&bounded=1&q=${encodeURIComponent(v)}`)).json();
          res.innerHTML = r.length ? r.map((x, i) => `<button type="button" class="city" data-i="${i}"><span class="city-ph">${icon('pin')}</span><span><b>${esc(x.name || v)}</b><small>${esc([x.address?.road, x.address?.house_number, x.address?.town || x.address?.city || x.address?.village].filter(Boolean).join(' '))}</small></span></button>`).join('')
            : `<p class="hint">Niet gevonden in ${esc(trip.city.name)}. Probeer het adres (straat en huisnummer).</p>`;
          res.onclick = (e) => {
            const b = e.target.closest('[data-i]'); if (!b) return;
            const x = r[b.dataset.i];
            chosen = { name: x.name || v, lat: Number(x.lat), lon: Number(x.lon), address: [x.address?.road, x.address?.house_number].filter(Boolean).join(' ') };
            $$('.city', res).forEach((c) => c.classList.toggle('on', c === b));
            if (!$('#apname', el).value.trim()) $('#apname', el).value = x.name || v;
            $('#apgo', el).disabled = false;
          };
        } catch { res.innerHTML = '<p class="hint">Zoeken lukt nu niet. Controleer je internetverbinding.</p>'; }
      };
      q.addEventListener('input', () => { clearTimeout(timer); chosen = null; $('#apgo', el).disabled = true; timer = setTimeout(search, 500); });
      $('#apf', el).onsubmit = (e) => {
        e.preventDefault();
        if (!chosen) return;
        const type = $('#apt', el).value;
        const place = {
          id: S.uid('c'), kind, ...chosen, name: $('#apname', el).value.trim() || chosen.name, custom: true, note: $('#apn', el).value.trim(), text: $('#apn', el).value.trim(),
          ...(kind === 'sight' ? { cat: type, short: types.find((t) => t[0] === type)[1].replace(/ \(.*\)$/, ''), indoor: ['museum', 'film', 'uitje'].includes(type), dur: type === 'museum' ? 90 : type === 'uitje' ? 120 : 45, prio: 4, fee: null }
            : kind === 'food' ? { cuisine: type, meal: /café|lunch|pannenkoek/i.test(type) ? 'beide' : 'diner', allround: /café|brasserie|pannenkoek/i.test(type) }
            : { style: type }),
        };
        S.updateTrip(trip.id, (t) => { (t.custom ||= []).push(place); });
        close();
        toast(`${place.name} toegevoegd`);
        router();
      };
      setTimeout(() => q.focus(), 300);
    },
  });
}

// ------------------------------------------------------------------ DETAIL
async function detail(id, pid) {
  const trip = S.getTrip(id);
  view.innerHTML = `${header('', { back: `#/r/${id}` })}<div class="list">${skeleton(1)}</div>`;
  const own = (trip.custom || []).find((c) => c.id === pid);
  const p = (own && [...customFor(trip, own.kind)].find((c) => c.id === pid)) || await findPlace(trip.city, pid) || trip.favorites?.[pid];
  if (!p) { view.innerHTML = header('Niet gevonden', { back: `#/r/${id}` }) + errorBox('Deze plek kon niet geladen worden.'); return; }
  const back = p.kind === 'sight' ? 'zien' : p.kind === 'hotel' ? 'hotels' : 'eten';
  const photos = p.photos?.length ? p.photos : p.photo ? [p.photo] : [];
  const chips = [];
  if (p.kind === 'sight') {
    if (p.dur) chips.push(`${icon('clock')} ${p.dur >= 120 ? String(Math.round(p.dur / 30) / 2).replace('.', ',') + ' uur' : p.dur + ' min'}`);
    chips.push(`${icon(p.indoor ? 'museum' : 'sun')} ${p.indoor ? 'Binnen' : 'Buiten'}`);
    if (FEE[p.fee]) chips.push(`<b class="fee-chip ${FEE[p.fee][1]}">${icon('ticket')} ${FEE[p.fee][0]}${p.fee === 'buiten' ? ' (binnen kan entree gelden)' : p.fee === 'entree' ? ' (prijs: zie website)' : ''}</b>`);
  }
  if (p.kind === 'food' && p.cuisine) chips.push(`${icon('food')} ${esc(p.cuisine)}`);
  if (p.kind === 'food' && p.meal) chips.push(`${icon('clock')} ${p.meal === 'lunch' ? 'Lunch' : p.meal === 'diner' ? 'Diner' : 'Lunch & diner'}${p.allround ? ' · all-round' : ''}`);
  if (p.kind === 'food' && p.hours) chips.push(`${icon('calendar')} ${esc(p.hours.replace(/Mo/g, 'ma').replace(/Tu/g, 'di').replace(/We/g, 'wo').replace(/Th/g, 'do').replace(/Fr/g, 'vr').replace(/Sa/g, 'za').replace(/Su/g, 'zo').replace(/off/g, 'dicht'))}`);
  if (p.kind === 'hotel' && p.stars) chips.push(`${icon('star')} ${p.stars} sterren`);
  if (p.kind === 'hotel' && p.style) chips.push(`${icon('bed')} ${esc(p.style)}`);
  if (p.km != null) chips.push(`${icon(p.km > 2 ? 'route' : 'walk')} ${p.km > 2 ? 'In de omgeving, ' : ''}${distLabel(p.km)} van het centrum`);

  const days = trip.plan?.days || tripDates(trip).map((date) => ({ date }));
  view.innerHTML = `
  <article class="detail">
    <div class="detail-media">
      ${photos.length ? `<div class="gallery" id="gal">${photos.map((u) => `<img src="${esc(wm(u, 1280))}" alt="${esc(p.name)}">`).join('')}</div>
        ${photos.length > 1 ? `<div class="dots">${photos.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}`
        : `<div class="minimap hero-map" id="dmap"></div>`}
      <div class="detail-top">
        <a class="iconbtn glass" href="#/r/${id}/${back}" aria-label="Terug">${icon('left')}</a>
        ${favBtn(trip, p, 'glass')}
      </div>
    </div>
    <div class="detail-body">
      <p class="kicker">${esc(p.sub || '')}</p>
      <h1 class="serif xl">${esc(p.name)}</h1>
      ${p.address ? `<p class="addr">${icon('pin')} ${esc(p.address)}${p.address.includes(trip.city.name) || p.address.includes(',') ? '' : ', ' + esc(trip.city.name)}</p>` : ''}
      <div class="dchips">${chips.map((c) => `<span>${c}</span>`).join('')}</div>
      <div class="actions">
        <a class="btn" target="_blank" rel="noopener" href="${gmaps.place(p, trip.city.name)}">${icon('external')} Open in Google Maps</a>
        <a class="btn ghost" target="_blank" rel="noopener" href="${gmaps.route(p, trip.city.name)}">${icon('nav')} Route</a>
        ${p.website ? `<a class="btn ghost" target="_blank" rel="noopener" href="${esc(p.website)}">${icon('globe')} Website</a>` : ''}
      ${p.wiki ? `<a class="btn ghost" target="_blank" rel="noopener" href="https://${p.wiki[0]}.wikipedia.org/wiki/${enc(p.wiki[1].replace(/ /g, '_'))}">${icon('book')} Meer lezen</a>` : ''}
      ${p.kind !== 'sight' ? `<a class="btn ghost" target="_blank" rel="noopener" href="${gmaps.streetview(p)}">${icon('camera')} Gevel in Street View</a>` : ''}
      </div>
      <p class="text" id="dtext">${esc(p.text || p.short || '')}</p>
      ${p.tip ? `<div class="tip hl">${icon('lightbulb')}<div><b>Insider tip</b><p>${esc(p.tip)}</p></div></div>` : ''}
      ${p.todo?.length ? `<section class="dotodo"><h2 class="sec-t">Wat kun je hier doen</h2><ul>${p.todo.map((t) => `<li>${icon('done')}<span>${esc(t)}</span></li>`).join('')}</ul></section>` : ''}
      ${famBlock(trip, p)}
      ${p.closedNote || p.closed ? `<div class="note-line">${icon('info')} ${esc(p.closedNote || '')}${p.closed?.includes(1) ? ' Op maandag gesloten.' : ''} Controleer de actuele openingstijden${p.website ? ' op de website' : ''}.</div>` : ''}
      ${p.custom ? `<div class="note-line">${icon('user')} Zelf toegevoegd aan deze reis. <button class="linkbtn danger" id="delcustom">Verwijder deze plek</button></div>`
        : `<div class="note-line">${icon('info')} Klopt dit niet meer (gesloten of gesloopt)? <button class="linkbtn danger" id="hideplace">Verberg deze plek</button></div>`}
      ${menuBlock(p)}
      ${p.kind !== 'sight' ? `<div class="note-line">${icon('star')} Meer foto's en reviews: bekijk ze in Google Maps.</div>` : ''}
      <div class="addplan">
        <label for="pday">${icon('calendar')} Zet in mijn planning</label>
        <div class="row">
          <select id="pday">${days.map((d, i) => `<option value="${d.date}">Dag ${i + 1} · ${fmt.dayCap(d.date)} ${fmt.short(d.date)}</option>`).join('')}</select>
          <input type="time" id="ptime" value="${p.kind === 'food' ? (p.meal === 'lunch' ? '12:30' : '19:00') : '14:00'}">
          <button class="btn" id="padd">${icon('plus')} Toevoegen</button>
        </div>
      </div>
      ${photos.length ? `<div class="minimap" id="dmap"></div>` : ''}
      ${p.photoCredit ? `<p class="credits">Gevelfoto: Wikimedia Commons, “${esc(p.photoCredit)}” · <a target="_blank" rel="noopener" href="https://commons.wikimedia.org/wiki/File:${enc(p.photoCredit.replace(/ /g, '_'))}">maker en licentie ${icon('external')}</a></p>` : ''}
      ${p.wiki ? `<p class="credits">Foto's: Wikimedia Commons · <a target="_blank" rel="noopener" href="https://${p.wiki[0]}.wikipedia.org/wiki/${enc(p.wiki[1].replace(/ /g, '_'))}">Meer op Wikipedia ${icon('external')}</a></p>` : ''}
    </div>
  </article>`;

  $('#hideplace')?.addEventListener('click', () => {
    if (!confirm(`${p.name} verbergen? Hij verdwijnt uit de lijsten, de kaart en de planning van deze reis.`)) return;
    S.updateTrip(id, (t) => {
      (t.hidden ||= {})[pid] = p.name;
      if (t.favorites) delete t.favorites[pid];
      for (const d of t.plan?.days || []) d.items = d.items.filter((i) => i.refId !== pid);
    });
    toast(`${p.name} verborgen`);
    location.hash = `#/r/${id}/${back}`;
  });
  $('#delcustom')?.addEventListener('click', () => {
    if (!confirm(`${p.name} uit deze reis verwijderen?`)) return;
    S.updateTrip(id, (t) => {
      t.custom = (t.custom || []).filter((c) => c.id !== pid);
      if (t.favorites) delete t.favorites[pid];
    });
    toast(`${p.name} verwijderd`);
    location.hash = `#/r/${id}/${back}`;
  });
  const gal = $('#gal');
  if (gal) gal.addEventListener('scroll', () => {
    const i = Math.round(gal.scrollLeft / gal.clientWidth);
    $$('.dots i').forEach((d, k) => d.classList.toggle('on', k === i));
  }, { passive: true });
  const map = makeMap($('#dmap'), { lat: p.lat, lon: p.lon, zoom: 16, interactive: false });
  marker(map, p, { active: true });
  cleanup.push(() => map.remove());

  if (!p.text && p.wiki) wikiSummary(p.wiki[0], p.wiki[1]).then((s) => { const el = $('#dtext'); if (el && s.text) el.textContent = s.text; }).catch(() => {});

  $('#padd').onclick = () => {
    const date = $('#pday').value, time = $('#ptime').value || '14:00';
    S.updateTrip(id, (t) => {
      if (!t.plan) t.plan = { generatedAt: null, days: tripDates(t).map((d) => ({ date: d, items: [] })) };
      const day = t.plan.days.find((d) => d.date === date);
      day.items.push({ id: S.uid('i'), time, kind: p.kind, refId: p.id, title: p.kind === 'food' ? `${time < '16:00' ? 'Lunch' : 'Diner'} bij ${p.name}` : p.name, lat: p.lat, lon: p.lon, sub: p.sub });
      sortItems(day);
    });
    toast(`Toegevoegd aan ${fmt.day(date)} ${fmt.short(date)}`);
  };
}

function menuBlock(p) {
  if (p.kind !== 'food') return '';
  const m = p.menu;
  const link = m?.url || p.menuUrl || p.website;
  if (!m) return link ? `<section class="menublock"><h2 class="sec-t">${icon('food')} Op de kaart</h2><p class="muted">We hebben de menukaart van dit restaurant niet kunnen lezen.</p><a class="btn ghost" target="_blank" rel="noopener" href="${esc(link)}">${icon('external')} Bekijk de menukaart op hun website</a></section>` : '';
  return `<section class="menublock">
    <h2 class="sec-t">${icon('food')} Op de kaart</h2>
    ${m.dishes?.length ? `<ul class="dishes">${m.dishes.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
    ${m.note ? `<p>${esc(m.note)}</p>` : ''}
    <div class="famchips">
      ${m.price ? `<span>${icon('ticket')} ${esc(m.price)}</span>` : ''}
      ${m.veg ? `<span class="ok">${icon('flower')} Vegetarisch op de kaart</span>` : ''}
      ${m.kids ? `<span class="ok">${icon('smile')} ${esc(m.kids)}</span>` : ''}
      ${m.hours ? `<span>${icon('clock')} ${esc(m.hours)}</span>` : ''}
    </div>
    <a class="btn ghost" target="_blank" rel="noopener" href="${esc(link)}">${icon('external')} Hele menukaart</a>
    <p class="muted small">Overgenomen van hun website (${esc(m.checked || '')}). Gerechten en prijzen kunnen veranderen.</p>
  </section>`;
}

function famBlock(trip, p) {
  const fam = familyOf(trip);
  const f = kidFit(p, fam);
  if (!f) return '';
  const buggy = { ja: 'Buggy: prima', deels: 'Buggy: gaat, soms lastig', nee: 'Buggy: liever niet (trappen)' }[f.buggy] || 'Buggy: vraag bij de ingang';
  return `<section class="famblock ${f.level}">
    <h2 class="sec-t">${icon('baby')} Met ${fam.kids.length ? `jullie kinderen <small>(${esc(fam.label)})</small>` : 'kinderen'}</h2>
    <div class="famchips">
      ${fam.kids.map((a) => `<span class="${a >= f.min ? 'ok' : 'no'}">${icon(a >= f.min ? 'check' : 'x')} ${a === 0 ? 'baby' : a + ' jaar'}</span>`).join('')}
      <span>${icon('walk')} ${buggy}</span>
      ${f.min > 0 ? `<span>${icon('info')} Vanaf ${f.min} jaar</span>` : `<span>${icon('smile')} Alle leeftijden</span>`}
    </div>
    ${f.text ? `<p>${esc(f.text)}</p>` : ''}
    ${f.level === 'deels' ? `<p class="muted">Voor de jongste is het vooral kijken: houd het bezoek kort.</p>` : ''}
    ${f.level === 'nee' ? `<p class="muted">Misschien iets voor als ze wat ouder zijn, of als één van jullie even alleen gaat.</p>` : ''}
  </section>`;
}

// ------------------------------------------------------------------ KAART
async function mapPage(id) {
  const trip = S.getTrip(id);
  const pre = location.hash.split('?')[1];
  let filter = ['sight', 'hotel', 'food', 'fav'].includes(pre) ? pre : 'all';
  view.innerHTML = `
  <section class="mapview">
    <div class="map-top">
      ${header('Kaart', { back: `#/r/${id}`, action: `<a class="iconbtn" target="_blank" rel="noopener" href="${gmaps.place({ name: trip.city.name }, trip.city.country)}" aria-label="Open in Google Maps">${icon('external')}</a>` })}
      <div class="chips scroll" id="mf">
        ${[['all', 'Alles'], ['sight', 'Bezienswaardigheden'], ['hotel', 'Hotels'], ['food', 'Restaurants'], ['fav', 'Favorieten']].map(([k, l]) => `<button class="chip${k === filter ? ' on' : ''}" data-k="${k}">${l}</button>`).join('')}
      </div>
    </div>
    <div id="bigmap"></div>
    <button class="iconbtn locate" id="loc" aria-label="Mijn locatie">${icon('locate')}</button>
    <div class="mapcard" id="mc" hidden></div>
  </section>`;
  const map = makeMap($('#bigmap'), { lat: trip.city.lat, lon: trip.city.lon, zoom: 14 });
  cleanup.push(() => map.remove());
  $('#loc').onclick = () => userLocation(map);

  const data = { sight: [], hotel: [], food: [] };
  let markers = [];
  const show = (p) => {
    const mc = $('#mc');
    mc.hidden = false;
    mc.innerHTML = `<a class="mc-img" href="#/r/${id}/p/${enc(p.id)}">${photoOrPh(p, 330)}</a>
      <div class="mc-body"><a href="#/r/${id}/p/${enc(p.id)}"><b>${esc(p.name)}</b><small>${esc(p.sub || '')}${p.km != null ? ' · ' + distLabel(p.km) : ''}</small></a>
      <div class="row"><a class="btn small ghost" target="_blank" rel="noopener" href="${gmaps.route(p, trip.city.name)}">${icon('nav')} Route</a><a class="btn small ghost" target="_blank" rel="noopener" href="${gmaps.place(p, trip.city.name)}">${icon('external')} Maps</a>${favBtn(trip, p, 'inline')}</div></div>
      <button class="iconbtn mc-x" aria-label="Sluiten">${icon('x')}</button>`;
    mc.querySelector('.mc-x').onclick = () => { mc.hidden = true; };
  };
  const draw = (refit) => {
    markers.forEach((m) => m.remove());
    markers = [];
    let pts;
    if (filter === 'fav') pts = Object.values(trip.favorites || {}).map((f) => ({ ...f, kind: f.kind }));
    else if (filter === 'all') pts = [...data.sight.filter((s) => s.km < 6), ...data.hotel, ...data.food];
    else pts = data[filter];
    pts.forEach((p) => markers.push(marker(map, p, { kind: filter === 'fav' ? 'fav' : p.kind, onClick: show })));
    if (refit && pts.length) fit(map, filter === 'all' ? data.sight.filter((s) => s.km < 1) : pts.filter((p) => (p.km ?? 0) < 6), 20);
  };
  $('#mf').onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; $$('#mf .chip').forEach((x) => x.classList.toggle('on', x === b)); filter = b.dataset.k; $('#mc').hidden = true; draw(true); };
  draw(false);
  const load = async (k, fn) => { try { data[k] = await fn(); draw(filter === k || (filter === 'all' && k === 'sight')); } catch { /* bron niet bereikbaar */ } };
  const famMap = familyOf(trip);
  load('sight', async () => (await sightsForTrip(trip)).filter((s) => famMap || s.cat !== 'spelen'));
  load('hotel', () => placesForTrip(trip, 'hotel'));
  load('food', () => placesForTrip(trip, 'food'));
}

// ------------------------------------------------------------------ PLANNING
async function planning(id) {
  const trip = S.getTrip(id);
  const [weather, pSights, pFood] = await Promise.all([weatherFor(trip), sightsForTrip(trip).catch(() => []), placesForTrip(trip, 'food').catch(() => [])]);
  const byId = new Map([...pSights, ...pFood].map((x) => [x.id, x]));
  const placeById = (pid) => byId.get(pid);
  const W = (d) => weather.find((w) => w.date === d);
  const days = trip.plan?.days;
  view.innerHTML = `
  ${header('Reisplanning', { back: '#/', sub: `${esc(trip.city.name)} · ${fmt.range(trip.start, trip.end)}`, action: days ? `<button class="iconbtn" id="ics" aria-label="Exporteer naar agenda">${icon('download')}</button>` : '' })}
  <div class="plan-actions">
    <button class="btn ${days ? 'ghost' : ''}" id="smart">${icon('wand')} ${days ? 'Opnieuw slim plannen' : 'Maak slimme planning'}</button>
    ${days ? '' : `<button class="btn ghost" id="empty">${icon('edit')} Zelf plannen</button>`}
  </div>
  ${days ? '' : `<div class="empty big">${icon('wand')}<h2>Laat Travelly plannen</h2><p>We verdelen de mooiste plekken over jullie dagen: dicht bij elkaar, musea op regendagen, nooit naar een museum dat dicht is, met lunch en diner in de buurt. Daarna kun je alles aanpassen.</p></div>`}
  ${days ? planIntro(trip) : ''}
  <div class="days">${(days || []).map((d, i) => dayCard(trip, d, i, W(d.date), explainDay(trip, d, i, days.length, weather, placeById))).join('')}</div>`;

  $('#smart').onclick = async () => {
    if (days && !confirm('De huidige planning wordt vervangen door een nieuwe. Doorgaan?')) return;
    $('#smart').disabled = true; $('#smart').innerHTML = 'Bezig met plannen…';
    try { await buildPlan(trip); toast('Planning gemaakt'); } catch { alert('Plannen lukt nu niet. Controleer je internetverbinding.'); }
    router();
  };
  $('#empty')?.addEventListener('click', () => { S.updateTrip(id, { plan: { generatedAt: null, days: tripDates(trip).map((date) => ({ date, items: [] })) } }); router(); });
  $('#ics')?.addEventListener('click', () => exportICS(trip));

  const view$ = $('.days');
  view$.addEventListener('click', (e) => {
    const it = e.target.closest('[data-item]');
    const addB = e.target.closest('[data-add]');
    const mapB = e.target.closest('[data-map]');
    if (addB) return editItem(trip, addB.dataset.add, null);
    if (mapB) return toggleDayMap(trip, mapB.dataset.map, mapB);
    if (!it || e.target.closest('a')) return;
    // potlood, of tik op een eigen onderdeel zonder plek: aanpassen
    editItem(trip, it.dataset.day, it.dataset.item);
  });
}

function planIntro(trip) {
  const fam = familyOf(trip);
  const tempo = trip.prefs?.tempo || 'normaal';
  const ints = (trip.prefs?.interests || []).map((k) => ({ cultuur: 'cultuur & musea', wandelen: 'wandelen & grachten', natuur: 'natuur & parken' }[k])).filter(Boolean);
  return `<details class="planintro">
    <summary>${icon('wand')}<span><b>Zo is jullie planning gemaakt</b><small>Wat we hebben meegewogen</small></span>${icon('down')}</summary>
    <ul>
      <li>${icon('cloudsun')} <span><b>Het weer per dag:</b> bij regen musea en binnen, bij mooi weer parken, grachten en terrassen.</span></li>
      <li>${icon('calendar')} <span><b>Openingsdagen en seizoen:</b> geen museum op een dag dat het dicht is; seizoensplekken (zoals Keukenhof) alleen als ze open zijn.</span></li>
      <li>${icon('walk')} <span><b>Afstanden:</b> wat dicht bij elkaar ligt komt op dezelfde dag, in een logische looproute.</span></li>
      <li>${icon('heart')} <span><b>Jullie voorkeuren:</b> ${ints.length ? esc(ints.join(', ')) : 'een mix van alles'}, in een ${esc(tempo)} tempo.</span></li>
      <li>${icon(fam ? 'baby' : 'users')} <span><b>Wie er meegaat:</b> ${fam ? `kinderen van ${esc(fam.label)}: plekken die bij hun leeftijd passen, speelpauze, rustmoment en vroeg eten.` : esc(partyLabel(trip)) + '.'}</span></li>
      <li>${icon('food')} <span><b>Eten:</b> lunch en diner dicht bij waar jullie op dat moment zijn, elke keer ergens anders.</span></li>
    </ul>
    <p class="hint">${icon('edit')} Tik op een plek om hem te bekijken, of op het potlood om de tijd of omschrijving aan te passen. De uitleg per dag past zich daarop aan.</p>
  </details>`;
}

function dayCard(trip, d, i, w, ex) {
  // de dagroute is een wandelroute: de fietstocht naar de omgeving laten we eruit
  const pts = d.items.filter((x) => x.lat && !(x.kind === 'tour' && x.icon === 'route'));
  const route = gmaps.day(pts);
  let prev = null;
  return `<section class="day" id="day-${d.date}">
    <div class="day-h">
      <div><span class="daynum">Dag ${i + 1}</span><h2>${fmt.dayCap(d.date)} ${fmt.short(d.date)}</h2></div>
      ${w && w.tmax != null ? `<div class="day-wx" title="${weatherInfo(w.code).label}${w.source === 'klimaat' ? ' (gemiddeld van eerdere jaren)' : ''}">${icon(weatherInfo(w.code).icon, 'wx-' + weatherInfo(w.code).icon)}<b>${Math.round(w.tmax)}°</b>${w.pop != null ? `<small>${icon('drop')}${w.pop}%</small>` : ''}</div>` : ''}
    </div>
    ${ex ? `<details class="daysum" open>
      <summary><span><b>${esc(ex.title)}</b><small>${esc(ex.what)}</small></span>${icon('down')}</summary>
      <ul>${ex.why.map((r) => `<li>${icon(r.icon)}<span>${esc(r.text)}</span></li>`).join('')}</ul>
    </details>` : ''}
    <ol class="tl">${d.items.map((it) => {
      const walk = prev && it.lat && prev.lat ? walkMin(distKm(prev, it)) : null;
      if (it.lat) prev = it;
      const link = it.refId ? `#/r/${trip.id}/p/${enc(it.refId)}` : null;
      return `<li class="tl-i k-${it.kind}" data-item="${it.id}" data-day="${d.date}" tabindex="0">
        <time>${it.time}</time>
        <span class="dot">${icon(it.kind === 'sight' ? 'landmark' : it.kind === 'food' ? 'food' : it.kind === 'hotel' ? 'bed' : it.icon || 'pin')}</span>
        ${link ? `<a class="tl-b tl-link" href="${link}">` : '<div class="tl-b">'}
          ${walk && walk > 2 ? `<small class="walk">${icon('walk')} ${walk} min lopen</small>` : ''}
          <b>${esc(it.title)}${link ? ` ${icon('right', 'tl-arrow')}` : ''}</b>
          ${it.sub ? `<small>${esc(it.sub)}</small>` : ''}
          ${it.note ? `<p>${esc(it.note)}</p>` : ''}
          ${it.stops?.length ? `<span class="stops">${it.stops.map((s) => `<a href="#/r/${trip.id}/p/${enc(s.id)}">${esc(s.name)}${s.km > 2 ? ` <small>(${distLabel(s.km)})</small>` : ''}</a>`).join('')}</span>
            <a class="tour-link" target="_blank" rel="noopener" href="${gmaps.day(it.icon === 'route' ? [trip.city, ...it.stops, trip.city] : it.stops, it.icon === 'route' ? 'bicycling' : 'walking')}">${icon('route')} Route in Google Maps</a>` : ''}
        ${link ? '</a>' : '</div>'}
        <button class="tl-go" data-edit aria-label="${esc(it.title)} aanpassen">${icon('edit')}</button>
      </li>`;
    }).join('') || '<li class="tl-empty">Nog niets gepland.</li>'}</ol>
    <div class="day-f">
      <button class="btn small ghost" data-add="${d.date}">${icon('plus')} Toevoegen</button>
      ${pts.length ? `<button class="btn small ghost" data-map="${d.date}">${icon('map')} Kaart</button>` : ''}
      ${route ? `<a class="btn small" target="_blank" rel="noopener" href="${route}">${icon('route')} Dagroute in Google Maps</a>` : ''}
    </div>
    <div class="daymap" hidden></div>
  </section>`;
}

function toggleDayMap(trip, date, btn) {
  const sec = $(`#day-${date}`);
  const box = sec.querySelector('.daymap');
  if (!box.hidden) { box.hidden = true; box._map?.remove(); box._map = null; return; }
  box.hidden = false;
  const day = trip.plan.days.find((d) => d.date === date);
  const pts = day.items.filter((x) => x.lat);
  const map = makeMap(box, { lat: trip.city.lat, lon: trip.city.lon, zoom: 14 });
  box._map = map;
  cleanup.push(() => map.remove());
  pts.forEach((p, i) => marker(map, p, { kind: p.kind, label: String(i + 1) }));
  line(map, pts);
  fit(map, pts, 30);
}

async function editItem(trip, date, itemId) {
  const day = trip.plan.days.find((d) => d.date === date);
  const it = itemId ? day.items.find((x) => x.id === itemId) : null;
  let options = [];
  try {
    const [s, f] = await Promise.all([sightsForTrip(trip), placesForTrip(trip, 'food').catch(() => [])]);
    const favs = Object.values(trip.favorites || {});
    options = [...favs.map((x) => ({ ...x, grp: 'Favorieten' })), ...s.filter((x) => familyOf(trip) || x.cat !== 'spelen').map((x) => ({ ...x, grp: x.cat === 'spelen' ? 'Spelen' : 'Bezienswaardigheden' })), ...f.map((x) => ({ ...x, grp: 'Restaurants' }))];
  } catch { /* alleen vrije tekst */ }
  const groups = [...new Set(options.map((o) => o.grp))];
  // Wisselen: andere plek van hetzelfde soort, dichtstbijzijnde eerst (favorieten bovenaan)
  const isLunch = it && /^Lunch/.test(it.title);
  const swaps = it?.refId ? options.filter((o) => o.grp !== 'Favorieten' && o.kind === it.kind && o.id !== it.refId && (it.kind !== 'food' || (isLunch ? o.meal !== 'diner' : o.meal !== 'lunch')))
    .map((o) => ({ ...o, d: distKm(it, o), fav: !!trip.favorites?.[o.id] })).sort((a, b) => (b.fav - a.fav) || a.d - b.d).slice(0, 25) : [];
  sheet(`
    <h2 class="sheet-t">${it ? 'Onderdeel aanpassen' : `Toevoegen aan ${fmt.day(date)} ${fmt.short(date)}`}</h2>
    <form class="form tight" id="ef">
      <label>Tijd<input type="time" id="et" value="${it?.time || '14:00'}" required></label>
      ${it ? '' : `<label>Kies een plek<select id="ep"><option value="">— Eigen invulling —</option>${groups.map((g) => `<optgroup label="${g}">${options.filter((o) => o.grp === g).map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>`}
      ${swaps.length ? `<label>${it.kind === 'food' ? 'Ander restaurant' : 'Andere plek'}<select id="eswap"><option value="">— Houden: ${esc(it.title.replace(/^(Lunch|Diner|Vroeg eten) bij /, ''))} —</option>${swaps.map((o) => `<option value="${esc(o.id)}">${o.fav ? '♥ ' : ''}${esc(o.name)}${o.cuisine ? ' · ' + esc(o.cuisine) : ''} · ${distLabel(o.d)}</option>`).join('')}</select></label>` : ''}
      <label>Omschrijving<input id="etitle" value="${esc(it?.title || '')}" placeholder="Bijv. Fietsen huren"></label>
      <label>Notitie<textarea id="enote" rows="2" placeholder="Optioneel">${esc(it?.note || '')}</textarea></label>
      <div class="row">
        ${it ? `<button type="button" class="btn ghost danger" id="edel">${icon('trash')} Verwijderen</button>` : ''}
        <button class="btn" type="submit">${icon('check')} Opslaan</button>
      </div>
    </form>`, {
    onMount(el, close) {
      const ep = $('#ep', el);
      const es = $('#eswap', el);
      es?.addEventListener('change', () => {
        const o = swaps.find((x) => x.id === es.value);
        $('#etitle', el).value = o ? (it.kind === 'food' ? it.title.replace(/ bij .*$/, ' bij ' + o.name) : o.name) : it.title;
      });
      ep?.addEventListener('change', () => {
        const o = options.find((x) => x.id === ep.value);
        if (o) $('#etitle', el).value = o.kind === 'food' ? `${$('#et', el).value < '16:00' ? 'Lunch' : 'Diner'} bij ${o.name}` : o.name;
      });
      $('#edel', el)?.addEventListener('click', () => {
        S.updateTrip(trip.id, () => { day.items = day.items.filter((x) => x.id !== itemId); });
        close(); router();
      });
      $('#ef', el).onsubmit = (e) => {
        e.preventDefault();
        const title = $('#etitle', el).value.trim();
        const o = ep ? options.find((x) => x.id === ep.value) : null;
        if (!title && !o) return;
        S.updateTrip(trip.id, () => {
          if (it) {
            const sw = es ? swaps.find((x) => x.id === es.value) : null;
            Object.assign(it, { time: $('#et', el).value, title: title || it.title, note: $('#enote', el).value.trim() });
            if (sw) Object.assign(it, { refId: sw.id, lat: sw.lat, lon: sw.lon, sub: sw.cuisine || sw.short || sw.sub || '', note: sw.tip || '' });
          }
          else day.items.push({
            id: S.uid('i'), time: $('#et', el).value, title: title || o.name, note: $('#enote', el).value.trim(),
            ...(o ? { kind: o.kind, refId: o.id, lat: o.lat, lon: o.lon, sub: o.sub } : { kind: 'custom', icon: 'pin' }),
          });
          sortItems(day);
        });
        close(); router();
      };
    },
  });
}

function exportICS(trip) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Travelly//NL', 'CALSCALE:GREGORIAN'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const escI = (s = '') => s.replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  for (const d of trip.plan.days) {
    d.items.forEach((it, i) => {
      const next = d.items[i + 1];
      const start = d.date.replace(/-/g, '') + 'T' + it.time.replace(':', '') + '00';
      const endT = next && next.time > it.time ? next.time : `${String(Math.min(23, Number(it.time.slice(0, 2)) + 1)).padStart(2, '0')}:${it.time.slice(3)}`;
      lines.push('BEGIN:VEVENT', `UID:${it.id}@travelly`, `DTSTAMP:${stamp}`, `DTSTART:${start}`, `DTEND:${d.date.replace(/-/g, '')}T${endT.replace(':', '')}00`,
        `SUMMARY:${escI(it.title)}`, `LOCATION:${escI([it.title.replace(/^(Lunch|Diner) bij /, ''), trip.city.name].join(', '))}`,
        `DESCRIPTION:${escI([it.note, it.lat ? gmaps.route(it) : ''].filter(Boolean).join('\n'))}`, 'END:VEVENT');
    });
  }
  lines.push('END:VCALENDAR');
  download(new Blob([lines.join('\r\n')], { type: 'text/calendar' }), `travelly-${trip.city.name.toLowerCase()}.ics`);
}

function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ------------------------------------------------------------------ WEER
async function weatherPage(id) {
  const trip = S.getTrip(id);
  view.innerHTML = `${header('Weer', { back: '#/', sub: esc(trip.city.name) })}<div class="list">${skeleton(3)}</div>`;
  const [weather, now] = await Promise.all([weatherFor(trip), currentWeather(trip.city.lat, trip.city.lon).catch(() => null)]);
  const ws = weather.filter((w) => w.tmax != null);
  const climate = ws.some((w) => w.source === 'klimaat');
  const wet = ws.filter((w) => w.pop >= 50);
  const tip = !ws.length ? 'Het weer kon niet geladen worden.'
    : wet.length ? `Neem een paraplu mee: op ${wet.map((w) => fmt.day(w.date)).join(', ')} is de kans op regen ${climate ? 'meestal' : ''} groot. De slimme planning kiest dan voor binnenactiviteiten.`
    : ws.every((w) => w.tmax >= 20) ? 'Mooi weer! Plan een rondvaart of een terras aan het water, en vergeet je zonnebril niet.'
    : 'Overwegend droog. Laagjes kleding is handig: \'s ochtends en \'s avonds kan het fris zijn.';
  view.innerHTML = `${header('Weer', { back: '#/', sub: esc(trip.city.name) })}
  <div class="weather">
    ${now ? `<div class="wx-now">${icon(weatherInfo(now.code).icon, 'wx-big wx-' + weatherInfo(now.code).icon)}<div><small>Nu in ${esc(trip.city.name)}</small><b>${Math.round(now.temp)}°C</b><span>${weatherInfo(now.code).label} · wind ${Math.round(now.wind)} km/u</span></div></div>` : ''}
    <h2 class="sec-t">Jullie reisdagen</h2>
    <div class="wx-list">${weather.map((w) => {
      if (w.tmax == null) return `<div class="wx-row"><div><b>${fmt.dayCap(w.date)}</b><small>${fmt.short(w.date)}</small></div><span class="muted">Nog geen gegevens</span></div>`;
      const wi = weatherInfo(w.code);
      return `<div class="wx-row"><div><b>${fmt.dayCap(w.date)}</b><small>${fmt.short(w.date)}</small></div>
        <div class="wx-ic">${icon(wi.icon, 'wx-' + wi.icon)}<small>${wi.label}${w.sun != null ? `<br>${w.sun}% zon` : ''}</small></div>
        <div class="wx-t"><b>${Math.round(w.tmax)}°</b><small>${Math.round(w.tmin)}°</small></div>
        <div class="wx-p">${icon('drop')}${w.source === 'verwachting' ? `${(Math.round((w.rain ?? 0) * 10) / 10).toString().replace('.', ',')} mm` : `${w.pop ?? '–'}%`}</div></div>`;
    }).join('')}</div>
    ${climate ? `<p class="hint">${icon('info')} Voor dagen verder dan ruim twee weken vooruit tonen we het gemiddelde weer op die datums in de afgelopen drie jaar. Zodra jullie reis dichterbij komt, verschijnt hier de echte verwachting.</p>` : ''}
    <div class="tip hl">${icon('lightbulb')}<div><b>Tip voor je reis</b><p>${tip}</p></div></div>
  </div>`;
}

// ------------------------------------------------------------------ NOTITIES
const COLORS = [['sage', 'Groen'], ['rose', 'Roze'], ['sky', 'Blauw'], ['sand', 'Zand']];
function notes(id) {
  const trip = S.getTrip(id);
  trip.notes ||= []; trip.todos ||= [];
  view.innerHTML = `${header('Notities', { back: '#/', sub: esc(trip.city.name) })}
  <div class="notes-wrap">
    <form class="noteform" id="nf">
      <input id="nt" placeholder="Titel (bijv. Parkeren)" maxlength="60">
      <textarea id="nx" rows="2" placeholder="Voeg een notitie toe…"></textarea>
      <div class="row"><div class="colors">${COLORS.map(([c, l], i) => `<label class="c-${c}" title="${l}"><input type="radio" name="col" value="${c}"${i ? '' : ' checked'}><span></span></label>`).join('')}</div><button class="btn small">${icon('plus')} Bewaar</button></div>
    </form>
    <div class="notes">${trip.notes.map((n) => `<div class="note c-${n.color}"><div class="note-h"><b>${esc(n.title || 'Notitie')}</b><button class="iconbtn sm" data-del="${n.id}" aria-label="Verwijder">${icon('trash')}</button></div><p>${esc(n.text)}</p><small>${new Date(n.at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}</small></div>`).join('')}</div>
    <section class="todo">
      <h2 class="sec-t">${icon('list')} To-do</h2>
      <ul${trip.todos.length ? '' : ' hidden'}>${trip.todos.map((t) => `<li class="${t.done ? 'done' : ''}"><label><input type="checkbox" data-t="${t.id}"${t.done ? ' checked' : ''}><span>${esc(t.text)}</span></label><button class="iconbtn sm" data-tdel="${t.id}" aria-label="Verwijder">${icon('x')}</button></li>`).join('')}</ul>
      <form id="tf" class="todo-add"><input id="tx" placeholder="Bijv. Tickets museum boeken"><button class="iconbtn" aria-label="Toevoegen">${icon('plus')}</button></form>
    </section>
  </div>`;
  $('#nf').onsubmit = (e) => {
    e.preventDefault();
    const text = $('#nx').value.trim(), title = $('#nt').value.trim();
    if (!text && !title) return;
    S.updateTrip(id, (t) => { t.notes.unshift({ id: S.uid('n'), title, text, color: $('input[name=col]:checked').value, at: Date.now() }); });
    notes(id);
  };
  $('.notes').onclick = (e) => { const b = e.target.closest('[data-del]'); if (b && confirm('Notitie verwijderen?')) { S.updateTrip(id, (t) => { t.notes = t.notes.filter((n) => n.id !== b.dataset.del); }); notes(id); } };
  $('.todo ul').onchange = (e) => { const c = e.target.closest('[data-t]'); if (!c) return; S.updateTrip(id, (t) => { const x = t.todos.find((y) => y.id === c.dataset.t); x.done = c.checked; }); c.closest('li').classList.toggle('done', c.checked); };
  $('.todo ul').onclick = (e) => { const b = e.target.closest('[data-tdel]'); if (!b) return; S.updateTrip(id, (t) => { t.todos = t.todos.filter((x) => x.id !== b.dataset.tdel); }); notes(id); };
  $('#tf').onsubmit = (e) => { e.preventDefault(); const v = $('#tx').value.trim(); if (!v) return; S.updateTrip(id, (t) => { t.todos.push({ id: S.uid('d'), text: v, done: false }); }); notes(id); $('#tx').focus(); };
}

// ------------------------------------------------------------------ DAGBOEK
async function diary(id) {
  const trip = S.getTrip(id);
  trip.diary ||= [];
  const entries = trip.diary.slice().sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  view.innerHTML = `${header('Mijn dagboek', { back: '#/', sub: esc(trip.city.name), action: `<button class="btn small" id="new">${icon('plus')} Nieuw</button>` })}
  <div class="diary">
    ${entries.length ? '' : `<div class="empty big">${icon('book')}<h2>Jouw reis, jouw verhaal</h2><p>Schrijf op wat jullie meemaken en voeg foto's toe. Zo maak je onderweg je eigen reisboek.</p><button class="btn" id="new2">${icon('camera')} Eerste herinnering</button></div>`}
    ${entries.map((e) => `<article class="entry" data-e="${e.id}">
      <header><time>${fmt.dayCap(e.date)} ${fmt.long(e.date)}</time><button class="iconbtn sm" data-edit="${e.id}" aria-label="Bewerken">${icon('edit')}</button></header>
      ${e.photos?.length ? `<div class="pics n${Math.min(e.photos.length, 4)}">${e.photos.map((p) => `<button class="pic" data-pic="${p}"><img data-pid="${p}" alt=""></button>`).join('')}</div>` : ''}
      ${e.text ? `<p class="script-text">${esc(e.text).replace(/\n/g, '<br>')}</p>` : ''}
      ${e.place ? `<span class="tag">${icon('pin')} ${esc(e.place)}</span>` : ''}
    </article>`).join('')}
  </div>`;
  $$('img[data-pid]').forEach(async (img) => { img.src = await S.photoURL(img.dataset.pid) || ''; });
  const open = (eid) => diaryEditor(trip, eid);
  $('#new').onclick = () => open(null);
  $('#new2')?.addEventListener('click', () => open(null));
  $('.diary').onclick = async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) return open(ed.dataset.edit);
    const pic = e.target.closest('[data-pic]');
    if (pic) { const u = await S.photoURL(pic.dataset.pic); sheet(`<img class="lightbox" src="${u}" alt=""><button class="btn ghost" data-close>Sluiten</button>`, { wide: true }); }
  };
}

function diaryEditor(trip, eid) {
  const e = eid ? trip.diary.find((x) => x.id === eid) : null;
  const today = iso(new Date());
  const dates = tripDates(trip);
  const defDate = e?.date || (dates.includes(today) ? today : dates[0]);
  let photos = [...(e?.photos || [])];
  const added = [];
  sheet(`
    <h2 class="sheet-t">${e ? 'Herinnering bewerken' : 'Nieuwe herinnering'}</h2>
    <form class="form tight" id="df">
      <label>Datum<input type="date" id="dd" value="${defDate}"></label>
      <label>Wat hebben jullie beleefd?<textarea id="dt" rows="4" placeholder="Wat een prachtige stad! De grachten, de oude gebouwen…">${esc(e?.text || '')}</textarea></label>
      <label>Plek (optioneel)<input id="dp" value="${esc(e?.place || '')}" placeholder="Bijv. Hortus botanicus"></label>
      <div class="upl" id="upl"></div>
      <div class="row wrap">
        <label class="btn ghost small">${icon('image')} Kies foto's<input type="file" accept="image/*" multiple hidden id="fpick"></label>
        <label class="btn ghost small">${icon('camera')} Foto maken<input type="file" accept="image/*" capture="environment" hidden id="fcam"></label>
      </div>
      <div class="row">
        ${e ? `<button type="button" class="btn ghost danger" id="ddel">${icon('trash')} Verwijderen</button>` : ''}
        <button class="btn" type="submit">${icon('check')} Bewaren</button>
      </div>
    </form>`, {
    onMount(el, close) {
      const upl = $('#upl', el);
      const drawPics = async () => {
        upl.innerHTML = photos.map((p) => `<div class="thumb"><img data-pid="${p}" alt=""><button type="button" data-rm="${p}" aria-label="Verwijder foto">${icon('x')}</button></div>`).join('');
        for (const img of $$('img[data-pid]', upl)) img.src = await S.photoURL(img.dataset.pid) || '';
      };
      upl.onclick = (ev) => { const b = ev.target.closest('[data-rm]'); if (b) { photos = photos.filter((x) => x !== b.dataset.rm); drawPics(); } };
      const onFiles = async (files) => {
        for (const f of files) {
          const { blob, w, h } = await S.compressImage(f);
          const pid = S.uid('p');
          await S.putPhoto({ id: pid, tripId: trip.id, blob, w, h, created: Date.now() });
          photos.push(pid); added.push(pid);
        }
        drawPics();
      };
      $('#fpick', el).onchange = (ev) => onFiles([...ev.target.files]);
      $('#fcam', el).onchange = (ev) => onFiles([...ev.target.files]);
      drawPics();
      $('#ddel', el)?.addEventListener('click', async () => {
        if (!confirm('Deze herinnering en de foto\'s verwijderen?')) return;
        for (const p of e.photos || []) await S.deletePhoto(p);
        S.updateTrip(trip.id, (t) => { t.diary = t.diary.filter((x) => x.id !== eid); });
        close(); router();
      });
      $('#df', el).onsubmit = async (ev) => {
        ev.preventDefault();
        const rec = { date: $('#dd', el).value || defDate, text: $('#dt', el).value.trim(), place: $('#dp', el).value.trim(), photos };
        if (!rec.text && !photos.length) return;
        const removed = (e?.photos || []).filter((p) => !photos.includes(p));
        for (const p of removed) await S.deletePhoto(p);
        S.updateTrip(trip.id, (t) => {
          if (e) Object.assign(t.diary.find((x) => x.id === eid), rec);
          else t.diary.push({ id: S.uid('e'), at: Date.now(), ...rec });
        });
        close(); router();
      };
    },
  });
}

// ------------------------------------------------------------------ FAVORIETEN
function favorites(id) {
  const trip = S.getTrip(id);
  let filter = 'all';
  view.innerHTML = `${header('Favorieten', { back: '#/', sub: esc(trip.city.name), action: `<a class="iconbtn" href="#/r/${id}/kaart?fav" aria-label="Op de kaart">${icon('map')}</a>` })}
  <div class="chips scroll" id="ff">${[['all', 'Alles'], ['sight', 'Bezienswaardigheden'], ['hotel', 'Hotels'], ['food', 'Restaurants']].map(([k, l], i) => `<button class="chip${i ? '' : ' on'}" data-k="${k}">${l}</button>`).join('')}</div>
  <div class="favgrid" id="fg"></div>`;
  const draw = () => {
    const l = Object.values(trip.favorites || {}).filter((f) => filter === 'all' || f.kind === filter).sort((a, b) => b.addedAt - a.addedAt);
    $('#fg').innerHTML = l.length ? l.map((p) => `<div class="fcard"><a href="#/r/${id}/p/${enc(p.id)}">${photoOrPh(p, 500)}<b>${esc(p.name)}</b><small>${esc(p.sub || '')}</small></a>${favBtn(trip, p)}</div>`).join('')
      : `<div class="empty big">${icon('heart')}<h2>Nog geen favorieten</h2><p>Tik op het hartje bij een bezienswaardigheid, hotel of restaurant om hem hier te bewaren.</p><a class="btn" href="#/r/${id}/zien">Ontdek ${esc(trip.city.name)}</a></div>`;
  };
  $('#ff').onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; $$('#ff .chip').forEach((x) => x.classList.toggle('on', x === b)); filter = b.dataset.k; draw(); };
  draw();
  const off = S.onChange(() => document.body.dataset.page === 'favorites' && setTimeout(draw, 250));
  cleanup.push(off);
}

// ------------------------------------------------------------------ INSTELLINGEN
function settings(id) {
  const trip = S.getTrip(id);
  const p = trip.prefs || { interests: [], tempo: 'normaal' };
  view.innerHTML = `${header('Reis aanpassen', { back: `#/r/${id}`, sub: esc(trip.city.name) })}
  <form class="form" id="sf">
    <section class="fsec">
      <span class="flabel">Datums</span>
      <div class="dates"><label>Aankomst<input type="date" id="s1" value="${trip.start}"></label><label>Vertrek<input type="date" id="s2" value="${trip.end}"></label></div>
    </section>
    <section class="fsec">
      <span class="flabel">Wie gaan er mee?</span>
      <div class="party" id="partybox"></div>
    </section>
    <section class="fsec">
      <span class="flabel">Interesses</span>
      <div class="chips" id="si">${[['cultuur', 'Cultuur & musea'], ['wandelen', 'Wandelen & grachten'], ['natuur', 'Natuur & parken']].map(([k, l]) => `<button type="button" class="chip${p.interests?.includes(k) ? ' on' : ''}" data-i="${k}">${l}</button>`).join('')}</div>
      <span class="flabel">Tempo</span>
      <div class="seg" id="st">${[['rustig', 'Rustig'], ['normaal', 'Normaal'], ['actief', 'Actief']].map(([k, l]) => `<button type="button" class="${p.tempo === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
      <label class="check"><input type="checkbox" id="sfree"${p.free ? ' checked' : ''}> Liefst gratis uitjes</label>
    </section>
    <button class="btn big">${icon('check')} Opslaan</button>
  </form>
  <div class="menu">
    <button id="exp">${icon('download')}<span>Exporteer reis (met foto's)</span>${icon('right')}</button>
    <button id="imp">${icon('upload')}<span>Importeer een reis</span>${icon('right')}</button>
    <button id="del" class="danger">${icon('trash')}<span>Verwijder deze reis</span>${icon('right')}</button>
  </div>
  ${Object.keys(trip.hidden || {}).length ? `<section class="hidden-list"><h2 class="sec-t">${icon('info')} Verborgen plekken</h2>
    ${Object.entries(trip.hidden).map(([hid, name]) => `<div class="row"><span>${esc(name)}</span><button class="btn small ghost" data-unhide="${esc(hid)}">Terughalen</button></div>`).join('')}</section>` : ''}
  <p class="credits">Je reizen, notities en foto's worden alleen op dit apparaat bewaard. Wil je ze ook op je computer of telefoon? Exporteer de reis hier en importeer het bestand op het andere apparaat.</p>`;
  $('.hidden-list')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-unhide]'); if (!b) return;
    S.updateTrip(id, (t) => { delete t.hidden[b.dataset.unhide]; });
    toast('Plek is weer zichtbaar');
    settings(id);
  });
  let tempo = p.tempo || 'normaal';
  const party = { kids: [], ...JSON.parse(JSON.stringify(partyOf(trip))) };
  const before = JSON.stringify(partyClean(party));
  partyEditor($('#partybox'), party);
  $('#si').onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) b.classList.toggle('on'); };
  $('#st').onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; $$('#st button').forEach((x) => x.classList.toggle('on', x === b)); tempo = b.dataset.t; };
  $('#sf').onsubmit = (e) => {
    e.preventDefault();
    let s1 = $('#s1').value, s2 = $('#s2').value;
    if (s2 < s1) s2 = s1;
    if (daysBetween(s1, s2) > 20) { alert('Een reis kan maximaal 21 dagen duren.'); return; }
    const datesChanged = s1 !== trip.start || s2 !== trip.end;
    const newPrefs = { interests: $$('#si .on').map((x) => x.dataset.i), tempo, free: $('#sfree').checked };
    const partyChanged = JSON.stringify(partyClean(party)) !== before || JSON.stringify(newPrefs) !== JSON.stringify({ interests: p.interests || [], tempo: p.tempo || 'normaal', free: !!p.free });
    S.updateTrip(id, (t) => {
      t.start = s1; t.end = s2; t.persons = partyCount(party); t.party = partyClean(party);
      t.prefs = newPrefs;
      if (datesChanged && t.plan) {
        // bestaande dagen meeschuiven naar de nieuwe datums
        const nd = tripDates(t);
        t.plan.days = nd.map((date, i) => ({ date, items: t.plan.days[i]?.items || [] }));
      }
    });
    toast('Opgeslagen');
    if (partyChanged && trip.plan && confirm('Jullie voorkeuren of wie er meegaat zijn veranderd. Zal ik de planning daarop opnieuw maken?')) buildPlan(trip).then(() => { location.hash = `#/r/${id}/planning`; }).catch(() => { location.hash = `#/r/${id}`; });
    else location.hash = `#/r/${id}`;
  };
  $('#exp').onclick = async () => download(await S.exportTrip(trip), `travelly-${trip.city.name.toLowerCase()}-${trip.start}.json`);
  $('#imp').onclick = importFlow;
  $('#del').onclick = async () => { if (confirm(`De reis naar ${trip.city.name} met alle notities en foto's verwijderen?`)) { await S.deleteTrip(id); location.hash = '#/'; } };
}

// ------------------------------------------------------------------ start
router();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
