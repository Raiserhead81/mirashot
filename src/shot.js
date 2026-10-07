'use strict';
/**
 * MIRASHOT — Webseiten-Screenshots via Playwright (Chromium headless).
 * Max. 3 parallel, Rest in Warteschlange; volle Queue => HTTP 429 (wirft ShotBusy).
 * Es wird nichts gespeichert und die URL nie geloggt.
 */

const { chromium } = require('playwright');

const MAX_PARALLEL = Number(process.env.SHOT_MAX_PARALLEL || 3);
const QUEUE_LIMIT = Number(process.env.SHOT_QUEUE_LIMIT || 12);
const NAV_TIMEOUT = Number(process.env.SHOT_TIMEOUT_MS || 20000);

let active = 0;
const queue = [];

class ShotBusy extends Error {
  constructor() {
    super('Server ausgelastet, bitte kurz erneut versuchen');
    this.status = 429;
  }
}

function acquire() {
  if (active < MAX_PARALLEL) {
    active += 1;
    return Promise.resolve();
  }
  if (queue.length >= QUEUE_LIMIT) throw new ShotBusy();
  return new Promise((resolve, reject) => queue.push({ resolve, reject }));
}

function release() {
  const next = queue.shift();
  if (next) next.resolve();
  else active = Math.max(0, active - 1);
}

function clampViewport(w, h) {
  const c = (v, d) => {
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n)) return d;
    return Math.min(3840, Math.max(320, n));
  };
  return { width: c(w, 1280), height: c(h, 800) };
}

/**
 * @param {URL} url geprüfte Ziel-URL (aus ssrf.checkUrl, DNS bereits verifiziert)
 * @param {{width:number, height:number, fullPage:boolean}} opts
 * @returns {Promise<{buffer:Buffer, contentType:string}>}
 */
async function takeScreenshot(url, opts) {
  await acquire();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--disable-features=Translate',
      ],
    });
    const context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: 1,
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
      // Bewusst ohne Login/Cookies aus früheren Läufen
      bypassCSP: false,
      javaScriptEnabled: true,
    });
    context.setDefaultNavigationTimeout(NAV_TIMEOUT);
    const page = await context.newPage();

    await page.goto(url.toString(), {
      waitUntil: 'load',
      timeout: NAV_TIMEOUT,
      referer: undefined,
    });
    // Ruhe geben fuer spate Renders, aber hart begrenzt
    await page.waitForTimeout(600).catch(() => {});
    const buffer = await page.screenshot({
      type: 'png',
      fullPage: !!opts.fullPage,
      timeout: NAV_TIMEOUT,
      animations: 'disabled',
      caret: 'hide',
    });
    await context.close().catch(() => {});
    return { buffer, contentType: 'image/png' };
  } finally {
    if (browser) await browser.close().catch(() => {});
    release();
  }
}

module.exports = { takeScreenshot, clampViewport, ShotBusy, NAV_TIMEOUT };
