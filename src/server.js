'use strict';
/**
 * MIRASHOT — Server.
 * Datenschutzmodell: Keine Cookies, kein Tracking, keine Persistenz.
 * Die angefragte URL wird NICHT geloggt (access log via nginx nutzt $uri, Body/Ausnahmen hier OHNE URL).
 */

const path = require('path');
const express = require('express');
const { checkUrl, resolveAndCheck } = require('./ssrf');
const { takeScreenshot, clampViewport, ShotBusy, NAV_TIMEOUT } = require('./shot');
const ai = require('./ai');

const app = express();
const PORT = Number(process.env.PORT || 3119);
const MAX_BODY = '12mb'; // Screenshots als base64 (Opt-in, nur auf Klick)

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: MAX_BODY }));

// Statische Auslieferung (keine CDNs, keine externen Requests der Seite selbst)
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', extensions: ['html'] }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Status der KI-Features (ohne Details zum Key)
app.get('/api/ai/status', (req, res) => {
  res.json({ ok: true, configured: ai.aiConfigured() });
});

app.get('/api/shot', async (req, res) => {
  const started = Date.now();
  const raw = String(req.query.url || '');
  const full = req.query.full === '1' || req.query.full === 'true';
  const vw = clampViewport(req.query.w, req.query.h);

  const check = checkUrl(raw);
  if (!check.ok) return res.status(400).json({ ok: false, error: check.reason });

  let resolved;
  try {
    resolved = await resolveAndCheck(check.url.hostname);
  } catch {
    return res.status(400).json({ ok: false, error: 'Name konnte nicht aufgelöst werden' });
  }
  if (!resolved.ok) return res.status(400).json({ ok: false, error: resolved.reason });

  try {
    const { buffer, contentType } = await takeScreenshot(check.url, {
      width: vw.width,
      height: vw.height,
      fullPage: full,
    });
    res.set('Content-Type', contentType);
    res.set('Content-Length', String(buffer.length));
    res.set('Cache-Control', 'no-store');
    res.set('X-Mirashot-Viewport', `${vw.width}x${vw.height}`);
    res.status(200).send(buffer);
    console.log(`[shot] ok bytes=${buffer.length} full=${full ? 1 : 0} ms=${Date.now() - started}`);
  } catch (err) {
    if (err instanceof ShotBusy) {
      return res.status(429).json({ ok: false, error: err.message });
    }
    const status = /Timeout|timeout|TIMEOUT/.test(String(err && err.message)) ? 504 : 502;
    console.log(`[shot] error status=${status} ms=${Date.now() - started}`);
    res.status(status).json({ ok: false, error: status === 504 ? 'Zeitüberschreitung beim Laden der Seite' : 'Screenshot fehlgeschlagen — Seite nicht erreichbar oder blockiert' });
  }
});

function aiHandler(fn) {
  return async (req, res) => {
    if (!ai.aiConfigured()) {
      return res.status(503).json({ ok: false, error: 'KI nicht konfiguriert' });
    }
    const image = req.body && req.body.image;
    if (!image || typeof image !== 'string' || image.length < 64) {
      return res.status(400).json({ ok: false, error: 'Kein Bild übergeben' });
    }
    try {
      const result = await fn(image);
      res.json({ ok: true, ...result });
      console.log(`[ai] ${fn.name} ok`);
    } catch (err) {
      const status = err && err.status ? err.status : 500;
      console.log(`[ai] ${fn.name} error status=${status}`);
      res.status(status).json({ ok: false, error: err && err.message ? err.message : 'KI-Fehler' });
    }
  };
}

app.post('/api/ai/analyze', aiHandler(ai.analyze));
app.post('/api/ai/redact', aiHandler(ai.redactBoxes));
app.post('/api/ai/alt', aiHandler(ai.altText));

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Nicht gefunden' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'Bild zu groß' });
  }
  console.log(`[server] error status=500`);
  res.status(500).json({ ok: false, error: 'Interner Fehler' });
});

app.listen(PORT, () => {
  console.log(`[mirashot] listening on 127.0.0.1:${PORT} ai=${ai.aiConfigured() ? 'on' : 'off'} timeout=${NAV_TIMEOUT}ms`);
});
