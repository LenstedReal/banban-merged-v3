"""
Vercel Serverless entry point for banbansports backend.

This wraps the FastAPI app for Vercel's @vercel/python runtime.
Background loops (websocket broadcast, st11 refresh, settlement) are disabled
because serverless functions are short-lived and stateless. Only HTTP endpoints
work (which is enough for scores, match stats, AI prediction).
"""
import sys
import os
from pathlib import Path

# Add the backend root to Python path so `app.` imports resolve
BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from datetime import datetime, timezone

from app.core.config import CORS_ORIGINS, IS_PRODUCTION
from app.routers import (
    scores,
    streams,
    bein,
    channels,
    auth as auth_router,
    predictions,
    chat,
    notifications,
    match_stats,
    admin,
    push,
    ai_predict,
)

# Vercel serverless: NO lifespan, NO background tasks
app = FastAPI(title="banbansports", version="4.0-vercel")


@app.get("/api/")
async def root():
    return {"message": "banbansports v4 — API ready (Vercel)", "version": "4.0-vercel"}


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "runtime": "vercel-serverless",
        "version": "4.0-vercel",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# HTTP routers (WebSocket router omitted — not supported on serverless)
app.include_router(scores.router)
app.include_router(match_stats.router)
app.include_router(streams.router)
app.include_router(bein.router)
app.include_router(channels.router)
app.include_router(auth_router.router)
app.include_router(predictions.router)
app.include_router(chat.router)
app.include_router(notifications.router)
app.include_router(push.router)
app.include_router(admin.router)
app.include_router(ai_predict.router)


# CORS
if CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    # Fallback: allow all Vercel + localhost origins
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://(localhost(:\d+)?|127\.0\.0\.1(:\d+)?|.+\.vercel\.app)$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
