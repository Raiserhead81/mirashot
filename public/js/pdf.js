'use strict';
/* MIRASHOT — minimaler PDF-Writer (vanilla JS, keine Abhängigkeiten, laeuft komplett lokal).
 * Erzeugt ein A4-hoch-PDF mit einer Seite pro Canvas: Bild eingepasst mittig,
 * dezente Seitenzahl unten (Helvetica = PDF-Standardfont, kein Download nötig). */

(function () {
  const A4W = 595.276; // pt
  const A4H = 841.89;
  const MARGIN = 42;

  function latin1(str) {
    const b = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xff;
    return b;
  }

  function concat(chunks) {
    let len = 0;
    for (const c of chunks) len += c.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  async function canvasToJpegBytes(canvas, quality) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality || 0.92));
    return new Uint8Array(await blob.arrayBuffer());
  }

  /**
   * @param {HTMLCanvasElement[]} canvases
   * @returns {Promise<Uint8Array>} fertiges PDF
   */
  async function build(canvases) {
    if (!canvases || !canvases.length) throw new Error('Keine Seiten übergeben');
    const chunks = [];
    const offsets = [];
    let pos = 0;
    const push = (data) => { chunks.push(data); pos += data.length; };
    const beginObj = (num) => { offsets[num] = pos; push(latin1(`${num} 0 obj\n`)); };

    // Kopf (Binär-Marker signaling >7bit)
    push(latin1('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));

    const N = canvases.length;
    // Objektnummern: 1 Catalog, 2 Pages, 3 Font; je Seite img=4+3i, content=5+3i, page=6+3i
    const imgObj = (i) => 4 + i * 3;
    const contentObj = (i) => 5 + i * 3;
    const pageObj = (i) => 6 + i * 3;

    beginObj(1);
    push(latin1('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'));

    beginObj(2);
    push(latin1(`<< /Type /Pages /Count ${N} /Kids [${canvases.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>\nendobj\n`));

    beginObj(3);
    push(latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n'));

    for (let i = 0; i < N; i++) {
      const jpeg = await canvasToJpegBytes(canvases[i]);
      const iw = canvases[i].width;
      const ih = canvases[i].height;
      const maxW = A4W - MARGIN * 2;
      const maxH = A4H - MARGIN * 2 - 26; // Platz fuer die Seitenzahl
      const scale = Math.min(maxW / iw, maxH / ih);
      const w = iw * scale;
      const h = ih * scale;
      const x = (A4W - w) / 2;
      const y = A4H - MARGIN - 18 - h;

      // Bild (JPEG = DCTDecode)
      beginObj(imgObj(i));
      push(latin1(`<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`));
      push(jpeg);
      push(latin1('\nendstream\nendobj\n'));

      // Seiteninhalt: Bild mittig + Seitenzahl
      const text = `Seite ${i + 1} von ${N}`;
      const tx = (A4W - text.length * 4.7) / 2;
      const content = `q\n${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${i} Do\nQ\nBT\n/F1 9 Tf\n0.45 0.45 0.45 rg\n1 0 0 1 ${tx.toFixed(2)} 26 Tm\n(${text}) Tj\nET\n`;
      beginObj(contentObj(i));
      push(latin1(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`));

      beginObj(pageObj(i));
      push(latin1(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4W.toFixed(2)} ${A4H.toFixed(2)}] /Resources << /XObject << /Im${i} ${imgObj(i)} 0 R >> /Font << /F1 3 0 R >> >> /Contents ${contentObj(i)} 0 R >>\nendobj\n`));
    }

    // xref-Tabelle
    const xrefPos = pos;
    const maxNum = pageObj(N - 1);
    let xref = `xref\n0 ${maxNum + 1}\n0000000000 65535 f \n`;
    for (let n = 1; n <= maxNum; n++) {
      xref += `${String(offsets[n] || 0).padStart(10, '0')} 00000 n \n`;
    }
    push(latin1(xref));
    push(latin1(`trailer\n<< /Size ${maxNum + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`));

    return concat(chunks);
  }

  window.MirashotPdf = { build };
})();
