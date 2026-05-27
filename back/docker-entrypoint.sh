#!/usr/bin/env sh
set -e

python manage.py migrate --noinput

if [ "${RUN_SEED_DEMO:-false}" = "true" ]; then
  python manage.py seed_demo
fi

exec "$@"
