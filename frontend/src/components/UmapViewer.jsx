import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import DeckGL from "@deck.gl/react";
import { OrthographicView } from "@deck.gl/core";
import { ScatterplotLayer } from "@deck.gl/layers";
import { viridisRgb, viridisHex, norm, categoryRgb, categoryHex } from "../lib/viz.js";

/**
 * UmapViewer
 * ----------
 * Hardware-accelerated 2D scatterplot of UMAP coordinates.
 *
 * Coloring has two modes (driven by the left controls panel):
 *   - "celltype": categorical palette keyed on each cell's `c` index
 *   - "gene":     continuous viridis ramp keyed on a per-cell expression value
 *
 * Also supports box-selection: in select mode, dragging draws a rectangle and
 * the enclosed cells are reported via onSelect(ids) using deck's pickObjects.
 *
 * Props:
 *   cells: Array<{ id, x, y, c? }>
 *   categories: string[]
 *   labelField: string | null
 *   colorMode: "celltype" | "gene"
 *   geneValues: { gene, values:number[], vmin, vmax } | null
 *   hidden: Set<number>          // hidden category indices (from the legend)
 *   pointSize: number
 *   selectMode: boolean
 *   onSelect: (ids:number[]) => void
 */

const HIGHLIGHT = [255, 255, 255, 255];

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

export default function UmapViewer({
  cells,
  categories = [],
  labelField,
  colorMode = "celltype",
  geneValues = null,
  hidden,
  pointSize = 4,
  selectMode = false,
  onSelect,
}) {
  const containerRef = useRef(null);
  const deckRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewState, setViewState] = useState(null);
  const [rect, setRect] = useState(null); // {x0,y0,x1,y1} during box drag

  const hasCategories = categories && categories.length > 0;
  const geneMode = colorMode === "gene" && geneValues && geneValues.values;
  const bounds = useMemo(() => computeBounds(cells), [cells]);
  const hiddenSet = hidden || EMPTY_SET;

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

  useEffect(() => {
    if (bounds && size.width && size.height) {
      setViewState(fitViewState(bounds, size.width, size.height));
    }
  }, [bounds, size.width, size.height]);

  const resetView = useCallback(() => {
    if (bounds && size.width && size.height) {
      setViewState(fitViewState(bounds, size.width, size.height));
    }
  }, [bounds, size.width, size.height]);

  const visibleCells = useMemo(() => {
    if (!hasCategories || hiddenSet.size === 0) return cells;
    return cells.filter((d) => !hiddenSet.has(d.c));
  }, [cells, hiddenSet, hasCategories]);

  const getFillColor = useCallback(
    (d) => {
      if (geneMode) {
        const v = geneValues.values[d.id];
        return viridisRgb(norm(v, geneValues.vmin, geneValues.vmax));
      }
      return categoryRgb(d.c);
    },
    [geneMode, geneValues]
  );

  const layers = useMemo(
    () => [
      new ScatterplotLayer({
        id: "umap-cells",
        data: visibleCells,
        getPosition: (d) => [d.x, d.y],
        getFillColor,
        // Fixed on-screen size: radius is in screen pixels and the min/max
        // clamps are locked to pointSize, so points NEVER grow or shrink when
        // zooming — only their spacing changes.
        getRadius: pointSize,
        radiusUnits: "pixels",
        radiusMinPixels: pointSize,
        radiusMaxPixels: pointSize,
        stroked: false,
        filled: true,
        antialiasing: true,
        pickable: true,
        autoHighlight: !selectMode,
        highlightColor: HIGHLIGHT,
        opacity: 0.9,
        updateTriggers: {
          getRadius: pointSize,
          getFillColor: [geneMode, geneValues && geneValues.gene],
        },
      }),
    ],
    [visibleCells, pointSize, selectMode, getFillColor, geneMode, geneValues]
  );

  // ---- Box selection (only active in select mode) ----
  const onMouseDown = useCallback(
    (e) => {
      if (!selectMode) return;
      const r = containerRef.current.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      setRect({ x0: x, y0: y, x1: x, y1: y });
    },
    [selectMode]
  );

  const onMouseMove = useCallback(
    (e) => {
      if (!selectMode || !rect) return;
      const r = containerRef.current.getBoundingClientRect();
      setRect((prev) => ({
        ...prev,
        x1: e.clientX - r.left,
        y1: e.clientY - r.top,
      }));
    },
    [selectMode, rect]
  );

  const onMouseUp = useCallback(() => {
    if (!selectMode || !rect) return;
    const x = Math.min(rect.x0, rect.x1);
    const y = Math.min(rect.y0, rect.y1);
    const width = Math.abs(rect.x1 - rect.x0);
    const height = Math.abs(rect.y1 - rect.y0);
    setRect(null);
    if (width < 3 || height < 3) {
      onSelect?.([]); // treated as a click-to-clear
      return;
    }
    const deck = deckRef.current;
    if (deck && deck.pickObjects) {
      const picked = deck.pickObjects({ x, y, width, height });
      const ids = [];
      const seen = new Set();
      for (const p of picked) {
        const id = p.object?.id;
        if (id != null && !seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
      onSelect?.(ids);
    }
  }, [selectMode, rect, onSelect]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full bg-slate-950"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      style={{ cursor: selectMode ? "crosshair" : "default" }}
    >
      {viewState && (
        <DeckGL
          ref={deckRef}
          views={new OrthographicView({ id: "ortho", flipY: false })}
          viewState={viewState}
          controller={{
            scrollZoom: true,
            dragPan: !selectMode,
            doubleClickZoom: true,
          }}
          onViewStateChange={({ viewState: vs }) => setViewState(vs)}
          layers={layers}
          getTooltip={({ object }) =>
            object && {
              html: `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.5">
                       ${
                         object.c != null && categories[object.c]
                           ? `<span style="color:${categoryHex(object.c)}">●</span> <b>${categories[object.c]}</b><br/>`
                           : ""
                       }
                       ${
                         geneMode
                           ? `<b>${geneValues.gene}</b>: ${(geneValues.values[object.id] ?? 0).toFixed(3)}<br/>`
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

      {/* Box-selection rectangle */}
      {rect && (
        <div
          className="pointer-events-none absolute border border-emerald-400/80 bg-emerald-400/10"
          style={{
            left: Math.min(rect.x0, rect.x1),
            top: Math.min(rect.y0, rect.y1),
            width: Math.abs(rect.x1 - rect.x0),
            height: Math.abs(rect.y1 - rect.y0),
          }}
        />
      )}

      {/* Continuous color bar (gene mode) */}
      {geneMode && (
        <div className="absolute right-4 top-4 rounded-xl border border-slate-800 bg-slate-900/80 p-3 backdrop-blur">
          <div className="mb-1.5 font-mono text-[11px] text-slate-200">
            {geneValues.gene}
          </div>
          <div
            className="h-2.5 w-40 rounded"
            style={{
              background: `linear-gradient(to right, ${viridisHex(0)}, ${viridisHex(
                0.25
              )}, ${viridisHex(0.5)}, ${viridisHex(0.75)}, ${viridisHex(1)})`,
            }}
          />
          <div className="mt-1 flex w-40 justify-between font-mono text-[9px] text-slate-500">
            <span>{geneValues.vmin}</span>
            <span>expression</span>
            <span>{geneValues.vmax}</span>
          </div>
        </div>
      )}

      {/* Cell counter (bottom-left) */}
      <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 font-mono text-xs text-indigo-300 backdrop-blur">
        {visibleCells.length.toLocaleString()}
        {hiddenSet.size > 0 ? ` / ${cells.length.toLocaleString()}` : ""} cells
        {selectMode && (
          <span className="ml-2 text-emerald-300">· drag to select</span>
        )}
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

const EMPTY_SET = new Set();
