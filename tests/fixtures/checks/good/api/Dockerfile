# syntax=docker/dockerfile:1
ARG PY=3.12
FROM python:${PY}-slim AS base
WORKDIR /app
COPY requirements.txt .
COPY --chown=app:app *.py \
     ./
COPY --from=base /usr/lib /usr/lib
ADD https://example.invalid/file.tgz /tmp/
RUN <<EOT
echo "COPY nothing.txt ." > /dev/null
EOT
CMD ["python", "main.py"]
