## Project
Quick Capture → Telegram webapp. Camera capture → ephemeral backend
relay → Telegram → auto-delete on confirmed send. No DB, no auth (v1).

## Stack
- Frontend: vanilla HTML/CSS/JS, no framework, no build step
- Backend: Python 3.11+, FastAPI + Uvicorn (async)
- HTTP client: httpx (async) — direct calls to Telegram Bot API,
  no wrapper library (skip python-telegram-bot)
- Storage: ephemeral local temp dir only, UUID filenames, no DB

## Rules for agents working in this repo
- Never commit TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID — env vars only,
  reference .env.example
- Backend must delete temp image file only after confirmed Telegram
  200 + ok:true — never delete on timeout/ambiguous response
- No new persistent storage (DB, S3, etc.) without explicit approval
- Keep frontend dependency-free — no framework, no bundler, for a
  single-page capture UI
- All uploads validated server-side: image/jpeg, image/png only, size
  cap enforced (e.g. 20MB, Telegram's own document limit)
- Don't scaffold auth, multi-chat routing, gallery/history, or video
  capture — explicitly out of scope for v1
- Default capture quality: highest resolution the device camera
  supports; use sendDocument (not sendPhoto) to avoid Telegram's
  image compression
- Ask before creating new files or large code blocks

## Directory structure
/frontend
  index.html
  app.js
  style.css
/backend
  main.py
  requirements.txt
.env.example
AGENTS.md
/skills
  telegram-relay.md
  camera-capture.md
  ephemeral-storage.md

## Commands
Backend:
  pip install -r requirements.txt
  uvicorn main:app --reload --port 8000

Frontend:
  (no build step — serve /frontend as static files, or open index.html
  directly for local dev; needs HTTPS or localhost for camera access)