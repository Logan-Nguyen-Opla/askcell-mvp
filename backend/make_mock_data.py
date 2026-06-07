"""
make_mock_data.py
=================
Generates a small, realistic mock scRNA-seq dataset for AskCell so the app
works out of the box with zero setup.

Output: sample_data/mock_pbmc.h5ad
  - 3,000 cells in 5 immune clusters (T, B, NK, Monocyte, Dendritic)
  - 22 marker / housekeeping genes with biologically sensible expression
  - Pre-computed 2D UMAP coordinates in adata.obsm['X_umap']

You normally never need to run this — the .h5ad it produces is already
bundled. It's here for transparency and so you can regenerate if you want.

    python make_mock_data.py
"""

from __future__ import annotations

import os

import anndata as ad
import numpy as np
import pandas as pd
from scipy import sparse

rng = np.random.default_rng(42)

# 5 immune clusters and their sizes (sum = 3000).
cluster_names = ["T cells", "B cells", "NK cells", "Monocytes", "Dendritic"]
n_per = [900, 600, 450, 750, 300]
# Cluster centers in UMAP space (spread out so they look like real islands).
centers = np.array(
    [[-5, 0], [5, 4], [4, -5], [-2, 7], [7, -2]], dtype=float
)

# Canonical immune marker genes + a few broad housekeeping genes.
genes = [
    "CD3D", "CD3E", "CD8A", "IL7R",       # T-cell
    "MS4A1", "CD79A", "CD79B",            # B-cell
    "NKG7", "GNLY", "KLRD1",              # NK
    "LYZ", "CD14", "FCGR3A", "S100A8",    # Monocyte
    "FCER1A", "CLEC10A",                  # Dendritic
    "PDCD1", "CTLA4", "LAG3",             # checkpoint (subset of T)
    "GAPDH", "ACTB", "MALAT1",            # broadly expressed
]
gi = {g: i for i, g in enumerate(genes)}

# Per-cluster mean expression program (rows = gene, cols = cluster).
prog = np.full((len(genes), 5), 0.05)  # low background everywhere


def setm(gene: str, cl: int, val: float) -> None:
    prog[gi[gene], cl] = val


# T cells (0)
for g in ("CD3D", "CD3E", "IL7R"):
    setm(g, 0, 2.6)
setm("CD8A", 0, 1.8)
for g in ("PDCD1", "CTLA4", "LAG3"):  # checkpoint markers, modest, T-restricted
    setm(g, 0, 0.6)
# B cells (1)
for g in ("MS4A1", "CD79A", "CD79B"):
    setm(g, 1, 2.7)
# NK cells (2)
for g in ("NKG7", "GNLY", "KLRD1"):
    setm(g, 2, 2.9)
setm("NKG7", 0, 0.4)        # a little NKG7 in T cells too
setm("FCGR3A", 2, 1.4)      # CD16 on NK
# Monocytes (3)
for g in ("LYZ", "CD14", "S100A8"):
    setm(g, 3, 3.0)
setm("FCGR3A", 3, 1.6)
# Dendritic (4)
for g in ("FCER1A", "CLEC10A"):
    setm(g, 4, 2.5)
setm("LYZ", 4, 1.5)
# Housekeeping / broad
for g in ("GAPDH", "ACTB", "MALAT1"):
    for c in range(5):
        prog[gi[g], c] = 3.3

# Assign cells to clusters.
labels = np.concatenate([np.full(n, i) for i, n in enumerate(n_per)])
N = int(labels.size)
G = len(genes)

# UMAP coordinates: a Gaussian blob per cluster.
umap = np.zeros((N, 2), dtype=np.float32)
start = 0
for i, n in enumerate(n_per):
    umap[start : start + n] = centers[i] + rng.normal(0, 1.0, size=(n, 2))
    start += n

# Expression matrix: gamma draws around the cluster mean, with dropout
# (lots of zeros) to mimic real single-cell sparsity.
X = np.zeros((N, G), dtype=np.float32)
for ci in range(5):
    idx = np.where(labels == ci)[0]
    means = prog[:, ci]                       # (G,)
    draws = rng.gamma(shape=1.5, scale=means / 1.5, size=(idx.size, G))
    detect_p = np.clip(0.15 + means * 0.28, 0.0, 0.95)  # detection prob ~ mean
    mask = rng.random((idx.size, G)) < detect_p
    X[idx] = (draws * mask).astype(np.float32)

X = np.clip(X, 0.0, 8.0)  # cap like log-normalized values
Xs = sparse.csr_matrix(X)

adata = ad.AnnData(X=Xs)
adata.var_names = genes
adata.obs["cell_type"] = pd.Categorical([cluster_names[l] for l in labels])
adata.obsm["X_umap"] = umap

out_dir = os.path.join(os.path.dirname(__file__), "sample_data")
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, "mock_pbmc.h5ad")
adata.write_h5ad(out_path)

print(f"Wrote {out_path}")
print(f"  {N} cells x {G} genes, {len(cluster_names)} clusters")
print(f"  UMAP range x[{umap[:,0].min():.1f},{umap[:,0].max():.1f}] "
      f"y[{umap[:,1].min():.1f},{umap[:,1].max():.1f}]")
