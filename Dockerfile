FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080 PYTHONPATH=/app/src:/app/app
WORKDIR /app
COPY requirements.txt requirements-baseline.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-baseline.txt
COPY src ./src
COPY app ./app
COPY samples/*.jsonl ./samples/
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION SAMPLES_DIR=/app/samples
RUN useradd -u 10001 -m app && chmod -R a+rX /app
USER app
EXPOSE 8080
CMD ["sh", "-c", "uvicorn main:app --app-dir app --host 0.0.0.0 --port ${PORT} --no-access-log --workers 1"]
