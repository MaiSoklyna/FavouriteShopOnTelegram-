# Favourite of Shop - Backend API

FastAPI backend for the Favourite of Shop Telegram E-Commerce Bot. Includes both the REST API server and Telegram bot in a single process.

## Tech Stack

- **FastAPI** - REST API framework
- **python-telegram-bot** - Telegram bot integration
- **Supabase** - PostgreSQL database (via PostgREST proxy)
- **JWT** - Authentication for admin and users

## Quick Start (Local Development)

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate   # Windows

# Install dependencies
pip install -r requirements.txt

# Copy env template and fill in your values
cp .env.example .env

# Run the server (API + Bot)
python run.py
```

## Deploy to Railway

1. Connect this repo on [railway.app](https://railway.app)
2. Add all environment variables from `.env.example`
3. Railway auto-detects the `Procfile` and deploys

## Deploy to Render

1. Create a **Web Service** on [render.com](https://render.com)
2. Connect this repo
3. Build command: `pip install -r requirements.txt`
4. Start command: `python run.py`
5. Add all environment variables from `.env.example`

## Deploy with Docker

```bash
docker build -t favourite-of-shop-backend .
docker run -p 8000:8000 --env-file .env favourite-of-shop-backend
```

## Environment Variables

See `.env.example` for all required variables. Key ones:

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `SECRET_KEY` | JWT signing secret (generate a strong random key) |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `SUPABASE_JWT_SECRET` | Supabase JWT secret |
| `CORS_ORIGINS` | Comma-separated frontend URLs |
| `WEB_APP_URL` | Miniapp URL (for Telegram WebApp) |
| `ADMIN_PANEL_URL` | Dashboard URL |

## API Endpoints

- `GET /` - API info
- `GET /health` - Health check
- `GET /docs` - Swagger documentation
- `POST /api/telegram-auth` - Telegram user authentication
- `POST /api/admin/login` - Admin login
- `/api/*` - Miniapp API routes
- `/db/*` - Supabase PostgREST proxy
