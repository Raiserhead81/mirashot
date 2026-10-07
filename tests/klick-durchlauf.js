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
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`;
  results.push(line);
  console.log(line);
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
  // WICHTIG: Box nach JEDEM Klick neu messen (Klicks koennen die Seite scrollen)
  const canvasBox = async () => page.locator('#editorCanvas').boundingBox();

  await page.click('.tool[data-tool="pen"]');
  let box = await canvasBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  for (let i = 0; i <= 20; i++) await page.mouse.move(box.x + box.width * 0.2 + i * (box.width * 0.6 / 20), box.y + box.height * 0.3 + Math.sin(i / 3) * 25);
  await page.mouse.up();

  await page.click('.tool[data-tool="rect"]');
  box = await canvasBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.7, { steps: 8 });
  await page.mouse.up();

  await page.click('.tool[data-tool="number"]');
  box = await canvasBox();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.25);

  const afterDraw = await page.evaluate(() => {
    // Undo-Schalter aktiv = History hat Einträge = Shapes committed
    return { undoEnabled: !document.querySelector('#undoBtn').disabled };
  });
  check('Annotationen gezeichnet (Undo aktiv)', afterDraw.undoEnabled);

  /* ---------- 2b) Bearbeiten-Modus: Auswahl, Verschieben, Endgriff, Umfärben, Löschen ---------- */
  const ed = () => page.evaluate(() => {
    const e = window.__mirashotEditor;
    return {
      sel: e.selected,
      shapes: e.shapes.map((x) => ({
        type: x.type, x: x.x, y: x.y, color: x.color, text: x.text, width: x.width,
        p0: x.points ? { ...x.points[0] } : null, p1: x.points ? { ...x.points[1] } : null,
      })),
    };
  });

  // Text erzeugen
  await page.click('.tool[data-tool="text"]');
  let box2 = await canvasBox();
  await page.mouse.click(box2.x + box2.width * 0.18, box2.y + box2.height * 0.82);
  await page.waitForSelector('.tool-text-input', { timeout: 5000 });
  await page.keyboard.type('Hallo Prüfung');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(150);

  // Pfeil erzeugen (links -> rechts)
  await page.click('.tool[data-tool="arrow"]');
  box2 = await canvasBox();
  await page.mouse.move(box2.x + box2.width * 0.5, box2.y + box2.height * 0.9);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width * 0.72, box2.y + box2.height * 0.9, { steps: 5 });
  await page.mouse.up();

  await page.click('.tool[data-tool="select"]');
  box2 = await canvasBox();
  // a) Text anklicken = auswählen
  await page.mouse.click(box2.x + box2.width * 0.18, box2.y + box2.height * 0.82);
  let st = await ed();
  const textIdx = st.sel;
  const textBefore = textIdx != null ? { ...st.shapes[textIdx] } : null;
  check('Bearbeiten: Text ausgewählt', textIdx != null && st.shapes[textIdx].type === 'text', 'sel=' + st.sel);

  // b) Text verschieben
  await page.mouse.move(box2.x + box2.width * 0.18, box2.y + box2.height * 0.82);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width * 0.18 + 80, box2.y + box2.height * 0.82 + 40, { steps: 6 });
  await page.mouse.up();
  st = await ed();
  const movedText = st.shapes[textIdx];
  check('Bearbeiten: Text verschoben', movedText && textBefore
    && Math.abs(movedText.x - textBefore.x) + Math.abs(movedText.y - textBefore.y) > 20,
    `dx=${(movedText.x - textBefore.x).toFixed(0)} dy=${(movedText.y - textBefore.y).toFixed(0)}`);

  // c) Doppelklick öffnet Textfeld mit Inhalt
  await page.mouse.dblclick(box2.x + box2.width * 0.18 + 80, box2.y + box2.height * 0.82 + 40);
  const ta = page.locator('.tool-text-input');
  const prefill = await ta.inputValue();
  check('Bearbeiten: Doppelklick zeigt bestehenden Text', prefill === 'Hallo Prüfung', prefill);
  await page.fill('.tool-text-input', 'Geändert'); // ersetzt Inhalt (löst input-Event aus)
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(150);
  st = await ed();
  check('Bearbeiten: Text geändert', st.shapes[textIdx] && st.shapes[textIdx].text === 'Geändert', (st.shapes[textIdx] || {}).text);

  // d) Objekt umfärben (Text noch selektiert? -> erneut selektieren)
  await page.mouse.click(box2.x + box2.width * 0.18 + 80, box2.y + box2.height * 0.82 + 40);
  st = await ed();
  if (st.sel == null || st.shapes[st.sel].type !== 'text') {
    // Position nach dem Verschieben trifft evtl. nicht exakt -> über Editor-API selektieren
    await page.evaluate((i) => { const e = window.__mirashotEditor; e.selected = i; e.tool = 'select'; e.render(); }, st.shapes.findIndex((x) => x.type === 'text'));
  }
  await page.click('#swatches .swatch:nth-child(2)'); // Blau
  st = await ed();
  check('Bearbeiten: Farbe auf Auswahl angewendet', st.shapes.some((x) => x.type === 'text' && x.color === '#1f3a5f'), (st.shapes.find((x) => x.type === 'text') || {}).color);

  // e) Pfeil umdrehen via Endpunkt-Griff
  st = await ed();
  const arrowIdx = st.shapes.findIndex((x) => x.type === 'arrow');
  const arrowBefore = st.shapes[arrowIdx];
  check('Pfeil erzeugt (links->rechts)', arrowBefore && arrowBefore.p0.x < arrowBefore.p1.x);
  box2 = await canvasBox();
  const sx = box2.width / (await page.evaluate(() => window.__mirashotEditor.canvas.width));
  const sy = box2.height / (await page.evaluate(() => window.__mirashotEditor.canvas.height));
  // Arrow selektieren: Klick auf Pfeilmitte
  const mid = { x: (arrowBefore.p0.x + arrowBefore.p1.x) / 2, y: (arrowBefore.p0.y + arrowBefore.p1.y) / 2 };
  await page.mouse.click(box2.x + mid.x * sx, box2.y + mid.y * sy);
  st = await ed();
  check('Bearbeiten: Pfeil ausgewählt', st.sel === arrowIdx, 'sel=' + st.sel);
  // Endpunkt B fassen und hinter A ziehen (umdrehen)
  await page.mouse.move(box2.x + arrowBefore.p1.x * sx, box2.y + arrowBefore.p1.y * sy);
  await page.mouse.down();
  await page.mouse.move(box2.x + (arrowBefore.p0.x - 120 / sx) * sx, box2.y + arrowBefore.p0.y * sy, { steps: 8 });
  await page.mouse.up();
  st = await ed();
  const arrowAfter = st.shapes[arrowIdx];
  check('Bearbeiten: Pfeil umgedreht (Endgriff)', arrowAfter.p1.x < arrowAfter.p0.x, `p0.x=${arrowAfter.p0.x} p1.x=${arrowAfter.p1.x}`);

  // f) Löschen mit Entf-Taste + Undo
  const countBefore = (await ed()).shapes.length;
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
  st = await ed();
  check('Bearbeiten: Entf löscht Objekt', st.shapes.length === countBefore - 1 && !st.shapes.some((x) => x.type === 'arrow'));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  st = await ed();
  check('Bearbeiten: Undo stellt Pfeil wieder her', st.shapes.some((x) => x.type === 'arrow'));

  /* ---------- 3) Download über "Herunterladen" ---------- */
  /* ---------- 4) Download ---------- */
  const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
  await page.click('#downloadBtn');
  const download = await downloadPromise;
  const fname = download.suggestedFilename();
  check('Download über "Herunterladen"', /^mirashot-example\.com-\d{4}-\d{2}-\d{2}-\d{4}\.png$/.test(fname), fname);
  const tmpDownload = path.join('/tmp', fname);
  await download.saveAs(tmpDownload);
  check('PNG-Datei > 20 KB', fs.statSync(tmpDownload).size > 20000, `${fs.statSync(tmpDownload).size} Bytes`);
  fs.unlinkSync(tmpDownload);


  /* ---------- 3b) Sammelmappe + PDF ---------- */
  await page.click('#addToMappeBtn');
  // Neue Aufnahme verwirft die Mappe nicht: zweite Seite aufnehmen
  await page.click('#backBtn');
  await page.click('.tab[data-tab="screen"]');
  await page.setInputFiles('#fileInput', '/tmp/nonce.png');
  await page.waitForSelector('#editorSection:not(.hidden)', { timeout: 15000 });
  await page.click('#addToMappeBtn');
  const mappeState = await page.evaluate(() => ({
    n: window.__mirashotMappe.length,
    visible: !document.querySelector('#mappeBar').classList.contains('hidden'),
    countText: document.querySelector('#mappeCount').textContent,
  }));
  check('Mappe: 2 Seiten, Leiste sichtbar', mappeState.n === 2 && mappeState.visible && /2 Seiten/.test(mappeState.countText), mappeState.countText);

  // Thumbnail-Klick lädt Seite 1 (annotierter Website-Shot, 1280 breit) zurück
  await page.click('#mappeThumbs .thumb:first-child img');
  await page.waitForTimeout(250);
  const backW = await page.evaluate(() => window.__mirashotEditor.canvas.width);
  check('Mappe: Thumbnail lädt Seite in Editor', backW === 1280, `canvas=${backW}`);

  // PDF der ganzen Mappe erzeugen
  const pdfPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#pdfBtn');
  const pdfDl = await pdfPromise;
  check('PDF-Download startet', /\.pdf$/.test(pdfDl.suggestedFilename()), pdfDl.suggestedFilename());
  await pdfDl.saveAs('/tmp/mirashot-mappe.pdf');
  const pdfBuf = fs.readFileSync('/tmp/mirashot-mappe.pdf');
  const pdfStr = pdfBuf.toString('latin1');
  check('PDF: Header %PDF-1.4', pdfStr.startsWith('%PDF-1.4'));
  check('PDF: Seitenzahl == 2', /\/Count 2 /.test(pdfStr));
  check('PDF: 2 eingebettete JPEG-Bilder', (pdfStr.match(/\/Subtype \/Image/g) || []).length === 2);
  check('PDF: xref + %%EOF', pdfStr.includes('startxref') && pdfStr.trimEnd().endsWith('%%EOF'));
  check('PDF: plausible Größe', pdfBuf.length > 20000 && pdfBuf.length < 30 * 1024 * 1024, `${(pdfBuf.length / 1024).toFixed(0)} KB`);

  // Chromium verarbeitet die Datei fehlerfrei (Laden oder sauberer PDF-Download)
  const pdfPage = await browser.newPage();
  let chromiumPdf = false;
  pdfPage.on('download', (d) => { if (d.suggestedFilename().endsWith('.pdf')) chromiumPdf = true; });
  try {
    await pdfPage.goto('file:///tmp/mirashot-mappe.pdf', { timeout: 8000, waitUntil: 'load' });
    chromiumPdf = true;
  } catch { /* Download statt Anzeige gilt auch als "fehlerfrei verarbeitet" */ }
  await pdfPage.close();
  check('PDF: Chromium lädt/verarbeitet Datei', chromiumPdf);

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
    await page.click('.tool[data-tool="pen"]');
    let b2 = await page.locator('#editorCanvas').boundingBox();
    await page.mouse.move(b2.x + b2.width * 0.3, b2.y + b2.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(b2.x + b2.width * 0.7, b2.y + b2.height * 0.55, { steps: 12 });
    await page.mouse.up();
    await page.click('.tool[data-tool="number"]');
    b2 = await page.locator('#editorCanvas').boundingBox();
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
