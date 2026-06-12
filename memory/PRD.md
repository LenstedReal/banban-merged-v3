# Banban Sports — PRD (Product Requirements Document)

## Original Problem Statement (Turkish, user verbatim)
Kullanıcı iki GitHub reposunu birleştirip tek temiz proje istedi:
1. `LenstedReal/Banban` — Vanilla altyapı (eski, kaliteli özellikler korunsun)
2. `LenstedReal/Banban_new` — Next.js altyapı (en son geliştirmelerle bozulmuş)

**Şikayet ve Talepler**:
- 🐛 Scoreboard / Maç Merkezi'nde Dünya Kupası, milli maçlar, hazırlık maçları görünmüyor → FIX ✅
- 🐛 API'ler ve maç sistem mantığında hata var → FIX ✅
- 🐛 Chrome'da site düzgün yüklenmiyor → FIX ✅ (Next.js prod-grade)
- 🤖 Tüm yapay zekaları (Gemini + ChatGPT + Claude) harmanla → IMPL ✅
- ☁️ Vercel deploy uyumlu, performanslı, profesyonel → IMPL ✅
- 🚫 **HİÇBİR emergent bağımlılığı, isim, kütüphane yok** → IMPL ✅
- 🇹🇷 Takım isimleri Türkçe olsun → IMPL ✅ (Kanada/ABD/Brezilya...)
- 🕒 Saat dilimi İstanbul/Türkiye → IMPL ✅ (ZoneInfo DST-aware)

## Architecture
- **Frontend**: Next.js 15.5.18 + React 19 (App Router, TypeScript) — Vercel-ready
- **Backend**: FastAPI + Python 3.11 + Motor (async MongoDB) — Railway/Render-ready
- **DB**: MongoDB (Atlas free tier compatible)
- **AI Providers** (DIRECT SDKs, no wrappers):
  - OpenAI GPT-5.2 (`openai` SDK, OPENAI_API_KEY)
  - Anthropic Claude Sonnet 4.5 (`anthropic` SDK, ANTHROPIC_API_KEY)
  - Google Gemini 3 Pro Preview (`google-generativeai` SDK, GEMINI_API_KEY)
- **Live Data**: LiveScore.com → FotMob → SofaScore fallback chain
- **Timezone**: `zoneinfo.ZoneInfo("Europe/Istanbul")` — DST-aware
- **Deploy**: Frontend → Vercel one-click; Backend → Railway (`DEPLOY.md`)

## Iteration 4 — 2026-06-12 (Git pack optimization)
- ffmpeg ile tüm public videoları yeniden sıkıştırıldı (854px scale, CRF 32):
  - spiderman_trailer.mp4: 9.3M → 4.8M
  - ad_cod.mp4: 4.3M → 1.0M
  - ad_efootball.mp4: 1.3M → 503K
  - ad_lords.mp4: 4.8M → 1.3M
  - ad_pubg.mp4: 4.5M → 1.5M
- `/app/media_backup/` tamamen kaldırıldı (kullanılmayan yedek videolar).
- `git filter-repo` ile geçmişten kaldırıldı: `media_backup/`, `_old_backup_static_html/`, `vercel-deploy/`, eski büyük blob versiyonları.
- Tüm commit'ler tek bir squash commit'e dönüştürüldü.
- **Sonuç**: `.git` 78M → 12M, pack 77.39 MiB → 11.20 MiB. GitHub push hazır.

## Iteration 3 Changes (this session, 2026-06-12)
1. **🇹🇷 Türkçe Takım İsim Çevirisi** (`core/team_translations.py`):
   - 80+ FIFA millî takımı (Kanada, ABD, Brezilya, Almanya, İspanya, Hollanda, Japonya, Suudi Arabistan, Fas, Senegal...)
   - 60+ büyük Avrupa kulübü (Bayern Münih, Marsilya, vs)
   - `tr_team_name(en)` + `tr_to_en_candidates(tr)` — iki yönlü
   - `scores.py` `_translate_stages` helper ile tüm `/api/livescore/*` outputu çevirir
   - Backend `team1_en`/`team2_en` ve `NmEn` alanlarını koruyor → match-stats hâlâ İngilizce upstream ile eşleşiyor
2. **🕒 Istanbul Timezone** (`livescore.py`):
   - `ZoneInfo("Europe/Istanbul")` import (Python <3.9 fallback +3 UTC)
   - Status formatting: `astimezone(TR_TZ)` → `BUGÜN 19:00` / `YARIN 22:00`
   - `/api/livescore/today` artık Istanbul tarihi kullanıyor (gece UTC günü değişimi sorunu yok)
3. **🚫 Emergent Bağımlılığı 0**:
   - `emergentintegrations` paketi uninstall edildi
   - `_llm_client.py` wrapper silindi
   - `ai_predictor.py` baştan: openai + anthropic + google-generativeai direct SDKs
   - `asyncio.to_thread` ile sync SDK'lar event loop'u bloklamadan paralel
   - Tüm key/env/comment/regex'lerden "emergent" kelimesi silindi
   - `vercel-deploy/`, `_old_backup_static_html/`, `compare/` klasörleri silindi
4. **☁️ Vercel Uyumluluk**:
   - `frontend/vercel.json` baştan yazıldı (build/install/region fra1)
   - `DEPLOY.md` Vercel + Railway adım adım rehber

## Critical Bug Fixes (Iteration 1)
- **Morocco/Africa exclusion bug** → `is_intl` artık country exclusion'dan ÖNCE
- **`INTL_KEYWORDS` expanded**: friendly, nations league, world cup qualif, afcon
- **`BIG_LEAGUE_KEYWORDS` expanded**: AFCON, Asian Cup, World Cup Qualifying
- **Frontend filters**: MİLLİ MAÇ, DÜNYA KUPASI, AVRUPA ŞAMP., HAZIRLIK

## New Features (Iteration 1 + 2)
1. **Multi-Model AI Prediction** (`/api/ai/predict`):
   - 3 model paralel: GPT-5.2 + Gemini 3 Pro + Claude Sonnet 4.5
   - Claude harmonizer; OpenAI fallback; first-prediction final fallback
   - Graceful: 0 key → `available:false` + Türkçe error (NOT 500)
   - 1+ key → çalışıyor
   - 3 key → full harmoni
   - MongoDB cache 1h TTL
2. **AI UI** (`AIPrediction.tsx`):
   - Cyan/pink glow card, harmonized score + confidence%, per-model breakdown
   - Modal entegrasyonu (`MatchStatsModal.tsx`)

## Implementation Status (2026-06-12)
- [x] Repository merge (Banban + Banban_new)
- [x] World Cup / milli / hazırlık visibility fix
- [x] Multi-model AI (direct SDKs, no emergent)
- [x] AI Prediction UI
- [x] Türkçe takım isim mapping (80+ ülke, 60+ kulüp)
- [x] Istanbul timezone (DST-aware)
- [x] Reverse-mapping match stats (TR ↔ EN search)
- [x] Vercel-ready frontend (`vercel.json`)
- [x] Backend Railway deploy guide (`DEPLOY.md`)
- [x] **Zero emergent traces** (grep verified)
- [x] **Testing agent**: 11/11 backend pytest pass, 95% frontend
- [ ] **AI keys** (user must provide OpenAI / Anthropic / Gemini)
- [ ] **Push to production** (Vercel + Railway deploy)

## Test Credentials
See `/app/memory/test_credentials.md`

## Backlog
- **P1**: Provide AI keys → enables full 3-model harmonization
- **P1**: Last-5 form indicator (team form W/D/L) into AI prompt
- **P1**: WebSocket real-time scoreboard (infra ready, `/api/ws`)
- **P1**: More club mappings (Brazilian Serie A, MLS, J-League, Saudi Pro League)
- **P2**: Mobile bottom-nav, i18n EN toggle
- **P2**: Push notifications UI
- **P2**: Bet-style odds from AI confidence (Kelly criterion)
- **P2**: Per-user prediction game vs AI leaderboard

## Engagement Enhancement Idea
**"AI'yı Yendin mi?" Leaderboard**:
- Mevcut tahmin oyununda kullanıcı tahminini girdiğinde harmonize AI tahmini yan yana
- Kullanıcı haftalık "AI'a karşı doğru tahmin" puanı toplar
- Top-10 lider tablosu (kullanıcı vs 3-model AI)
- Premium tier'i: tüm 3 model + geçmiş hit-rate analitiği
- Bu özellik viral paylaşım + retention + monetization sağlar
