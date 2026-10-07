# CPU-only API image. No PyTorch: the image model runs on ONNX Runtime.
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt && find /usr/local/lib/python3.12 -name '__pycache__' -prune -exec rm -rf {} +
COPY alembic.ini .
COPY alembic ./alembic
COPY app ./app
COPY models ./models
COPY scripts ./scripts

FROM base AS test
COPY requirements-dev.txt .
RUN pip install -r requirements-dev.txt
COPY tests ./tests
COPY pytest.ini .
CMD ["pytest", "-q"]

FROM base AS runtime
RUN useradd --system --uid 10001 app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health').status==200 else 1)"
# One worker: the rate limiter, scheduler and model session live in this process (see DECISIONS.md).
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
