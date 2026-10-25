import asyncio
import logging
import os
import re
import uuid
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
load_dotenv()

TELEGRAM_BOT_TOKEN: str = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_CHAT_ID: str = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
MAX_UPLOAD_SIZE_MB: int = int(os.environ.get("MAX_UPLOAD_SIZE_MB", "50"))
TEMP_DIR: Path = Path(os.environ.get("TEMP_DIR", "/tmp/capture"))
REQUEST_TIMEOUT_SECONDS: float = float(os.environ.get("REQUEST_TIMEOUT_SECONDS", "15"))
STALE_FILE_MAX_AGE_MINUTES: int = int(os.environ.get("STALE_FILE_MAX_AGE_MINUTES", "60"))

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png"}
MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024
TELEGRAM_API_URL = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendDocument"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Startup validation
# ---------------------------------------------------------------------------
if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
    raise RuntimeError(
        "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in environment / .env file"
    )

TEMP_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="teleCam relay", version="1.0.0")

# CORS only needed if the frontend is hosted on a different origin.
# When serving from the same FastAPI process (single Render service),
# this middleware is a no-op but harmless to keep for local dev.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ── Static frontend ──────────────────────────────────────────────────────────
# Resolve the frontend directory relative to this file so it works regardless
# of where uvicorn is launched from.
_HERE = Path(__file__).parent
_FRONTEND_DIR = (_HERE.parent / "frontend").resolve()

# ---------------------------------------------------------------------------
# Background stale-file sweep
# ---------------------------------------------------------------------------
async def _sweep_stale_files() -> None:
    """Periodically delete orphaned temp files older than the configured age."""
    import time
    while True:
        await asyncio.sleep(60)  # check every minute
        cutoff = time.time() - STALE_FILE_MAX_AGE_MINUTES * 60
        for f in TEMP_DIR.iterdir():
            if f.is_file() and f.stat().st_mtime < cutoff:
                try:
                    f.unlink()
                    log.info("Stale file removed: %s", f.name)
                except OSError as exc:
                    log.warning("Could not remove stale file %s: %s", f.name, exc)


@app.on_event("startup")
async def startup_event() -> None:
    asyncio.create_task(_sweep_stale_files())
    log.info("teleCam backend started. Temp dir: %s", TEMP_DIR)
    log.info("Serving frontend from: %s", _FRONTEND_DIR)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
async def serve_root() -> FileResponse:
    """Serve the SPA entry point."""
    return FileResponse(_FRONTEND_DIR / "index.html")


@app.post("/upload")
async def upload_image(
    file: UploadFile = File(...),
    caption: str = Form(default=""),
) -> JSONResponse:
    # 1. Validate content-type BEFORE reading the body
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported media type '{file.content_type}'. Only JPEG and PNG are accepted.",
        )

    # 2. Read body with size cap
    body = await file.read(MAX_UPLOAD_SIZE_BYTES + 1)
    if len(body) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_UPLOAD_SIZE_MB} MB.",
        )

    # 3. Determine extension from validated content-type (don't trust client)
    ext = ".jpg" if file.content_type == "image/jpeg" else ".png"
    temp_path = TEMP_DIR / f"{uuid.uuid4()}{ext}"  # UUID keeps temp storage safe

    # Build a clean display filename for Telegram (from the original upload name)
    raw_name   = (file.filename or f"capture{ext}").strip()
    # Allow only word chars, hyphens, underscores, dots — strip everything else
    safe_name  = re.sub(r"[^\w\-.]", "_", raw_name)
    # Enforce the correct extension regardless of what the client sent
    safe_name  = re.sub(r"\.[^.]+$", "", safe_name) + ext
    if not safe_name or safe_name == ext:
        safe_name = f"capture{ext}"

    # 4. Write to temp dir
    try:
        temp_path.write_bytes(body)
        log.info("Temp file written: %s (%d bytes)", temp_path.name, len(body))
    except OSError as exc:
        log.error("Failed to write temp file: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to save file on server.")

    # 5. Relay to Telegram
    try:
        payload = {"chat_id": TELEGRAM_CHAT_ID}
        if caption and caption.strip():
            payload["caption"] = caption.strip()[:1024]

        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            with temp_path.open("rb") as fh:
                resp = await client.post(
                    TELEGRAM_API_URL,
                    data=payload,
                    # safe_name → human-readable filename in Telegram (e.g. Pixel_7_Pro_2026-10-25_22-46-00.jpg)
                    # temp_path.name is only used locally (UUID)
                    files={"document": (safe_name, fh, file.content_type)},
                )
    except httpx.TimeoutException:
        log.warning("Telegram request timed out for %s", temp_path.name)
        return JSONResponse(
            status_code=504,
            content={"ok": False, "error": "Telegram request timed out. The file is retained for retry."},
        )
    except httpx.RequestError as exc:
        log.error("Network error sending to Telegram: %s", exc)
        return JSONResponse(
            status_code=502,
            content={"ok": False, "error": f"Network error: {exc}. The file is retained for retry."},
        )

    # 6. Evaluate Telegram response
    telegram_ok = resp.status_code == 200 and resp.json().get("ok") is True

    if telegram_ok:
        # Delete ONLY after confirmed success
        try:
            temp_path.unlink()
            log.info("Temp file deleted after successful send: %s", temp_path.name)
        except OSError as exc:
            log.warning("Could not delete temp file %s: %s", temp_path.name, exc)
        return JSONResponse(content={"ok": True, "message": "Image sent to Telegram."})
    else:
        error_body = resp.text
        log.error(
            "Telegram returned non-OK response (%d): %s", resp.status_code, error_body
        )
        return JSONResponse(
            status_code=502,
            content={
                "ok": False,
                "error": f"Telegram rejected the upload (HTTP {resp.status_code}). File retained.",
                "detail": error_body,
            },
        )


# ---------------------------------------------------------------------------
# Static frontend — mounted LAST so API routes always take priority.
# Serves /frontend/** at the root path (e.g. /style.css, /app.js).
# ---------------------------------------------------------------------------
if _FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")
else:
    log.warning("Frontend directory not found at %s — static files will not be served.", _FRONTEND_DIR)
