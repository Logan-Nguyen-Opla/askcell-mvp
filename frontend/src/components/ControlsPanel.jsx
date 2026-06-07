import React, { useRef } from "react";
import { categoryHex } from "../lib/viz.js";

/**
 * ControlsPanel (left rail)
 * -------------------------
 * cellxgene-VIP-style control column: branding, dataset upload/status, the
 * color-by control (cell type vs gene), the gene list, the annotation legend
 * (show/hide cell types), point size, and the box-select toggle.
 *
 * It is fully controlled — every piece of state lives in App and is threaded
 * down as props so the embedding, plots, and chat all stay in sync.
 */

const palHex = (i) => categoryHex(i);

const STATUS = {
  idle: { dot: "bg-slate-600", label: "No dataset" },
  uploading: { dot: "bg-amber-400 animate-pulse-dot", label: "Processing…" },
  ready: { dot: "bg-emerald-400", label: "Ready" },
  error: { dot: "bg-rose-500", label: "Error" },
};

export default function ControlsPanel({
  status,
  filename,
  cellCount,
  error,
  datasetReady,
  onFile,
  // coloring
  colorMode,
  onUseCellType,
  geneInput,
  setGeneInput,
  onSubmitGene,
  genes,
  activeGene,
  onPickGene,
  onRemoveGene,
  geneError,
  // legend
  categories,
  labelField,
  hidden,
  onToggleCategory,
  // viewer controls
  pointSize,
  setPointSize,
  selectMode,
  setSelectMode,
}) {
  const fileRef = useRef(null);
  const s = STATUS[status] || STATUS.idle;
  const hasCategories = categories && categories.length > 0;

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-900/40">
      {/* Branding */}
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3.5">
        <span className="text-lg">🧬</span>
        <span className="font-semibold tracking-tight text-slate-100">AskCell</span>
        <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">
          VIP
        </span>
      </div>

      <div className="askcell-scroll flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {/* Dataset */}
        <Section title="dataset">
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
            <span className="truncate font-mono text-xs text-slate-300">
              {status === "ready" ? filename || "Ready" : status === "error" ? error || "Error" : s.label}
            </span>
          </div>
          {datasetReady && (
            <div className="mt-1 font-mono text-[10px] text-indigo-300/80">
              {cellCount.toLocaleString()} cells
            </div>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={status === "uploading"}
            className="mt-2 w-full rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-sm font-medium text-indigo-200 transition hover:bg-indigo-500/20 disabled:opacity-50"
          >
            Upload .h5ad
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".h5ad"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </Section>

        {/* Color by */}
        <Section title="color by">
          <div className="flex gap-1.5">
            <button
              onClick={onUseCellType}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs transition ${
                colorMode === "celltype"
                  ? "bg-indigo-500/20 text-indigo-200"
                  : "border border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              Cell type
            </button>
            <button
              disabled
              className={`flex-1 rounded-md px-2 py-1.5 text-xs ${
                colorMode === "gene"
                  ? "bg-indigo-500/20 text-indigo-200"
                  : "border border-slate-800 text-slate-500"
              }`}
            >
              Gene {activeGene ? `· ${activeGene}` : ""}
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmitGene(geneInput);
            }}
            className="mt-2"
          >
            <input
              value={geneInput}
              onChange={(e) => setGeneInput(e.target.value)}
              disabled={!datasetReady}
              placeholder="Add a gene (e.g. CD3D)…"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-indigo-500/60 focus:outline-none disabled:opacity-50"
            />
          </form>
          {geneError && (
            <div className="mt-1 font-mono text-[10px] text-rose-400">{geneError}</div>
          )}
          {genes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {genes.map((g) => (
                <span
                  key={g}
                  className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] transition ${
                    g === activeGene
                      ? "bg-emerald-500/20 text-emerald-200"
                      : "bg-slate-800/70 text-slate-300"
                  }`}
                >
                  <button onClick={() => onPickGene(g)} className="hover:underline">
                    {g}
                  </button>
                  <button
                    onClick={() => onRemoveGene(g)}
                    className="text-slate-500 hover:text-rose-400"
                    aria-label={`remove ${g}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* Annotations / legend */}
        {hasCategories && (
          <Section title={labelField || "cell type"}>
            <div className="space-y-0.5">
              {categories.map((name, i) => {
                const isHidden = hidden.has(i);
                return (
                  <button
                    key={name}
                    onClick={() => onToggleCategory(i)}
                    className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition hover:bg-slate-800/60 ${
                      isHidden ? "opacity-35" : "opacity-100"
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: palHex(i) }}
                    />
                    <span className="truncate text-slate-200">{name}</span>
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        {/* Point size */}
        <Section title="point size">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="1"
              max="12"
              step="0.5"
              value={pointSize}
              onChange={(e) => setPointSize(parseFloat(e.target.value))}
              className="h-1 flex-1 cursor-pointer accent-indigo-500"
            />
            <span className="w-6 text-center font-mono text-xs text-indigo-300">
              {pointSize}
            </span>
          </div>
        </Section>

        {/* Selection */}
        <Section title="selection">
          <button
            onClick={() => setSelectMode(!selectMode)}
            disabled={!datasetReady}
            className={`w-full rounded-lg px-3 py-1.5 text-xs transition disabled:opacity-50 ${
              selectMode
                ? "bg-emerald-500/20 text-emerald-200"
                : "border border-slate-800 text-slate-300 hover:text-emerald-200"
            }`}
          >
            {selectMode ? "Box-select: ON (drag on plot)" : "Enable box-select"}
          </button>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-500">
        {title}
      </div>
      {children}
    </div>
  );
}
