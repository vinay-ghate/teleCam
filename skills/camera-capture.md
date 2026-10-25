## Scope
getUserMedia setup, the two UI modes, and how capture quality is
enforced client-side.

## Capture quality
- Request highest resolution camera supports via constraints, e.g.
  width/height `ideal: 4096` (or similar) — browser clamps to actual
  device max automatically
- Capture via `<canvas>` → `toBlob()` with `image/jpeg` quality `1.0`,
  or `image/png` if lossless is preferred over file size
- No client-side resizing/compression — that defeats "highest quality
  default"

## Two UI modes
**Live Preview mode**
- Visible `<video>` element bound to the camera stream
- Visible shutter button
- After capture: show the captured frame (canvas or static image) as
  a preview with Send / Retake options before upload

**Hidden Camera mode**
- Camera stream still active (permission granted, stream running) but
  `<video>` element not rendered/visible (off-screen or display:none
  — note: some browsers throttle truly hidden video elements, test
  this; may need width/height 1px positioned off-screen instead of
  display:none)
- Single discreet capture button, minimal/no visual feedback
- No preview shown — capture triggers upload directly (or a minimal
  non-intrusive status indicator only)

## Mode toggle
- Single UI toggle switches between the two behaviors
- Switching modes should not require re-requesting camera permission
  if a stream is already active — just change what's rendered/shown

## Status feedback
- Minimal indicator states: idle → capturing → uploading → sent /
  failed
- Hidden mode should keep this as unobtrusive as the mode implies
  (e.g. a small dot/icon color change, not a banner)

## Gotchas
- getUserMedia requires a secure context (HTTPS or localhost) —
  will silently fail or throw on plain HTTP in production
- Always request camera permission on explicit user action (button
  tap), not on page load — browsers block/warn on auto-request
- Release the stream (`track.stop()`) when leaving the page to avoid
  the camera indicator staying on