# Container image for the AskCell FastAPI backend on Cloud Run.
FROM python:3.12-slim

WORKDIR /app

# Install dependencies first so this layer caches across code changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code + the bundled sample dataset (sample_data/mock_pbmc.h5ad).
COPY . .

# Cloud Run injects $PORT (defaults to 8080). Bind uvicorn to it.
ENV PORT=8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
