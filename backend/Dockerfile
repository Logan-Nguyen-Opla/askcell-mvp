# Container image for the AskCell FastAPI backend on Cloud Run.
FROM python:3.12-slim

WORKDIR /app

# Install dependencies first so this layer caches across code changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code + the bundled sample dataset (sample_data/mock_pbmc.h5ad).
COPY . .

# Cloud Run injects $PORT (defaults to 8080). Serve with Hypercorn so the
# container speaks HTTP/2 cleartext (h2c) — required for Cloud Run --use-http2,
# which removes the 32MB request cap so big .h5ad uploads get through.
ENV PORT=8080
CMD ["sh", "-c", "hypercorn app.main:app --bind 0.0.0.0:${PORT}"]
