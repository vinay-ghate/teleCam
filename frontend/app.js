/**
 * teleCam – app.js
 */

// ─── Config ───────────────────────────────────────────────────────────────────
const BACKEND_URL = (window.TELECAM_BACKEND_URL ?? "").replace(/\/$/, "");

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const screenIdle = $("screen-idle");
const screenCamera = $("screen-camera");
const video = $("video");
const canvas = $("canvas");
const flashOverlay = $("flash-overlay");
const focusRing = $("focus-ring");
const stealthOverlay = $("stealth-overlay");
const stealthLabel = $("stealth-label");
const previewControls = $("preview-controls");
const statusDot = $("status-dot");
const statusText = $("status-text");
const queueBadge = $("queue-badge");
const queueCount = $("queue-count");
const toastContainer = $("toast-container");

const btnModePreview = $("btn-mode-preview");
const btnModeStealth = $("btn-mode-stealth");
const btnStartCamera = $("btn-start-camera");
const btnShutter = $("btn-shutter");
const btnStopPreview = $("btn-stop-preview");
const btnStopStealth = $("btn-stop-stealth");
const btnSwitchPreview = $("btn-switch-preview");
const btnSwitchStealth = $("btn-switch-stealth");
const btnStealthCapture = $("btn-stealth-capture");

// ─── State ────────────────────────────────────────────────────────────────────
let stream = null;
let mode = "stealth";
let cameras = [];
let cameraIndex = 0;

// ─── Upload Queue ─────────────────────────────────────────────────────────────
const uploadQueue = [];
let processorRunning = false;

function enqueue(blob, filename) {
  uploadQueue.push({ blob, filename });
  updateQueueBadge();
  if (!processorRunning) runProcessor();
}

async function runProcessor() {
  processorRunning = true;
  while (uploadQueue.length > 0) {
    const { blob, filename } = uploadQueue[0];
    try {
      const result = await uploadBlob(blob, filename);
      uploadQueue.shift();
      updateQueueBadge();
      showToast(result.ok, result.message);
    } catch (err) {
      console.error("Upload failed, retrying in 3s:", err);
      showToast(false, "Network error — retrying…");
      await sleep(3000);
    }
  }
  processorRunning = false;
  updateQueueBadge();
}

function updateQueueBadge() {
  const n = uploadQueue.length;
  queueBadge.hidden = n === 0;
  queueCount.textContent = n;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Filename generation ──────────────────────────────────────────────────────
function getDeviceName() {
  const ua = navigator.userAgent;
  // userAgentData is available in modern Chromium
  if (navigator.userAgentData?.platform) return navigator.userAgentData.platform.replace(/\s+/g, "_");
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) {
    const m = ua.match(/Android[\s\d.]+;\s*([^;)]+)/);
    return m ? m[1].trim().replace(/\s+/g, "_") : "Android";
  }
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "Device";
}

function generateFilename() {
  const device = getDeviceName();
  const now = new Date();
  const date = now.toLocaleDateString("en-CA");                        // YYYY-MM-DD
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "-");     // HH-MM-SS
  return `${device}_${date}_${time}.jpg`;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(success, message, duration = 2500) {
  const el = document.createElement("div");
  if (success) {
    el.className = "toast-dot";
    el.setAttribute("aria-label", "Sent");
  } else {
    el.className = "toast toast--err";
    el.setAttribute("role", "status");
    el.innerHTML = `<span class="toast-icon">✕</span><span class="toast-msg">${message}</span>`;
  }
  toastContainer.prepend(el);
  requestAnimationFrame(() => el.classList.add("toast--in"));
  setTimeout(() => {
    el.classList.remove("toast--in");
    el.classList.add("toast--out");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
  }, duration);
}

// ─── Screens ──────────────────────────────────────────────────────────────────
function showIdle() {
  screenIdle.hidden = false; screenIdle.classList.add("active");
  screenCamera.hidden = true; screenCamera.classList.remove("active");
}
function showCamera() {
  screenIdle.hidden = true; screenIdle.classList.remove("active");
  screenCamera.hidden = false; screenCamera.classList.add("active");
}

// ─── Mode ─────────────────────────────────────────────────────────────────────
function applyMode() {
  const isStealth = mode === "stealth";

  btnModePreview.classList.toggle("active", !isStealth);
  btnModePreview.setAttribute("aria-pressed", String(!isStealth));
  btnModeStealth.classList.toggle("active", isStealth);
  btnModeStealth.setAttribute("aria-pressed", String(isStealth));

  // Stealth overlay fully covers the feed (solid opaque)
  stealthOverlay.hidden = !isStealth;
  previewControls.hidden = isStealth;

  if (isStealth) stealthLabel.textContent = "Tap to capture & send";
}

btnModePreview.addEventListener("click", () => { mode = "preview"; applyMode(); });
btnModeStealth.addEventListener("click", () => { mode = "stealth"; applyMode(); });

// ─── Camera ───────────────────────────────────────────────────────────────────
async function loadCameraList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    cameras = devices.filter((d) => d.kind === "videoinput").map((d) => d.deviceId);
  } catch (_) { cameras = []; }
}

async function startCamera(deviceId) {
  if (stream) stream.getTracks().forEach((t) => t.stop());

  const constraints = {
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      facingMode: deviceId ? undefined : { ideal: "environment" },
      width: { ideal: 4096 },
      height: { ideal: 4096 },
    },
    audio: false,
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    console.error("Camera error:", err);
    showToast(false, "Camera permission denied.", 5000);
    return;
  }

  video.srcObject = stream;
  if (cameras.length === 0) await loadCameraList();
  showCamera();
  applyMode();
  setStatus("ready");
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  video.srcObject = null;
  setStatus("idle");
  showIdle();
}

async function switchCamera() {
  if (cameras.length < 2) { showToast(false, "No other camera found."); return; }
  cameraIndex = (cameraIndex + 1) % cameras.length;
  await startCamera(cameras[cameraIndex]);
}

btnStartCamera.addEventListener("click", () => startCamera(null));
btnStopPreview.addEventListener("click", stopCamera);
btnStopStealth.addEventListener("click", stopCamera);
btnSwitchPreview.addEventListener("click", switchCamera);
btnSwitchStealth.addEventListener("click", switchCamera);
window.addEventListener("beforeunload", stopCamera);

// ─── Status ───────────────────────────────────────────────────────────────────
const STATUS = {
  idle: { dot: "", text: "Idle" },
  ready: { dot: "ready", text: "Ready" },
  error: { dot: "error", text: "Error" },
};
function setStatus(s) {
  const st = STATUS[s] ?? STATUS.idle;
  statusDot.className = "status-dot " + st.dot;
  statusText.textContent = st.text;
}

// ─── Capture ─────────────────────────────────────────────────────────────────
// Video is always full-screen in the DOM → browser never suspends it →
// canvas.drawImage always gets a real frame (no black images).
function captureFrame() {
  return new Promise((resolve, reject) => {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) { reject(new Error("Video not ready.")); return; }
    canvas.width = vw; canvas.height = vh;
    canvas.getContext("2d").drawImage(video, 0, 0, vw, vh);
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("toBlob failed.")),
      "image/jpeg", 1.0
    );
  });
}

function triggerFlash() {
  flashOverlay.classList.add("flash");
  setTimeout(() => flashOverlay.classList.remove("flash"), 120);
}
function triggerFocusRing() {
  focusRing.classList.add("active");
  setTimeout(() => focusRing.classList.remove("active"), 500);
}

// ─── Upload ───────────────────────────────────────────────────────────────────
async function uploadBlob(blob, filename) {
  const form = new FormData();
  form.append("file", blob, filename);
  const resp = await fetch(`${BACKEND_URL}/upload`, { method: "POST", body: form });
  const data = await resp.json();
  return { ok: resp.ok && data.ok === true, message: data.message ?? data.error ?? "Unknown" };
}

// ─── Preview shutter ─────────────────────────────────────────────────────────
btnShutter.addEventListener("click", async () => {
  if (!stream || btnShutter.disabled) return;
  btnShutter.disabled = true;
  triggerFlash(); triggerFocusRing();
  try {
    enqueue(await captureFrame(), generateFilename());
  } catch (err) {
    showToast(false, "Capture failed: " + err.message, 4000);
  } finally {
    btnShutter.disabled = false;
  }
});

// ─── Stealth tap ─────────────────────────────────────────────────────────────
btnStealthCapture.addEventListener("click", async () => {
  if (!stream || btnStealthCapture.disabled) return;
  btnStealthCapture.disabled = true;
  btnStealthCapture.classList.add("sending");
  try {
    enqueue(await captureFrame(), generateFilename());
    stealthLabel.textContent = "Queued ✓";
    setTimeout(() => { stealthLabel.textContent = "Tap to capture & send"; }, 700);
  } catch (err) {
    showToast(false, "Capture failed: " + err.message, 4000);
    stealthLabel.textContent = "Tap to capture & send";
  } finally {
    btnStealthCapture.disabled = false;
    setTimeout(() => btnStealthCapture.classList.remove("sending"), 300);
  }
});

// ─── Init ────────────────────────────────────────────────────────────────────
showIdle();
applyMode();
