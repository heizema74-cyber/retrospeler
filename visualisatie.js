// visualisatie.js – luistert mee met de muziek, zoekt de beat en tekent de beelden.
//
// Waarom luisteren we "mee"? Spotify versleutelt het geluid (DRM), dus de browser
// mag de muziek zelf niet analyseren. Daarom vangen we het geluid opnieuw op:
// via de microfoon (muziek uit je speakers) of door het tabblad-geluid te delen.
//
// Hoe werkt de beat-detectie?
// 1. Een AnalyserNode (Web Audio API) splitst het geluid elk beeldje op in
//    frequenties: links de lage tonen (bas), rechts de hoge (hihat).
// 2. We kijken alleen naar de bas (ca. 40–150 Hz): daar zit de kick-drum.
// 3. We meten hoeveel de bas ten opzichte van het vorige beeldje *toeneemt*.
// 4. Is die toename veel groter dan normaal (gemiddelde + 1,5 × de spreiding
//    van de laatste seconde), dan noemen we het een beat.
// 5. De tijd tussen de beats geeft het tempo (BPM).

const AANTAL_BALKEN = 40;
const MINI_BALKEN = 19;
const MODI = ["Spectrum", "Oscilloscoop", "Tunnel"];

// Geluid
let audioContext = null;
let analyser = null;
let bronKnoop = null;
let huidigeStream = null;
let bronNaam = "";
let binBreedte = 0;       // hoeveel Hz één frequentie-vakje breed is
let frequenties = null;   // sterkte per frequentie (0–255)
let golfvorm = null;      // de geluidsgolf zelf (128 = stil)
let vorigeBas = null;

// Beat
const fluxGeschiedenis = [];
const beatIntervallen = [];
let laatsteBeat = 0;
let beatKracht = 0;       // 1 direct na een beat, zakt daarna langzaam naar 0
let aantalBeats = 0;
let bpm = 0;

// Tekenen
let modusIndex = 0;
const pieken = new Array(AANTAL_BALKEN).fill(0);
const miniPieken = new Array(MINI_BALKEN).fill(0);
let tunnelBuffer = null;
let tunnelDraai = 0.004;

// ---------- geluidsbron kiezen ----------

/** Luistert via de microfoon. */
export async function startMicrofoon() {
  const stream = await navigator.mediaDevices.getUserMedia({
    // Zonder deze filters klinkt muziek voor de computer zoals hij echt is.
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  koppelStream(stream, "MIC");
}

/** Luistert naar het geluid van een gedeeld tabblad (Chrome en Edge). */
export async function startTabbladAudio() {
  if (!navigator.mediaDevices.getDisplayMedia) {
    throw new Error("Deze browser kan geen tabblad-audio delen. Probeer Chrome of Edge.");
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    systemAudio: "include",
  });
  if (stream.getAudioTracks().length === 0) {
    stopTracks(stream);
    throw new Error("Er werd geen geluid gedeeld. Zet in het deelvenster 'Tabblad-audio delen' aan.");
  }
  koppelStream(stream, "TAB");
}

/** Sluit een geluidsstroom aan op de analyser. */
function koppelStream(stream, naam) {
  stopBron();
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  audioContext.resume();

  analyser = audioContext.createAnalyser();
  analyser.fftSize = 4096;               // fijn genoeg om de bas goed te zien
  analyser.smoothingTimeConstant = 0.35; // laag = snel reageren op de beat
  analyser.minDecibels = -90;
  analyser.maxDecibels = -15;

  bronKnoop = audioContext.createMediaStreamSource(stream);
  bronKnoop.connect(analyser); // bewust NIET naar de speakers, anders krijg je rondzingen

  huidigeStream = stream;
  bronNaam = naam;
  binBreedte = audioContext.sampleRate / analyser.fftSize;
  frequenties = new Uint8Array(analyser.frequencyBinCount);
  golfvorm = new Uint8Array(analyser.fftSize);
  vorigeBas = null;

  // Als de gebruiker het delen stopt, stoppen wij ook.
  for (const track of stream.getAudioTracks()) {
    track.addEventListener("ended", stopBron);
  }
}

/** Stopt alle sporen van een stream (microfoon of scherm delen). */
function stopTracks(stream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/** Stopt met luisteren. */
export function stopBron() {
  if (bronKnoop) {
    bronKnoop.disconnect();
  }
  if (huidigeStream) {
    stopTracks(huidigeStream);
  }
  bronKnoop = null;
  huidigeStream = null;
  analyser = null;
  bronNaam = "";
}

/** Naam van de huidige bron: "MIC", "TAB" of "" (geen). */
export function huidigeBron() {
  return bronNaam;
}

// ---------- analyseren ----------

/**
 * Analyseert het geluid van dit moment. Roep dit één keer per beeldje aan.
 * Geeft een object terug met alles wat de tekenfuncties nodig hebben.
 */
export function analyseer(nu) {
  beatKracht = beatKracht * 0.9;

  if (!analyser) {
    return { actief: false, beat: false, beatKracht: beatKracht, bpm: bpm };
  }

  analyser.getByteFrequencyData(frequenties);
  analyser.getByteTimeDomainData(golfvorm);

  const beat = zoekBeat(nu);
  if (beat) {
    beatKracht = 1;
  }
  return { actief: true, beat: beat, beatKracht: beatKracht, bpm: bpm };
}

/** Kijkt of er op dit moment een beat valt. */
function zoekBeat(nu) {
  const begin = Math.max(1, Math.floor(40 / binBreedte));
  const eind = Math.ceil(150 / binBreedte);

  // Hoeveel is de bas gegroeid sinds het vorige beeldje? ("flux")
  let flux = 0;
  if (vorigeBas) {
    for (let i = begin; i <= eind; i++) {
      const verschil = frequenties[i] - vorigeBas[i - begin];
      if (verschil > 0) {
        flux += verschil;
      }
    }
  }
  vorigeBas = frequenties.slice(begin, eind + 1);

  // Onthoud ongeveer de laatste seconde (60 beeldjes).
  fluxGeschiedenis.push(flux);
  if (fluxGeschiedenis.length > 60) {
    fluxGeschiedenis.shift();
  }

  const gemiddelde = gemiddeldeVan(fluxGeschiedenis);
  const spreiding = spreidingVan(fluxGeschiedenis, gemiddelde);
  const drempel = gemiddelde + 1.5 * spreiding;

  const genoegTijdVerstreken = nu - laatsteBeat > 280; // max. ~210 BPM
  const isBeat = flux > drempel && flux > 20 && genoegTijdVerstreken;
  if (isBeat) {
    onthoudBeat(nu);
  }
  return isBeat;
}

/** Slaat een beat op en rekent het tempo opnieuw uit. */
function onthoudBeat(nu) {
  const interval = nu - laatsteBeat;
  if (interval > 280 && interval < 1500) {
    beatIntervallen.push(interval);
    if (beatIntervallen.length > 16) {
      beatIntervallen.shift();
    }
  }
  laatsteBeat = nu;
  aantalBeats += 1;

  if (beatIntervallen.length >= 4) {
    let tempo = 60000 / mediaanVan(beatIntervallen);
    // Breng het tempo naar een gebruikelijk bereik.
    while (tempo > 180) {
      tempo = tempo / 2;
    }
    while (tempo < 70) {
      tempo = tempo * 2;
    }
    bpm = Math.round(tempo);
  }
}

function gemiddeldeVan(getallen) {
  let som = 0;
  for (const getal of getallen) {
    som += getal;
  }
  return som / getallen.length;
}

function spreidingVan(getallen, gemiddelde) {
  let som = 0;
  for (const getal of getallen) {
    som += (getal - gemiddelde) ** 2;
  }
  return Math.sqrt(som / getallen.length);
}

function mediaanVan(getallen) {
  const gesorteerd = [...getallen].sort((a, b) => a - b);
  return gesorteerd[Math.floor(gesorteerd.length / 2)];
}

/**
 * Verdeelt de frequenties over een aantal balken (0 tot 1).
 * De verdeling is logaritmisch: de bas krijgt net zoveel balken als de hoge tonen,
 * zoals ook onze oren het horen.
 */
function balkWaarden(aantal) {
  const laagste = 35;
  const hoogste = 16000;
  const waarden = [];
  for (let i = 0; i < aantal; i++) {
    const vanHz = laagste * Math.pow(hoogste / laagste, i / aantal);
    const totHz = laagste * Math.pow(hoogste / laagste, (i + 1) / aantal);
    const van = Math.floor(vanHz / binBreedte);
    const tot = Math.max(van + 1, Math.ceil(totHz / binBreedte));
    let sterkste = 0;
    for (let j = van; j < tot && j < frequenties.length; j++) {
      sterkste = Math.max(sterkste, frequenties[j]);
    }
    waarden.push(sterkste / 255);
  }
  return waarden;
}

// ---------- modi ----------

/** Schakelt naar de volgende visualisatie en geeft de naam terug. */
export function volgendeModus() {
  modusIndex = (modusIndex + 1) % MODI.length;
  return MODI[modusIndex];
}

// ---------- tekenen ----------

/** Tekent de grote visualisatie. */
export function tekenVisualisatie(ctx, breedte, hoogte, analyse, nu) {
  if (breedte === 0 || hoogte === 0) {
    return;
  }
  if (!analyse.actief) {
    tekenWachtscherm(ctx, breedte, hoogte, nu);
  } else if (MODI[modusIndex] === "Spectrum") {
    tekenSpectrum(ctx, breedte, hoogte, analyse);
  } else if (MODI[modusIndex] === "Oscilloscoop") {
    tekenOscilloscoop(ctx, breedte, hoogte, analyse, nu);
  } else {
    tekenTunnel(ctx, breedte, hoogte, analyse, nu);
  }
}

/** Zolang er geen geluidsbron is: een rustige golf met uitleg. */
function tekenWachtscherm(ctx, breedte, hoogte, nu) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, breedte, hoogte);

  ctx.strokeStyle = "rgba(60, 255, 110, 0.45)";
  ctx.lineWidth = Math.max(1, hoogte / 300);
  ctx.beginPath();
  for (let x = 0; x <= breedte; x += 4) {
    const golf = Math.sin((x / breedte) * Math.PI * 6 + nu / 700) * Math.sin(nu / 1300);
    const y = hoogte * 0.6 + golf * hoogte * 0.08;
    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  const letterGrootte = Math.round(Math.min(hoogte / 12, breedte / 24));
  ctx.textAlign = "center";
  ctx.fillStyle = "#3cff6e";
  ctx.font = letterGrootte + "px VT323, monospace";
  ctx.fillText("Kies 🎤 Microfoon of 🖥 Tabblad-audio", breedte / 2, hoogte * 0.3);
  ctx.fillStyle = "#1c9a45";
  ctx.font = Math.round(letterGrootte * 0.75) + "px VT323, monospace";
  ctx.fillText("dan beweegt dit scherm mee op de beat", breedte / 2, hoogte * 0.3 + letterGrootte);
}

/** Klassieke balken met vallende piekjes. */
function tekenSpectrum(ctx, breedte, hoogte, analyse) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, breedte, hoogte);
  if (analyse.beatKracht > 0.05) {
    ctx.fillStyle = "rgba(40, 255, 90, " + 0.12 * analyse.beatKracht + ")";
    ctx.fillRect(0, 0, breedte, hoogte);
  }

  const waarden = balkWaarden(AANTAL_BALKEN);
  const ruimte = breedte / AANTAL_BALKEN;
  const balkBreedte = ruimte * 0.75;
  const piekDikte = Math.max(2, hoogte / 120);

  const verloop = ctx.createLinearGradient(0, hoogte, 0, 0);
  verloop.addColorStop(0, "#00b800");
  verloop.addColorStop(0.6, "#e6e600");
  verloop.addColorStop(1, "#ff2a00");

  for (let i = 0; i < AANTAL_BALKEN; i++) {
    const x = i * ruimte + (ruimte - balkBreedte) / 2;
    const balkHoogte = waarden[i] * hoogte * 0.95;
    ctx.fillStyle = verloop;
    ctx.fillRect(x, hoogte - balkHoogte, balkBreedte, balkHoogte);

    // Het piekje zakt langzaam terug als de balk lager wordt.
    pieken[i] = Math.max(waarden[i], pieken[i] - 0.006);
    ctx.fillStyle = "#d8d8d8";
    ctx.fillRect(x, hoogte - pieken[i] * hoogte * 0.95 - piekDikte, balkBreedte, piekDikte);
  }

  // Zwarte streepjes eroverheen geven het "LED-blokjes"-effect.
  const segment = Math.max(4, hoogte / 40);
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  for (let y = hoogte; y > 0; y -= segment) {
    ctx.fillRect(0, y - 1, breedte, Math.max(1, segment * 0.25));
  }
}

/** De geluidsgolf als lijn, die dikker en feller wordt op de beat. */
function tekenOscilloscoop(ctx, breedte, hoogte, analyse, nu) {
  // Half doorzichtig zwart: zo blijft er een spoor van vorige beeldjes.
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fillRect(0, 0, breedte, hoogte);

  const kleur = (nu / 30 + aantalBeats * 50) % 360;
  ctx.strokeStyle = "hsl(" + kleur + ", 100%, " + (55 + 25 * analyse.beatKracht) + "%)";
  ctx.lineWidth = Math.max(2, hoogte / 200) * (1 + 3 * analyse.beatKracht);
  ctx.beginPath();

  const aantalPunten = golfvorm.length / 2; // half venster = iets ingezoomd
  for (let x = 0; x <= breedte; x += 2) {
    const index = Math.floor((x / breedte) * (aantalPunten - 1));
    const uitslag = (golfvorm[index] - 128) / 128;
    const y = hoogte / 2 + uitslag * hoogte * 0.45 * (1 + 0.3 * analyse.beatKracht);
    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

/** Een draaiende tunnel: elk beeldje is het vorige, iets vergroot en gedraaid. */
function tekenTunnel(ctx, breedte, hoogte, analyse, nu) {
  if (!tunnelBuffer || tunnelBuffer.width !== breedte || tunnelBuffer.height !== hoogte) {
    tunnelBuffer = document.createElement("canvas");
    tunnelBuffer.width = breedte;
    tunnelBuffer.height = hoogte;
  }
  // 1. Kopie maken van het vorige beeldje.
  const buffer = tunnelBuffer.getContext("2d");
  buffer.clearRect(0, 0, breedte, hoogte);
  buffer.drawImage(ctx.canvas, 0, 0);

  // Elke 8 beats draait de tunnel de andere kant op.
  if (analyse.beat && aantalBeats % 8 === 0) {
    tunnelDraai = -tunnelDraai;
  }

  // 2. Die kopie iets groter en gedraaid terugzetten: zo ontstaat de tunnel.
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, breedte, hoogte);
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.translate(breedte / 2, hoogte / 2);
  ctx.rotate(tunnelDraai * (1 + 4 * analyse.beatKracht));
  const schaal = 1.025 + 0.06 * analyse.beatKracht;
  ctx.scale(schaal, schaal);
  ctx.translate(-breedte / 2, -hoogte / 2);
  ctx.drawImage(tunnelBuffer, 0, 0);
  ctx.restore();

  // 3. In het midden een nieuwe ring tekenen, gevormd door de geluidsgolf.
  const kleur = (nu / 25 + aantalBeats * 37) % 360;
  const straal = Math.min(breedte, hoogte) * (0.12 + 0.1 * analyse.beatKracht);
  ctx.strokeStyle = "hsl(" + kleur + ", 100%, 60%)";
  ctx.lineWidth = Math.max(2, hoogte / 250) * (1 + 2 * analyse.beatKracht);
  ctx.beginPath();
  const punten = 128;
  for (let k = 0; k < punten; k++) {
    const hoek = (k / punten) * Math.PI * 2;
    const index = Math.floor((k / punten) * (golfvorm.length / 2));
    const r = straal * (1 + ((golfvorm[index] - 128) / 128) * 0.6);
    const x = breedte / 2 + Math.cos(hoek) * r;
    const y = hoogte / 2 + Math.sin(hoek) * r;
    if (k === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.stroke();

  // Een gloed in het midden direct na een beat.
  if (analyse.beatKracht > 0.6) {
    ctx.fillStyle = "hsla(" + kleur + ", 100%, 70%, " + 0.3 * analyse.beatKracht + ")";
    ctx.beginPath();
    ctx.arc(breedte / 2, hoogte / 2, straal * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Het kleine spectrum in het display (19 balkjes, pixel-stijl). */
export function tekenMiniSpectrum(ctx, analyse) {
  const breedte = ctx.canvas.width;
  const hoogte = ctx.canvas.height;
  ctx.clearRect(0, 0, breedte, hoogte);

  let waarden = new Array(MINI_BALKEN).fill(0);
  if (analyse.actief) {
    waarden = balkWaarden(MINI_BALKEN);
  }

  for (let i = 0; i < MINI_BALKEN; i++) {
    const x = i * 4;
    const balkHoogte = Math.round(waarden[i] * hoogte);
    for (let y = 0; y < balkHoogte; y++) {
      if (y > hoogte * 0.75) {
        ctx.fillStyle = "#ff3a1a";
      } else if (y > hoogte * 0.5) {
        ctx.fillStyle = "#e6e600";
      } else {
        ctx.fillStyle = "#2be04f";
      }
      ctx.fillRect(x, hoogte - 1 - y, 3, 1);
    }

    miniPieken[i] = Math.max(waarden[i], miniPieken[i] - 0.02);
    ctx.fillStyle = analyse.actief ? "#bbbbbb" : "#1a4a26";
    ctx.fillRect(x, hoogte - 1 - Math.round(miniPieken[i] * (hoogte - 1)), 3, 1);
  }
}
