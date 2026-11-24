// app.js — state management, UI events, application flow
import { Viewer } from './canvas.js';
import { averageGroups, rgbToHex, hexToRgb } from './color.js';
import { History } from './history.js';

const $ = (id) => document.getElementById(id);

// ---------- device limits ----------
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// iOS Safari: a single canvas is limited to ~16.7 MP (4096×4096). Desktop: a sensible memory cap.
const MAX_AREA = IS_IOS ? 16_777_216 : 64_000_000;
const MAX_SIDE = IS_IOS ? 16_384 : 32_767;

// ---------- state ----------
const S = {
  fileName: 'image',
  W: 0, H: 0,
  source: null, sctx: null,       // original (never modified)
  work: null, wctx: null,         // painted
  n: 16, m: 16, preset: 'custom',
  colB: null, rowB: null, colOf: null, rowOf: null,
  snap: true, autoApply: true, showGrid: true,
  fillMode: 'single', colorSource: 'avg', customColor: '#ff3b30', linear: false,
  sel: null, dragStart: null, dragCur: null,
  last: null,                      // {color:[r,g,b]} or {cells:k}
  version: 0,                      // for the export cache
};
const history = new History();

// ---------- remember settings ----------
const SETTINGS_KEY = 'grid-color-tool:settings';
const SAVED = ['n', 'm', 'preset', 'snap', 'autoApply', 'showGrid', 'fillMode', 'colorSource', 'customColor', 'linear'];
function loadSettings() {
  try {
    const o = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    for (const k of SAVED) if (k in o) S[k] = o[k];
  } catch (_) {}
}
function saveSettings() {
  try {
    const o = {}; for (const k of SAVED) o[k] = S[k];
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(o));
  } catch (_) {}
}

// ---------- viewer ----------
const viewer = new Viewer({
  container: $('stage'),
  view: $('viewCanvas'),
  overlay: $('overlayCanvas'),
  onSelectStart: (p) => { S.dragStart = p; S.dragCur = p; setSelection(rectFrom(p, p, false)); },
  onSelectMove: (p) => { S.dragCur = p; setSelection(rectFrom(S.dragStart, p, false)); },
  onSelectEnd: (p) => {
    const rect = rectFrom(S.dragStart, p, true);
    S.dragStart = null;
    setSelection(rect);
    if (rect && S.autoApply) { apply(); setSelection(null); }
  },
  onSelectCancel: () => { S.dragStart = null; setSelection(null); },
  onViewChange: (scale) => { $('stZoom').textContent = S.W ? `${Math.round(scale * 100)}%` : ''; },
});

// ---------- grid ----------
function resolvePreset() {
  const p = S.preset;
  if (!p || p === 'custom' || !S.W) return;
  const [kind, val] = p.split(':');
  if (kind === 'f') { const [a, b] = val.split('x').map(Number); S.n = a; S.m = b; }
  else if (kind === 'sq') { S.n = Number(val); S.m = Math.max(1, Math.round(S.n * S.H / S.W)); }
  else if (kind === 'px') { const c = Number(val); S.n = Math.max(1, Math.round(S.W / c)); S.m = Math.max(1, Math.round(S.H / c)); }
}

function buildGrid() {
  if (!S.W) return;
  S.n = Math.max(1, Math.min(S.W, Math.floor(S.n) || 1));
  S.m = Math.max(1, Math.min(S.H, Math.floor(S.m) || 1));
  const make = (count, size) => {
    const b = new Int32Array(count + 1);
    for (let i = 0; i <= count; i++) b[i] = Math.round(i * size / count);
    const of = new Int32Array(size);
    for (let i = 0; i < count; i++) of.fill(i, b[i], b[i + 1]);
    return [b, of];
  };
  [S.colB, S.colOf] = make(S.n, S.W);
  [S.rowB, S.rowOf] = make(S.m, S.H);
  viewer.setGrid(S.colB, S.rowB);
  $('nInput').value = S.n; $('mInput').value = S.m;
  const cw = S.W / S.n, ch = S.H / S.m;
  const f = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  $('cellInfo').textContent = `Cell ≈ ${f(cw)} × ${f(ch)} px`;
  updateStatus();
}

// ---------- selection ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function rectFrom(a, b, final) {
  if (!S.W || !a || !b) return null;
  if (S.snap) {
    const ca = S.colOf[clamp(Math.floor(a.x), 0, S.W - 1)], cb = S.colOf[clamp(Math.floor(b.x), 0, S.W - 1)];
    const ra = S.rowOf[clamp(Math.floor(a.y), 0, S.H - 1)], rb = S.rowOf[clamp(Math.floor(b.y), 0, S.H - 1)];
    const c0 = Math.min(ca, cb), c1 = Math.max(ca, cb), r0 = Math.min(ra, rb), r1 = Math.max(ra, rb);
    const x = S.colB[c0], y = S.rowB[r0];
    return { x, y, w: S.colB[c1 + 1] - x, h: S.rowB[r1 + 1] - y };
  }
  // Free selection: include every pixel touched
  if (final) {
    const dist = Math.hypot(a.x - b.x, a.y - b.y) * viewer.scale;
    if (dist < 4) return null;            // a tap = no selection
  }
  const x0 = clamp(Math.floor(Math.min(a.x, b.x)), 0, S.W), x1 = clamp(Math.ceil(Math.max(a.x, b.x)), 0, S.W);
  const y0 = clamp(Math.floor(Math.min(a.y, b.y)), 0, S.H), y1 = clamp(Math.ceil(Math.max(a.y, b.y)), 0, S.H);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function setSelection(rect) {
  S.sel = rect;
  viewer.setSelection(rect);
  updateButtons();
  updateStatus();
}

// ---------- fill ----------
function apply() {
  const sel = S.sel;
  if (!sel || !S.work) return;
  const { x, y, w, h } = sel;
  const t0 = performance.now();
  history.record(S.wctx, x, y, w, h);

  if (S.colorSource === 'custom') {
    S.wctx.fillStyle = S.customColor;
    S.wctx.fillRect(x, y, w, h);
    S.last = { color: hexToRgb(S.customColor) };
  } else {
    const data = S.sctx.getImageData(x, y, w, h).data;
    const colIdx = new Int32Array(w), rowIdx = new Int32Array(h);
    let nc = 1, nr = 1, c0 = 0, r0 = 0;
    if (S.fillMode === 'cell') {
      c0 = S.colOf[x]; r0 = S.rowOf[y];
      nc = S.colOf[x + w - 1] - c0 + 1; nr = S.rowOf[y + h - 1] - r0 + 1;
      for (let i = 0; i < w; i++) colIdx[i] = S.colOf[x + i] - c0;
      for (let j = 0; j < h; j++) rowIdx[j] = S.rowOf[y + j] - r0;
    }
    const avgs = averageGroups(data, w, h, colIdx, rowIdx, nc, nr, S.linear);
    let painted = 0;
    for (let rj = 0; rj < nr; rj++) {
      for (let ci = 0; ci < nc; ci++) {
        const c = avgs[rj * nc + ci];
        if (!c) continue;                 // fully transparent region: leave it
        let fx = x, fy = y, fw = w, fh = h;
        if (S.fillMode === 'cell') {
          fx = Math.max(S.colB[c0 + ci], x); fw = Math.min(S.colB[c0 + ci + 1], x + w) - fx;
          fy = Math.max(S.rowB[r0 + rj], y); fh = Math.min(S.rowB[r0 + rj + 1], y + h) - fy;
        }
        S.wctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        S.wctx.fillRect(fx, fy, fw, fh);
        painted++;
      }
    }
    S.last = S.fillMode === 'cell' && nc * nr > 1 ? { cells: painted } : (avgs[0] ? { color: avgs[0] } : null);
  }
  S.lastMs = performance.now() - t0;
  S.version++;
  viewer.requestRender();
  updateLast();
  updateButtons();
}

function undo() { if (history.undo(S.wctx)) { S.version++; viewer.requestRender(); updateButtons(); } }
function redo() { if (history.redo(S.wctx)) { S.version++; viewer.requestRender(); updateButtons(); } }

async function resetToOriginal() {
  if (!S.work) return;
  const ok = await ask('Discard all fills and revert to the original image? (You can bring them back with Undo.)',
    [{ label: 'Cancel', value: false }, { label: 'Revert', value: true, danger: true }]);
  if (!ok) return;
  history.record(S.wctx, 0, 0, S.W, S.H);
  S.wctx.clearRect(0, 0, S.W, S.H);
  S.wctx.drawImage(S.source, 0, 0);
  S.version++;
  viewer.requestRender();
  updateButtons();
}

// ---------- image loading ----------
function freeCanvas(c) { if (c) { c.width = 0; c.height = 0; } }   // releases memory immediately on iOS

function makeCanvas(w, h, opts) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', opts);
  if (!ctx || c.width !== w || c.height !== h) throw new Error('could not create canvas');
  return [c, ctx];
}

async function loadFile(file) {
  if (!file) return;
  if (file.type && !file.type.startsWith('image/')) { toast('This is not an image file.'); return; }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let W = img.naturalWidth, H = img.naturalHeight;
    if (!W || !H) throw new Error('could not read image size');

    if (W * H > MAX_AREA || W > MAX_SIDE || H > MAX_SIDE) {
      const k = Math.min(Math.sqrt(MAX_AREA / (W * H)), MAX_SIDE / W, MAX_SIDE / H);
      const nW = Math.floor(W * k), nH = Math.floor(H * k);
      const mp = (v) => (v / 1e6).toFixed(1);
      const ok = await ask(
        `This image is ${W}×${H} px (${mp(W * H)} MP). A single canvas on this device can hold at most ~${mp(MAX_AREA)} MP; ` +
        `beyond that Safari silently leaves the canvas blank.\n\nOpen it downscaled to ${nW}×${nH} px (${mp(nW * nH)} MP)?`,
        [{ label: 'Cancel', value: false }, { label: 'Downscale and open', value: true, primary: true }]);
      if (!ok) return;
      W = nW; H = nH;
    }

    freeCanvas(S.source); freeCanvas(S.work);
    S.source = S.work = null;
    history.clear();

    const [source, sctx] = makeCanvas(W, H, { willReadFrequently: true });
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, 0, 0, W, H);
    const [work, wctx] = makeCanvas(W, H);
    wctx.drawImage(source, 0, 0);
    sctx.getImageData(0, 0, 1, 1);    // is the canvas actually usable?

    Object.assign(S, { source, sctx, work, wctx, W, H, sel: null, last: null, version: S.version + 1 });
    S.fileName = (file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
    resolvePreset();
    buildGrid();
    viewer.setImage(work, W, H);
    $('empty').hidden = true;
    updateLast();
    updateButtons();
    updateStatus();
  } catch (err) {
    console.error(err);
    toast('Could not open image: ' + (err && err.message ? err.message : err));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- export ----------
let blobCache = { version: -1, blob: null };

function exportName() { return `${S.fileName}_grid.png`; }

function makeBlob() {
  if (blobCache.version === S.version && blobCache.blob) return Promise.resolve(blobCache.blob);
  return new Promise((res, rej) => S.work.toBlob((b) => {
    if (!b) return rej(new Error('could not create PNG'));
    blobCache = { version: S.version, blob: b };
    res(b);
  }, 'image/png'));
}

async function download() {
  if (!S.work) return;
  try {
    const blob = await makeBlob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = exportName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  } catch (e) { toast('Download failed: ' + e.message); }
}

const shareBtn = $('shareBtn');
const shareSupported = !!(navigator.share && navigator.canShare &&
  navigator.canShare({ files: [new File([new Blob()], 'x.png', { type: 'image/png' })] }));
if (shareSupported) shareBtn.hidden = false;

async function share() {
  if (!S.work) return;
  const cached = blobCache.version === S.version && blobCache.blob;
  try {
    const blob = await makeBlob();
    const file = new File([blob], exportName(), { type: 'image/png' });
    await navigator.share({ files: [file], title: exportName() });
  } catch (e) {
    if (e.name === 'AbortError') return;
    if (e.name === 'NotAllowedError' && !cached) {
      // The tap's user-activation expired while the PNG was being encoded; the file is ready now.
      toast('PNG ready — tap Share again to save it.');
      return;
    }
    toast('Could not share: ' + e.message);
  }
}

// ---------- UI ----------
function updateButtons() {
  const has = !!S.work;
  $('undoBtn').disabled = !history.canUndo;
  $('redoBtn').disabled = !history.canRedo;
  for (const id of ['fitBtn', 'oneBtn', 'downloadBtn', 'shareBtn', 'resetBtn']) $(id).disabled = !has;
  $('applyBtn').disabled = !S.sel;
  $('clearSelBtn').disabled = !S.sel;
  $('pickLastBtn').disabled = !(S.last && S.last.color);
}

function updateLast() {
  const sw = $('lastSwatch'), t = $('lastText');
  if (S.last && S.last.color) {
    const hex = rgbToHex(S.last.color);
    sw.style.background = hex;
    t.textContent = `${hex}  ·  rgb(${S.last.color.join(', ')})`;
  } else if (S.last && S.last.cells) {
    sw.style.background = 'repeating-conic-gradient(#888 0 25%, #555 0 50%) 0 0/12px 12px';
    t.textContent = `${S.last.cells} cells, each with its own average`;
  } else {
    sw.style.background = 'transparent';
    t.textContent = '—';
  }
}

function updateStatus() {
  $('stImage').textContent = S.W ? `${S.W}×${S.H} px · grid ${S.n}×${S.m}` : 'No image';
  $('stSel').textContent = S.sel ? `Selection: ${S.sel.w}×${S.sel.h} px @ (${S.sel.x}, ${S.sel.y})` : '';
}

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

function ask(text, buttons) {
  return new Promise((resolve) => {
    $('modalText').textContent = text;
    const box = $('modalButtons');
    box.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      el.textContent = b.label;
      el.onclick = () => { $('modal').hidden = true; resolve(b.value); };
      box.appendChild(el);
    }
    $('modal').hidden = false;
  });
}

function syncControls() {
  $('nInput').value = S.n; $('mInput').value = S.m;
  $('presetSelect').value = S.preset;
  if ($('presetSelect').value !== S.preset) { S.preset = 'custom'; $('presetSelect').value = 'custom'; }
  $('gridToggle').checked = S.showGrid;
  $('snapToggle').checked = S.snap;
  $('autoToggle').checked = S.autoApply;
  $('linearToggle').checked = S.linear;
  $('colorInput').value = S.customColor;
  document.querySelector(`input[name=fillMode][value=${S.fillMode}]`).checked = true;
  document.querySelector(`input[name=colorSource][value=${S.colorSource}]`).checked = true;
  viewer.setShowGrid(S.showGrid);
}

function bindUI() {
  $('fileInput').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });

  const onGridInput = () => {
    S.preset = 'custom'; $('presetSelect').value = 'custom';
    S.n = parseInt($('nInput').value, 10) || 1;
    S.m = parseInt($('mInput').value, 10) || 1;
    if (S.W) { buildGrid(); setSelection(null); }
    saveSettings();
  };
  $('nInput').addEventListener('change', onGridInput);
  $('mInput').addEventListener('change', onGridInput);
  $('presetSelect').addEventListener('change', (e) => {
    S.preset = e.target.value;
    if (S.preset.startsWith('f:')) resolvePreset();     // show N×M even without an image
    if (S.W) { resolvePreset(); buildGrid(); setSelection(null); }
    else { $('nInput').value = S.n; $('mInput').value = S.m; }
    saveSettings();
  });
  $('gridToggle').addEventListener('change', (e) => { S.showGrid = e.target.checked; viewer.setShowGrid(S.showGrid); saveSettings(); });
  $('snapToggle').addEventListener('change', (e) => { S.snap = e.target.checked; saveSettings(); });
  $('autoToggle').addEventListener('change', (e) => { S.autoApply = e.target.checked; saveSettings(); });
  $('linearToggle').addEventListener('change', (e) => { S.linear = e.target.checked; saveSettings(); });
  $('colorInput').addEventListener('input', (e) => {
    S.customColor = e.target.value;
    S.colorSource = 'custom';
    document.querySelector('input[name=colorSource][value=custom]').checked = true;
    saveSettings();
  });
  for (const r of document.querySelectorAll('input[name=fillMode]')) r.addEventListener('change', (e) => { S.fillMode = e.target.value; saveSettings(); });
  for (const r of document.querySelectorAll('input[name=colorSource]')) r.addEventListener('change', (e) => { S.colorSource = e.target.value; saveSettings(); });

  $('applyBtn').addEventListener('click', apply);
  $('clearSelBtn').addEventListener('click', () => setSelection(null));
  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  $('fitBtn').addEventListener('click', () => viewer.fit());
  $('oneBtn').addEventListener('click', () => viewer.actualSize());
  $('downloadBtn').addEventListener('click', download);
  shareBtn.addEventListener('click', share);
  $('resetBtn').addEventListener('click', resetToOriginal);
  $('pickLastBtn').addEventListener('click', () => {
    if (!S.last || !S.last.color) return;
    S.customColor = rgbToHex(S.last.color);
    S.colorSource = 'custom';
    syncControls(); saveSettings();
    toast(`Custom color: ${S.customColor}`);
  });
  $('panelBtn').addEventListener('click', () => {
    const p = $('panel');
    p.classList.toggle('hidden');
    $('panelBtn').setAttribute('aria-expanded', String(!p.classList.contains('hidden')));
  });

  // Drag and drop (desktop)
  const stage = $('stage');
  stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('dragover'); });
  stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));
  stage.addEventListener('drop', (e) => {
    e.preventDefault(); stage.classList.remove('dragover');
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) loadFile(f);
  });

  // Keyboard shortcuts (iPad with keyboard / desktop)
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'radio' || t.tagName === 'SELECT')) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && k === 'y') { e.preventDefault(); redo(); }
    else if (mod && k === 's') { e.preventDefault(); download(); }
    else if (mod && k === 'o') { e.preventDefault(); $('fileInput').click(); }
    else if (mod) return;
    else if (e.key === 'Enter') { e.preventDefault(); apply(); }
    else if (e.key === 'Escape') setSelection(null);
    else if (k === '0') viewer.fit();
    else if (k === '1') viewer.actualSize();
    else if (k === 'g') { S.showGrid = !S.showGrid; syncControls(); saveSettings(); }
    else if (k === 's') { S.snap = !S.snap; syncControls(); saveSettings(); }
  });

  // Warn before leaving the page with unsaved work
  window.addEventListener('beforeunload', (e) => { if (history.canUndo) { e.preventDefault(); e.returnValue = ''; } });
}

// ---------- start ----------
loadSettings();
bindUI();
syncControls();
updateButtons();
updateStatus();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// For debugging / tests
window.gridTool = { S, history, viewer, apply, undo, redo, loadFile, makeBlob, setSelection, rectFrom };
