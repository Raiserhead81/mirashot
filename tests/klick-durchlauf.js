'use strict';
/* MIRASHOT — kompletter Klick-Durchlauf (E2E).
   Webseite-Shot -> Editor -> Annotation -> Download, Bildschirm-Tab -> Drop-Fallback.
   Erwartet: 0 Konsolen-Fehler. Erzeugt optional Screenshots:
   MIRA_SHOTS=1  -> docs/redesign-start.png + docs/redesign-editor.png (Vollseite) */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.MIRA_URL || 'https://mirashot.gemivo.de/';
const WITH_SHOTS = process.env.MIRA_SHOTS === '1';
const results = [];
function check(name, ok, detail) {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message.slice(0, 140)));

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

  /* ---------- 1) Webseite ablichten ---------- */
  await page.fill('#urlInput', 'https://example.com');
  await page.click('#shotBtn');
  await page.waitForSelector('#editorSection:not(.hidden)', { timeout: 30000 });
  const shotState = await page.evaluate(() => ({
    canvasW: document.querySelector('#editorCanvas').width,
    canvasH: document.querySelector('#editorCanvas').height,
  }));
  check('Webseite-Shot landet im Editor (1280x800)', shotState.canvasW === 1280 && shotState.canvasH === 800, `canvas=${shotState.canvasW}x${shotState.canvasH}`);

  /* ---------- 2) Annotation: Stift + Rechteck + Schritt-Bubble ---------- */
  const box = await page.locator('#editorCanvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  await page.click('.tool[data-tool="pen"]');
  await page.mouse.move(cx - 200, cy - 80);
  await page.mouse.down();
  for (let i = 0; i <= 20; i++) await page.mouse.move(cx - 200 + i * 20, cy - 80 + Math.sin(i / 3) * 25);
  await page.mouse.up();

  await page.click('.tool[data-tool="rect"]');
  await page.mouse.move(cx - 120, cy - 60);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy + 60, { steps: 8 });
  await page.mouse.up();

  await page.click('.tool[data-tool="number"]');
  await page.mouse.click(cx + 180, cy - 100);

  const afterDraw = await page.evaluate(() => {
    // Undo-Schalter aktiv = History hat Einträge = Shapes committed
    return { undoEnabled: !document.querySelector('#undoBtn').disabled };
  });
  check('Annotationen gezeichnet (Undo aktiv)', afterDraw.undoEnabled);

  /* ---------- 3) Download über "Fertig" ---------- */
  const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
  await page.click('#doneBtn');
  const download = await downloadPromise;
  const fname = download.suggestedFilename();
  check('Download über "Fertig"', /^mirashot-example\.com-\d{4}-\d{2}-\d{2}-\d{4}\.png$/.test(fname), fname);
  const tmpDownload = path.join('/tmp', fname);
  await download.saveAs(tmpDownload);
  check('PNG-Datei > 20 KB', fs.statSync(tmpDownload).size > 20000, `${fs.statSync(tmpDownload).size} Bytes`);
  fs.unlinkSync(tmpDownload);

  /* ---------- 4) Bildschirm-Tab -> Drop-Fallback ---------- */
  await page.click('#backBtn');
  await page.click('.tab[data-tab="screen"]');
  const helpVisible = await page.evaluate(() => !document.querySelector('#pickerHelp').classList.contains('hidden'));
  check('Auswahl-Hilfe sichtbar', helpVisible);
  // Hilfe ausblenden + Persistenz prüfen
  await page.click('#helpDismiss');
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="screen"]');
  const helpHiddenAfterReload = await page.evaluate(() => document.querySelector('#pickerHelp').classList.contains('hidden'));
  check('Auswahl-Hilfe bleibt ausgeblendet (Persistenz)', helpHiddenAfterReload);

  await page.setInputFiles('#fileInput', '/tmp/nonce.png');
  await page.waitForSelector('#editorSection:not(.hidden)', { timeout: 15000 });
  const dropState = await page.evaluate(() => ({
    canvasW: document.querySelector('#editorCanvas').width,
    editorStatus: document.querySelector('#editorStatus').textContent.trim(),
  }));
  check('Drop-Fallback lädt Bild in Editor', dropState.canvasW === 420, `canvas=${dropState.canvasW}W`);

  /* ---------- 5) Theme-Toggle ---------- */
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme || 'light');
  await page.click('#themeToggle');
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
  check('Theme-Toggle schaltet auf dunkel', themeBefore === 'light' && themeAfter === 'dark');
  await page.click('#themeToggle');
  const themeBack = await page.evaluate(() => document.documentElement.dataset.theme);
  check('Theme-Toggle zurückschaltet', themeBack === 'light');

  /* ---------- 6) Konsolen-Fehler ---------- */
  check('0 Konsolen-/Seiten-Fehler im gesamten Durchlauf', errors.length === 0, errors.join(' | ').slice(0, 200));

  /* ---------- Screenshots ---------- */
  if (WITH_SHOTS) {
    fs.mkdirSync(path.join(__dirname, '..', 'docs'), { recursive: true });
    // Startseite (hell, Vollseite)
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'redesign-start.png'), fullPage: true });
    // Editor-Ansicht mit Bild + Annotationen (Vollseite)
    await page.setInputFiles('#fileInput', '/tmp/nonce.png');
    await page.waitForSelector('#editorSection:not(.hidden)', { timeout: 15000 });
    const b2 = await page.locator('#editorCanvas').boundingBox();
    await page.click('.tool[data-tool="pen"]');
    await page.mouse.move(b2.x + b2.width * 0.3, b2.y + b2.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(b2.x + b2.width * 0.7, b2.y + b2.height * 0.55, { steps: 12 });
    await page.mouse.up();
    await page.click('.tool[data-tool="number"]');
    await page.mouse.click(b2.x + b2.width * 0.75, b2.y + b2.height * 0.25);
    await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'redesign-editor.png'), fullPage: true });
    // Bonus: dunkle Startseite
    await page.click('#backBtn');
    await page.click('#themeToggle');
    await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'redesign-start-dark.png'), fullPage: true });
    check('Screenshots geschrieben (start/editor/start-dark)', fs.existsSync(path.join(__dirname, '..', 'docs', 'redesign-start.png')) && fs.existsSync(path.join(__dirname, '..', 'docs', 'redesign-editor.png')));
  }

  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('TEST-CRASH:', e.message); process.exit(1); });
