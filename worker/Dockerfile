# syntax=docker/dockerfile:1.7

FROM python:3.12-slim AS deps
WORKDIR /app
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
COPY requirements.txt .
RUN pip install --prefix=/install -r requirements.txt

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

RUN groupadd -r app && useradd -r -g app app

COPY --from=deps /install /usr/local
COPY --chown=app:app worker.py operations.py healthcheck.py ./

USER app

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python healthcheck.py || exit 1

CMD ["python", "worker.py"]
