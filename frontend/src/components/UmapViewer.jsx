import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import DeckGL from "@deck.gl/react";
import { OrthographicView } from "@deck.gl/core";
import { ScatterplotLayer } from "@deck.gl/layers";

/**
 * UmapViewer
 * ----------
 * Hardware-accelerated 2D scatterplot of UMAP coordinates, colored by cell type.
 *
 * Props:
 *   cells: Array<{ id, x, y, c? }>   // c = index into `categories` (optional)
 *   categories: string[]            // e.g. ["B cells", "T cells", ...]
 *   labelField: string | null       // obs column used for coloring
 */

// Vibrant categorical palette tuned for the slate-950 background.
const PALETTE = [
  "#818cf8", // indigo
  "#34d399", // emerald
  "#fbbf24", // amber
  "#fb7185", // rose
  "#38bdf8", // sky
  "#c084fc", // violet
  "#fb923c", // orange
  "#2dd4bf", // teal
  "#f472b6", // pink
  "#a3e635", // lime
];
const UNKNOWN_HEX = "#94a3b8"; // slate-400 for cells with no label
const HIGHLIGHT = [255, 255, 255, 255]; // white hover highlight

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
const PALETTE_RGB = PALETTE.map(hexToRgb);
const UNKNOWN_RGB = hexToRgb(UNKNOWN_HEX);

function colorFor(catIndex) {
  if (catIndex == null || catIndex < 0) return UNKNOWN_RGB;
  return PALETTE_RGB[catIndex % PALETTE_RGB.length];
}
function hexFor(catIndex) {
  if (catIndex == null || catIndex < 0) return UNKNOWN_HEX;
  return PALETTE[catIndex % PALETTE.length];
}

function computeBounds(cells) {
  if (!cells || cells.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < cells.length; i++) {
    const { x, y } = cells[i];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function fitViewState(bounds, width, height, padding = 0.9) {
  if (!bounds || !width || !height) {
    return { target: [0, 0, 0], zoom: 0, minZoom: -10, maxZoom: 20 };
  }
  const [minX, minY, maxX, maxY] = bounds;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const rangeX = Math.max(maxX - minX, 1e-6);
  const rangeY = Math.max(maxY - minY, 1e-6);
  const zoomX = Math.log2((width * padding) / rangeX);
  const zoomY = Math.log2((height * padding) / rangeY);
  return {
    target: [centerX, centerY, 0],
    zoom: Math.min(zoomX, zoomY),
    minZoom: -10,
    maxZoom: 20,
  };
}

export default function UmapViewer({ cells, categories = [], labelField }) {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewState, setViewState] = useState(null);
  const [pointSize, setPointSize] = useState(4);          // px radius
  const [hidden, setHidden] = useState(() => new Set());  // hidden category indices

  const hasCategories = categories && categories.length > 0;
  const bounds = useMemo(() => computeBounds(cells), [cells]);

  // Track container pixel size (the left 70% pane).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-fit when data or viewport changes.
  useEffect(() => {
    if (bounds && size.width && size.height) {
      setViewState(fitViewState(bounds, size.width, size.height));
    }
  }, [bounds, size.width, size.height]);

  // Reset hidden set whenever the dataset changes.
  useEffect(() => {
    setHidden(new Set());
  }, [categories]);

  const resetView = useCallback(() => {
    if (bounds && size.width && size.height) {
      setViewState(fitViewState(bounds, size.width, size.height));
    }
  }, [bounds, size.width, size.height]);

  // Visible subset (after legend toggles).
  const visibleCells = useMemo(() => {
    if (!hasCategories || hidden.size === 0) return cells;
    return cells.filter((d) => !hidden.has(d.c));
  }, [cells, hidden, hasCategories]);

  const layers = useMemo(
    () => [
      new ScatterplotLayer({
        id: "umap-cells",
        data: visibleCells,
        getPosition: (d) => [d.x, d.y],
        getFillColor: (d) => colorFor(d.c),
        getRadius: pointSize,
        radiusUnits: "pixels",
        radiusMinPixels: 1,
        radiusMaxPixels: 24,
        stroked: false,
        filled: true,
        antialiasing: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: HIGHLIGHT,
        opacity: 0.9,
        updateTriggers: {
          getRadius: pointSize,
          getFillColor: [hasCategories],
        },
      }),
    ],
    [visibleCells, pointSize, hasCategories]
  );

  const toggleCategory = useCallback((idx) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  return (
    <div ref={containerRef} className="relative h-full w-full bg-slate-950">
      {viewState && (
        <DeckGL
          views={new OrthographicView({ id: "ortho", flipY: false })}
          viewState={viewState}
          controller={{ scrollZoom: true, dragPan: true, doubleClickZoom: true }}
          onViewStateChange={({ viewState: vs }) => setViewState(vs)}
          layers={layers}
          getTooltip={({ object }) =>
            object && {
              html: `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.5">
                       ${
                         object.c != null && categories[object.c]
                           ? `<span style="color:${hexFor(object.c)}">●</span> <b>${categories[object.c]}</b><br/>`
                           : ""
                       }
                       cell #${object.id}<br/>
                       x: ${object.x.toFixed(3)} &nbsp; y: ${object.y.toFixed(3)}
                     </div>`,
              style: {
                backgroundColor: "#0f172a",
                color: "#e2e8f0",
                border: "1px solid #312e81",
                borderRadius: "8px",
                padding: "8px 10px",
              },
            }
          }
        />
      )}

      {/* Legend (top-right) — click an item to show/hide that type */}
      {hasCategories && (
        <div className="absolute right-4 top-4 max-h-[60%] w-48 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/80 p-3 backdrop-blur askcell-scroll">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate-500">
            {labelField || "cell type"}
          </div>
          <div className="space-y-1">
            {categories.map((name, i) => {
              const isHidden = hidden.has(i);
              return (
                <button
                  key={name}
                  onClick={() => toggleCategory(i)}
                  className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition hover:bg-slate-800/60 ${
                    isHidden ? "opacity-35" : "opacity-100"
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: hexFor(i) }}
                  />
                  <span className="truncate text-slate-200">{name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Point-size slider (bottom-center) */}
      <div className="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/80 px-4 py-2 backdrop-blur">
        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
          size
        </span>
        <input
          type="range"
          min="1"
          max="12"
          step="0.5"
          value={pointSize}
          onChange={(e) => setPointSize(parseFloat(e.target.value))}
          className="h-1 w-40 cursor-pointer accent-indigo-500"
        />
        <span className="w-6 text-center font-mono text-xs text-indigo-300">
          {pointSize}
        </span>
      </div>

      {/* Cell counter (bottom-left) */}
      <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 font-mono text-xs text-indigo-300 backdrop-blur">
        {visibleCells.length.toLocaleString()}
        {hidden.size > 0 ? ` / ${cells.length.toLocaleString()}` : ""} cells
      </div>

      {/* Reset view (bottom-right) */}
      <button
        onClick={resetView}
        className="absolute bottom-4 right-4 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 font-mono text-xs text-slate-300 backdrop-blur transition hover:border-emerald-500/50 hover:text-emerald-300"
      >
        reset view
      </button>
    </div>
  );
}
