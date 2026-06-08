"""
main.py
=======
FastAPI gateway for AskCell.

Routes
------
POST /api/upload   multipart .h5ad  -> parse + cache matrix in memory
GET  /api/umap                      -> lean {id, x, y} coordinate array
POST /api/chat     {message}        -> Gemini reply (with tool execution)
GET  /api/status                    -> dataset metadata (handy for the UI)

CORS is wide-open for local development; lock down ``allow_origins`` before any
real deployment.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import ai_agent
from .cell_engine import cell_engine_instance

load_dotenv()  # read backend/.env (GEMINI_API_KEY, etc.)

# Path to the bundled sample dataset (auto-loaded on startup so the app shows
# data with zero setup). Override with the SAMPLE_H5AD env var, or set it to an
# empty string to disable auto-loading.
_DEFAULT_SAMPLE = (
    Path(__file__).resolve().parent.parent / "sample_data" / "mock_pbmc.h5ad"
)
SAMPLE_H5AD = os.environ.get("SAMPLE_H5AD", str(_DEFAULT_SAMPLE))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """On startup, auto-load the bundled sample dataset if present."""
    try:
        if (
            SAMPLE_H5AD
            and not cell_engine_instance.is_loaded()
            and os.path.exists(SAMPLE_H5AD)
        ):
            cell_engine_instance.load(SAMPLE_H5AD, os.path.basename(SAMPLE_H5AD))
            print(f"[AskCell] Auto-loaded sample dataset: {SAMPLE_H5AD}")
        elif SAMPLE_H5AD and not os.path.exists(SAMPLE_H5AD):
            print(
                f"[AskCell] No sample dataset at {SAMPLE_H5AD} "
                "(upload an .h5ad to begin)."
            )
    except Exception as exc:  # never let a bad sample crash startup
        print(f"[AskCell] Could not auto-load sample dataset: {exc}")
    yield


app = FastAPI(title="AskCell API", version="1.0.0", lifespan=lifespan)

# --------------------------------------------------------------------------- #
# CORS
# --------------------------------------------------------------------------- #
_origins = os.environ.get(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class ChatRequest(BaseModel):
    message: str


class GenesRequest(BaseModel):
    genes: list[str]


class SelectionRequest(BaseModel):
    cell_ids: list[int]


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.get("/")
def root() -> dict:
    return {"service": "AskCell API", "status": "ok", "version": "1.0.0"}


@app.post("/api/upload")
async def upload_dataset(file: UploadFile = File(...)) -> dict:
    """Accept an .h5ad upload, parse it, and cache it in memory."""
    if not file.filename or not file.filename.endswith(".h5ad"):
        raise HTTPException(
            status_code=400,
            detail="Only .h5ad (AnnData) files are supported.",
        )

    # Stream the upload to a temp file, then hand the path to the engine.
    # The engine takes ownership (owns_file=True): it deletes the temp itself
    # once loaded in-memory, or keeps it alive for backed (big-file) mode. We
    # only clean up here if load() fails before taking ownership.
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            delete=False, suffix=".h5ad"
        ) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name

        cell_engine_instance.load(tmp_path, file.filename, owns_file=True)

    except ValueError as exc:
        # Validation failure (e.g. missing UMAP) -> 422.
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise HTTPException(
            status_code=500, detail=f"Failed to process file: {exc}"
        ) from exc
    finally:
        await file.close()

    return {"message": "File processed successfully", "filename": file.filename}


@app.get("/api/umap")
def get_umap() -> dict:
    """Return the cached UMAP coordinates for the GPU scatterplot."""
    if not cell_engine_instance.is_loaded():
        raise HTTPException(
            status_code=400,
            detail="No dataset loaded. Upload an .h5ad file first.",
        )
    return cell_engine_instance.get_umap_coordinates()


@app.get("/api/status")
def get_status() -> dict:
    """Lightweight dataset metadata for the front-end state indicators."""
    if not cell_engine_instance.is_loaded():
        return {"loaded": False}
    return {"loaded": True, **cell_engine_instance.summary()}


@app.post("/api/chat")
def chat(req: ChatRequest) -> dict:
    """Run a user message through the Gemini agent (with tool execution)."""
    if not cell_engine_instance.is_loaded():
        raise HTTPException(
            status_code=400,
            detail="No dataset loaded. Upload an .h5ad file before chatting.",
        )

    message = (req.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    try:
        reply = ai_agent.run_chat(message)
    except RuntimeError as exc:
        # Missing API key, etc.
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Agent error: {exc}"
        ) from exc

    return {"reply": reply}


# --------------------------------------------------------------------------- #
# Visualization endpoints (VIP-style features)
# --------------------------------------------------------------------------- #
def _require_loaded() -> None:
    if not cell_engine_instance.is_loaded():
        raise HTTPException(
            status_code=400, detail="No dataset loaded. Upload an .h5ad first."
        )


@app.get("/api/gene/{gene}")
def gene_per_cell(gene: str) -> dict:
    """Per-cell expression vector for one gene (colors the embedding)."""
    _require_loaded()
    return cell_engine_instance.gene_per_cell(gene)


@app.post("/api/expression/grouped")
def grouped_expression(req: GenesRequest) -> dict:
    """Per-cell-type mean / % expressing for the requested genes."""
    _require_loaded()
    if not req.genes:
        raise HTTPException(status_code=400, detail="No genes requested.")
    return cell_engine_instance.grouped_expression(req.genes)


@app.post("/api/selection")
def selection(req: SelectionRequest) -> dict:
    """Summary stats for a set of selected cell ids (lasso/box select)."""
    _require_loaded()
    return cell_engine_instance.selection_stats(req.cell_ids)


@app.get("/api/qc")
def qc() -> dict:
    """Numeric per-cell QC metrics for the right-panel histograms."""
    _require_loaded()
    return cell_engine_instance.qc_metrics()
