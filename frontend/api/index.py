"""
Vercel Serverless entry point — bundles entire FastAPI app into one function.
The catch-all rewrite in vercel.json routes /api/* to this single endpoint.
"""
import sys
from pathlib import Path

# Add project root so we can import _backend_app
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from datetime import datetime, timezone

# Rename the imported package: _backend_app contains the original `app` package
import importlib
backend_pkg = importlib.import_module("_backend_app")

# Pull modules from the relocated package
from _backend_app.core.config import CORS_ORIGINS, IS_PRODUCTION  # type: ignore
from _backend_app.routers import (  # type: ignore
    scores, streams, bein, channels, match_stats, ai_predict,
    auth as auth_router, predictions, chat, notifications, push, admin,
)

# FastAPI app — NO lifespan, NO background tasks (serverless = stateless)
app = FastAPI(title="banbansports", version="4.0-vercel")


@app.get("/api/")
async def root():
    return {"message": "banbansports v4 — API ready (Vercel serverless)", "version": "4.0-vercel"}


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "runtime": "vercel-serverless",
        "version": "4.0-vercel",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# HTTP routers (WebSocket router excluded — serverless doesn't support it)
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

# CORS — same-origin on Vercel (frontend and API share the same domain)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS if CORS_ORIGINS else ["*"],
    allow_credentials=bool(CORS_ORIGINS),
    allow_methods=["*"],
    allow_headers=["*"],
)
