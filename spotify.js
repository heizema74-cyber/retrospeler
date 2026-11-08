// spotify.js – inloggen bij Spotify en praten met de Spotify Web API.
//
// Inloggen gebeurt met de "PKCE"-methode: daarvoor is geen eigen server en
// geen geheim wachtwoord nodig. Het werkt zo:
// 1. We maken een willekeurige code ("verifier") en sturen een versleutelde
//    versie daarvan mee naar de inlogpagina van Spotify.
// 2. Na het inloggen stuurt Spotify je terug naar deze pagina met een "code".
// 3. Die code + de originele verifier ruilen we in voor een toegangssleutel (token).

import { CLIENT_ID } from "./config.js";

const API = "https://api.spotify.com/v1";

// Het adres waar Spotify je na het inloggen naartoe terugstuurt. We nemen het adres
// van de pagina zelf, zodat het overal werkt: op 127.0.0.1 én op je eigen server.
// "index.html" halen we eraf, zodat ".../index.html" en ".../" hetzelfde adres opleveren.
// Let op: precies dit adres moet ook in het Spotify Dashboard staan.
const REDIRECT_URI = window.location.origin + window.location.pathname.replace(/index\.html$/, "");

// Welke rechten de app vraagt aan Spotify.
const RECHTEN = [
  "streaming",                    // muziek afspelen in de browser
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",   // afspelen, pauzeren, shuffle enz.
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",            // je gelikete nummers
].join(" ");

// ---------- inloggen ----------

/** Maakt een willekeurige tekst van letters en cijfers. */
function willekeurigeTekst(lengte) {
  const tekens = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const getallen = crypto.getRandomValues(new Uint8Array(lengte));
  let tekst = "";
  for (const getal of getallen) {
    tekst += tekens[getal % tekens.length];
  }
  return tekst;
}

/** Versleutelt tekst met SHA-256 en maakt er URL-veilige base64 van. */
async function maakChallenge(tekst) {
  const bytes = new TextEncoder().encode(tekst);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Geeft het terugstuur-adres, zodat de app het kan laten zien bij problemen. */
export function terugstuurAdres() {
  return REDIRECT_URI;
}

/** Stuurt de gebruiker naar de inlogpagina van Spotify. */
export async function startInloggen() {
  const verifier = willekeurigeTekst(64);
  localStorage.setItem("rs_verifier", verifier);

  const parameters = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: RECHTEN,
    code_challenge_method: "S256",
    code_challenge: await maakChallenge(verifier),
  });
  window.location.href = "https://accounts.spotify.com/authorize?" + parameters;
}

/** Slaat de tokens op die Spotify teruggeeft. */
function bewaarTokens(data) {
  localStorage.setItem("rs_token", data.access_token);
  // Een minuut eerder dan nodig verversen, voor de zekerheid.
  const verlooptOp = Date.now() + (data.expires_in - 60) * 1000;
  localStorage.setItem("rs_verloopt", String(verlooptOp));
  if (data.refresh_token) {
    localStorage.setItem("rs_ververs", data.refresh_token);
  }
}

/** Vraagt een (nieuw) token aan bij Spotify. */
async function vraagTokenAan(gegevens) {
  const antwoord = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(gegevens),
  });
  const data = await antwoord.json();
  if (!antwoord.ok) {
    throw new Error("Spotify gaf geen toegang: " + (data.error_description || data.error));
  }
  bewaarTokens(data);
}

/**
 * Kijkt of we net terugkomen van de inlogpagina en wisselt dan de code in.
 * Geeft true terug als de gebruiker ingelogd is.
 */
export async function verwerkTerugkeer() {
  const parameters = new URLSearchParams(window.location.search);

  if (parameters.get("error")) {
    history.replaceState({}, "", REDIRECT_URI);
    throw new Error("Inloggen bij Spotify is afgebroken (" + parameters.get("error") + ").");
  }

  const code = parameters.get("code");
  if (code) {
    // De code meteen uit de adresbalk halen, zodat herladen geen fout geeft.
    history.replaceState({}, "", REDIRECT_URI);
    await vraagTokenAan({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code: code,
      redirect_uri: REDIRECT_URI,
      code_verifier: localStorage.getItem("rs_verifier"),
    });
    localStorage.removeItem("rs_verifier");
  }

  return localStorage.getItem("rs_ververs") !== null;
}

let verversBezig = null;

/** Geeft een geldig token terug en ververst het als het verlopen is. */
export async function haalToken() {
  const verlooptOp = Number(localStorage.getItem("rs_verloopt") || 0);
  if (localStorage.getItem("rs_token") && Date.now() < verlooptOp) {
    return localStorage.getItem("rs_token");
  }

  const verversToken = localStorage.getItem("rs_ververs");
  if (!verversToken) {
    throw new Error("Je bent niet ingelogd.");
  }

  // Als er al een verversing bezig is, wachten we daarop in plaats van een tweede te starten.
  if (!verversBezig) {
    verversBezig = vraagTokenAan({
      grant_type: "refresh_token",
      refresh_token: verversToken,
      client_id: CLIENT_ID,
    }).finally(() => { verversBezig = null; });
  }
  await verversBezig;
  return localStorage.getItem("rs_token");
}

/** Wist alle opgeslagen inloggegevens. */
export function uitloggen() {
  for (const sleutel of ["rs_token", "rs_verloopt", "rs_ververs", "rs_verifier"]) {
    localStorage.removeItem(sleutel);
  }
}

// ---------- algemene API-aanroep ----------

/** Doet een verzoek aan de Spotify Web API en geeft het antwoord als object terug. */
async function api(pad, opties = {}) {
  const token = await haalToken();
  const adres = pad.startsWith("http") ? pad : API + pad;
  const antwoord = await fetch(adres, {
    ...opties,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
  });

  const tekst = await antwoord.text();
  if (!antwoord.ok) {
    let uitleg = tekst;
    try {
      uitleg = JSON.parse(tekst).error.message;
    } catch {
      // geen JSON: dan tonen we de ruwe tekst
    }
    throw new Error("Spotify-fout " + antwoord.status + ": " + uitleg);
  }
  if (!tekst) {
    return null;
  }
  try {
    return JSON.parse(tekst);
  } catch {
    return null;
  }
}

/** Haalt alle pagina's van een lijst op (Spotify geeft er maximaal 50 per keer). */
async function haalAllePaginas(pad, maxPaginas = 10) {
  const items = [];
  let volgende = pad;
  let paginas = 0;
  while (volgende && paginas < maxPaginas) {
    const data = await api(volgende);
    items.push(...data.items);
    volgende = data.next;
    paginas += 1;
  }
  return items;
}

/** Zet ruwe Spotify-gegevens om naar simpele nummer-objecten. */
function naarNummers(items) {
  const nummers = [];
  for (const regel of items) {
    if (!regel) {
      continue;
    }
    // Zoekresultaten zijn zelf een nummer; in lijsten zit het nummer in .item of .track.
    const nummer = regel.type === "track" ? regel : (regel.item || regel.track);
    if (!nummer || nummer.type !== "track" || nummer.is_local) {
      continue;
    }
    nummers.push({
      uri: nummer.uri,
      naam: nummer.name,
      artiesten: nummer.artists.map((artiest) => artiest.name).join(", "),
      duurMs: nummer.duration_ms,
    });
  }
  return nummers;
}

// ---------- gegevens ophalen ----------

/** Alle afspeellijsten van de gebruiker. */
export async function haalAfspeellijsten() {
  const lijsten = await haalAllePaginas("/me/playlists?limit=50");
  return lijsten.filter((lijst) => lijst !== null);
}

/** De nummers in één afspeellijst. */
export async function haalNummersVanLijst(lijstId) {
  let items;
  try {
    // Nieuwere naam van dit adres bij Spotify ...
    items = await haalAllePaginas("/playlists/" + lijstId + "/items?limit=50");
  } catch {
    // ... en de oudere naam, voor het geval de nieuwe niet werkt.
    items = await haalAllePaginas("/playlists/" + lijstId + "/tracks?limit=50");
  }
  return naarNummers(items);
}

/** De nummers die de gebruiker een hartje heeft gegeven. */
export async function haalGelikteNummers() {
  const items = await haalAllePaginas("/me/tracks?limit=50", 4);
  return naarNummers(items);
}

/** Zoekt nummers op naam of artiest. */
export async function zoekNummers(zoekterm) {
  const data = await api("/search?type=track&limit=10&q=" + encodeURIComponent(zoekterm));
  return naarNummers(data.tracks.items);
}

// ---------- afspelen besturen ----------

/** Maakt deze browser het actieve Spotify-apparaat. */
export async function zetAfspelenOp(apparaatId) {
  await api("/me/player", {
    method: "PUT",
    body: JSON.stringify({ device_ids: [apparaatId], play: false }),
  });
}

/** Start het afspelen. Opdracht is bijv. { context_uri, offset } of { uris, offset }. */
export async function speelAf(apparaatId, opdracht) {
  await api("/me/player/play?device_id=" + apparaatId, {
    method: "PUT",
    body: JSON.stringify(opdracht),
  });
}

/** Zet willekeurige volgorde aan of uit. */
export async function zetShuffle(aan, apparaatId) {
  await api("/me/player/shuffle?state=" + aan + "&device_id=" + apparaatId, { method: "PUT" });
}

/** Herhalen: stand is "off", "context" (hele lijst) of "track" (één nummer). */
export async function zetHerhalen(stand, apparaatId) {
  await api("/me/player/repeat?state=" + stand + "&device_id=" + apparaatId, { method: "PUT" });
}
