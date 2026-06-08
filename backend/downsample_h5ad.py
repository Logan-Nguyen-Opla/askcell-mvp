"""
downsample_h5ad.py
==================
Shrink a big ``.h5ad`` so it uploads fast.

Keeps a random subsample of cells (default 100,000) and writes a new file,
preserving X, obs, var, and obsm['X_umap'] so AskCell loads it unchanged. Reads
the source in "backed" mode, so it works on huge files without loading the whole
matrix into RAM.

Usage (from the backend/ folder, using its virtualenv):

    python downsample_h5ad.py big.h5ad
        -> writes big.subsampled.h5ad with 100,000 cells

    python downsample_h5ad.py big.h5ad out.h5ad 150000
        -> writes out.h5ad with 150,000 cells

Tip: the AskCell viewer only displays up to 150k cells, so subsampling to
100k–150k loses nothing visually while making uploads dramatically faster.
"""

import sys

import anndata as ad
import numpy as np


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    src = sys.argv[1]
    out = (
        sys.argv[2]
        if len(sys.argv) > 2
        else src[: -len(".h5ad")] + ".subsampled.h5ad"
        if src.endswith(".h5ad")
        else src + ".subsampled.h5ad"
    )
    n_keep = int(sys.argv[3]) if len(sys.argv) > 3 else 100_000

    print(f"Reading {src} (backed / low-memory)…")
    adata = ad.read_h5ad(src, backed="r")
    n = adata.n_obs
    print(f"  {n:,} cells x {adata.n_vars:,} genes")

    if "X_umap" not in adata.obsm:
        print("  WARNING: no obsm['X_umap'] — AskCell needs UMAP coordinates.")

    if n <= n_keep:
        print(f"Already <= {n_keep:,} cells; nothing to do.")
        sys.exit(0)

    rng = np.random.default_rng(0)
    idx = np.sort(rng.choice(n, size=n_keep, replace=False))

    print(f"Subsampling to {n_keep:,} cells and writing {out}…")
    subset = adata[idx].to_memory()  # materialize only the chosen rows
    subset.write_h5ad(out)
    print(f"Done -> {out}")


if __name__ == "__main__":
    main()
