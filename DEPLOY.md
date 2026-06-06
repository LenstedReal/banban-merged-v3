# banbansports — Deployment Guide

Production stack:
- **Frontend**: Next.js 15 (App Router) → **Vercel** (single-command deploy)
- **Backend**: Python FastAPI → **Railway / Render / Fly.io** (Python host)
- **DB**: MongoDB Atlas (free tier) or self-hosted

---

## 1) Frontend → Vercel (one click)

The `frontend/` folder is fully Vercel-ready (`vercel.json` + `next.config.js` already wired).

### Steps
1. Push the repo to GitHub.
2. Go to https://vercel.com/new and import the repo.
3. **Root Directory**: select `frontend`.
4. **Framework Preset**: auto-detected as Next.js.
5. **Environment Variables**:
   ```
   NEXT_PUBLIC_BACKEND_URL = https://your-backend-host.example.com
   ```
   (Pointing to wherever you deployed the Python backend — Railway URL etc.)
6. Click **Deploy**. Done.

### Build settings (auto)
- Build: `yarn build`
- Install: `yarn install --frozen-lockfile`
- Output: `.next`
- Region: `fra1` (Frankfurt — closest to TR users)

---

## 2) Backend → Railway (recommended, free tier)

Vercel does **not** support long-lived Python ASGI apps with WebSockets.
Backend belongs on a Python-friendly host. Railway is the simplest free option.

### Steps
1. Go to https://railway.app/new and connect the GitHub repo.
2. **Root Directory**: `backend`.
3. **Build Command**: `pip install -r requirements.txt`
4. **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. **Environment Variables** (copy from `backend/.env` and **change secrets**):
   ```
   MONGO_URL=<your atlas connection string>
   DB_NAME=banbansports
   JWT_SECRET=<random 32+ char>
   ADMIN_EMAIL=<your admin>
   ADMIN_PASSWORD=<strong>
   ENV=production
   CORS_ORIGINS=https://your-frontend.vercel.app
   OPENAI_API_KEY=<from openai dashboard>
   ANTHROPIC_API_KEY=<from anthropic dashboard>
   GEMINI_API_KEY=<from Google AI Studio>
   ```
6. Deploy. Copy the public URL and paste it as `NEXT_PUBLIC_BACKEND_URL` on Vercel.

### Alternative hosts
- **Render**: same flow, free tier sleeps after 15min inactivity.
- **Fly.io**: free 3 VMs, no sleep, slightly more setup.

---

## 3) MongoDB → Atlas

1. Sign up at https://www.mongodb.com/cloud/atlas (free M0 cluster).
2. Create a cluster, allow `0.0.0.0/0` access (or restrict to Railway's IP).
3. Copy the connection string → `MONGO_URL` env on Railway.

---

## 4) AI Provider Keys (required for `/api/ai/predict`)

The 3-model harmonized prediction needs at least ONE provider key. All 3 keys
give the richest result; with fewer keys, the service degrades gracefully.

| Provider | Where to get | Free tier? |
|---|---|---|
| OpenAI (GPT-5.2) | https://platform.openai.com/api-keys | Paid only |
| Anthropic (Claude Sonnet 4.5) | https://console.anthropic.com/settings/keys | $5 trial credit |
| Google (Gemini 3 Pro) | https://aistudio.google.com/app/apikey | Generous free tier |

Set them as env vars on the backend host. The backend reads them on startup.

---

## 5) GitHub push

Use the chat input's **"Save to GitHub"** button to push the current pod to your repo.
Or manually:
```bash
git add -A && git commit -m "deploy" && git push
```

---

## 6) Smoke test after deploy

```bash
# Backend health
curl https://your-backend.up.railway.app/api/health

# AI configured?
curl https://your-backend.up.railway.app/api/ai/health

# Live scores
curl https://your-backend.up.railway.app/api/scores/top?n=5

# Frontend (open in browser)
open https://your-frontend.vercel.app
```

---

## 7) Legal disclaimer

Stream endpoints (`/api/bein/*`, `/api/streams/*`) proxy 3rd-party broadcaster
content. **DMCA / RTÜK risk** — for personal/educational use only. Vercel and
Railway may suspend the account if takedown notices arrive. Consider keeping
the stream proxy off the public domain or behind auth.
