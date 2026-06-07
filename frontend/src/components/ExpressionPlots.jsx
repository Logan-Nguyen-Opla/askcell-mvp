import React, { useMemo, useState } from "react";
import { viridisHex, histogram, norm, categoryHex } from "../lib/viz.js";

/**
 * ExpressionPlots
 * ---------------
 * Bottom "plots drawer" with three cellxgene-VIP-style views, all rendered as
 * dependency-free SVG:
 *   - Violin:  per-cell-type distribution of the ACTIVE gene
 *   - Dot:     genes x cell types; dot size = % expressing, color = mean
 *   - Heatmap: genes x cell types; cell color = mean expression (row-scaled)
 *
 * Props:
 *   genes: string[]                       // genes added by the user (chips)
 *   grouped: {cell_types, rows} | null    // /api/expression/grouped result
 *   activeGene: string | null
 *   geneCells: {gene, values, vmin, vmax} | null   // per-cell, for the violin
 *   cells: Array<{id, c?}>                 // to bucket violin values by type
 *   categories: string[]
 */

const palHex = (i) => categoryHex(i);

const TABS = [
  { key: "violin", label: "Violin" },
  { key: "dot", label: "Dot plot" },
  { key: "heatmap", label: "Heatmap" },
];

export default function ExpressionPlots({
  genes = [],
  grouped,
  activeGene,
  geneCells,
  cells = [],
  categories = [],
}) {
  const [tab, setTab] = useState("violin");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
          plots
        </span>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                tab === t.key
                  ? "bg-indigo-500/20 text-indigo-200"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {genes.length > 0 && (
          <span className="ml-auto truncate font-mono text-[10px] text-slate-500">
            {genes.join(" · ")}
          </span>
        )}
      </div>

      <div className="askcell-scroll flex-1 overflow-auto p-4">
        {tab === "violin" && (
          <Violin
            activeGene={activeGene}
            geneCells={geneCells}
            cells={cells}
            categories={categories}
          />
        )}
        {tab === "dot" && <DotPlot grouped={grouped} />}
        {tab === "heatmap" && <Heatmap grouped={grouped} />}
      </div>
    </div>
  );
}

function Empty({ children }) {
  return (
    <div className="flex h-full min-h-[160px] items-center justify-center text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

/* ----------------------------- Violin ----------------------------- */
function Violin({ activeGene, geneCells, cells, categories }) {
  const data = useMemo(() => {
    if (!geneCells || !geneCells.values || !cells.length || !categories.length) {
      return null;
    }
    const vals = geneCells.values;
    const BINS = 24;
    const groups = categories.map(() => []);
    for (const cell of cells) {
      const c = cell.c;
      if (c != null && c >= 0 && c < categories.length) {
        groups[c].push(vals[cell.id]);
      }
    }
    const vmin = geneCells.vmin;
    const vmax = geneCells.vmax;
    let maxDensity = 0;
    const densities = groups.map((g) => {
      if (!g.length) return new Array(BINS).fill(0);
      const counts = histogram(g, BINS, vmin, vmax);
      const dens = counts.map((c) => c / g.length); // normalize by group size
      for (const d of dens) if (d > maxDensity) maxDensity = d;
      return dens;
    });
    const means = groups.map(
      (g) => (g.length ? g.reduce((a, b) => a + b, 0) / g.length : 0)
    );
    return { densities, groups, means, vmin, vmax, maxDensity, BINS };
  }, [geneCells, cells, categories]);

  if (!activeGene || !geneCells) {
    return <Empty>Add or click a gene to see its distribution per cell type.</Empty>;
  }
  if (geneCells.error) return <Empty>Gene “{activeGene}” not found in this dataset.</Empty>;
  if (!data) return <Empty>No cell-type annotation to split by.</Empty>;

  const H = 220;
  const colW = 92;
  const padL = 44;
  const padB = 64;
  const W = padL + categories.length * colW + 12;
  const { densities, means, vmin, vmax, maxDensity, BINS } = data;
  const yFor = (v) => H - norm(v, vmin, vmax) * H;
  const halfMax = colW * 0.42;

  return (
    <div>
      <div className="mb-2 font-mono text-xs text-slate-300">
        {activeGene} — expression distribution
      </div>
      <svg width={W} height={H + padB} className="overflow-visible">
        {/* y axis */}
        <line x1={padL} y1={0} x2={padL} y2={H} stroke="#334155" />
        {[vmin, (vmin + vmax) / 2, vmax].map((v, i) => (
          <g key={i}>
            <text
              x={padL - 6}
              y={yFor(v) + 3}
              textAnchor="end"
              className="fill-slate-500 font-mono text-[9px]"
            >
              {v.toFixed(1)}
            </text>
            <line x1={padL} y1={yFor(v)} x2={W} y2={yFor(v)} stroke="#1e293b" />
          </g>
        ))}
        {categories.map((name, ci) => {
          const cx = padL + ci * colW + colW / 2;
          const dens = densities[ci];
          // Build a mirrored violin path across the bins.
          const pts = [];
          for (let b = 0; b < BINS; b++) {
            const frac = (b + 0.5) / BINS;
            const v = vmin + frac * (vmax - vmin);
            const y = yFor(v);
            const w = maxDensity ? (dens[b] / maxDensity) * halfMax : 0;
            pts.push([cx + w, y]);
          }
          const left = [];
          for (let b = BINS - 1; b >= 0; b--) {
            const frac = (b + 0.5) / BINS;
            const v = vmin + frac * (vmax - vmin);
            const y = yFor(v);
            const w = maxDensity ? (dens[b] / maxDensity) * halfMax : 0;
            left.push([cx - w, y]);
          }
          const all = [...pts, ...left];
          const path =
            "M " + all.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L ") + " Z";
          return (
            <g key={name}>
              <path d={path} fill={palHex(ci)} fillOpacity={0.55} stroke={palHex(ci)} />
              {/* mean marker */}
              <line
                x1={cx - halfMax * 0.5}
                x2={cx + halfMax * 0.5}
                y1={yFor(means[ci])}
                y2={yFor(means[ci])}
                stroke="#e2e8f0"
                strokeWidth={1.5}
              />
              <text
                x={cx}
                y={H + 14}
                textAnchor="end"
                transform={`rotate(-35 ${cx} ${H + 14})`}
                className="fill-slate-400 font-mono text-[9px]"
              >
                {name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ----------------------------- Dot plot ----------------------------- */
function DotPlot({ grouped }) {
  const ok = grouped && grouped.rows && grouped.rows.length;
  const maxMean = useMemo(() => {
    if (!ok) return 1;
    let m = 0;
    for (const r of grouped.rows)
      if (r.stats) for (const s of r.stats) if (s.mean > m) m = s.mean;
    return m || 1;
  }, [grouped, ok]);

  if (!ok) return <Empty>Add a gene to build a dot plot across cell types.</Empty>;

  const cats = grouped.cell_types;
  const rowH = 30;
  const colW = 92;
  const padL = 92;
  const padT = 70;
  const W = padL + cats.length * colW + 12;
  const Hsvg = padT + grouped.rows.length * rowH + 10;

  return (
    <svg width={W} height={Hsvg} className="overflow-visible">
      {cats.map((c, i) => {
        const x = padL + i * colW + colW / 2;
        return (
          <text
            key={c}
            x={x}
            y={padT - 10}
            textAnchor="start"
            transform={`rotate(-40 ${x} ${padT - 10})`}
            className="fill-slate-400 font-mono text-[9px]"
          >
            {c}
          </text>
        );
      })}
      {grouped.rows.map((r, ri) => {
        const y = padT + ri * rowH + rowH / 2;
        return (
          <g key={r.gene + ri}>
            <text x={padL - 10} y={y + 3} textAnchor="end" className="fill-slate-300 font-mono text-[10px]">
              {r.gene}
            </text>
            {r.error
              ? <text x={padL + 4} y={y + 3} className="fill-rose-400 font-mono text-[9px]">not found</text>
              : r.stats.map((s, ci) => {
                  const x = padL + ci * colW + colW / 2;
                  const radius = 3 + (s.pct / 100) * 11;
                  return (
                    <circle
                      key={ci}
                      cx={x}
                      cy={y}
                      r={radius}
                      fill={viridisHex(s.mean / maxMean)}
                      stroke="#0f172a"
                    >
                      <title>{`${r.gene} · ${cats[ci]}\nmean ${s.mean}\n${s.pct}% expressing`}</title>
                    </circle>
                  );
                })}
          </g>
        );
      })}
      <DotLegend x={padL} y={Hsvg - 2} maxMean={maxMean} />
    </svg>
  );
}

function DotLegend({ x, y, maxMean }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <text x={0} y={-30} className="fill-slate-500 font-mono text-[8px]">size = % expressing · color = mean (0–{maxMean.toFixed(1)})</text>
      {[10, 50, 100].map((p, i) => (
        <g key={p} transform={`translate(${i * 46}, -12)`}>
          <circle cx={6} cy={0} r={3 + (p / 100) * 11} fill="#475569" />
          <text x={22} y={3} className="fill-slate-500 font-mono text-[8px]">{p}%</text>
        </g>
      ))}
    </g>
  );
}

/* ----------------------------- Heatmap ----------------------------- */
function Heatmap({ grouped }) {
  const ok = grouped && grouped.rows && grouped.rows.length;
  if (!ok) return <Empty>Add genes to build a heatmap across cell types.</Empty>;

  const cats = grouped.cell_types;
  const rowH = 26;
  const cellW = 64;
  const padL = 92;
  const padT = 70;
  const W = padL + cats.length * cellW + 12;
  const Hsvg = padT + grouped.rows.length * rowH + 10;

  return (
    <svg width={W} height={Hsvg} className="overflow-visible">
      {cats.map((c, i) => {
        const x = padL + i * cellW + cellW / 2;
        return (
          <text
            key={c}
            x={x}
            y={padT - 8}
            textAnchor="start"
            transform={`rotate(-40 ${x} ${padT - 8})`}
            className="fill-slate-400 font-mono text-[9px]"
          >
            {c}
          </text>
        );
      })}
      {grouped.rows.map((r, ri) => {
        const y = padT + ri * rowH;
        // Row-scaled so each gene uses the full color range.
        const rowMax = r.stats ? Math.max(1e-6, ...r.stats.map((s) => s.mean)) : 1;
        return (
          <g key={r.gene + ri}>
            <text x={padL - 10} y={y + rowH / 2 + 3} textAnchor="end" className="fill-slate-300 font-mono text-[10px]">
              {r.gene}
            </text>
            {r.error
              ? <text x={padL + 4} y={y + rowH / 2 + 3} className="fill-rose-400 font-mono text-[9px]">not found</text>
              : r.stats.map((s, ci) => (
                  <rect
                    key={ci}
                    x={padL + ci * cellW}
                    y={y + 2}
                    width={cellW - 2}
                    height={rowH - 4}
                    fill={viridisHex(s.mean / rowMax)}
                  >
                    <title>{`${r.gene} · ${cats[ci]}\nmean ${s.mean}`}</title>
                  </rect>
                ))}
          </g>
        );
      })}
      <text x={padL} y={Hsvg - 2} className="fill-slate-500 font-mono text-[8px]">
        color = mean expression (scaled per gene row)
      </text>
    </svg>
  );
}
