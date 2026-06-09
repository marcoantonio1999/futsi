FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY back/requirements.txt /app/back/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r /app/back/requirements.txt

COPY back /app/back

WORKDIR /app/back
RUN python manage.py collectstatic --noinput

EXPOSE 10000

CMD ["sh", "-c", "echo Starting Futsi API on port ${PORT:-10000} && gunicorn futsi_api.wsgi:application --bind 0.0.0.0:${PORT:-10000} --log-file -"]
