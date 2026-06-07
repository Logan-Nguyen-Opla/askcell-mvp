/**
 * viz.js
 * ------
 * Small dependency-free helpers shared by the visualization components:
 *   - viridis continuous color ramp (for gene-expression coloring + heatmap)
 *   - histogram binning (QC panel + violin density)
 *   - geometry (point-in-rect for box selection)
 *
 * Kept tiny and pure so it tree-shakes well and is trivial to test.
 */

// 10-stop viridis approximation. Perceptually uniform, colorblind-friendly,
// and reads well on the dark slate background.
const VIRIDIS = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 74, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [110, 206, 88],
  [181, 222, 43],
  [253, 231, 37],
];

/* ----------------------- Categorical colors ----------------------- */
// Curated, high-contrast hues for the first several cell types. Beyond this,
// we fall back to golden-angle hue rotation so an UNLIMITED number of
// categories stay visually distinct (no looping back onto earlier colors).
const CATEGORY_BASE = [
  "#818cf8", "#34d399", "#fbbf24", "#fb7185", "#38bdf8",
  "#c084fc", "#fb923c", "#2dd4bf", "#f472b6", "#a3e635",
  "#60a5fa", "#f87171", "#4ade80", "#facc15", "#e879f9",
];
const UNKNOWN_RGB = [148, 163, 184]; // slate-400 for cells with no label

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
const CATEGORY_BASE_RGB = CATEGORY_BASE.map(hexToRgb);

function hslToRgb(h, s, l) {
  const hn = (((h % 360) + 360) % 360) / 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + hn * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Distinct [r,g,b] for category index `i` (any non-negative integer). */
export function categoryRgb(i) {
  if (i == null || i < 0) return UNKNOWN_RGB;
  if (i < CATEGORY_BASE_RGB.length) return CATEGORY_BASE_RGB[i];
  // Golden-angle hue rotation; alternate lightness bands for extra separation.
  const j = i - CATEGORY_BASE_RGB.length;
  const hue = (j * 137.508) % 360;
  const light = j % 2 === 0 ? 0.62 : 0.5;
  return hslToRgb(hue, 0.6, light);
}

/** Distinct hex string for category index `i`. */
export function categoryHex(i) {
  const [r, g, b] = categoryRgb(i);
  const h = (v) => v.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Map t in [0,1] to an [r,g,b] viridis color (clamped). */
export function viridisRgb(t) {
  if (!Number.isFinite(t)) return [120, 120, 120];
  const x = Math.max(0, Math.min(1, t));
  const scaled = x * (VIRIDIS.length - 1);
  const i = Math.floor(scaled);
  const f = scaled - i;
  const a = VIRIDIS[i];
  const b = VIRIDIS[Math.min(i + 1, VIRIDIS.length - 1)];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export function viridisHex(t) {
  const [r, g, b] = viridisRgb(t);
  const h = (v) => v.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Normalize a value into [0,1] given a [min,max] range (safe on zero-range). */
export function norm(v, min, max) {
  if (max <= min) return 0;
  return (v - min) / (max - min);
}

/** Bin values into `bins` equal-width buckets over [min,max]. Returns counts. */
export function histogram(values, bins, min, max) {
  const counts = new Array(bins).fill(0);
  if (max <= min) {
    counts[0] = values.length;
    return counts;
  }
  const span = max - min;
  for (let k = 0; k < values.length; k++) {
    const v = values[k];
    if (!Number.isFinite(v)) continue;
    let idx = Math.floor(((v - min) / span) * bins);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    counts[idx] += 1;
  }
  return counts;
}

/** min/max of a numeric array, ignoring non-finite values. */
export function extent(values) {
  let min = Infinity;
  let max = -Infinity;
  for (let k = 0; k < values.length; k++) {
    const v = values[k];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return [0, 0];
  return [min, max];
}

/** True if point (px,py) lies in the rectangle defined by two corners. */
export function pointInRect(px, py, x0, y0, x1, y1) {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}
