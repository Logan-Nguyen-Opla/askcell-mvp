"""
cell_engine.py
==============
AnnData processing engine for AskCell.

Responsibilities
----------------
1. Hold a single uploaded ``.h5ad`` dataset in memory for the lifetime of the
   process (the ``cell_engine_instance`` singleton), so chat queries never have
   to re-read the file from disk -> avoids O(N) disk I/O on every question.
2. Emit UMAP coordinates in an ultra-lean array structure for the GPU viewer.
3. Compute deterministic gene-expression statistics for the AI agent's tool.

JSON Serialization Guardrail
----------------------------
Single-cell matrices are full of native NumPy scalars (``np.float32`` /
``np.float64``). FastAPI's default JSON encoder cannot serialize those and will
raise at runtime. Every numeric value that leaves this module is therefore
explicitly cast to a standard Python primitive via ``float()`` / ``int()``.
"""

from __future__ import annotations

import anndata as ad
import numpy as np
import pandas as pd
from scipy import sparse


# obs columns to prefer as the cell label / color field, in priority order.
_PREFERRED_LABELS = [
    "cell_type", "celltype", "cell_types", "CellType",
    "cell_ontology_class", "annotation", "labels",
    "leiden", "louvain", "clusters", "cluster", "seurat_clusters",
]


class CellEngine:
    """In-memory holder + analytics for a single scRNA-seq dataset."""

    def __init__(self) -> None:
        self.adata = None          # type: ignore[assignment]  # anndata.AnnData
        self.filename: str | None = None

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #
    def load(self, file_path: str, filename: str) -> None:
        """Read an .h5ad file into memory and validate it.

        Raises
        ------
        ValueError
            If the dataset does not contain pre-computed UMAP coordinates.
        """
        adata = ad.read_h5ad(file_path)

        if "X_umap" not in adata.obsm:
            raise ValueError(
                "Dataset is missing pre-computed UMAP coordinates "
                "(expected adata.obsm['X_umap']). Please run sc.tl.umap "
                "before uploading."
            )

        # Make gene lookups O(1) and case-insensitive friendly downstream.
        adata.var_names_make_unique()

        self.adata = adata
        self.filename = filename

    def is_loaded(self) -> bool:
        return self.adata is not None

    def reset(self) -> None:
        self.adata = None
        self.filename = None

    # ------------------------------------------------------------------ #
    # UMAP coordinates
    # ------------------------------------------------------------------ #
    def get_umap_coordinates(self) -> dict:
        """Return UMAP coordinates as a lean ``{id, x, y}`` array.

        The payload is intentionally minimal so it streams quickly to the
        browser and maps 1:1 onto a Deck.gl Float32 buffer.
        """
        self._assert_loaded()

        umap = np.asarray(self.adata.obsm["X_umap"])  # shape (n_cells, >=2)
        xs = umap[:, 0]
        ys = umap[:, 1]
        n = int(umap.shape[0])

        # Resolve a categorical label column (cell type / cluster) if present.
        label_field = self._pick_label_column()
        categories: list[str] = []
        codes = None
        if label_field is not None:
            series = self.adata.obs[label_field].astype("category")
            categories = [str(c) for c in series.cat.categories]
            codes = series.cat.codes.to_numpy()  # int per cell; -1 = missing

        cells = []
        for i in range(n):
            cell = {"id": i, "x": float(xs[i]), "y": float(ys[i])}
            if codes is not None:
                cell["c"] = int(codes[i])  # index into `categories` (-1 if unknown)
            cells.append(cell)

        return {
            "total_cells": n,
            "label_field": label_field,
            "categories": categories,
            "cells": cells,
        }

    def _pick_label_column(self) -> str | None:
        """Choose an obs column to use as the cell label / color field.

        Prefers well-known names (cell_type, leiden, …); otherwise falls back to
        the first categorical/string column with a sensible number of distinct
        values. Returns ``None`` if nothing suitable exists (uploaded data may
        have no annotations).
        """
        obs = self.adata.obs
        for name in _PREFERRED_LABELS:
            if name in obs.columns:
                return name
        for col in obs.columns:
            s = obs[col]
            if s.dtype == object or str(s.dtype) == "category":
                n_unique = int(s.nunique(dropna=True))
                if 2 <= n_unique <= 50:
                    return col
        return None

    # ------------------------------------------------------------------ #
    # Gene expression (the AI tool target)
    # ------------------------------------------------------------------ #
    def get_gene_expression(self, gene_name: str) -> dict:
        """Compute expression statistics for a single gene.

        Returns a dict matching the agent's tool schema:
            { gene, mean_expression, max_expression, percentage_of_cells_expressed }

        If the gene is absent, returns an ``error`` field instead so the agent
        can relay a graceful message rather than crash.
        """
        self._assert_loaded()

        gene = self._resolve_gene(gene_name)
        if gene is None:
            return {
                "gene": gene_name,
                "error": (
                    f"Gene '{gene_name}' was not found in the loaded "
                    f"dataset's {self.adata.n_vars} measured features."
                ),
            }
        expr = self._expr_vector(gene)

        n_cells = int(expr.shape[0])
        n_expressing = int(np.count_nonzero(expr))
        pct = (n_expressing / n_cells * 100.0) if n_cells else 0.0

        # --- JSON serialization guardrail: cast every value explicitly. ---
        return {
            "gene": gene,
            "mean_expression": round(float(np.mean(expr)), 4),
            "max_expression": round(float(np.max(expr)), 4),
            "percentage_of_cells_expressed": round(float(pct), 2),
        }

    # ------------------------------------------------------------------ #
    # Introspection helpers (handy for the agent / debugging)
    # ------------------------------------------------------------------ #
    def summary(self) -> dict:
        self._assert_loaded()
        return {
            "filename": self.filename,
            "n_cells": int(self.adata.n_obs),
            "n_genes": int(self.adata.n_vars),
        }

    def cell_type_overview(self) -> dict:
        """Describe the loaded dataset's cell-type / cluster annotation.

        Used to ground the AI agent: it returns the label column name plus each
        category and how many cells carry it, so the model knows which cell
        types actually exist instead of guessing. ``label_field`` is ``None``
        (and ``cell_types`` empty) when the dataset has no usable annotation.
        """
        self._assert_loaded()

        label_field = self._pick_label_column()
        cell_types: list[dict] = []
        if label_field is not None:
            counts = self.adata.obs[label_field].value_counts()
            cell_types = [
                {"name": str(name), "count": int(count)}
                for name, count in counts.items()
            ]

        return {
            "filename": self.filename,
            "n_cells": int(self.adata.n_obs),
            "n_genes": int(self.adata.n_vars),
            "label_field": label_field,
            "cell_types": cell_types,
        }

    # ------------------------------------------------------------------ #
    # Per-cell / grouped expression (powers the VIP-style visualizations)
    # ------------------------------------------------------------------ #
    def gene_per_cell(self, gene_name: str) -> dict:
        """Return one gene's expression value for every cell, in cell order.

        The ``values`` array is index-aligned with the ``id`` field emitted by
        :meth:`get_umap_coordinates`, so the front-end can recolor the scatter
        (continuous gradient) or build per-cell-type violins without a second
        lookup. Returns an ``error`` field if the gene is absent.
        """
        self._assert_loaded()

        gene = self._resolve_gene(gene_name)
        if gene is None:
            return {
                "gene": gene_name,
                "error": (
                    f"Gene '{gene_name}' was not found in the loaded "
                    f"dataset's {self.adata.n_vars} measured features."
                ),
            }

        expr = self._expr_vector(gene)
        return {
            "gene": gene,
            "values": [round(float(v), 4) for v in expr],
            "vmin": round(float(expr.min()), 4) if expr.size else 0.0,
            "vmax": round(float(expr.max()), 4) if expr.size else 0.0,
        }

    def grouped_expression(self, genes: list[str]) -> dict:
        """Per-cell-type mean expression and % expressing, for several genes.

        Powers the dot-plot and heatmap. ``rows`` is parallel to the requested
        gene list (unknown genes carry an ``error`` instead of ``stats``);
        ``stats`` within a row is parallel to ``cell_types``.
        """
        self._assert_loaded()

        label_field = self._pick_label_column()
        if label_field is None:
            cats = ["all cells"]
            codes = np.zeros(self.adata.n_obs, dtype=int)
        else:
            series = self.adata.obs[label_field].astype("category")
            cats = [str(c) for c in series.cat.categories]
            codes = series.cat.codes.to_numpy()

        rows = []
        for raw in genes:
            gene = self._resolve_gene(raw)
            if gene is None:
                rows.append({"gene": raw, "error": "not found"})
                continue
            expr = self._expr_vector(gene)
            stats = []
            for ci in range(len(cats)):
                sub = expr[codes == ci]
                n = int(sub.size)
                mean = float(sub.mean()) if n else 0.0
                pct = float(np.count_nonzero(sub) / n * 100.0) if n else 0.0
                stats.append(
                    {"mean": round(mean, 4), "pct": round(pct, 2), "n": n}
                )
            rows.append({"gene": gene, "stats": stats})

        return {"label_field": label_field, "cell_types": cats, "rows": rows}

    def selection_stats(self, cell_ids: list[int], top_n: int = 10) -> dict:
        """Summarize an arbitrary set of selected cells (from the lasso/box).

        Returns the selection size, a per-cell-type breakdown, and the most
        *enriched* genes (highest mean inside the selection relative to the
        whole dataset) so the user can characterize what they highlighted.
        """
        self._assert_loaded()

        n_obs = self.adata.n_obs
        ids = np.array(
            [i for i in cell_ids if isinstance(i, int) and 0 <= i < n_obs],
            dtype=int,
        )
        out: dict = {"n": int(ids.size), "by_cell_type": [], "top_genes": []}
        if ids.size == 0:
            return out

        # Per-cell-type counts within the selection.
        label_field = self._pick_label_column()
        if label_field is not None:
            series = self.adata.obs[label_field].astype("category")
            cats = [str(c) for c in series.cat.categories]
            codes = series.cat.codes.to_numpy()[ids]
            counts = np.bincount(codes[codes >= 0], minlength=len(cats))
            out["by_cell_type"] = sorted(
                [
                    {"cell_type": cats[i], "count": int(counts[i])}
                    for i in range(len(cats))
                    if counts[i] > 0
                ],
                key=lambda d: -d["count"],
            )

        # Enriched genes: selection mean minus global mean, per gene.
        X = self.adata.X
        sub = X[ids]
        sel_mean = (
            np.asarray(sub.mean(axis=0)).ravel()
            if sparse.issparse(sub)
            else np.asarray(sub).mean(axis=0).ravel()
        )
        glob_mean = (
            np.asarray(X.mean(axis=0)).ravel()
            if sparse.issparse(X)
            else np.asarray(X).mean(axis=0).ravel()
        )
        diff = sel_mean - glob_mean
        order = np.argsort(-diff)[:top_n]
        var_names = self.adata.var_names
        out["top_genes"] = [
            {
                "gene": str(var_names[i]),
                "mean": round(float(sel_mean[i]), 4),
                "enrichment": round(float(diff[i]), 4),
            }
            for i in order
            if sel_mean[i] > 0
        ]
        return out

    def qc_metrics(self, max_metrics: int = 6) -> dict:
        """Return per-cell numeric obs columns (n_genes, percent_mito, …).

        These feed the right-panel QC histograms. Categorical and all-NaN
        columns are skipped; ``metrics`` is empty when the dataset carries no
        numeric annotation (e.g. the bundled mock).
        """
        self._assert_loaded()

        obs = self.adata.obs
        metrics = []
        for col in obs.columns:
            if len(metrics) >= max_metrics:
                break
            s = obs[col]
            if str(s.dtype) == "category" or not pd.api.types.is_numeric_dtype(s):
                continue
            vals = s.to_numpy(dtype=float)
            if not np.any(np.isfinite(vals)):
                continue
            metrics.append(
                {"name": str(col), "values": [round(float(v), 4) for v in vals]}
            )
        return {"metrics": metrics}

    # ------------------------------------------------------------------ #
    # Internal
    # ------------------------------------------------------------------ #
    def _resolve_gene(self, gene_name: str) -> str | None:
        """Resolve a (possibly mis-cased) gene symbol to its exact var name.

        scRNA-seq symbols are usually upper-case (CD3D, PDCD1) but users may
        type ``cd3d``. Returns ``None`` if the gene is not measured.
        """
        gene = (gene_name or "").strip()
        var_names = self.adata.var_names
        if gene in var_names:
            return gene
        lower_map = {g.lower(): g for g in var_names}
        return lower_map.get(gene.lower())

    def _expr_vector(self, gene: str) -> np.ndarray:
        """Dense 1-D expression vector for a resolved gene (cell-ordered)."""
        column = self.adata.X[:, self.adata.var_names.get_loc(gene)]
        if sparse.issparse(column):
            return column.toarray().ravel()
        return np.asarray(column).ravel()

    def _assert_loaded(self) -> None:
        if self.adata is None:
            raise RuntimeError(
                "No dataset is loaded. Upload an .h5ad file via /api/upload first."
            )


# Module-level singleton shared across all routes (the global state holder).
cell_engine_instance = CellEngine()
