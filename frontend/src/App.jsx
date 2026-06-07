import React, { useCallback, useEffect, useRef, useState } from "react";
import UmapViewer from "./components/UmapViewer.jsx";
import ChatSidebar from "./components/ChatSidebar.jsx";

/**
 * App
 * ---
 * The application state controller and 70/30 grid layout.
 *
 * Flow:
 *   drop .h5ad -> POST /api/upload -> GET /api/umap -> render scatterplot
 *
 * Layout (fixed 100vh / 100vw, no window scrollbars):
 *   - Left 70%: toolbar (drag-and-drop upload + indicators) over WebGL canvas
 *   - Right 30%: AskCell chat sidebar
 */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

// idle | uploading | ready | error
function StatusPill({ status, filename, cellCount, error }) {
  const map = {
    idle: { dot: "bg-slate-600", label: "No dataset" },
    uploading: { dot: "bg-amber-400 animate-pulse-dot", label: "Processing…" },
    ready: { dot: "bg-emerald-400", label: filename || "Ready" },
    error: { dot: "bg-rose-500", label: error || "Error" },
  };
  const s = map[status] || map.idle;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-1.5">
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      <span className="max-w-[260px] truncate font-mono text-xs text-slate-300">
        {s.label}
      </span>
      {status === "ready" && (
        <span className="font-mono text-xs text-indigo-300">
          · {cellCount.toLocaleString()} cells
        </span>
      )}
    </div>
  );
}

export default function App() {
  const [cells, setCells] = useState([]);
  const [categories, setCategories] = useState([]);
  const [labelField, setLabelField] = useState(null);
  const [status, setStatus] = useState("idle");
  const [filename, setFilename] = useState(null);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);

  const datasetReady = status === "ready";

  // On first load, check whether the backend already has a dataset cached
  // (e.g. the bundled sample auto-loaded on startup) and render it immediately.
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
        // Backend not up yet — stay idle; the user can upload manually.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.name.endsWith(".h5ad")) {
      setStatus("error");
      setError("Please upload an .h5ad file");
      return;
    }

    setStatus("uploading");
    setError(null);

    try {
      // 1) Upload + parse on the backend.
      const form = new FormData();
      form.append("file", file);
      const upRes = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        body: form,
      });
      if (!upRes.ok) {
        const err = await upRes.json().catch(() => ({}));
        throw new Error(err.detail || `Upload failed (${upRes.status})`);
      }
      const upData = await upRes.json();

      // 2) Fetch the cached UMAP coordinates.
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
  }, []);

  // --- Drag & drop handlers ---
  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      handleFile(file);
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
      {/* ---------------- Left canvas pane (70%) ---------------- */}
      <div className="relative flex h-full w-[70%] flex-col border-r border-slate-800">
        {/* Toolbar */}
        <div className="z-10 flex items-center gap-4 border-b border-slate-800 bg-slate-950/80 px-5 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧬</span>
            <span className="font-semibold tracking-tight text-slate-100">
              AskCell
            </span>
            <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">
              MVP v1.0
            </span>
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={status === "uploading"}
            className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-sm font-medium text-indigo-200 transition hover:bg-indigo-500/20 disabled:opacity-50"
          >
            Upload .h5ad
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".h5ad"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />

          <div className="ml-auto">
            <StatusPill
              status={status}
              filename={filename}
              cellCount={cells.length}
              error={error}
            />
          </div>
        </div>

        {/* Canvas / drop zone */}
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
            />
          ) : (
            <EmptyState status={status} error={error} />
          )}

          {/* Drag overlay */}
          {dragging && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
              <div className="rounded-2xl border-2 border-dashed border-indigo-400 px-10 py-8 text-center">
                <div className="mb-2 text-4xl">⬇</div>
                <p className="font-medium text-indigo-200">
                  Drop your .h5ad dataset
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- Right control sidebar (30%) ---------------- */}
      <div className="h-full w-[30%]">
        <ChatSidebar datasetReady={datasetReady} />
      </div>
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
        {status === "uploading"
          ? "Processing dataset…"
          : "Drop an .h5ad file to begin"}
      </h3>
      <p className="mt-2 max-w-sm text-center text-sm text-slate-500">
        {status === "error"
          ? error
          : "Upload a single-cell RNA-seq dataset with pre-computed UMAP coordinates to visualize thousands of cells in real time."}
      </p>
    </div>
  );
}
