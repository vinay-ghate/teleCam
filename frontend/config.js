/**
 * teleCam – config.js
 *
 * Backend URL configuration:
 * - Empty string ("") means same-origin (when FastAPI serves the frontend, on port 8000 or on Render).
 * - When testing frontend on a separate dev port (e.g. Live Server on port 5500), automatically points to port 8000 on the same host (PC or mobile LAN).
 */
(function () {
  const loc = window.location;
  if (loc.protocol === "file:") {
    window.TELECAM_BACKEND_URL = "http://localhost:8000";
  } else if (loc.port === "8000" || loc.protocol === "https:" || (!loc.port && loc.hostname !== "localhost" && loc.hostname !== "127.0.0.1")) {
    window.TELECAM_BACKEND_URL = "";
  } else {
    window.TELECAM_BACKEND_URL = `${loc.protocol}//${loc.hostname}:8000`;
  }
})();
