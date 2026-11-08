// app.js – het hoofdbestand: koppelt de knoppen, Spotify en de visualisatie aan elkaar.

import { CLIENT_ID } from "./config.js";
import * as spotify from "./spotify.js";
import * as vis from "./visualisatie.js";

// ---------- toestand ----------

let speler = null;            // de Spotify-speler in deze browser
let apparaatId = null;        // het id van deze browser als Spotify-apparaat
let laatsteStatus = null;     // de laatst ontvangen status van Spotify

let positieMs = 0;            // positie in het nummer bij de laatste status
let positieTijdstip = 0;      // wanneer die status binnenkwam
let duurMs = 0;
let gepauzeerd = true;
let aanHetSlepen = false;     // sleept de gebruiker aan de positie-schuif?

let shuffleAan = false;
let herhaalStand = 0;         // 0 = uit, 1 = hele lijst, 2 = één nummer
const HERHAAL_API = ["off", "context", "track"];
const HERHAAL_LABEL = ["REP: UIT", "REP: LIJST", "REP: 1"];

let marqueeTekst = "Welkom bij de Retrospeler";
let marqueeStart = 0;

let lijstNummers = [];        // de nummers die nu in de afspeellijst staan
let lijstContext = null;      // Spotify-adres van de afspeellijst (of null bij zoeken/likes)
let huidigeUri = null;        // het nummer dat nu speelt
const afspeellijsten = {};    // id -> afspeellijst

const element = (id) => document.getElementById(id);
const visCanvas = element("vis-canvas");
const visCtx = visCanvas.getContext("2d");
const miniCtx = element("mini-spectrum").getContext("2d");

// ---------- hulpfuncties ----------

/** Zet milliseconden om naar "mm:ss". */
function formatTijd(ms) {
  const totaalSeconden = Math.max(0, Math.floor(ms / 1000));
  const minuten = Math.floor(totaalSeconden / 60);
  const seconden = totaalSeconden % 60;
  return String(minuten).padStart(2, "0") + ":" + String(seconden).padStart(2, "0");
}

/** Toont een korte melding onder de knoppen. */
function toonMelding(tekst, isFout = false) {
  const vak = element("melding");
  vak.textContent = tekst;
  vak.classList.toggle("fout", isFout);
}

/** Verandert de lopende tekst in het display. */
function zetMarquee(tekst) {
  if (tekst !== marqueeTekst) {
    marqueeTekst = tekst;
    marqueeStart = performance.now();
  }
}

/**
 * Maakt van een knop-functie een "veilige" versie: gaat er iets mis,
 * dan zie je de fout als melding in plaats van dat er stil niets gebeurt.
 */
function veilig(functie) {
  return async (gebeurtenis) => {
    try {
      await functie(gebeurtenis);
    } catch (fout) {
      toonMelding(fout.message, true);
    }
  };
}

/** Controleert of de Spotify-speler klaar is. */
function spelerIsKlaar() {
  if (!speler || !apparaatId) {
    toonMelding("De speler is nog niet verbonden met Spotify.", true);
    return false;
  }
  return true;
}

// ---------- Spotify-speler ----------

/** Laadt de Web Playback SDK van Spotify; die roept daarna maakSpeler aan. */
function laadSpotifySpeler() {
  window.onSpotifyWebPlaybackSDKReady = maakSpeler;
  const script = document.createElement("script");
  script.src = "https://sdk.scdn.co/spotify-player.js";
  document.body.appendChild(script);
}

/** Maakt de speler aan en luistert naar wat Spotify ons vertelt. */
function maakSpeler() {
  speler = new Spotify.Player({
    name: "Retrospeler",
    volume: element("volume").value / 100,
    getOAuthToken: (geefToken) => {
      spotify.haalToken().then(geefToken).catch((fout) => toonMelding(fout.message, true));
    },
  });

  speler.addListener("ready", veilig(async ({ device_id }) => {
    apparaatId = device_id;
    element("info-apparaat").textContent = "VERBONDEN";
    toonMelding("Verbonden met Spotify. Kies een afspeellijst en dubbelklik op een nummer.");
    await spotify.zetAfspelenOp(apparaatId);
  }));
  speler.addListener("not_ready", () => {
    element("info-apparaat").textContent = "OFFLINE";
    toonMelding("De verbinding met Spotify is weggevallen.", true);
  });
  speler.addListener("initialization_error", ({ message }) => {
    toonMelding("De speler kon niet starten: " + message, true);
  });
  speler.addListener("authentication_error", () => {
    toonMelding("Je inlog is verlopen. Log opnieuw in.", true);
    element("inlog-blok").hidden = false;
  });
  speler.addListener("account_error", () => {
    toonMelding("Afspelen in de browser kan alleen met Spotify Premium.", true);
  });
  speler.addListener("autoplay_failed", () => {
    toonMelding("De browser hield het afspelen tegen. Klik op ▶.", true);
  });
  speler.addListener("player_state_changed", verwerkStatus);

  speler.connect();
}

/** Werkt het display bij als Spotify een nieuwe status stuurt. */
function verwerkStatus(status) {
  if (!status) {
    return;
  }
  laatsteStatus = status;
  positieMs = status.position;
  positieTijdstip = performance.now();
  duurMs = status.duration;
  gepauzeerd = status.paused;

  element("status-spelen").textContent = gepauzeerd ? "❚❚" : "▶";
  element("info-duur").textContent = formatTijd(duurMs);

  shuffleAan = status.shuffle;
  herhaalStand = status.repeat_mode;
  element("knop-shuffle").classList.toggle("aan", shuffleAan);
  element("knop-herhaal").textContent = HERHAAL_LABEL[herhaalStand];
  element("knop-herhaal").classList.toggle("aan", herhaalStand > 0);

  const nummer = status.track_window.current_track;
  if (nummer) {
    const artiesten = nummer.artists.map((artiest) => artiest.name).join(", ");
    zetMarquee(artiesten + " - " + nummer.name + " (" + formatTijd(duurMs) + ")");
    // Soms speelt Spotify een andere versie van hetzelfde nummer ("linked_from").
    huidigeUri = nummer.linked_from && nummer.linked_from.uri ? nummer.linked_from.uri : nummer.uri;
    markeerHuidigNummer();
  }
}

// ---------- afspeellijst ----------

/** Vult de keuzelijst met de afspeellijsten van de gebruiker. */
async function laadAfspeellijsten() {
  const keuze = element("kies-lijst");
  const likes = document.createElement("option");
  likes.value = "likes";
  likes.textContent = "♥ Gelikete nummers";
  keuze.appendChild(likes);

  const lijsten = await spotify.haalAfspeellijsten();
  for (const lijst of lijsten) {
    afspeellijsten[lijst.id] = lijst;
    const optie = document.createElement("option");
    optie.value = lijst.id;
    optie.textContent = lijst.name;
    keuze.appendChild(optie);
  }
}

/** Laadt de nummers van de gekozen afspeellijst. */
async function kiesLijst() {
  const waarde = element("kies-lijst").value;
  if (!waarde) {
    return;
  }
  toonMelding("Nummers laden…");
  if (waarde === "likes") {
    lijstNummers = await spotify.haalGelikteNummers();
    lijstContext = null;
  } else {
    try {
      lijstNummers = await spotify.haalNummersVanLijst(waarde);
    } catch (fout) {
      throw new Error("Deze afspeellijst kon niet geladen worden. Spotify geeft apps in "
        + "ontwikkelmodus soms alleen toegang tot je eigen lijsten. (" + fout.message + ")");
    }
    lijstContext = afspeellijsten[waarde].uri;
  }
  toonNummers();
  toonMelding(lijstNummers.length + " nummers geladen.");
}

/** Zoekt nummers en zet ze in de afspeellijst. */
async function zoek(gebeurtenis) {
  gebeurtenis.preventDefault(); // anders herlaadt het formulier de pagina
  const zoekterm = element("zoekterm").value.trim();
  if (!zoekterm) {
    return;
  }
  toonMelding("Zoeken…");
  lijstNummers = await spotify.zoekNummers(zoekterm);
  lijstContext = null;
  element("kies-lijst").value = "";
  toonNummers();
  toonMelding(lijstNummers.length + " resultaten voor '" + zoekterm + "'.");
}

/** Zet de nummers als regels in de lijst op het scherm. */
function toonNummers() {
  const lijst = element("nummers");
  lijst.innerHTML = "";
  lijstNummers.forEach((nummer, index) => {
    const regel = document.createElement("li");
    regel.tabIndex = 0;
    regel.dataset.index = index;
    regel.dataset.uri = nummer.uri;

    const titel = document.createElement("span");
    titel.className = "titel";
    titel.textContent = (index + 1) + ". " + nummer.artiesten + " - " + nummer.naam;
    const duur = document.createElement("span");
    duur.className = "duur";
    duur.textContent = formatTijd(nummer.duurMs);

    regel.append(titel, duur);
    lijst.appendChild(regel);
  });
  markeerHuidigNummer();
}

/** Geeft het nummer dat nu speelt een andere kleur. */
function markeerHuidigNummer() {
  for (const regel of element("nummers").children) {
    regel.classList.toggle("speelt", regel.dataset.uri === huidigeUri);
  }
}

/** Speelt het nummer op plek `index` in de lijst af. */
async function speelNummer(index) {
  if (!spelerIsKlaar()) {
    return;
  }
  speler.activateElement(); // nodig voor sommige browsers (o.a. Safari)
  const nummer = lijstNummers[index];
  let opdracht;
  if (lijstContext) {
    // Binnen de afspeellijst, zodat "volgende" het volgende nummer van die lijst is.
    opdracht = { context_uri: lijstContext, offset: { uri: nummer.uri } };
  } else {
    opdracht = { uris: lijstNummers.map((n) => n.uri), offset: { position: index } };
  }
  await spotify.speelAf(apparaatId, opdracht);
}

// ---------- knoppen koppelen ----------

function koppelKnoppen() {
  element("knop-inloggen").addEventListener("click", veilig(spotify.startInloggen));

  element("knop-uitloggen").addEventListener("click", () => {
    spotify.uitloggen();
    if (speler) {
      speler.disconnect();
    }
    window.location.reload();
  });

  element("knop-afspelen").addEventListener("click", veilig(async () => {
    if (!spelerIsKlaar()) {
      return;
    }
    speler.activateElement();
    const erIsEenNummer = laatsteStatus && laatsteStatus.track_window.current_track;
    if (!erIsEenNummer && lijstNummers.length > 0) {
      await speelNummer(0);
    } else {
      await speler.resume();
    }
  }));

  element("knop-pauze").addEventListener("click", veilig(async () => {
    if (spelerIsKlaar()) {
      await speler.pause();
    }
  }));

  element("knop-stop").addEventListener("click", veilig(async () => {
    if (spelerIsKlaar()) {
      await speler.pause();
      await speler.seek(0);
    }
  }));

  element("knop-vorige").addEventListener("click", veilig(async () => {
    if (spelerIsKlaar()) {
      await speler.previousTrack();
    }
  }));

  element("knop-volgende").addEventListener("click", veilig(async () => {
    if (spelerIsKlaar()) {
      await speler.nextTrack();
    }
  }));

  element("knop-shuffle").addEventListener("click", veilig(async () => {
    if (spelerIsKlaar()) {
      await spotify.zetShuffle(!shuffleAan, apparaatId);
    }
  }));

  element("knop-herhaal").addEventListener("click", veilig(async () => {
    if (spelerIsKlaar()) {
      const nieuweStand = (herhaalStand + 1) % 3;
      await spotify.zetHerhalen(HERHAAL_API[nieuweStand], apparaatId);
    }
  }));

  // Positie: tijdens het slepen alleen het display bijwerken, bij loslaten echt verspringen.
  const positie = element("positie");
  positie.addEventListener("input", () => {
    aanHetSlepen = true;
    element("tijd").textContent = formatTijd((positie.value / 1000) * duurMs);
  });
  positie.addEventListener("change", veilig(async () => {
    aanHetSlepen = false;
    if (spelerIsKlaar() && duurMs > 0) {
      const nieuwePositie = Math.round((positie.value / 1000) * duurMs);
      positieMs = nieuwePositie;
      positieTijdstip = performance.now();
      await speler.seek(nieuwePositie);
    }
  }));

  element("volume").addEventListener("input", () => {
    if (speler) {
      speler.setVolume(element("volume").value / 100);
    }
  });

  // Afspeellijst
  element("kies-lijst").addEventListener("change", veilig(kiesLijst));
  element("zoek-formulier").addEventListener("submit", veilig(zoek));
  const nummers = element("nummers");
  nummers.addEventListener("dblclick", veilig(async (gebeurtenis) => {
    const regel = gebeurtenis.target.closest("li");
    if (regel) {
      await speelNummer(Number(regel.dataset.index));
    }
  }));
  nummers.addEventListener("keydown", veilig(async (gebeurtenis) => {
    if (gebeurtenis.key === "Enter" && gebeurtenis.target.dataset.index !== undefined) {
      await speelNummer(Number(gebeurtenis.target.dataset.index));
    }
  }));

  // Visualisatie
  element("knop-microfoon").addEventListener("click", veilig(async () => {
    await vis.startMicrofoon();
    toonMelding("De visualisatie luistert nu via de microfoon. Zet de muziek niet te zacht.");
  }));
  element("knop-tabblad").addEventListener("click", veilig(async () => {
    await vis.startTabbladAudio();
    toonMelding("De visualisatie luistert naar het tabblad. Blijft het stil? Gebruik dan de microfoon.");
  }));
  const naarVolgendeModus = () => {
    element("knop-modus").textContent = "Modus: " + vis.volgendeModus();
  };
  element("knop-modus").addEventListener("click", naarVolgendeModus);
  visCanvas.addEventListener("click", naarVolgendeModus);
  const volledigScherm = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      element("vis-houder").requestFullscreen();
    }
  };
  element("knop-volledig").addEventListener("click", volledigScherm);
  visCanvas.addEventListener("dblclick", volledigScherm);
}

/** Zorgt dat het canvas evenveel pixels heeft als het scherm (scherp beeld). */
function pasCanvasAan() {
  const schaal = window.devicePixelRatio || 1;
  const houder = element("vis-houder");
  visCanvas.width = Math.round(houder.clientWidth * schaal);
  visCanvas.height = Math.round(houder.clientHeight * schaal);
}

// ---------- animatie: ongeveer 60 keer per seconde ----------

function animatieLus(nu) {
  // Tijd in het nummer: zelf doortellen tussen de statusberichten van Spotify door.
  let positie = positieMs;
  if (!gepauzeerd) {
    positie += nu - positieTijdstip;
  }
  if (duurMs > 0) {
    positie = Math.min(positie, duurMs);
  }
  if (!aanHetSlepen) {
    element("tijd").textContent = formatTijd(positie);
    element("positie").value = duurMs > 0 ? Math.round((positie / duurMs) * 1000) : 0;
  }

  // Lopende tekst: elke 0,18 seconde één letter opschuiven.
  const tekst = marqueeTekst + "   ***   ";
  const stap = Math.floor((nu - marqueeStart) / 180) % tekst.length;
  element("marquee").textContent = tekst.slice(stap) + tekst.slice(0, stap) + tekst;

  // Geluid analyseren en tekenen.
  const analyse = vis.analyseer(nu);
  vis.tekenMiniSpectrum(miniCtx, analyse);
  vis.tekenVisualisatie(visCtx, visCanvas.width, visCanvas.height, analyse, nu);

  element("lamp-beat").classList.toggle("aan", analyse.beatKracht > 0.5);
  element("info-bpm").textContent = analyse.bpm > 0 ? analyse.bpm + " BPM" : "--- BPM";
  const bron = vis.huidigeBron();
  element("info-bron").textContent = "BRON: " + (bron || "---");
  element("knop-microfoon").classList.toggle("aan", bron === "MIC");
  element("knop-tabblad").classList.toggle("aan", bron === "TAB");

  requestAnimationFrame(animatieLus);
}

// ---------- opstarten ----------

async function opstarten() {
  koppelKnoppen();
  new ResizeObserver(pasCanvasAan).observe(element("vis-houder"));
  requestAnimationFrame(animatieLus);
  element("terugstuur-adres").textContent = spotify.terugstuurAdres();

  // Inloggen, de microfoon en tabblad-audio werken alleen op een "veilige" pagina:
  // via https:// of op je eigen computer (127.0.0.1).
  if (!window.isSecureContext) {
    zetMarquee("Geen HTTPS");
    toonMelding("Deze pagina draait niet via https://. Spotify-inloggen, de microfoon en "
      + "tabblad-audio werken alleen via HTTPS. Zet een certificaat op je server (zie README.md).", true);
    return;
  }

  if (!CLIENT_ID) {
    zetMarquee("Nog geen Client ID ingesteld");
    toonMelding("Vul eerst je Spotify Client ID in config.js in (zie README.md). "
      + "De visualisatie werkt al wel.", true);
    return;
  }

  try {
    const ingelogd = await spotify.verwerkTerugkeer();
    if (!ingelogd) {
      element("inlog-blok").hidden = false;
      zetMarquee("Log in bij Spotify om te beginnen");
      return;
    }
    element("knop-uitloggen").hidden = false;
    laadSpotifySpeler();
    await laadAfspeellijsten();
  } catch (fout) {
    toonMelding(fout.message, true);
    element("inlog-blok").hidden = false;
  }
}

opstarten();
