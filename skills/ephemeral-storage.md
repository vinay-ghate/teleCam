# Skill: Ephemeral Storage (Backend)

## Scope
How uploaded images are temporarily held on the backend before/after
the Telegram relay — no persistence layer involved.

## Storage location
- Local temp directory, e.g. `/tmp/capture/` (or OS temp dir via
  Python's `tempfile` module)
- Not inside the web-served directory — never publicly accessible
  by URL

## Naming
- UUID v4 filename per upload (`uuid.uuid4()`), preserve original
  extension (.jpg/.png) based on validated content-type — don't trust
  client-supplied filename directly

## Lifecycle
1. File written to temp dir on upload
2. Passed to Telegram relay (see telegram-relay.md)
3. On confirmed Telegram success → delete immediately (same request
   cycle, not a background job)
4. On failure → retain file, surface error to client

## What this explicitly is NOT
- No database record of uploads
- No file ever written to permanent/persistent storage
- No scheduled cleanup job needed in v1 *if* delete-on-success is
  reliable — but add a basic stale-file sweep (e.g. delete anything
  older than 1 hour) as a safety net in case a delete step is ever
  missed due to a crash mid-request

## Gotchas
- If the server restarts/crashes between save and Telegram
  confirmation, an orphaned file can be left behind — the stale-file
  sweep above covers this
- Validate uploaded content-type and size BEFORE writing to disk,
  not after