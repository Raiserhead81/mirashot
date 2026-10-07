'use strict';
/* Bildschirm-Tab + Fallback-Diagnose. Modi:
   default       — Tab-Wechsel, Button-Klick (headless lehnt ab -> Meldung muss SICHTBAR sein), Upload, Drag&Drop
   --pick        — zusätzlich getDisplayMedia mit Auto-Pick (vollständiger Live-Flow) */
const { chromium } = require('playwright');

const URL = process.env.MIRA_URL || 'http://127.0.0.1:3199/';
const WITH_PICK = process.argv.includes('--pick');
const results = [];
function check(name, ok, detail) {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: WITH_PICK ? ['--auto-select-desktop-capture-source=Entire-screen'] : [],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console.error] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

  // 1) Init sauber?
  check('Keine JS-Fehler beim Laden', errors.length === 0, errors.join(' | ').slice(0, 160));

  // 2) Tab-Wechsel
  await page.click('.tab[data-tab="screen"]');
  await page.waitForTimeout(200);
  const tab = await page.evaluate(() => ({
    screenVisible: !!document.querySelector('#screenPanel').offsetParent,
    urlHidden: document.querySelector('#urlPanel').classList.contains('hidden'),
  }));
  check('Tab "Bildschirm" zeigt Panel', tab.screenVisible && tab.urlHidden);

  // 3) Button-Klick in headless (lehnt ab) → Meldung MUSS sichtbar sein
  await page.click('#screenBtn');
  await page.waitForTimeout(1200);
  const msg = await page.evaluate(() => {
    const el = document.querySelector('#screenStatus');
    return { text: el.textContent.trim(), visible: !!el.offsetParent, cls: el.className };
  });
  check('Fehlermeldung SICHTBAR nach blockierter Aufnahme', msg.visible && msg.text.length > 10 && msg.cls.includes('err'), msg.cls + ' | ' + msg.text.slice(0, 80));

  // 4) Upload-Pfad (Datei-Auswahl)
  await page.setInputFiles('#fileInput', '/tmp/nonce.png');
  await page.waitForTimeout(800);
  const up = await page.evaluate(() => ({
    editorVisible: !document.querySelector('#editorSection').classList.contains('hidden'),
    canvasSize: [document.querySelector('#editorCanvas').width, document.querySelector('#editorCanvas').height],
  }));
  check('Upload lädt Bild in Editor', up.editorVisible && up.canvasSize[0] === 420, `canvas=${up.canvasSize}`);

  // 5) Drag&Drop auf den Editor-Canvas (Bild ersetzen)
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 500;
    const x = c.getContext('2d');
    x.fillStyle = '#88aaff'; x.fillRect(0, 0, 1000, 500);
    x.font = '60px system-ui'; x.fillStyle = '#000'; x.fillText('DRAGDROP-OK', 250, 270);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'dragdrop-test.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const canvas = document.querySelector('#editorCanvas');
    for (const type of ['dragenter', 'dragover', 'drop']) {
      canvas.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  });
  await page.waitForTimeout(800);
  const drop = await page.evaluate(() => ({
    canvasSize: [document.querySelector('#editorCanvas').width, document.querySelector('#editorCanvas').height],
  }));
  check('Drag&Drop auf Canvas ersetzt Bild (1000x500)', drop.canvasSize[0] === 1000 && drop.canvasSize[1] === 500, `canvas=${drop.canvasSize}`);

  // 6) Zurück zum Tab + Drag&Drop aufs DropZone-Panel
  await page.click('#backBtn');
  await page.click('.tab[data-tab="screen"]');
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 320;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 640, 320);
    x.font = '40px system-ui'; x.fillStyle = '#c00'; x.fillText('DZ-FALLBACK', 180, 170);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'dz-fallback.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const dz = document.querySelector('#dropZone');
    for (const type of ['dragenter', 'dragover', 'drop']) {
      dz.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  });
  await page.waitForTimeout(800);
  const dzRes = await page.evaluate(() => ({
    editorVisible: !document.querySelector('#editorSection').classList.contains('hidden'),
    canvasSize: [document.querySelector('#editorCanvas').width, document.querySelector('#editorCanvas').height],
  }));
  check('Drag&Drop aufs Drop-Feld lädt Editor', dzRes.editorVisible && dzRes.canvasSize[0] === 640, `canvas=${dzRes.canvasSize}`);

  // 7) getDisplayMedia-Flow: Stub mit ECHTEM MediaStream aus canvas.captureStream()
  await page.click('#backBtn');
  await page.click('.tab[data-tab="screen"]');
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 800; c.height = 600;
    const x = c.getContext('2d');
    x.fillStyle = '#2a2'; x.fillRect(0, 0, 800, 600);
    x.font = '70px system-ui'; x.fillStyle = '#fff'; x.fillText('CAPTURE-STREAM-OK', 120, 310);
    const stream = c.captureStream(30);
    navigator.mediaDevices.getDisplayMedia = () => Promise.resolve(stream);
  });
  await page.click('#screenBtn');
  await page.waitForTimeout(2500);
  const pick = await page.evaluate(() => ({
    editorVisible: !document.querySelector('#editorSection').classList.contains('hidden'),
    canvasSize: [document.querySelector('#editorCanvas').width, document.querySelector('#editorCanvas').height],
  }));
  check('getDisplayMedia-Flow (echter Stream) endet im Editor 800x600', pick.editorVisible && pick.canvasSize[0] === 800 && pick.canvasSize[1] === 600, `canvas=${pick.canvasSize}`);

  // 8) NotAllowedError -> macOS-Berechtigungshinweis sichtbar
  await page.click('#backBtn');
  await page.click('.tab[data-tab="screen"]');
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = () => Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
  });
  await page.click('#screenBtn');
  await page.waitForTimeout(400);
  const perm = await page.evaluate(() => {
    const el = document.querySelector('#screenStatus');
    return { text: el.textContent, visible: !!el.offsetParent };
  });
  check('NotAllowedError zeigt macOS-Berechtigungshinweis SICHTBAR', perm.visible && /Datenschutz & Sicherheit/.test(perm.text) && /Bildschirmaufnahme/.test(perm.text), perm.text.slice(0, 90));

  // 9) NotSupportedError -> Chrome/Edge-Hinweis sichtbar
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = () => Promise.reject(Object.assign(new Error('nope'), { name: 'NotSupportedError' }));
  });
  await page.click('#screenBtn');
  await page.waitForTimeout(400);
  const ns = await page.evaluate(() => {
    const el = document.querySelector('#screenStatus');
    return { text: el.textContent, visible: !!el.offsetParent };
  });
  check('NotSupportedError zeigt Chrome/Edge-Hinweis SICHTBAR', ns.visible && /Chrome oder Edge/.test(ns.text), ns.text.slice(0, 90));

  check('Keine JS-Fehler insgesamt', errors.length === 0, errors.join(' | ').slice(0, 200));

  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('TEST-CRASH:', e.message); process.exit(1); });
