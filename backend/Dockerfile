FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Combined mode: FastAPI + Telegram bot in one process.
# Railway injects $PORT at runtime; fall back to 8000 for local docker run.
EXPOSE 8000
CMD API_PORT=${PORT:-8000} python run.py
