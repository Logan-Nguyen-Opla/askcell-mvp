import React, { useCallback, useEffect, useState } from "react";
import UmapViewer from "./components/UmapViewer.jsx";
import ChatSidebar from "./components/ChatSidebar.jsx";
import ControlsPanel from "./components/ControlsPanel.jsx";
import ExpressionPlots from "./components/ExpressionPlots.jsx";
import QcHistograms from "./components/QcHistograms.jsx";

/**
 * App
 * ---
 * cellxgene-VIP-style 3-panel layout + the single source of truth for all
 * cross-panel state:
 *
 *   [ ControlsPanel ] [ Embedding + Plots drawer ] [ Chat / QC + Selection ]
 *
 * Flow: upload .h5ad -> /api/upload -> /api/umap; then genes drive
 * /api/gene/{g} (coloring + violin) and /api/expression/grouped (dot/heatmap),
 * and box-selection drives /api/selection.
 */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function App() {
  // dataset
  const [cells, setCells] = useState([]);
  const [categories, setCategories] = useState([]);
  const [labelField, setLabelField] = useState(null);
  const [status, setStatus] = useState("idle");
  const [filename, setFilename] = useState(null);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);

  // coloring / genes
  const [colorMode, setColorMode] = useState("celltype");
  const [geneInput, setGeneInput] = useState("");
  const [genes, setGenes] = useState([]);
  const [activeGene, setActiveGene] = useState(null);
  const [geneData, setGeneData] = useState({}); // gene -> {gene,values,vmin,vmax}
  const [geneError, setGeneError] = useState(null);
  const [grouped, setGrouped] = useState(null);

  // viewer controls
  const [hidden, setHidden] = useState(() => new Set());
  const [pointSize, setPointSize] = useState(4);
  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState(null);

  // right rail
  const [rightTab, setRightTab] = useState("chat");

  const datasetReady = status === "ready";
  const geneCells = activeGene ? geneData[activeGene] || null : null;

  // Reset all derived analysis state when a new dataset loads.
  const resetAnalysis = useCallback(() => {
    setColorMode("celltype");
    setGeneInput("");
    setGenes([]);
    setActiveGene(null);
    setGeneData({});
    setGeneError(null);
    setGrouped(null);
    setHidden(new Set());
    setSelectMode(false);
    setSelection(null);
  }, []);

  // On first load, pick up an already-cached dataset (bundled sample).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await fetch(`${API_URL}/api/status`).then((r) => r.json());
        if (!cancelled && s.loaded) {
          const u = await fetch(`${API_URL}/api/umap`).then((r) => r.json());
          if (!cancelled) {
            setCells(u.cells);
            setCategories(u.categories || []);
            setLabelField(u.label_field || null);
            setFilename(s.filename);
            setStatus("ready");
          }
        }
      } catch {
        /* backend not up yet — stay idle */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFile = useCallback(
    async (file) => {
      if (!file) return;
      if (!file.name.endsWith(".h5ad")) {
        setStatus("error");
        setError("Please upload an .h5ad file");
        return;
      }
      setStatus("uploading");
      setError(null);
      resetAnalysis();
      try {
        const form = new FormData();
        form.append("file", file);
        const upRes = await fetch(`${API_URL}/api/upload`, { method: "POST", body: form });
        if (!upRes.ok) {
          const err = await upRes.json().catch(() => ({}));
          throw new Error(err.detail || `Upload failed (${upRes.status})`);
        }
        const upData = await upRes.json();

        const umapRes = await fetch(`${API_URL}/api/umap`);
        if (!umapRes.ok) {
          const err = await umapRes.json().catch(() => ({}));
          throw new Error(err.detail || `UMAP fetch failed (${umapRes.status})`);
        }
        const umapData = await umapRes.json();
        setCells(umapData.cells);
        setCategories(umapData.categories || []);
        setLabelField(umapData.label_field || null);
        setFilename(upData.filename);
        setStatus("ready");
      } catch (e) {
        setStatus("error");
        setError(e.message);
      }
    },
    [resetAnalysis]
  );

  // ---- Gene handling ----
  const fetchGene = useCallback(
    async (sym) => {
      const res = await fetch(`${API_URL}/api/gene/${encodeURIComponent(sym)}`);
      if (!res.ok) throw new Error(`lookup failed (${res.status})`);
      return res.json();
    },
    []
  );

  const onSubmitGene = useCallback(
    async (raw) => {
      const sym = (raw || "").trim();
      if (!sym || !datasetReady) return;
      setGeneError(null);
      try {
        const data = await fetchGene(sym);
        if (data.error) {
          setGeneError(`“${sym}” not found`);
          return;
        }
        setGeneData((prev) => ({ ...prev, [data.gene]: data }));
        setGenes((prev) => (prev.includes(data.gene) ? prev : [...prev, data.gene]));
        setActiveGene(data.gene);
        setColorMode("gene");
        setGeneInput("");
      } catch (e) {
        setGeneError(e.message);
      }
    },
    [datasetReady, fetchGene]
  );

  const onPickGene = useCallback(
    async (g) => {
      setActiveGene(g);
      setColorMode("gene");
      if (!geneData[g]) {
        try {
          const data = await fetchGene(g);
          if (!data.error) setGeneData((prev) => ({ ...prev, [g]: data }));
        } catch {
          /* ignore */
        }
      }
    },
    [geneData, fetchGene]
  );

  const onRemoveGene = useCallback(
    (g) => {
      setGenes((prev) => {
        const next = prev.filter((x) => x !== g);
        if (activeGene === g) {
          const fallback = next[next.length - 1] || null;
          setActiveGene(fallback);
          if (!fallback) setColorMode("celltype");
        }
        return next;
      });
    },
    [activeGene]
  );

  const handleGeneInput = useCallback(
    (v) => {
      setGeneInput(v);
      if (geneError) setGeneError(null);
    },
    [geneError]
  );

  // Refetch grouped (dot/heatmap) whenever the gene set changes.
  useEffect(() => {
    if (!datasetReady || genes.length === 0) {
      setGrouped(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/expression/grouped`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ genes }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setGrouped(data);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [genes, datasetReady]);

  // ---- Legend + selection ----
  const onToggleCategory = useCallback((idx) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const onSelect = useCallback(async (ids) => {
    if (!ids || ids.length === 0) {
      setSelection(null);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cell_ids: ids }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setSelection(data);
      setRightTab("chat");
    } catch {
      /* ignore */
    }
  }, []);

  // ---- Drag & drop ----
  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      handleFile(e.dataTransfer.files?.[0]);
    },
    [handleFile]
  );
  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
  }, []);
  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-200">
      {/* ---------------- Left controls rail ---------------- */}
      <ControlsPanel
        status={status}
        filename={filename}
        cellCount={cells.length}
        error={error}
        datasetReady={datasetReady}
        onFile={handleFile}
        colorMode={colorMode}
        onUseCellType={() => setColorMode("celltype")}
        geneInput={geneInput}
        setGeneInput={handleGeneInput}
        onSubmitGene={onSubmitGene}
        genes={genes}
        activeGene={activeGene}
        onPickGene={onPickGene}
        onRemoveGene={onRemoveGene}
        geneError={geneError}
        categories={categories}
        labelField={labelField}
        hidden={hidden}
        onToggleCategory={onToggleCategory}
        pointSize={pointSize}
        setPointSize={setPointSize}
        selectMode={selectMode}
        setSelectMode={setSelectMode}
      />

      {/* ---------------- Center: embedding + plots ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="relative flex-1"
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          {datasetReady ? (
            <UmapViewer
              cells={cells}
              categories={categories}
              labelField={labelField}
              colorMode={colorMode}
              geneValues={geneCells}
              hidden={hidden}
              pointSize={pointSize}
              selectMode={selectMode}
              onSelect={onSelect}
            />
          ) : (
            <EmptyState status={status} error={error} />
          )}

          {dragging && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
              <div className="rounded-2xl border-2 border-dashed border-indigo-400 px-10 py-8 text-center">
                <div className="mb-2 text-4xl">⬇</div>
                <p className="font-medium text-indigo-200">Drop your .h5ad dataset</p>
              </div>
            </div>
          )}
        </div>

        {datasetReady && (
          <div className="h-72 shrink-0 border-t border-slate-800 bg-slate-900/30">
            <ExpressionPlots
              genes={genes}
              grouped={grouped}
              activeGene={activeGene}
              geneCells={geneCells}
              cells={cells}
              categories={categories}
            />
          </div>
        )}
      </div>

      {/* ---------------- Right rail: selection + Chat/QC ---------------- */}
      <div className="flex h-full w-96 shrink-0 flex-col border-l border-slate-800">
        {selection && (
          <SelectionCard selection={selection} onClear={() => setSelection(null)} />
        )}

        <div className="flex border-b border-slate-800">
          {["chat", "qc"].map((t) => (
            <button
              key={t}
              onClick={() => setRightTab(t)}
              className={`flex-1 px-3 py-2.5 text-xs font-medium uppercase tracking-wide transition ${
                rightTab === t
                  ? "border-b-2 border-indigo-400 text-indigo-200"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {t === "chat" ? "AI Chat" : "QC"}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {rightTab === "chat" ? (
            <ChatSidebar datasetReady={datasetReady} />
          ) : (
            <QcHistograms
              apiUrl={API_URL}
              reloadKey={filename}
              datasetReady={datasetReady}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SelectionCard({ selection, onClear }) {
  return (
    <div className="border-b border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-emerald-200">
          {selection.n.toLocaleString()} cells selected
        </span>
        <button
          onClick={onClear}
          className="font-mono text-[10px] text-slate-400 hover:text-rose-400"
        >
          clear
        </button>
      </div>
      {selection.by_cell_type?.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {selection.by_cell_type.slice(0, 5).map((b) => (
            <div key={b.cell_type} className="flex justify-between font-mono text-[10px] text-slate-300">
              <span className="truncate">{b.cell_type}</span>
              <span className="text-slate-500">{b.count}</span>
            </div>
          ))}
        </div>
      )}
      {selection.top_genes?.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 font-mono text-[9px] uppercase tracking-widest text-slate-500">
            enriched genes
          </div>
          <div className="flex flex-wrap gap-1">
            {selection.top_genes.slice(0, 8).map((g) => (
              <span
                key={g.gene}
                className="rounded bg-slate-800/70 px-1.5 py-0.5 font-mono text-[10px] text-emerald-200"
                title={
                  g.enrichment != null
                    ? `mean ${g.mean} · +${g.enrichment} vs all`
                    : `mean ${g.mean}`
                }
              >
                {g.gene}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ status, error }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-slate-950">
      <div className="mb-5 grid grid-cols-6 gap-1.5 opacity-30">
        {Array.from({ length: 36 }).map((_, i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-indigo-400"
            style={{ opacity: 0.2 + ((i * 37) % 80) / 100 }}
          />
        ))}
      </div>
      <h3 className="text-lg font-medium text-slate-300">
        {status === "uploading" ? "Processing dataset…" : "Drop an .h5ad file to begin"}
      </h3>
      <p className="mt-2 max-w-sm text-center text-sm text-slate-500">
        {status === "error"
          ? error
          : "Upload a single-cell RNA-seq dataset with pre-computed UMAP coordinates to explore it in real time."}
      </p>
    </div>
  );
}
