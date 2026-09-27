# Small read-only API over the published daily energy (Harbourlight Energy Analytics, fictional).
# Build: docker build -t energy-api .   Run: docker run -p 8080:8080 -v ./extract:/data energy-api
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_PATH=/data/site_energy_daily.parquet

WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code, run as a non-root user.
COPY app.py .
RUN useradd --create-home --uid 10001 api
USER api

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health')"
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
