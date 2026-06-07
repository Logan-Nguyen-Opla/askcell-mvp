# 🧬 AskCell — MVP v1.0

An interactive **Single-Cell RNA-seq (scRNA-seq)** analytics platform. Visualize
massive biomedical datasets in real time with hardware-accelerated WebGL
(Deck.gl), and query biological insights in natural language via a **Gemini**
agent with function calling.

> **Comes with built-in mock data.** The backend auto-loads a bundled sample
> dataset on startup, so the cell scatterplot appears the moment you open the
> app — no data hunting, no upload needed to see it work.

---

## ⚡ Quick start (Windows)

You need two free things installed first:

1. **Python 3.10–3.13** — https://www.python.org/downloads/
   (during install, tick **"Add Python to PATH"**)
2. **Node.js 18+** — https://nodejs.org (the "LTS" button)

Then:

1. **Unzip** this folder and **open it in VS Code** (File → Open Folder).
2. **Double-click `run-backend.bat`** (or in a terminal: `.\run-backend.bat`).
   A window opens, installs everything, and starts the API. Leave it open.
3. **Double-click `run-frontend.bat`** (or: `.\run-frontend.bat`) in a *second*
   window. Leave it open too.
4. Open your browser to **http://localhost:5173**.

That's it. You'll see ~3,000 cells rendered. Pan by dragging, zoom with the
scroll wheel, hover a cell for its ID.

### To turn on the AI chat (optional)

The scatterplot works with **no key**. To enable the chat:

1. Get a free Gemini key: https://aistudio.google.com/apikey
2. Open `backend\.env`, replace `your_gemini_api_key_here` with your key, save.
3. Restart `run-backend.bat`.

Now ask the sidebar things like *"What is the expression profile of CD3D?"*

---

## 🍎 Quick start (macOS / Linux)

Same idea, run each block in its own terminal:

```bash
# Terminal 1 — backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # optional: add GEMINI_API_KEY for chat
uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend
npm install
cp .env.example .env
npm run dev                     # open http://localhost:5173
```

---

## Architecture

```
askcell-mvp/
├── run-backend.bat            # one-click backend (Windows)
├── run-frontend.bat           # one-click frontend (Windows)
├── backend/                   # FastAPI Python core
│   ├── app/
│   │   ├── main.py            # Gateway + startup auto-load of sample data
│   │   ├── cell_engine.py     # AnnData engine + JSON serialization guards
│   │   └── ai_agent.py        # Gemini client + get_gene_expression tool
│   ├── sample_data/
│   │   └── mock_pbmc.h5ad      # bundled mock dataset (auto-loaded)
│   ├── make_mock_data.py       # regenerates the mock dataset (optional)
│   ├── requirements.txt
│   └── .env.example
└── frontend/                  # React (Vite) desktop app
    ├── src/
    │   ├── components/
    │   │   ├── UmapViewer.jsx   # Deck.gl GPU scatterplot (OrthographicView)
    │   │   └── ChatSidebar.jsx  # Conversational AI sidebar
    │   ├── App.jsx             # 70/30 layout, state, auto-loads on open
    │   └── main.jsx
    ├── package.json
    └── .env.example
```

---

## How it works

```
[open app] → backend auto-loads mock_pbmc.h5ad → Deck.gl renders @ 60 FPS
                                                          │
[Chat: "Check expression of CD3D"] → Gemini calls get_gene_expression
        → real mean/max metrics from the matrix → synthesized answer
```

The mock dataset has 3,000 immune cells in 5 clusters with real marker genes
(CD3D, MS4A1, NKG7, LYZ, PDCD1, GAPDH, …), so the AI's answers are
biologically sensible.

---

## Using your own data

Drag any `.h5ad` file onto the left pane to replace the sample. The only
requirement: it must already contain 2D UMAP coordinates in
`adata.obsm['X_umap']` (the dot positions on the map). Standard processed
datasets like `pbmc3k` have this. A raw count matrix does not — run it through
the standard UMAP step first (e.g. in scanpy on Python 3.12 or Google Colab).

---

## API reference

| Method | Endpoint       | Body                       | Returns                                   |
| ------ | -------------- | -------------------------- | ----------------------------------------- |
| POST   | `/api/upload`  | `multipart` `.h5ad` file   | `{ message, filename }`                   |
| GET    | `/api/umap`    | —                          | `{ total_cells, cells: [{id,x,y}] }`      |
| POST   | `/api/chat`    | `{ "message": "..." }`     | `{ reply }`                               |
| GET    | `/api/status`  | —                          | `{ loaded, filename, n_cells, n_genes }`  |

---

## Notes & guardrails

- **Zero-config demo**: the bundled sample auto-loads on startup; disable by
  setting `SAMPLE_H5AD=` (empty) in `backend/.env`.
- **In-memory lifecycle**: the dataset lives in a process-global singleton;
  chat queries never re-read from disk.
- **JSON serialization**: all NumPy scalars are cast to Python `float`/`int`
  before leaving the backend, preventing FastAPI encoder crashes.
- **No fabrication**: the agent is instructed never to guess metrics — every
  number comes from the real matrix via the tool.
- **Python 3.13 friendly**: no package here needs a C compiler.
