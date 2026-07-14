#!/bin/sh
set -e

ROLE="${1:-api}"

if [ "$ROLE" = "api" ]; then
  alembic upgrade head
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000
elif [ "$ROLE" = "worker" ]; then
  exec celery -A app.tasks.celery_app worker --loglevel=info --concurrency="${CELERY_CONCURRENCY:-2}"
elif [ "$ROLE" = "beat" ]; then
  exec celery -A app.tasks.celery_app beat --loglevel=info
else
  exec "$@"
fi
