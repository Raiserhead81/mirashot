<p align="center">
  <img src="public/assets/icon.svg" alt="MIRASHOT" width="96" height="96">
</p>

<h1 align="center">MIRASHOT</h1>

<p align="center">
  <strong>Datenschutzkonforme Webseiten-Screenshots mit Annotation-Editor und optionalen KI-Features.</strong><br>
  Läuft in jedem Browser auf jedem Gerät. Keine Konten, keine Cookies, keine Speicherung.
</p>

<p align="center">
  <img alt="Lizenz" src="https://img.shields.io/badge/Lizenz-MIT-8b5cf6">
  <img alt="Stack" src="https://img.shields.io/badge/Stack-Node%20%2B%20Express%20%2B%20Playwright-22d3ee">
</p>

---

## Was ist MIRASHOT?

MIRASHOT erzeugt Screenshots von Webseiten (serverseitig, einmaliger Abruf) oder vom eigenen
Bildschirm (rein clientseitig) und lässt dich direkt im Browser annotieren — in voller
Bildauflösung, auf Desktop wie Touch. Der Name und das Orb-Gesicht stammen von
**MIRA**, der KI-Assistentin hinter dem Projekt.

## Features

**Aufnahme**
- *Webseite ablichten:* URL eingeben, PNG erhalten. Viewport einstellbar (320–3840 px), optional ganze Seite (`fullPage`).
- *Bildschirm:* `getDisplayMedia` — Tab, Fenster oder ganzer Bildschirm, vollständig im Browser. Feature-Detection: auf Geräten ohne Unterstützung (z. B. iOS Safari) ist der Tab sauber deaktiviert.

**Annotation-Editor (alles clientseitig)**
- Freihand, Pfeil, Linie, Rechteck, Ellipse
- Text/Kommentar-Tool (mehrzeilig, Umlaute, einstellbare Schriftgröße)
- Textmarker (multiplizierend, Text bleibt lesbar)
- Unschärfe- und Pixelate-Tool (Regionseffekt über dem Bild)
- Nummerierte Schritte (1/2/3-Bubbles, automatisch nummeriert)
- Radierer (entfernt das getroffene Annotation-Objekt)
- Undo/Redo (auch per Strg+Z / Strg+Y), Alles löschen
- 7 Farben (rot, grün, blau, gelb, orange, weiß, schwarz), Strichstärke-Slider
- Zeichnung in **voller Bildauflösung** (Canvas = Bildgröße, Anzeige nur skaliert)
- Download als `mirashot-<host>-<datum>.png`

**KI-Features (Opt-in, nur auf Klick)**
- *KI-Analyse:* deutschsprachige Beschreibung + 3–5 Beobachtungen, mit Kopieren-Button
- *Sensible Daten pixeln:* Vision-Modell liefert Bounding-Boxen (E-Mails, Telefonnummern, IBAN, Namen, Gesichter) → werden automatisch als Pixelate-Layer übernommen
- *Alt-Text kopieren:* kurze Bildbeschreibung direkt in die Zwischenablage
- Ohne konfigurierten Key: UI zeigt graceful „KI nicht konfiguriert“, alles andere funktioniert

## Datenschutz-Modell

- Screenshots werden **nur im Browser bearbeitet** — nichts wird hochgeladen oder gespeichert.
- URL-Shots: die Adresse wird **einmalig serverseitig abgerufen und niemals gespeichert oder geloggt** (nginx-Access-Log nur mit `$uri`, ohne Query-String).
- Keine Cookies, kein LocalStorage mit Nutzerinhalten, kein Analytics, keine externen CDNs/Fonts/Scripts (System-Font-Stack).
- SSRF-Schutz: nur http/https; blockiert localhost, 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, 0.0.0.0 u.a. — und prüft **nach DNS-Resolve jede Ziel-IP erneut**.
- KI-Nutzung passiert nur nach ausdrücklichem Klick; vorher wird im UI darauf hingewiesen, dass das Bild an einen KI-Dienst geht (Details: `/datenschutz`).

## API

| Endpoint | Beschreibung |
| --- | --- |
| `GET /api/health` | Liveness: `{"ok":true}` |
| `GET /api/shot?url=<url>&full=1&w=1280&h=800` | PNG-Stream. `full=1` = ganze Seite, `w`/`h` = Viewport (320–3840). Max. 3 parallel + Warteschlange, sonst `429`. Timeout 20 s. |
| `GET /api/ai/status` | `{"ok":true,"configured":bool}` |
| `POST /api/ai/analyze` | Body `{"image": "<dataURL>"}` → `{ok, description, observations[]}` |
| `POST /api/ai/redact` | Body `{"image": "<dataURL>"}` → `{ok, boxes:[{x,y,w,h,label}]}` (normalisiert 0–1) |
| `POST /api/ai/alt` | Body `{"image": "<dataURL>"}` → `{ok, alt}` |
| `GET /datenschutz` | Datenschutzerklärung (deutsch) inkl. KI-Abschnitt |

## Self-Hosting

```bash
git clone <repo-url> mirashot && cd mirashot
npm install
npx playwright install --with-deps chromium   # Systemdeps + Chromium
PORT=3119 npm start
```

### Konfiguration (Umgebungsvariablen)

| Variable | Default | Bedeutung |
| --- | --- | --- |
| `PORT` | `3119` | HTTP-Port |
| `AI_BASE_URL` | — | Basis-URL, OpenAI-kompatibel (z. B. `https://openrouter.ai/api/v1`) |
| `AI_API_KEY` | — | API-Key (verlässt den Server nie, wird nie geloggt) |
| `AI_MODEL` | — | Vision-Modell, z. B. `z-ai/glm-4.5v` |
| `SHOT_MAX_PARALLEL` | `3` | gleichzeitige Screenshots |
| `SHOT_QUEUE_LIMIT` | `12` | Warteschlange; voll → HTTP 429 |
| `SHOT_TIMEOUT_MS` | `20000` | Navigations-/Screenshot-Timeout |

Fehlen die drei `AI_*`-Variablen, bleiben die KI-Buttons deaktiviert und melden
„KI nicht konfiguriert“ — der Rest der App ist voll funktionsfähig.

### systemd (Beispiel)

```ini
[Unit]
Description=MIRASHOT
After=network.target

[Service]
WorkingDirectory=/opt/mirashot
ExecStart=/usr/bin/node src/server.js
Environment=PORT=3119
# EnvironmentFile=/etc/mirashot.env   # AI_BASE_URL / AI_API_KEY / AI_MODEL
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

## Entwicklung

```
src/server.js   Express-Server, Routes, Rate-Limiting
src/shot.js     Playwright-Screenshots, Parallelitäts-Queue
src/ssrf.js     URL-/DNS-/IP-Prüfung (SSRF-Schutz)
src/ai.js       KI-Client (OpenAI-kompatible Vision-Calls)
public/         Frontend (Editor, Tabs, Datenschutzseite) — vanilla JS, keine Builds
```

## Lizenz

MIT — siehe [LICENSE](LICENSE).
