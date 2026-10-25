/**
 * teleCam – config.js
 *
 * Backend URL configuration:
 * - Empty string ("") means same-origin (production on Render or any server where FastAPI serves the frontend).
 * - "http://localhost:8000" is automatically used only when developing frontend separately (e.g. Live Server on port 5500).
 */
window.TELECAM_BACKEND_URL =
  window.location.protocol === "file:" ||
  (window.location.hostname === "localhost" && window.location.port !== "8000") ||
  (window.location.hostname === "127.0.0.1" && window.location.port !== "8000")
    ? "http://localhost:8000"
    : "";
