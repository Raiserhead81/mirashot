'use strict';
/* MIRASHOT — App-Logik (Tabs, Aufnahme, Editor-Anbindung, KI). */

(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const statusEl = $('#captureStatus');
  const editorSection = $('#editorSection');
  const captureSection = $('#captureSection');

  let editor = null;
  let currentHost = 'mirashot';

  /* ---------- Theme (Hell = Default, Dunkel optional) ---------- */
  function initTheme() {
    let theme = 'light';
    try { theme = localStorage.getItem('mirashot-theme') === 'dark' ? 'dark' : 'light'; } catch { /* egal */ }
    applyTheme(theme);
    const t = $('#themeToggle');
    if (t) {
      t.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        try { localStorage.setItem('mirashot-theme', next); } catch { /* egal */ }
      });
    }
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const t = $('#themeToggle');
    if (t) t.textContent = theme === 'dark' ? 'Hell' : 'Dunkel';
  }

  /* ---------- Auswahl-Hilfe (Bildschirm-Tab, ausblendbar) ---------- */
  function initPickerHelp() {
    const help = $('#pickerHelp');
    if (!help) return;
    let hidden = false;
    try { hidden = localStorage.getItem('mirashot-hide-picker-help') === '1'; } catch { /* egal */ }
    help.classList.toggle('hidden', hidden);
    const d = $('#helpDismiss');
    if (d) {
      d.addEventListener('click', () => {
        help.classList.add('hidden');
        try { localStorage.setItem('mirashot-hide-picker-help', '1'); } catch { /* egal */ }
      });
    }
  }

  /* ---------- Status: immer im SICHTBAREN Bereich ausgeben ---------- */
  function statusTarget() {
    if (!editorSection.classList.contains('hidden')) return $('#editorStatus');
    if (!$('#screenPanel').classList.contains('hidden')) return $('#screenStatus');
    return statusEl; // #captureStatus im URL-Panel
  }

  function setStatus(msg, kind) {
    const el = statusTarget();
    el.className = 'status ' + (kind || 'info');
    el.innerHTML = msg;
  }

  function spin(msg) { setStatus(`<span class="spinner"></span>${msg}`, 'info'); }

  /* ---------- Tabs ---------- */
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $('#urlPanel').classList.toggle('hidden', tab.dataset.tab !== 'url');
      $('#screenPanel').classList.toggle('hidden', tab.dataset.tab !== 'screen');
      setStatus('', 'info');
    });
  });

  /* ---------- Tab 1: Webseite ablichten ---------- */
  $('#shotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('#urlInput').value.trim();
    if (!url) return;
    const full = $('#fullPage').checked ? '&full=1' : '';
    const w = $('#vpW').value || 1280;
    const h = $('#vpH').value || 800;
    spin('Seite wird abgelichtet …');
    $('#shotBtn').disabled = true;
    try {
      const res = await fetch(`/api/shot?url=${encodeURIComponent(url)}${full}&w=${w}&h=${h}`);
      if (!res.ok) {
        let msg = `Fehler (HTTP ${res.status})`;
        try { const j = await res.json(); if (j.error) msg = j.error; } catch { /* egal */ }
        if (res.status === 429) msg = 'Server ausgelastet — bitte einen Moment später erneut versuchen.';
        setStatus(msg, 'err');
        return;
      }
      const blob = await res.blob();
      await loadBlobIntoEditor(blob, hostOf(url));
      setStatus('Screenshot bereit — unten bearbeiten.', 'ok');
    } catch (err) {
      setStatus('Netzwerkfehler: ' + err.message, 'err');
    } finally {
      $('#shotBtn').disabled = false;
    }
  });

  function hostOf(u) {
    try { return new URL(u).hostname; } catch { return 'webseite'; }
  }

  async function loadBlobIntoEditor(blob, host) {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = dataUrl; });
    currentHost = host || 'mirashot';
    editor.setImage(img, currentHost);
    showEditor();
  }

  /* ---------- Tab 2: Bildschirm ---------- */
  function supportsScreenCapture() {
    return typeof navigator.mediaDevices !== 'undefined'
      && typeof navigator.mediaDevices.getDisplayMedia === 'function';
  }

  function initScreenTab() {
    const btn = $('#screenBtn');
    const hint = $('#screenHint');
    if (supportsScreenCapture()) {
      btn.addEventListener('click', captureScreen);
    } else {
      btn.disabled = true;
      hint.textContent = 'Dein Browser unterstützt keine Bildschirmaufnahme (z.B. iOS Safari). Nutze die Website-Ablichtung oder einen Desktop-Browser.';
      hint.classList.remove('hidden');
    }
  }

  async function captureScreen() {
    // Sofort sichtbare Meldung (Status erscheint im Bildschirm-Panel)
    setStatus('Browser-Dialog sollte offen sein — bitte Bildschirm/Fenster wählen …', 'info');
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
        selfBrowserSurface: 'exclude',   // unseren eigenen Tab gar nicht erst anbieten
        surfaceSwitching: 'include',     // Quelle kann während der Aufnahme gewechselt werden
      });
    } catch (err) {
      const name = (err && err.name) || '';
      if (name === 'NotAllowedError') {
        setStatus('Aufnahme abgebrochen oder blockiert. <strong>Am Mac fehlt oft die Bildschirm-Aufnahme-Berechtigung:</strong> Systemeinstellungen → Datenschutz &amp; Sicherheit → Bildschirmaufnahme → deinen Browser anstellen (dann Browser neu starten). Alternativ: Screenshot mit ⌘⇧4 machen und unten hierher ziehen.', 'err');
      } else if (name === 'NotSupportedError' || name === 'TypeError') {
        setStatus('Dieser Browser unterstützt keine Bildschirmaufnahme. <strong>Chrome oder Edge</strong> am Mac/Windows funktioniert. Alternativ: Screenshot mit ⌘⇧4 machen und unten in das Drop-Feld ziehen.', 'err');
      } else if (name === 'AbortError') {
        setStatus('Bildschirmaufnahme abgebrochen.', 'err');
      } else {
        setStatus('Aufnahme fehlgeschlagen: ' + (err && err.message ? err.message : name) + ' — Alternativ Screenshot (⌘⇧4) machen und unten in das Drop-Feld ziehen.', 'err');
      }
      return;
    }
    try {
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play().catch(() => {});
      // Warten bis echte Bilddaten ankommen (max. 3 s)
      const t0 = Date.now();
      while ((!video.videoWidth || !video.videoHeight) && Date.now() - t0 < 3000) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      if (!c.width || !c.height) throw new Error('Kein Bildinhalt empfangen');
      c.getContext('2d').drawImage(video, 0, 0);
      stream.getTracks().forEach((t) => t.stop());
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      await loadBlobIntoEditor(blob, 'bildschirm');
      let tip = '';
      try { if (!sessionStorage.getItem('mirashot-share-tip')) { tip = 'share-tip'; sessionStorage.setItem('mirashot-share-tip', '1'); } } catch { /* egal */ }
      setStatus('Bildschirmfoto bereit — rein lokal aufgenommen, nichts wurde übertragen.' + (tip ? ' <br><strong>Tipp fürs nächste Mal:</strong> Der Browser fragt aus Sicherheitsgründen bei jeder Aufnahme neu. Im Dialog steht deine zuletzt genutzte Quelle ganz oben; bei Tab-Freigabe „Dieses Mal und jedes Mal“ ankreuzen, falls angeboten. Die macOS-Freigabe (Datenschutz &amp; Sicherheit → Bildschirmaufnahme) gilt dauerhaft — danach bleibt nur noch der Klick.' : ''), 'ok');
    } catch (err) {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      setStatus('Aufnahme fehlgeschlagen: ' + err.message + ' — Alternativ Screenshot (⌘⇧4) machen und unten in das Drop-Feld ziehen.', 'err');
    }
  }

  /* ---------- Fallback: Datei-Upload + Drag & Drop (immer verfügbar) ---------- */
  async function loadFileIntoEditor(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) {
      setStatus('Keine Bilddatei: ' + file.name, 'err');
      return;
    }
    const label = (file.name || 'screenshot').replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9.-]+/gi, '-').slice(0, 40) || 'screenshot';
    await loadBlobIntoEditor(file, label);
    setStatus('Bild geladen: ' + file.name + ' — alles bleibt in deinem Browser.', 'ok');
  }

  function bindUploadFallback() {
    const dz = $('#dropZone');
    const input = $('#fileInput');
    if (!dz || !input) return;
    $('#uploadBtn').addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (f) loadFileIntoEditor(f);
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove('over');
    }));
    dz.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFileIntoEditor(f);
    });
    // Direkt auf den Editor-Canvas ziehen: Bild ersetzen
    const canvas = $('#editorCanvas');
    ['dragenter', 'dragover'].forEach((ev) => canvas.addEventListener(ev, (e) => e.preventDefault()));
    canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFileIntoEditor(f);
    });
  }

  /* ---------- Editor sichtbar schalten ---------- */
  function showEditor() {
    captureSection.classList.add('hidden');
    editorSection.classList.remove('hidden');
    editorSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('#backBtn').addEventListener('click', () => {
    editorSection.classList.add('hidden');
    captureSection.classList.remove('hidden');
    setStatus('', 'info');
  });

  /* ---------- Editor-Werkzeuge ---------- */
  const TOOL_ICONS = {
    pen: '<svg viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
    arrow: '<svg viewBox="0 0 24 24"><path d="M5 19L19 5"/><path d="M12 5h7v7"/><path d="M19 5l-4 0M19 5v4"/></svg>',
    line: '<svg viewBox="0 0 24 24"><path d="M4 20L20 4"/></svg>',
    rect: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/></svg>',
    ellipse: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="8.5" ry="6.5"/></svg>',
    text: '<svg viewBox="0 0 24 24"><path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/></svg>',
    highlight: '<svg viewBox="0 0 24 24"><path d="M4 17l3-3 5 5-3 3H4z"/><path d="M8 13l8.5-8.5a2.1 2.1 0 013 3L11 16"/></svg>',
    number: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M10 9.5a2 2 0 114 0c0 2-4 2.5-4 5h4.5"/><path d="M10 9.5v0"/></svg>',
    blur: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><circle cx="8" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="13" r="1.1" fill="currentColor" stroke="none"/><circle cx="16" cy="9.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="10" cy="15.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.1" fill="currentColor" stroke="none"/></svg>',
    pixel: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><path d="M8 9h3v3H8zM14 8h3v3h-3zM11 13h3v3h-3zM7 14h3v3H7zM15 14h2.5v2.5H15z" fill="currentColor" stroke="none"/></svg>',
    select: '<svg viewBox="0 0 24 24"><path d="M6 3l12 8-6.5 1.5L14 19l-2.5 1L9 14l-3 4z"/></svg>',
    eraser: '<svg viewBox="0 0 24 24"><path d="M7 20h13"/><path d="M6 16l5 4H6l-3-3 9.5-9.5a2 2 0 012.8 0l3.2 3.2a2 2 0 010 2.8L13 19"/></svg>',
  };
  const TOOL_LABELS = {
    pen: 'Stift', arrow: 'Pfeil', line: 'Linie', rect: 'Rechteck', ellipse: 'Ellipse',
    text: 'Text', highlight: 'Textmarker', number: 'Nummer', blur: 'Unscharf', pixel: 'Unkenntlich', eraser: 'Radierer',
    select: 'Bearbeiten',
  };
  // Reihenfolge: Zeile 1 = Bearbeiten/Stift/Pfeil/Textmarker/Text/Nummer, Zeile 2 = Unkenntlich/Rechteck/Ellipse/Linie/Unscharf/Radierer
  const ALL_TOOLS = ['select', 'pen', 'arrow', 'highlight', 'text', 'number', 'pixel', 'rect', 'ellipse', 'line', 'blur', 'eraser'];

  function makeToolButton(t) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool' + (t === 'pen' ? ' active' : '');
    b.dataset.tool = t;
    b.innerHTML = (TOOL_ICONS[t] || '') + `<span>${TOOL_LABELS[t] || t}</span>`;
    b.title = TOOL_LABELS[t] || t;
    b.addEventListener('click', () => {
      editor.tool = t;
      $$('#toolGrid .tool').forEach((x) => x.classList.toggle('active', x === b));
      $('#fontRow').classList.toggle('hidden', t !== 'text');
      $('#editorCanvas').style.cursor = t === 'text' ? 'text' : t === 'eraser' ? 'not-allowed' : 'crosshair';
    });
    return b;
  }

  function buildToolGrid() {
    const grid = $('#toolGrid');
    ALL_TOOLS.forEach((t) => grid.appendChild(makeToolButton(t)));
  }

  const COLORS = ['#d92d20', '#1f3a5f', '#111111', '#eab308']; // Rot, Blau, Schwarz, Gelb (Textmarker)
  function buildSwatches() {
    const box = $('#swatches');
    COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (i === 0 ? ' active' : '');
      b.style.background = c;
      b.title = c;
      b.dataset.color = c;
      b.addEventListener('click', () => {
        editor.color = c;
        $$('#swatches .swatch').forEach((x) => x.classList.toggle('active', x === b));
        if (editor.tool === 'select' && editor.selected != null && editor.shapes[editor.selected]) {
          editor.shapes[editor.selected].color = c;
          editor.commit(); // Klick = diskret = ein Undo-Schritt
        }
      });
      box.appendChild(b);
    });
  }

  function bindEditorControls() {
    // Bei ausgewähltem Objekt (Bearbeiten-Modus) Farbe/Strichstärke live ändern
    function applyToSelection(prop, value) {
      if (editor.tool === 'select' && editor.selected != null && editor.shapes[editor.selected]) {
        editor.shapes[editor.selected][prop] = value;
        editor.render();
      }
    }
    $('#strokeSlider').addEventListener('input', (e) => {
      editor.strokeWidth = Number(e.target.value);
      $('#strokeVal').textContent = e.target.value;
      applyToSelection('width', editor.strokeWidth);
    });
    $('#strokeSlider').addEventListener('change', () => editor.commit());
    $('#fontSlider').addEventListener('input', (e) => {
      editor.fontSize = Number(e.target.value);
      $('#fontVal').textContent = e.target.value;
    });
    $('#undoBtn').addEventListener('click', () => editor.undo());
    $('#redoBtn').addEventListener('click', () => editor.redo());
    $('#clearBtn').addEventListener('click', () => {
      if (confirm('Alle Annotationen löschen?')) editor.clearAll();
    });
    $('#downloadBtn').addEventListener('click', async () => {
      const name = await editor.download();
      $('#downloadNote').textContent = `Gespeichert als ${name}`;
      setStatus('PNG wurde heruntergeladen — nur von deinem Browser erzeugt.', 'ok');
    });
    document.addEventListener('keydown', (e) => {
      if (!editorSection.classList.contains('hidden')) {
        const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement && document.activeElement.tagName);
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); editor.undo(); }
        else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); editor.redo(); }
        else if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && editor.selected != null) { e.preventDefault(); editor.deleteSelected(); }
        else if (!typing && e.key === 'Escape') { editor.selected = null; editor.render(); }
      }
    });
    $('#deleteShapeBtn').addEventListener('click', () => editor.deleteSelected());
  }

  /* ---------- Start ---------- */
  function init() {
    editor = new window.MirashotEditor($('#editorCanvas'), {
      onChange: () => {
        $('#undoBtn').disabled = !editor.canUndo();
        $('#redoBtn').disabled = !editor.canRedo();
        $('#deleteShapeBtn').classList.toggle('hidden', editor.selected == null);
      },
    });
    window.__mirashotEditor = editor; // E2E-Test-Zugriff (nur lesend genutzt)
    buildToolGrid();
    buildSwatches();
    bindEditorControls();
    bindUploadFallback();
    initScreenTab();
    initTheme();
    initPickerHelp();
    editor.render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
