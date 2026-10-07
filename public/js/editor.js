'use strict';
/* MIRASHOT Annotation-Editor.
 * Zeichnet in VOLLER BILDAUAFLÖSUNG: Der Canvas hat die Größe des Bildes,
 * die Anzeige wird nur per CSS skaliert. Nichts verlässt den Browser. */

(function () {
  const TOOLS = ['select', 'pen', 'arrow', 'line', 'rect', 'ellipse', 'text', 'highlight', 'number', 'blur', 'pixel', 'eraser'];

  class Editor {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { willReadFrequently: true });
      this.opts = opts || {};
      this.base = null; // HTMLImageElement
      this.hostLabel = 'bildschirm';
      this.shapes = [];
      this.history = [[]];
      this.histIndex = 0;
      this.tool = 'pen';
      this.color = '#ef4444';
      this.strokeWidth = 8;
      this.fontSize = 34;
      this.numberNext = 1;
      this.drawing = null; // Shape in Arbeit
      this.erasedDuringDrag = false;
      this.textEdit = null; // {x,y,value,el,editIndex}
      this.selected = null;     // Index in shapes (Bearbeiten-Modus)
      this.dragMode = null;     // 'move' | 'a' | 'b' | 'resize'
      this.dragStart = null;
      this.dragMoved = false;
      this._bind();
    }

    /* ---------- Bild ---------- */
    setImage(img, hostLabel) {
      this.base = img;
      this.hostLabel = hostLabel || 'mirashot';
      this.canvas.width = img.naturalWidth;
      this.canvas.height = img.naturalHeight;
      this.clearAll(false);
      this.render();
    }

    hasImage() { return !!this.base; }

    /* ---------- Farbe des Texts auf Bubble ---------- */
    _textOn(color) {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
      if (!m) return '#0b0f1a';
      const lum = 0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16);
      return lum > 150 ? '#0b0f1a' : '#ffffff';
    }

    /* ---------- Zeichnen einzelner Shapes ---------- */
    _drawShape(ctx, s) {
      const w = s.width;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      switch (s.type) {
        case 'pen':
          ctx.strokeStyle = s.color;
          ctx.lineWidth = w;
          ctx.beginPath();
          s.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          ctx.stroke();
          break;
        case 'highlight':
          ctx.globalCompositeOperation = 'multiply';
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = s.color;
          ctx.lineWidth = Math.max(14, w * 4);
          ctx.lineCap = 'square';
          ctx.beginPath();
          s.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          ctx.stroke();
          break;
        case 'line':
          ctx.strokeStyle = s.color;
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(s.points[0].x, s.points[0].y);
          ctx.lineTo(s.points[1].x, s.points[1].y);
          ctx.stroke();
          break;
        case 'arrow': {
          const [a, b] = s.points;
          ctx.strokeStyle = s.color;
          ctx.fillStyle = s.color;
          ctx.lineWidth = w;
          const ang = Math.atan2(b.y - a.y, b.x - a.x);
          const head = Math.max(14, w * 3.2);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x - Math.cos(ang) * head * 0.6, b.y - Math.sin(ang) * head * 0.6);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - head * Math.cos(ang - 0.42), b.y - head * Math.sin(ang - 0.42));
          ctx.lineTo(b.x - head * Math.cos(ang + 0.42), b.y - head * Math.sin(ang + 0.42));
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'rect':
          ctx.strokeStyle = s.color;
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.rect(s.x, s.y, s.w, s.h);
          ctx.stroke();
          break;
        case 'ellipse':
          ctx.strokeStyle = s.color;
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w / 2), Math.abs(s.h / 2), 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'text': {
          ctx.fillStyle = s.color;
          ctx.font = `600 ${s.fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
          ctx.textBaseline = 'top';
          String(s.text || '').split('\n').forEach((line, i) => {
            ctx.fillText(line, s.x, s.y + i * s.fontSize * 1.25);
          });
          break;
        }
        case 'number': {
          const r = s.r;
          ctx.fillStyle = s.color;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = Math.max(2, r * 0.09);
          ctx.stroke();
          ctx.fillStyle = this._textOn(s.color);
          ctx.font = `800 ${Math.round(r * 1.05)}px system-ui, -apple-system, Roboto, Arial, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(s.num), s.x, s.y + r * 0.04);
          break;
        }
        case 'blur':
        case 'pixel':
          this._drawRegionEffect(ctx, s);
          break;
      }
      ctx.restore();
    }

    /* Unschärfe/Pixelate: Region aus dem BISHERigen Bildinhalt nehmen und verfrembt zurückzeichnen */
    _drawRegionEffect(ctx, s) {
      const pad = s.type === 'blur' ? Math.max(10, Math.min(s.w, s.h) * 0.25) : 2;
      const rx = Math.max(0, s.x - pad), ry = Math.max(0, s.y - pad);
      const rw = Math.min(this.canvas.width - rx, s.w + pad * 2);
      const rh = Math.min(this.canvas.height - ry, s.h + pad * 2);
      if (rw < 2 || rh < 2) return;
      const tmp = document.createElement('canvas');
      tmp.width = Math.max(1, Math.round(rw));
      tmp.height = Math.max(1, Math.round(rh));
      const tctx = tmp.getContext('2d');
      tctx.drawImage(this.canvas, rx, ry, rw, rh, 0, 0, tmp.width, tmp.height);

      let out = tmp;
      if (s.type === 'blur') {
        const b = document.createElement('canvas');
        b.width = tmp.width; b.height = tmp.height;
        const bctx = b.getContext('2d');
        bctx.filter = `blur(${Math.max(6, Math.min(s.w, s.h) / 9)}px)`;
        bctx.drawImage(tmp, 0, 0);
        out = b;
      } else {
        const blocks = Math.max(6, Math.round(Math.min(s.w, s.h) / 22));
        const small = document.createElement('canvas');
        small.width = Math.max(1, Math.round(tmp.width / blocks));
        small.height = Math.max(1, Math.round(tmp.height / blocks));
        const sctx = small.getContext('2d');
        sctx.imageSmoothingEnabled = true;
        sctx.drawImage(tmp, 0, 0, small.width, small.height);
        const big = document.createElement('canvas');
        big.width = tmp.width; big.height = tmp.height;
        const gctx = big.getContext('2d');
        gctx.imageSmoothingEnabled = false;
        gctx.drawImage(small, 0, 0, big.width, big.height);
        out = big;
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(s.x, s.y, s.w, s.h);
      ctx.clip();
      ctx.drawImage(out, rx, ry);
      ctx.restore();
    }

    render() {
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (this.base) ctx.drawImage(this.base, 0, 0);
      // Text-Eingabe laufend mitanzeigen
      const shapes = this.textEdit && this.textEdit.value
        ? this.shapes.concat([this._shapeFromTextEdit()])
        : this.shapes;
      for (const s of shapes) this._drawShape(ctx, s);
      if (this.drawing) this._drawShape(ctx, this.drawing);
      if (this.tool === 'select' && this.selected != null && this.shapes[this.selected]) {
        this._drawSelection(this.shapes[this.selected]);
      }
      if (this.opts.onChange) this.opts.onChange();
    }

    _shapeFromTextEdit() {
      const t = this.textEdit;
      return { type: 'text', x: t.x, y: t.y, text: t.value, color: this.color, fontSize: this.fontSize };
    }

    /* ---------- History ---------- */
    commit() {
      this.history = this.history.slice(0, this.histIndex + 1);
      this.history.push(JSON.parse(JSON.stringify(this.shapes)));
      if (this.history.length > 60) this.history.shift();
      this.histIndex = this.history.length - 1;
      this.render();
    }
    undo() {
      if (this.histIndex <= 0) return;
      this.selected = null;
      this.histIndex -= 1;
      this.shapes = JSON.parse(JSON.stringify(this.history[this.histIndex]));
      this._renumber();
      this.render();
    }
    redo() {
      if (this.histIndex >= this.history.length - 1) return;
      this.selected = null;
      this.histIndex += 1;
      this.shapes = JSON.parse(JSON.stringify(this.history[this.histIndex]));
      this._renumber();
      this.render();
    }
    canUndo() { return this.histIndex > 0; }
    canRedo() { return this.histIndex < this.history.length - 1; }

    clearAll(commit = true) {
      this.shapes = [];
      this.selected = null;
      this.numberNext = 1;
      if (commit) {
        this.history = [[]];
        this.histIndex = 0;
        this.render();
      }
    }
    _renumber() {
      let n = 0;
      for (const s of this.shapes) if (s.type === 'number') s.num = ++n;
      this.numberNext = n + 1;
    }

    /* ---------- Zeiger-Ereignisse (Maus + Touch) ---------- */
    _pos(e) {
      const rect = this.canvas.getBoundingClientRect();
      const sx = this.canvas.width / rect.width;
      const sy = this.canvas.height / rect.height;
      return { x: Math.round((e.clientX - rect.left) * sx), y: Math.round((e.clientY - rect.top) * sy) };
    }
    _setPointerCapture(e) { try { this.canvas.setPointerCapture(e.pointerId); } catch { /* egal */ } }

    _bind() {
      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => {
        if (!this.base) return;
        if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
        this._closeTextEdit(true);
        const p = this._pos(e);
        this._setPointerCapture(e);

        if (this.tool === 'select') {
          this._selectPointerDown(e, p);
          return;
        }
        if (this.tool === 'eraser') {
          this.erasedDuringDrag = this._eraseAt(p) || this.erasedDuringDrag;
          return;
        }
        if (this.tool === 'text') {
          e.preventDefault(); // verhindert, dass der Browser den Textfeld-Fokus direkt wieder aufhebt
          this._openTextEdit(p);
          return;
        }
        if (this.tool === 'number') {
          const r = Math.max(16, Math.min(this.canvas.width, this.canvas.height) * 0.022) + this.strokeWidth;
          this.shapes.push({ type: 'number', x: p.x, y: p.y, r, num: this.numberNext++, color: this.color });
          this.commit();
          return;
        }
        if (this.tool === 'pen' || this.tool === 'highlight') {
          this.drawing = { type: this.tool, color: this.color, width: this.strokeWidth, points: [p] };
        } else if (this.tool === 'line' || this.tool === 'arrow') {
          this.drawing = { type: this.tool, color: this.color, width: this.strokeWidth, points: [p, p] };
        } else if (this.tool === 'rect' || this.tool === 'ellipse' || this.tool === 'blur' || this.tool === 'pixel') {
          this.drawing = { type: this.tool, x: p.x, y: p.y, w: 0, h: 0, color: this.color, width: Math.max(3, this.strokeWidth * 0.6) };
        }
        c.setPointerCapture(e.pointerId);
      });

      c.addEventListener('pointermove', (e) => {
        if (!this.base) return;
        const p = this._pos(e);
        if (this.tool === 'select' && this.selected != null && this.dragMode) {
          this._selectDrag(p);
          return;
        }
        if (this.tool === 'eraser' && e.buttons) {
          this.erasedDuringDrag = this._eraseAt(p) || this.erasedDuringDrag;
          return;
        }
        if (!this.drawing) return;
        if (this.drawing.points) {
          if (this.drawing.type === 'pen' || this.drawing.type === 'highlight') {
            const last = this.drawing.points[this.drawing.points.length - 1];
            if (Math.hypot(p.x - last.x, p.y - last.y) > Math.max(1.5, this.strokeWidth / 4)) {
              this.drawing.points.push(p);
            }
          } else {
            this.drawing.points[1] = p;
          }
        } else {
          this.drawing.w = p.x - this.drawing.x;
          this.drawing.h = p.y - this.drawing.y;
        }
        this.render();
      });

      const finish = () => {
        if (this.tool === 'select') {
          if (this.dragMode && this.dragMoved) this.commit(); // eine Aenderung = ein Undo-Schritt
          this.dragMode = null;
          this.dragMoved = false;
          return;
        }
        if (this.tool === 'eraser') {
          if (this.erasedDuringDrag) { this._renumber(); this.commit(); this.erasedDuringDrag = false; }
          return;
        }
        if (!this.drawing) return;
        const d = this.drawing;
        this.drawing = null;
        const tiny = d.points
          ? (d.type === 'pen' || d.type === 'highlight'
            ? d.points.length < 2
            : Math.hypot(d.points[0].x - d.points[1].x, d.points[0].y - d.points[1].y) < 4)
          : Math.abs(d.w) < 4 || Math.abs(d.h) < 4;
        if (tiny) { this.render(); return; } // Klick ohne Ziehen: nichts anlicken
        if (d.type === 'rect' || d.type === 'ellipse' || d.type === 'blur' || d.type === 'pixel') {
          d.x = d.w < 0 ? d.x + d.w : d.x;
          d.y = d.h < 0 ? d.y + d.h : d.y;
          d.w = Math.abs(d.w);
          d.h = Math.abs(d.h);
        }
        this.shapes.push(d);
        this.commit();
      };
      c.addEventListener('pointerup', finish);
      c.addEventListener('pointercancel', () => { this.drawing = null; this.dragMode = null; this.render(); });
      c.addEventListener('dblclick', (e) => {
        if (this.tool !== 'select' || !this.base) return;
        e.preventDefault();
        const p = this._pos(e);
        const idx = this._hitIndex(p);
        if (idx >= 0 && this.shapes[idx].type === 'text') {
          this.selected = idx;
          this._openTextEdit({ x: this.shapes[idx].x, y: this.shapes[idx].y }, this.shapes[idx]);
        }
      });
    }

    /* ---------- Radierer: Shape unter dem Punkt entfernen ---------- */
    _eraseAt(p) {
      const tol = Math.max(8, this.strokeWidth * 1.5);
      for (let i = this.shapes.length - 1; i >= 0; i--) {
        if (this._hit(this.shapes[i], p, tol)) {
          this.shapes.splice(i, 1);
          this.render();
          return true;
        }
      }
      return false;
    }
    _hit(s, p, tol) {
      const bb = this._bbox(s);
      if (!bb) return false;
      const pad = s.type === 'number' || s.type === 'text' ? 0 : tol;
      return p.x >= bb.x - pad && p.x <= bb.x + bb.w + pad && p.y >= bb.y - pad && p.y <= bb.y + bb.h + pad;
    }

    /* ---- Bearbeiten-Modus (Auswahl-Cursor) ---- */

    _bbox(s) {
      if (s.points) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pt of s.points) {
          if (pt.x < minX) minX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y > maxY) maxY = pt.y;
        }
        const w2 = (s.width || 4) / 2 + 2;
        return { x: minX - w2, y: minY - w2, w: maxX - minX + w2 * 2, h: maxY - minY + w2 * 2 };
      }
      if (s.type === 'text') {
        this.ctx.save();
        this.ctx.font = `600 ${s.fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
        const lines = String(s.text || '').split('\n');
        let w = 0;
        for (const l of lines) w = Math.max(w, this.ctx.measureText(l).width);
        this.ctx.restore();
        return { x: s.x, y: s.y, w: Math.max(24, w), h: lines.length * s.fontSize * 1.25 };
      }
      if (s.type === 'number') return { x: s.x - s.r, y: s.y - s.r, w: s.r * 2, h: s.r * 2 };
      const x = Math.min(s.x, s.x + (s.w || 0));
      const y = Math.min(s.y, s.y + (s.h || 0));
      return { x, y, w: Math.abs(s.w || 0), h: Math.abs(s.h || 0) };
    }

    _hitIndex(p) {
      const tol = Math.max(8, this.strokeWidth * 1.5);
      for (let i = this.shapes.length - 1; i >= 0; i--) {
        if (this._hit(this.shapes[i], p, tol)) return i;
      }
      return -1;
    }

    _handleRadius() {
      return Math.max(7, Math.round(this.canvas.width / 150));
    }

    _hitHandle(p) {
      const s = this.shapes[this.selected];
      if (!s) return null;
      const r = this._handleRadius() * 1.8;
      if (s.type === 'line' || s.type === 'arrow') {
        if (Math.hypot(s.points[0].x - p.x, s.points[0].y - p.y) <= r) return 'a';
        if (Math.hypot(s.points[1].x - p.x, s.points[1].y - p.y) <= r) return 'b';
        return null;
      }
      const bb = this._bbox(s);
      if ((s.type === 'rect' || s.type === 'ellipse' || s.type === 'pixel' || s.type === 'blur')
        && Math.hypot(bb.x + bb.w - p.x, bb.y + bb.h - p.y) <= r) return 'resize';
      return null;
    }

    _selectPointerDown(e, p) {
      // 1) Griffe des selektierten Objekts (Endpunkte/Ecke)?
      if (this.selected != null) {
        const mode = this._hitHandle(p);
        if (mode) {
          this.dragMode = mode;
          this.dragStart = p;
          this.dragMoved = false;
          this._setPointerCapture(e);
          return;
        }
      }
      // 2) Objekt unter dem Klick auswaehlen + verschiebbare machen
      const idx = this._hitIndex(p);
      if (idx >= 0) {
        this.selected = idx;
        this.dragMode = 'move';
        this.dragStart = p;
        this.dragMoved = false;
        this._setPointerCapture(e);
        this.render();
        return;
      }
      // 3) Ins Leere geklickt -> abwaehlen
      this.selected = null;
      this.dragMode = null;
      this.render();
    }

    _selectDrag(p) {
      const s = this.shapes[this.selected];
      if (!s) { this.dragMode = null; return; }
      const dx = p.x - this.dragStart.x;
      const dy = p.y - this.dragStart.y;
      if (this.dragMode === 'move') {
        if (dx || dy) this.dragMoved = true;
        if (s.points) s.points = s.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
        else { s.x += dx; s.y += dy; }
        this.dragStart = p;
      } else if (this.dragMode === 'a') {
        s.points[0] = { x: p.x, y: p.y };
        this.dragMoved = true;
      } else if (this.dragMode === 'b') {
        s.points[1] = { x: p.x, y: p.y };
        this.dragMoved = true;
      } else if (this.dragMode === 'resize') {
        if (dx || dy) this.dragMoved = true;
        s.w = Math.max(6, p.x - s.x);
        s.h = Math.max(6, p.y - s.y);
      }
      this.render();
    }

    _drawSelection(s) {
      const ctx = this.ctx;
      const bb = this._bbox(s);
      const r = this._handleRadius();
      const scale = Math.max(1, this.canvas.width / 1000);
      ctx.save();
      ctx.setLineDash([7 * scale, 5 * scale]);
      ctx.strokeStyle = '#1f3a5f';
      ctx.lineWidth = Math.max(1.5, 1.5 * scale);
      ctx.strokeRect(bb.x - 5 * scale, bb.y - 5 * scale, bb.w + 10 * scale, bb.h + 10 * scale);
      ctx.setLineDash([]);
      // Griffe
      const handles = [];
      if (s.type === 'line' || s.type === 'arrow') {
        handles.push({ x: s.points[0].x, y: s.points[0].y }, { x: s.points[1].x, y: s.points[1].y });
      } else if (s.type === 'rect' || s.type === 'ellipse' || s.type === 'pixel' || s.type === 'blur') {
        handles.push({ x: bb.x + bb.w, y: bb.y + bb.h });
      }
      for (const hpt of handles) {
        ctx.beginPath();
        ctx.arc(hpt.x, hpt.y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#1f3a5f';
        ctx.lineWidth = Math.max(2, 2 * scale);
        ctx.stroke();
      }
      ctx.restore();
    }

    deleteSelected() {
      if (this.selected == null || !this.shapes[this.selected]) return;
      this.shapes.splice(this.selected, 1);
      this.selected = null;
      this._renumber();
      this.commit();
    }

    /* ---------- Text-Tool ---------- */
    _openTextEdit(p, existing) {
      this._closeTextEdit(false);
      const rect = this.canvas.getBoundingClientRect();
      const scale = rect.width / this.canvas.width;
      const ta = document.createElement('textarea');
      ta.className = 'tool-text-input';
      ta.rows = 2;
      ta.style.left = `${rect.left + window.scrollX + p.x * scale}px`;
      ta.style.top = `${rect.top + window.scrollY + p.y * scale}px`;
      ta.style.fontSize = `${Math.max(11, this.fontSize * scale)}px`;
      ta.placeholder = 'Text … (Strg+Enter = fertig, Esc = abbrechen)';
      document.body.appendChild(ta);
      ta.focus();
      const t = { x: p.x, y: p.y, value: existing ? String(existing.text || '') : '', el: ta, editIndex: existing ? this.shapes.indexOf(existing) : null };
      ta.value = t.value;
      this.textEdit = t;
      ta.addEventListener('input', () => { t.value = ta.value; this.render(); });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); this._closeTextEdit(false); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this._closeTextEdit(true); }
      });
      ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    _closeTextEdit(commit) {
      const t = this.textEdit;
      if (!t) return;
      this.textEdit = null;
      const value = t.value.trim();
      t.el.remove();
      if (commit && value) {
        if (t.editIndex != null && this.shapes[t.editIndex]) {
          this.shapes[t.editIndex].text = value; // bestehenden Text ersetzen
          this.commit();
        } else {
          this.shapes.push({ type: 'text', x: t.x, y: t.y, text: value, color: this.color, fontSize: this.fontSize });
          this.commit();
        }
      } else {
        this.render();
      }
    }

    /* ---------- KI: Pixelate-Boxen übernehmen ---------- */
    addPixelBoxes(boxes) {
      for (const b of boxes) {
        this.shapes.push({
          type: 'pixel',
          x: Math.round(b.x * this.canvas.width),
          y: Math.round(b.y * this.canvas.height),
          w: Math.max(8, Math.round(b.w * this.canvas.width)),
          h: Math.max(8, Math.round(b.h * this.canvas.height)),
          color: this.color,
          width: 2,
        });
      }
      this.commit();
    }

    /* ---------- Export ---------- */
    getBaseDataUrl(maxSide = 1600) {
      // Für KI: Basisbild (ohne Annotationen) auf sinnvolle Größe reduzieren
      if (!this.base) return null;
      const scale = Math.min(1, maxSide / Math.max(this.base.naturalWidth, this.base.naturalHeight));
      if (scale >= 1) return this.base.src;
      const c = document.createElement('canvas');
      c.width = Math.round(this.base.naturalWidth * scale);
      c.height = Math.round(this.base.naturalHeight * scale);
      c.getContext('2d').drawImage(this.base, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    }

    download() {
      return new Promise((resolve) => {
        this.canvas.toBlob((blob) => {
          const d = new Date();
          const pad = (n) => String(n).padStart(2, '0');
          const datum = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
          const host = (this.hostLabel || 'mirashot').replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'mirashot';
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `mirashot-${host}-${datum}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          resolve(a.download);
        }, 'image/png');
      });
    }
  }

  Editor.TOOLS = TOOLS;
  window.MirashotEditor = Editor;
})();
