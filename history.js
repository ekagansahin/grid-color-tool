// history.js — undo / redo (rectangle-patch based)
// Each step stores only the previous pixels of the rectangle that changed,
// so the iPad canvas memory quota is not filled with full-image copies.

export class History {
  constructor({ maxBytes = 160 * 1024 * 1024, maxSteps = 60 } = {}) {
    this.maxBytes = maxBytes;
    this.maxSteps = maxSteps;
    this.undoStack = [];
    this.redoStack = [];
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  _bytes(stack) {
    let s = 0;
    for (const p of stack) s += p.img.data.length;
    return s;
  }

  /** Call BEFORE a change: stores the current state of the rectangle. */
  record(ctx, x, y, w, h) {
    this.undoStack.push({ x, y, img: ctx.getImageData(x, y, w, h) });
    this.redoStack = [];
    this._trim();
  }

  _trim() {
    while (this.undoStack.length > this.maxSteps) this.undoStack.shift();
    let total = this._bytes(this.undoStack);
    while (this.undoStack.length > 1 && total > this.maxBytes) {
      total -= this.undoStack.shift().img.data.length;
    }
  }

  undo(ctx) { return this._swap(ctx, this.undoStack, this.redoStack); }
  redo(ctx) { return this._swap(ctx, this.redoStack, this.undoStack); }

  _swap(ctx, from, to) {
    const p = from.pop();
    if (!p) return false;
    const cur = ctx.getImageData(p.x, p.y, p.img.width, p.img.height);
    ctx.putImageData(p.img, p.x, p.y);
    to.push({ x: p.x, y: p.y, img: cur });
    return true;
  }
}
