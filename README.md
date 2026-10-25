# teleCam 📷→ Telegram

> **Quick Capture** – snap a photo in your browser and send it straight to a Telegram chat.  
> No account. No storage. No trace. Ephemeral by design.

---

## How it works

```
Browser camera  →  FastAPI backend  →  Telegram Bot API  →  your chat
     (HTTPS)          (Render)          sendDocument           ✓ delivered
                   temp file deleted
                   on confirmed send
```

1. The frontend captures a full-resolution JPEG via the browser's camera API.  
2. It uploads the image to the FastAPI backend running on Render.  
3. The backend validates the file, saves it to a temp directory, then relays it to Telegram using `sendDocument` (lossless, no compression).  
4. Only after Telegram confirms delivery (`200 ok:true`) is the temp file deleted.

---

## Features

| Feature | Details |
|---|---|
| **Two capture modes** | **Preview** – live viewfinder + shutter + preview before send. **Stealth** – single button, no preview, instant send. |
| **Full resolution** | `getUserMedia` requests max device resolution; `sendDocument` bypasses Telegram's compression. |
| **Ephemeral storage** | Temp files deleted immediately after confirmed Telegram delivery. Stale-file sweep as safety net. |
| **No framework** | Vanilla HTML/CSS/JS frontend. No build step. |
| **Easy deployment** | One-click Render Blueprint (`render.yaml`). |

---

## Prerequisites

| Tool | Version |
|---|---|
| Python | 3.11 or newer |
| pip | bundled with Python |
| A Telegram bot | [Create one with @BotFather](https://t.me/BotFather) |
| Your Telegram Chat ID | Send a message to your bot and call `getUpdates`, or use [@userinfobot](https://t.me/userinfobot) |

---

## Local Development

### 1 — Clone & configure

```bash
git clone https://github.com/YOUR_USERNAME/teleCam.git
cd teleCam

# Copy the example env file and fill in your credentials
cp .env.example .env
```

Edit `.env`:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here

# Optional – defaults are sensible
MAX_UPLOAD_SIZE_MB=50
TEMP_DIR=/tmp/capture
REQUEST_TIMEOUT_SECONDS=15
STALE_FILE_MAX_AGE_MINUTES=60
```

> ⚠️ **Never commit `.env`** – it is already in `.gitignore`.

---

### 2 — Run the backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.  
Health check: `http://localhost:8000/health`

---

### 3 — Serve the frontend

The frontend is plain HTML — no build step needed.

**Option A – VS Code Live Server / any static file server:**

```bash
# Python's built-in server (from the frontend directory)
cd frontend
python -m http.server 5500
# Open http://localhost:5500
```

**Option B – Direct file open** (works for local dev only — camera requires `localhost` or HTTPS):

```
Open frontend/index.html in your browser
```

> The frontend defaults to the same-origin backend (empty URL), which works in production.  
> For **local dev**, edit `frontend/config.js` to point at your local backend:
> ```js
> window.TELECAM_BACKEND_URL = "http://localhost:8000";
> ```

---

## Deploy to Render (single service, free tier)

FastAPI serves both the API **and** the static frontend — one Render service, one URL, no CORS configuration needed.

Render supports a **Blueprint** file (`render.yaml`) that provisions the service automatically.

### Step 1 – Push to GitHub

```bash
git add .
git commit -m "initial commit"
git push origin main
```

### Step 2 – Create a Render account

Go to [render.com](https://render.com) and sign up / log in.

### Step 3 – New Blueprint

1. In the Render dashboard click **New → Blueprint**.  
2. Connect your GitHub repository.  
3. Render detects `render.yaml` automatically — it will provision a single service called **telecam**.  
4. Click **Apply**.

### Step 4 – Set secret environment variables

Navigate to the **telecam** service → **Environment** tab and add:

| Key | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | your bot token |
| `TELEGRAM_CHAT_ID` | your chat ID |

These are marked `sync: false` in `render.yaml` so they are **never stored in the repo**.

### Step 5 – Open the service URL

Render gives you a single URL (e.g. `https://telecam.onrender.com`).  
Open it in your browser — the frontend is served directly from the same process.

> Camera access requires **HTTPS**, which Render provides automatically. ✓

---

## Project Structure

```
teleCam/
├── frontend/
│   ├── index.html      # Single-page UI
│   ├── style.css       # Design system + components
│   ├── app.js          # Camera, capture, upload logic
│   └── config.js       # Backend URL (edit before deploying)
├── backend/
│   ├── main.py         # FastAPI app
│   └── requirements.txt
├── skills/
│   ├── camera-capture.md
│   ├── telegram-relay.md
│   └── ephemeral-storage.md
├── .env.example        # Template — copy to .env
├── .gitignore          # Excludes .env
├── render.yaml         # Render Blueprint
└── AGENTS.md           # Project spec for AI agents
```

---

## Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | *(required)* | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | *(required)* | Target chat / user ID |
| `MAX_UPLOAD_SIZE_MB` | `50` | Max upload size (Telegram's doc limit is 50 MB) |
| `TEMP_DIR` | `/tmp/capture` | Where temp files are written |
| `REQUEST_TIMEOUT_SECONDS` | `15` | Timeout for Telegram API calls |
| `STALE_FILE_MAX_AGE_MINUTES` | `60` | Auto-delete orphaned files older than this |

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check – returns `{"status": "ok"}` |
| `POST` | `/upload` | Upload image → relay to Telegram |

**POST /upload**  
- Content-Type: `multipart/form-data`  
- Field: `file` (JPEG or PNG, max `MAX_UPLOAD_SIZE_MB`)  
- Returns: `{"ok": true, "message": "..."}` or `{"ok": false, "error": "..."}`

---

## Security Notes

- Bot token and chat ID are **env-var only** — never hardcoded, never logged, never returned by the API.
- Only `image/jpeg` and `image/png` are accepted — validated server-side before the file is written to disk.
- Temp files are **never publicly accessible** — stored outside the web-served directory.
- Delete-on-success is confirmed against a real Telegram `200 + ok:true` response.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Camera not working | You must use HTTPS or `localhost`. Plain HTTP will be blocked by the browser. |
| `RuntimeError: TELEGRAM_BOT_TOKEN … must be set` | Set the env vars in `.env` (local) or Render dashboard (production). |
| `413 File too large` | Lower your capture quality or raise `MAX_UPLOAD_SIZE_MB`. |
| Telegram returns non-OK | Check your bot token and that the bot has been started in the target chat. |
| Render free tier sleeps | Free web services spin down after inactivity. The first request after sleep may take ~30 s. Upgrade to a paid plan for always-on. |

---

## License

MIT
