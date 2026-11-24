# Grid Color Tool

A browser-based tool for selective pixelation / color blocking. A **virtual** N×M grid is overlaid on an image; the rectangle you select is filled with the average color of the original full-resolution pixels (or with a custom color). The image is never downscaled — the output is a full-resolution PNG.

Plain JavaScript + HTML5 Canvas, no build step. Designed primarily for iPad Safari.

**Live:** https://ekagansahin.github.io/grid-color-tool/

## Features

- **Grid:** enter N (columns) and M (rows) directly, or pick a preset:
  - Fixed N×M (4×4 … 128×128, 16×9, 32×18, 64×36)
  - Square cells: choose the column count, rows follow the image aspect ratio
  - Cell size (8–128 px)
- **Selection:** snap to cells (on by default) or free rectangle. With snapping on, a single tap selects one cell.
- **Fill modes:** *Single color* (one average for the whole selection) or *Per cell* (each cell in the selection gets its own average).
- **Color source:** average or custom color. The average is **always taken from the original image**, so overlapping selections don't depend on the order they were applied.
- **Linear RGB averaging** (optional): averages in linear-light space, which looks more accurate on high-contrast regions.
- Alpha-weighted averaging; fully transparent pixels are ignored.
- **Apply on release** (default) or select first and press **Apply to selection**.
- **Undo / redo:** only the previous pixels of the changed rectangle are stored (≤160 MB, ≤60 steps).
- **Export:** download as PNG; on iPad use **Share → Save Image** to save to Photos.
- **iPad:** Pointer Events (finger, Apple Pencil and mouse share one code path), two-finger zoom/pan, Retina (devicePixelRatio) rendering, iOS canvas limit (~16.7 MP) check with a downscale prompt.
- **PWA:** Add to Home Screen, full screen, works offline.
- Settings are remembered in the browser.

## Controls

| Gesture | Action |
|---|---|
| One finger / Pencil / mouse drag | Select a rectangle |
| Two fingers | Zoom + pan |
| One finger after the Pencil has been used | Pan |
| Mouse wheel | Zoom |
| Right/middle drag or Space + drag | Pan |

Keyboard: `⌘/Ctrl+Z` undo · `⌘/Ctrl+Shift+Z` or `Ctrl+Y` redo · `⌘/Ctrl+S` download · `⌘/Ctrl+O` open · `Enter` apply · `Esc` clear selection · `0` fit · `1` actual size · `G` grid · `S` snap

## Files

```
index.html      UI
style.css       tablet-first layout
app.js          state, events, loading, filling, export
canvas.js       display layers, zoom/pan, coordinate transforms, touch input
color.js        color averaging (sRGB / linear)
history.js      undo / redo (rectangle patches)
manifest.json   PWA manifest
sw.js           service worker (offline)
icons/          app icons
```

## Running locally

ES modules don't load from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploying to GitHub Pages

Settings → Pages → Build and deployment: Source = *Deploy from a branch*, Branch = `main`, folder = `/ (root)`.

When publishing an update, bump the `CACHE` name in `sw.js` (e.g. `grid-color-v2`) so installed copies pick up the new files.

## iPad test checklist

- [ ] A 12 MP photo opens; grid and fills are correct
- [ ] A 48 MP photo shows the downscale prompt and the downscaled image is not blank
- [ ] Pencil selection works; palm touches don't break it
- [ ] Two-finger zoom/pan is smooth and the page doesn't scroll
- [ ] Share → Save Image stores the full-resolution result in Photos
- [ ] Added to Home Screen it opens full screen and works in airplane mode
