// canvas.js — display layers, zoom/pan, coordinate transforms, touch input
//
// Layers:
//   source  (app.js)  original image, full resolution, never modified, not on screen
//   work    (app.js)  full-resolution image with the fills applied (this is exported)
//   view    (here)    on-screen rendering of work (scaled for devicePixelRatio)
//   overlay (here)    grid lines and the selection rectangle
//
// Transform: screen (CSS px) = image px * scale + (tx, ty)

const MAX_SCALE = 64;

export class Viewer {
  constructor({ container, view, overlay, onSelectStart, onSelectMove, onSelectEnd, onSelectCancel, onViewChange }) {
    this.container = container;
    this.view = view;
    this.overlay = overlay;
    this.vctx = view.getContext('2d');
    this.octx = overlay.getContext('2d');
    this.cb = { onSelectStart, onSelectMove, onSelectEnd, onSelectCancel, onViewChange };

    this.image = null;           // work canvas
    this.W = 0; this.H = 0;
    this.scale = 1; this.tx = 0; this.ty = 0;
    this.autoFit = true;          // keep fitting to the window until the user zooms
    this.cssW = 0; this.cssH = 0; this.dpr = 1;

    this.colB = null; this.rowB = null; this.showGrid = true;
    this.selection = null;        // {x,y,w,h} in image pixels

    this.pointers = new Map();
    this.mode = 'idle';           // idle | select | pinch | pan | blocked
    this.selectPointer = null;
    this.penSeen = false;         // once Apple Pencil is used, one finger = pan
    this.spaceDown = false;

    this._raf = 0;
    this._bindEvents();
    new ResizeObserver(() => this._resize()).observe(container);
    this._resize();
  }

  // ---------- public API ----------
  setImage(canvas, W, H) {
    this.image = canvas; this.W = W; this.H = H;
    this.selection = null;
    this.autoFit = true;
    this.fit();
  }

  setGrid(colB, rowB) { this.colB = colB; this.rowB = rowB; this.requestRender(); }
  setShowGrid(v) { this.showGrid = v; this.requestRender(); }
  setSelection(rect) { this.selection = rect; this.requestRender(); }

  fit() {
    if (!this.image || !this.cssW) return;
    const pad = 16;
    const s = Math.min((this.cssW - 2 * pad) / this.W, (this.cssH - 2 * pad) / this.H);
    this.scale = Math.max(1e-4, Math.min(MAX_SCALE, s));
    this.tx = (this.cssW - this.W * this.scale) / 2;
    this.ty = (this.cssH - this.H * this.scale) / 2;
    this.autoFit = true;
    this._viewChanged();
  }

  /** Zooms so that 1 image pixel = 1 screen (CSS) pixel, around the center. */
  actualSize() {
    if (!this.image) return;
    this.zoomAt(this.cssW / 2, this.cssH / 2, 1 / this.scale);
  }

  zoomAt(sx, sy, factor) {
    const minS = this._minScale();
    const ns = Math.max(minS, Math.min(MAX_SCALE, this.scale * factor));
    const ix = (sx - this.tx) / this.scale, iy = (sy - this.ty) / this.scale;
    this.scale = ns;
    this.tx = sx - ix * ns;
    this.ty = sy - iy * ns;
    this.autoFit = false;
    this._viewChanged();
  }

  screenToImage(sx, sy) {
    return { x: (sx - this.tx) / this.scale, y: (sy - this.ty) / this.scale };
  }

  requestRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._render(); });
  }

  // ---------- internals ----------
  _minScale() {
    if (!this.W) return 0.01;
    const fitS = Math.min(this.cssW / this.W, this.cssH / this.H);
    return Math.min(fitS * 0.25, 1);
  }

  _viewChanged() {
    this.requestRender();
    this.cb.onViewChange && this.cb.onViewChange(this.scale);
  }

  _resize() {
    const r = this.container.getBoundingClientRect();
    this.cssW = Math.max(1, Math.round(r.width));
    this.cssH = Math.max(1, Math.round(r.height));
    this.dpr = window.devicePixelRatio || 1;
    for (const c of [this.view, this.overlay]) {
      c.width = Math.round(this.cssW * this.dpr);
      c.height = Math.round(this.cssH * this.dpr);
      c.style.width = this.cssW + 'px';
      c.style.height = this.cssH + 'px';
    }
    if (this.autoFit) this.fit(); else this.requestRender();
  }

  _render() {
    const { vctx, octx, dpr } = this;
    vctx.setTransform(1, 0, 0, 1, 0, 0);
    vctx.clearRect(0, 0, this.view.width, this.view.height);
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!this.image) return;

    const s = this.scale;
    // Draw only the visible region (keeps large images smooth on iPad)
    const ix0 = Math.max(0, Math.floor(-this.tx / s));
    const iy0 = Math.max(0, Math.floor(-this.ty / s));
    const ix1 = Math.min(this.W, Math.ceil((this.cssW - this.tx) / s));
    const iy1 = Math.min(this.H, Math.ceil((this.cssH - this.ty) / s));
    if (ix1 > ix0 && iy1 > iy0) {
      vctx.imageSmoothingEnabled = s < 1;
      vctx.imageSmoothingQuality = 'high';
      vctx.drawImage(this.image, ix0, iy0, ix1 - ix0, iy1 - iy0,
        (ix0 * s + this.tx) * dpr, (iy0 * s + this.ty) * dpr, (ix1 - ix0) * s * dpr, (iy1 - iy0) * s * dpr);
    }

    // Grid
    const X = (ix) => Math.round((ix * s + this.tx) * dpr) + 0.5;
    const Y = (iy) => Math.round((iy * s + this.ty) * dpr) + 0.5;
    const left = X(0), right = X(this.W), top = Y(0), bottom = Y(this.H);
    octx.beginPath();
    if (this.showGrid && this.colB && this.rowB) {
      const cellW = (this.W / (this.colB.length - 1)) * s;
      const cellH = (this.H / (this.rowB.length - 1)) * s;
      if (cellW >= 3) {
        for (let i = 1; i < this.colB.length - 1; i++) {
          const x = X(this.colB[i]);
          if (x < 0 || x > this.overlay.width) continue;
          octx.moveTo(x, Math.max(top, 0)); octx.lineTo(x, Math.min(bottom, this.overlay.height));
        }
      }
      if (cellH >= 3) {
        for (let j = 1; j < this.rowB.length - 1; j++) {
          const y = Y(this.rowB[j]);
          if (y < 0 || y > this.overlay.height) continue;
          octx.moveTo(Math.max(left, 0), y); octx.lineTo(Math.min(right, this.overlay.width), y);
        }
      }
    }
    octx.rect(left, top, right - left, bottom - top);
    octx.lineWidth = Math.max(1, dpr * 1.5);
    octx.strokeStyle = 'rgba(0,0,0,0.45)';
    octx.stroke();
    octx.lineWidth = Math.max(0.5, dpr * 0.5);
    octx.strokeStyle = 'rgba(255,255,255,0.75)';
    octx.stroke();

    // Selection
    const sel = this.selection;
    if (sel && sel.w > 0 && sel.h > 0) {
      const x0 = X(sel.x), y0 = Y(sel.y), x1 = X(sel.x + sel.w), y1 = Y(sel.y + sel.h);
      octx.fillStyle = 'rgba(10,132,255,0.18)';
      octx.fillRect(x0, y0, x1 - x0, y1 - y0);
      octx.lineWidth = 3 * dpr;
      octx.strokeStyle = 'rgba(0,0,0,0.6)';
      octx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      octx.lineWidth = 1.5 * dpr;
      octx.strokeStyle = '#0a84ff';
      octx.setLineDash([6 * dpr, 4 * dpr]);
      octx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      octx.setLineDash([]);
    }
  }

  _local(e) {
    const r = this.overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _bindEvents() {
    const el = this.overlay;
    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('pointerup', (e) => this._up(e, false));
    el.addEventListener('pointercancel', (e) => this._up(e, true));
    el.addEventListener('lostpointercapture', (e) => { if (this.pointers.has(e.pointerId)) this._up(e, true); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.image) return;
      const p = this._local(e);
      const k = e.ctrlKey ? 0.01 : 0.0015;          // ctrlKey: trackpad pinch
      this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * k));
    }, { passive: false });
    // Block Safari's own pinch-zoom
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(t, (e) => e.preventDefault());
    }
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !isTyping(e)) { this.spaceDown = true; e.preventDefault(); } });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.spaceDown = false; });
  }

  _touchCount() {
    let n = 0;
    for (const p of this.pointers.values()) if (p.type === 'touch') n++;
    return n;
  }

  _down(e) {
    if (!this.image) return;
    e.preventDefault();
    if (e.pointerType === 'pen') this.penSeen = true;
    // Ignore palm/finger touches while the Pencil is selecting
    if (e.pointerType === 'touch' && this.mode === 'select' && this.pointers.get(this.selectPointer)?.type === 'pen') return;
    if (this.mode === 'blocked') return;

    const p = this._local(e);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, type: e.pointerType });
    try { this.overlay.setPointerCapture(e.pointerId); } catch (_) {}

    if (e.pointerType === 'touch' && this._touchCount() >= 2) {
      if (this.mode === 'select') { this.selectPointer = null; this.cb.onSelectCancel(); }
      this._startPinch();
      return;
    }
    if (this.mode !== 'idle') return;

    const panByMouse = e.pointerType === 'mouse' && (e.button === 1 || e.button === 2 || this.spaceDown);
    const panByFinger = e.pointerType === 'touch' && this.penSeen;
    if (panByMouse || panByFinger) {
      this.mode = 'pan';
      this.panPointer = e.pointerId;
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.mode = 'select';
    this.selectPointer = e.pointerId;
    this.cb.onSelectStart(this.screenToImage(p.x, p.y));
  }

  _startPinch() {
    const pts = [...this.pointers.values()].filter(p => p.type === 'touch').slice(0, 2);
    const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
    this.pinch = {
      d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
      s0: this.scale,
      img: this.screenToImage(cx, cy),
    };
    this.mode = 'pinch';
  }

  _move(e) {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;
    e.preventDefault();
    const p = this._local(e);
    const dx = p.x - ptr.x, dy = p.y - ptr.y;
    ptr.x = p.x; ptr.y = p.y;

    if (this.mode === 'select' && e.pointerId === this.selectPointer) {
      this.cb.onSelectMove(this.screenToImage(p.x, p.y));
    } else if (this.mode === 'pan' && e.pointerId === this.panPointer) {
      this.tx += dx; this.ty += dy; this.autoFit = false; this._viewChanged();
    } else if (this.mode === 'pinch') {
      const pts = [...this.pointers.values()].filter(q => q.type === 'touch').slice(0, 2);
      if (pts.length < 2) return;
      const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ns = Math.max(this._minScale(), Math.min(MAX_SCALE, this.pinch.s0 * d / this.pinch.d0));
      this.scale = ns;
      this.tx = cx - this.pinch.img.x * ns;
      this.ty = cy - this.pinch.img.y * ns;
      this.autoFit = false;
      this._viewChanged();
    }
  }

  _up(e, cancelled) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this._local(e);
    this.pointers.delete(e.pointerId);

    if (this.mode === 'select' && e.pointerId === this.selectPointer) {
      this.selectPointer = null;
      this.mode = 'idle';
      if (cancelled) this.cb.onSelectCancel();
      else this.cb.onSelectEnd(this.screenToImage(p.x, p.y));
    } else if (this.mode === 'pan' && e.pointerId === this.panPointer) {
      this.mode = 'idle';
    } else if (this.mode === 'pinch' && this._touchCount() < 2) {
      // Don't let the remaining finger start a selection: wait until all are lifted
      this.mode = this.pointers.size ? 'blocked' : 'idle';
    }
    if (this.mode === 'blocked' && this.pointers.size === 0) this.mode = 'idle';
  }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
}
