# Retrospeler

Een muziekspeler in jaren-'90-stijl in de webbrowser, gekoppeld aan Spotify, met een
visualisatie die meebeweegt op de beat.

## Bestanden

| Bestand | Wat doet het? |
|---------|---------------|
| `index.html` | De opbouw van de pagina (vensters, knoppen) |
| `style.css` | Het retro-uiterlijk |
| `app.js` | Koppelt alles aan elkaar: knoppen, display, afspeellijst |
| `spotify.js` | Inloggen bij Spotify en de Spotify Web API |
| `visualisatie.js` | Luistert mee met het geluid, zoekt de beat en tekent de beelden |
| `config.js` | Hier zet je je eigen Spotify Client ID |
| `start.bat` | Start de speler met één dubbelklik |

## Eenmalig instellen

Je hebt **Spotify Premium** nodig om in de browser af te spelen.

1. Ga naar <https://developer.spotify.com/dashboard> en log in.
2. Klik op **Create app** en vul in:
   - **App name**: Retrospeler (of iets anders)
   - **App description**: wat je wilt
   - **Redirect URI**: `http://127.0.0.1:8888/` (en klik op *Add*).
     Gebruik precies dit adres, met de `/` aan het eind. Spotify accepteert `localhost` niet meer.
   - Vink **Web API** en **Web Playback SDK** aan.
3. Sla op, open de app en kopieer de **Client ID**.
4. Plak die in `config.js`:
   ```js
   export const CLIENT_ID = "jouw-client-id-hier";
   ```

Een nieuwe Spotify-app staat in *ontwikkelmodus*: alleen jij (en wie je toevoegt onder
*User Management*) kan ermee inloggen. Voor eigen gebruik is dat precies goed.

## Starten

Dubbelklik op `start.bat`, of typ in deze map:

```
python -m http.server 8888 --bind 127.0.0.1
```

Open daarna **http://127.0.0.1:8888/** in Chrome of Edge en klik op *Inloggen bij Spotify*.

## Live zetten op je eigen server

De Retrospeler bestaat alleen uit losse bestanden (HTML, CSS, JavaScript). Er draait geen
programma op de server: elke webserver die bestanden kan aanbieden is genoeg (nginx,
Apache, een hostingpakket, enz.). Alles gebeurt in de browser van de bezoeker.

1. **HTTPS is verplicht.** Spotify accepteert alleen `https://`-adressen om naar terug te
   sturen, en browsers geven de microfoon alleen vrij op een beveiligde pagina. Een gratis
   certificaat krijg je met Let's Encrypt (`certbot`).
2. **Bestanden kopiëren.** Zet deze bestanden op de server, bijvoorbeeld in
   `/var/www/retrospeler`:
   `index.html`, `style.css`, `app.js`, `spotify.js`, `visualisatie.js`, `config.js`.
   (`start.bat`, `README.md` en de map `deploy` zijn niet nodig.)
3. **Webserver instellen.** Voor nginx staat een voorbeeld in
   `deploy/nginx-retrospeler.conf`, met uitleg bovenin.
4. **Spotify Dashboard.** Voeg bij je app een extra Redirect URI toe met het adres van je
   server, bijvoorbeeld `https://muziek.jouwdomein.nl/` (met `/` aan het eind). Het adres
   `http://127.0.0.1:8888/` mag blijven staan, dan werkt thuis testen ook nog. Dezelfde
   Client ID werkt voor beide adressen.

Weet je niet zeker welk adres je moet invullen? Open de speler op je server en kijk onder
de inlogknop: daar staat het terugstuur-adres precies zoals Spotify het verwacht.

**Wie kan er inloggen?** Een Spotify-app in ontwikkelmodus is alleen bruikbaar voor jou en
een paar mensen die je zelf toevoegt onder *User Management* in het Dashboard (en elke
gebruiker heeft Premium nodig). Openstellen voor iedereen kan alleen met goedkeuring van
Spotify, en die geven ze in de praktijk alleen aan bedrijven met heel veel gebruikers.

## De visualisatie

Spotify versleutelt het geluid, dus de pagina kan de muziek niet zelf "horen". Daarom
vangt de visualisatie het geluid opnieuw op. Je hebt twee keuzes:

- **🎤 Microfoon**: luistert naar de muziek uit je speakers. Werkt altijd, maar niet met een
  koptelefoon, en praten in de kamer telt ook mee.
- **🖥 Tabblad-audio** (Chrome/Edge): kies in het deelvenster *dit tabblad* en zet
  *Tabblad-audio delen* aan. Blijft de visualisatie stil? Dan wordt het versleutelde geluid
  geblokkeerd en kun je de microfoon gebruiken.

Klik op de visualisatie voor een andere modus (Spectrum, Oscilloscoop, Tunnel) en dubbelklik
voor volledig scherm. Het rode lampje in het display knippert op de beat en ernaast staat het
geschatte tempo (BPM).
