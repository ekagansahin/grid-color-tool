// color.js — color averaging (core logic)
// All calculations run on the original, full-resolution pixels.

// sRGB (0–255) -> linear (0–1) lookup table
const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb255(v) {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

/**
 * Splits the pixels of a rectangle into groups and returns the average color of each group.
 *
 * data   : getImageData(...).data (RGBA data of the rectangle)
 * w, h   : rectangle size
 * colIdx : Int32Array(w) — group column index (0..nc-1) for every pixel column
 * rowIdx : Int32Array(h) — group row index (0..nr-1) for every pixel row
 * nc, nr : number of group columns / rows (1×1 in single-color mode)
 * linear : if true, average in linear-light space
 *
 * Pixels are weighted by alpha; fully transparent pixels are ignored.
 * Returns Array(nc*nr) — each item is [r,g,b], or null if the group has no opaque pixel.
 */
export function averageGroups(data, w, h, colIdx, rowIdx, nc, nr, linear) {
  const n = nc * nr;
  const sr = new Float64Array(n), sg = new Float64Array(n), sb = new Float64Array(n), sa = new Float64Array(n);
  let i = 0;
  for (let y = 0; y < h; y++) {
    const rowBase = rowIdx[y] * nc;
    for (let x = 0; x < w; x++, i += 4) {
      const a = data[i + 3];
      if (a === 0) continue;
      const k = rowBase + colIdx[x];
      if (linear) {
        sr[k] += SRGB_TO_LINEAR[data[i]] * a;
        sg[k] += SRGB_TO_LINEAR[data[i + 1]] * a;
        sb[k] += SRGB_TO_LINEAR[data[i + 2]] * a;
      } else {
        sr[k] += data[i] * a;
        sg[k] += data[i + 1] * a;
        sb[k] += data[i + 2] * a;
      }
      sa[k] += a;
    }
  }
  const out = new Array(n);
  for (let k = 0; k < n; k++) {
    if (sa[k] === 0) { out[k] = null; continue; }
    if (linear) {
      out[k] = [linearToSrgb255(sr[k] / sa[k]), linearToSrgb255(sg[k] / sa[k]), linearToSrgb255(sb[k] / sa[k])];
    } else {
      out[k] = [Math.round(sr[k] / sa[k]), Math.round(sg[k] / sa[k]), Math.round(sb[k] / sa[k])];
    }
  }
  return out;
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
