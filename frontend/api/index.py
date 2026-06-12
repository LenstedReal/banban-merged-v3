"""
Vercel Serverless entry point — slim version.

Only loads HTTP-only routers (scores, match_stats, streams, channels) by default
to stay under Vercel's 250MB serverless size limit. Heavy AI/DB routers are
loaded conditionally if their dependencies + env vars are present.
"""
import sys
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from datetime import datetime, timezone

app = FastAPI(title="banbansports", version="4.0-vercel-slim")


@app.get("/api/")
async def root():
    return {"message": "banbansports v4 — API ready (Vercel slim)", "version": "4.0-vercel-slim"}


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "runtime": "vercel-serverless",
        "version": "4.0-vercel-slim",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# --- Core routers (HTTP only, no DB, no AI) ---
from _backend_app.routers import scores, match_stats, streams, channels, bein  # type: ignore
app.include_router(scores.router)
app.include_router(match_stats.router)
app.include_router(streams.router)
app.include_router(channels.router)
app.include_router(bein.router)

# --- Optional: DB-backed routers (only if motor/pymongo + MONGO_URL set) ---
if os.environ.get("MONGO_URL", "").startswith("mongodb"):
    try:
        from _backend_app.routers import (  # type: ignore
            auth as auth_router, predictions, chat, notifications, push, admin,
        )
        app.include_router(auth_router.router)
        app.include_router(predictions.router)
        app.include_router(chat.router)
        app.include_router(notifications.router)
        app.include_router(push.router)
        app.include_router(admin.router)
    except ImportError:
        pass  # motor/pymongo not installed — DB features disabled

# --- Optional: AI predict (only if at least one provider key + lib present) ---
if any(os.environ.get(k) for k in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY")):
    try:
        from _backend_app.routers import ai_predict  # type: ignore
        app.include_router(ai_predict.router)
    except ImportError:
        pass  # AI libs not installed — predict endpoint disabled


# CORS — same-origin on Vercel (frontend + api share domain), wildcard fine
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
