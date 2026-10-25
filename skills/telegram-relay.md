## Scope
How images get from the backend's temp storage to Telegram, and the
contract around when it's safe to delete the local file.

## Config
- TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID loaded from environment only
- Never hardcoded, never logged, never returned in API responses

## Send method
- Use `sendDocument`, not `sendPhoto`
  - sendPhoto re-compresses and downsizes the image (Telegram applies
    its own JPEG compression + resolution cap)
  - sendDocument preserves the original file losslessly — required
    since default quality is "highest available"
- Endpoint: `POST https://api.telegram.org/bot<TOKEN>/sendDocument`
- Multipart form upload: `chat_id` + `document` (the file)
- Use httpx.AsyncClient, not requests — don't block the event loop

## Success contract
- Only treat as success if Telegram responds HTTP 200 AND `ok: true`
  in the JSON body
- On success → delete the temp file immediately, return success to
  frontend
- On any other outcome (non-200, ok:false, timeout, network error):
  - Do NOT delete the file
  - Return a clear error to frontend (don't swallow it)
  - Optional: allow a manual/automatic retry against the same temp
    file rather than re-uploading from the client

## Gotchas
- Telegram file size limit for bots: 50MB via sendDocument — validate
  before attempting send, fail fast with a clear error if exceeded
- Network call to Telegram can hang — set an explicit httpx timeout
  (e.g. 15s) so the request doesn't dangle indefinitely
- If chat_id or token is missing/invalid, fail at startup, not on
  first request