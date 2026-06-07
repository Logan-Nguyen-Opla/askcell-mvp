import React, { useEffect, useState } from "react";
import { histogram, extent } from "../lib/viz.js";

/**
 * QcHistograms
 * ------------
 * Right-panel QC view: one histogram per numeric obs column (n_genes,
 * percent_mito, n_counts, …). Many datasets (incl. the bundled mock) carry no
 * numeric QC columns, so an informative empty state is the common case.
 *
 * Props:
 *   apiUrl: string
 *   reloadKey: any        // changes when the dataset changes -> refetch
 *   datasetReady: boolean
 */
export default function QcHistograms({ apiUrl, reloadKey, datasetReady }) {
  const [metrics, setMetrics] = useState(null); // null = loading
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!datasetReady) {
      setMetrics([]);
      return;
    }
    let cancelled = false;
    setMetrics(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/qc`);
        if (!res.ok) throw new Error(`QC fetch failed (${res.status})`);
        const data = await res.json();
        if (!cancelled) setMetrics(data.metrics || []);
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
          setMetrics([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, reloadKey, datasetReady]);

  if (metrics === null) {
    return <Centered>Loading QC metrics…</Centered>;
  }
  if (error) {
    return <Centered>⚠️ {error}</Centered>;
  }
  if (metrics.length === 0) {
    return (
      <Centered>
        This dataset has no numeric QC columns to plot.
        <br />
        <span className="text-slate-600">
          (Datasets with obs like <span className="font-mono">n_genes</span> or{" "}
          <span className="font-mono">percent_mito</span> will show histograms
          here.)
        </span>
      </Centered>
    );
  }

  return (
    <div className="askcell-scroll flex-1 space-y-5 overflow-y-auto px-4 py-4">
      {metrics.map((m) => (
        <QcChart key={m.name} name={m.name} values={m.values} />
      ))}
    </div>
  );
}

function Centered({ children }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-sm leading-relaxed text-slate-500">
      <p>{children}</p>
    </div>
  );
}

function QcChart({ name, values }) {
  const BINS = 28;
  const [min, max] = extent(values);
  const counts = histogram(values, BINS, min, max);
  const maxCount = Math.max(1, ...counts);
  const W = 240;
  const H = 80;
  const barW = W / BINS;
  const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-xs text-slate-200">{name}</span>
        <span className="font-mono text-[9px] text-slate-500">
          μ {mean.toFixed(2)}
        </span>
      </div>
      <svg width={W} height={H} className="block">
        {counts.map((c, i) => {
          const h = (c / maxCount) * (H - 4);
          return (
            <rect
              key={i}
              x={i * barW + 0.5}
              y={H - h}
              width={Math.max(0.5, barW - 1)}
              height={h}
              className="fill-indigo-400/70"
            />
          );
        })}
      </svg>
      <div className="flex justify-between font-mono text-[9px] text-slate-600">
        <span>{min.toFixed(1)}</span>
        <span>{max.toFixed(1)}</span>
      </div>
    </div>
  );
}
