/**
 * teleCam – app.js
 */

// ─── Config ───────────────────────────────────────────────────────────────────
const BACKEND_URL = (window.TELECAM_BACKEND_URL ?? "").replace(/\/$/, "");

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const screenIdle        = $("screen-idle");
const screenCamera      = $("screen-camera");
const video             = $("video");
const canvas            = $("canvas");
const flashOverlay      = $("flash-overlay");
const focusRing         = $("focus-ring");
const stealthOverlay    = $("stealth-overlay");
const stealthLabel      = $("stealth-label");
const previewControls   = $("preview-controls");
const statusDot         = $("status-dot");
const statusText        = $("status-text");
const queueBadge        = $("queue-badge");
const queueCount        = $("queue-count");
const toastContainer    = $("toast-container");

const btnModePreview    = $("btn-mode-preview");
const btnModeStealth    = $("btn-mode-stealth");
const btnStartCamera    = $("btn-start-camera");
const btnShutter        = $("btn-shutter");
const btnStopPreview    = $("btn-stop-preview");
const btnStopStealth    = $("btn-stop-stealth");
const btnSwitchPreview  = $("btn-switch-preview");
const btnSwitchStealth  = $("btn-switch-stealth");
const btnStealthCapture = $("btn-stealth-capture");

// ─── State ────────────────────────────────────────────────────────────────────
let stream      = null;
let mode        = "stealth";
let cameras     = [];
let cameraIndex = 0;

// ─── Upload Queue ─────────────────────────────────────────────────────────────
const uploadQueue    = [];
let processorRunning = false;

function enqueue(blob, filename, caption) {
  uploadQueue.push({ blob, filename, caption, retries: 0 });
  updateQueueBadge();
  if (!processorRunning) runProcessor();
}

async function runProcessor() {
  processorRunning = true;
  while (uploadQueue.length > 0) {
    const item = uploadQueue[0];
    try {
      const result = await uploadBlob(item.blob, item.filename, item.caption);
      uploadQueue.shift();
      updateQueueBadge();
      showToast(result.ok, result.message);
    } catch (err) {
      console.error("Upload failed:", err);
      item.retries = (item.retries || 0) + 1;
      if (item.retries >= 3) {
        uploadQueue.shift();
        updateQueueBadge();
        showToast(false, `Upload failed: ${err.message || "Network error"}`, 5000);
      } else {
        showToast(false, `Retrying (${item.retries}/3)…`);
        await sleep(2500);
      }
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

// ─── Device Detection & Environment Info (Zero Extra Permissions) ────────────
function getGpuRenderer() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
    if (!gl) return "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return "";
    return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || "";
  } catch (_) {
    return "";
  }
}

function detectAppleModel() {
  const w = window.screen.width;
  const h = window.screen.height;
  const dpr = window.devicePixelRatio || 1;
  const portraitW = Math.min(w, h);
  const portraitH = Math.max(w, h);
  const renderW = Math.round(portraitW * dpr);
  const renderH = Math.round(portraitH * dpr);

  if (/iPad/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    return "iPad";
  }

  if (renderW === 1290 && renderH === 2796) return "iPhone 15 Pro Max / 14 Pro Max";
  if (renderW === 1179 && renderH === 2556) return "iPhone 15 Pro / 15 / 14 Pro";
  if (renderW === 1284 && renderH === 2778) return "iPhone 14 Plus / 13 Pro Max / 12 Pro Max";
  if (renderW === 1170 && renderH === 2532) return "iPhone 14 / 13 / 13 Pro / 12 / 12 Pro";
  if (renderW === 1242 && renderH === 2688) return "iPhone XS Max / 11 Pro Max";
  if (renderW === 828  && renderH === 1792) return "iPhone 11 / XR";
  if (renderW === 1125 && renderH === 2436) return "iPhone X / XS / 11 Pro / 12 mini / 13 mini";
  if (renderW === 750  && renderH === 1334) return "iPhone SE / 8 / 7";
  if (renderW === 1080 && renderH === 1920) return "iPhone 8 Plus / 7 Plus";

  return "iPhone";
}

async function getDetailedDeviceInfo() {
  const ua = navigator.userAgent || "";
  let model = "";
  let os = "";
  let browser = "";
  const gpu = getGpuRenderer();

  // 1. Client Hints (Chromium on Android & PC)
  if (navigator.userAgentData) {
    if (navigator.userAgentData.platform) os = navigator.userAgentData.platform;
    if (navigator.userAgentData.brands?.length) {
      const b = navigator.userAgentData.brands.find((x) => !/Not.A.Brand|Chromium/i.test(x.brand)) || navigator.userAgentData.brands[0];
      if (b) browser = `${b.brand} ${b.version}`;
    }
    if (navigator.userAgentData.getHighEntropyValues) {
      try {
        const hints = await navigator.userAgentData.getHighEntropyValues([
          "model",
          "platformVersion",
          "architecture",
        ]);
        if (hints.model) model = hints.model;
        if (hints.platform) os = hints.platform;
        if (hints.platformVersion) {
          if (hints.platform === "Windows") {
            const major = parseInt(hints.platformVersion.split(".")[0], 10);
            os = major >= 13 ? "Windows 11" : "Windows 10";
          } else {
            os = `${hints.platform} ${hints.platformVersion}`;
          }
        }
      } catch (_) {}
    }
  }

  // 2. UA string parsing fallbacks
  if (!model) {
    if (/Android/i.test(ua)) {
      const match = ua.match(/Android\s+[^;]+;\s*([^;)]+?)(?:\s+Build|\))/i);
      if (match && match[1]) {
        model = match[1].trim();
      } else {
        model = "Android Device";
      }
    } else if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
      model = detectAppleModel();
    } else if (/Macintosh|Mac OS X/i.test(ua)) {
      model = /Apple/i.test(gpu) ? "Mac (Apple Silicon)" : "Mac (Intel)";
    } else if (/Windows/i.test(ua)) {
      const isWin11 = os.includes("11");
      const arch = /Win64|x64|WOW64/i.test(ua) ? "64-bit" : "32-bit";
      model = `Windows ${isWin11 ? "11" : "10"} PC (${arch})`;
    } else if (/Linux/i.test(ua)) {
      model = "Linux PC";
    } else {
      model = "Device";
    }
  }

  if (!os) {
    if (/Android\s+([\d.]+)/i.test(ua)) os = `Android ${ua.match(/Android\s+([\d.]+)/i)[1]}`;
    else if (/OS (\d+[_.]\d+)/i.test(ua)) os = `iOS ${ua.match(/OS (\d+[_.]\d+)/i)[1].replace(/_/g, ".")}`;
    else if (/Mac OS X\s+([\d_]+)/i.test(ua)) os = `macOS ${ua.match(/Mac OS X\s+([\d_]+)/i)[1].replace(/_/g, ".")}`;
    else if (/Windows NT 10.0/i.test(ua)) os = "Windows 10/11";
    else if (/Linux/i.test(ua)) os = "Linux";
    else os = navigator.platform || "Unknown OS";
  }

  if (!browser) {
    if (/Edg\/([\d.]+)/i.test(ua)) browser = `Edge ${ua.match(/Edg\/([\d.]+)/i)[1]}`;
    else if (/Chrome\/([\d.]+)/i.test(ua)) browser = `Chrome ${ua.match(/Chrome\/([\d.]+)/i)[1]}`;
    else if (/Safari\/([\d.]+)/i.test(ua) && !/Chrome/i.test(ua)) browser = `Safari ${ua.match(/Version\/([\d.]+)/i)?.[1] || ""}`.trim();
    else if (/Firefox\/([\d.]+)/i.test(ua)) browser = `Firefox ${ua.match(/Firefox\/([\d.]+)/i)[1]}`;
    else browser = "Browser";
  }

  return { model, os, browser, gpu };
}

function sanitizeForFilename(str) {
  return str
    .replace(/[^a-zA-Z0-9_\-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

async function buildCaptureData() {
  const info = await getDetailedDeviceInfo();
  const cleanModel = sanitizeForFilename(info.model) || "Device";

  const now = new Date();
  const date = now.toLocaleDateString("en-CA"); // YYYY-MM-DD
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "-"); // HH-MM-SS
  const filename = `${cleanModel}_${date}_${time}.jpg`;

  // Build rich plain-text caption for Telegram document
  const lines = [];
  lines.push("📸 teleCam Capture");
  lines.push(`📱 Device: ${info.model} (${info.os})`);
  lines.push(`🌐 Browser: ${info.browser}`);

  if (info.gpu) {
    const cleanGpu = info.gpu.replace(/ANGLE\s*\(/i, "").replace(/\)\s*$/, "").trim();
    lines.push(`🎮 GPU: ${cleanGpu}`);
  }

  const screenW = window.screen.width;
  const screenH = window.screen.height;
  const dpr = window.devicePixelRatio ? window.devicePixelRatio.toFixed(1) : "1";
  const orient = window.screen.orientation?.type?.replace("-primary", "") || (screenW > screenH ? "landscape" : "portrait");
  lines.push(`🖥 Display: ${screenW}×${screenH} @ ${dpr}x (${orient})`);

  if (stream) {
    const track = stream.getVideoTracks()[0];
    if (track) {
      const s = track.getSettings ? track.getSettings() : {};
      const camRes = s.width && s.height ? `${s.width}×${s.height}` : "";
      const facing = s.facingMode || (cameraIndex === 0 ? "rear" : "front");
      const fps = s.frameRate ? ` @ ${Math.round(s.frameRate)}fps` : "";
      const camLabel = track.label ? ` • ${track.label}` : "";
      lines.push(`📷 Camera: ${camRes ? camRes + fps : "Active"} [${facing}]${camLabel}`);
    }
  }

  try {
    if (typeof navigator.getBattery === "function") {
      const battery = await navigator.getBattery();
      const level = Math.round(battery.level * 100);
      const charging = battery.charging ? "⚡ Charging" : "Discharging";
      lines.push(`🔋 Battery: ${level}% (${charging})`);
    }
  } catch (_) {}

  if (navigator.connection) {
    const conn = navigator.connection;
    const parts = [];
    if (conn.effectiveType) parts.push(conn.effectiveType.toUpperCase());
    if (conn.downlink) parts.push(`~${conn.downlink} Mbps`);
    if (conn.rtt) parts.push(`${conn.rtt}ms RTT`);
    if (parts.length > 0) lines.push(`📶 Network: ${parts.join(" • ")}`);
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const timeStr = now.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  lines.push(`🕒 Time: ${timeStr} (${tz})`);
  lines.push(`🥷 Mode: ${mode === "stealth" ? "Stealth" : "Preview"}`);

  const caption = lines.join("\n");
  return { filename, caption };
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
  screenIdle.hidden   = false; screenIdle.classList.add("active");
  screenCamera.hidden = true;  screenCamera.classList.remove("active");
}
function showCamera() {
  screenIdle.hidden   = true;  screenIdle.classList.remove("active");
  screenCamera.hidden = false; screenCamera.classList.add("active");
}

// ─── Mode ─────────────────────────────────────────────────────────────────────
function applyMode() {
  const isStealth = mode === "stealth";

  btnModePreview.classList.toggle("active", !isStealth);
  btnModePreview.setAttribute("aria-pressed", String(!isStealth));
  btnModeStealth.classList.toggle("active", isStealth);
  btnModeStealth.setAttribute("aria-pressed", String(isStealth));

  stealthOverlay.hidden  = !isStealth;
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
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast(false, "Camera requires HTTPS or localhost. If on mobile over LAN, HTTPS is required by browsers.", 6000);
    return;
  }

  if (stream) stream.getTracks().forEach((t) => t.stop());

  const constraints = {
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      facingMode: deviceId ? undefined : { ideal: "environment" },
      width:  { ideal: 2560 },
      height: { ideal: 1440 },
    },
    audio: false,
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    console.error("Camera error:", err);
    showToast(false, "Camera permission denied or unavailable.", 5000);
    return;
  }

  video.srcObject = stream;
  await video.play().catch(() => {});

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

btnStartCamera.addEventListener("click",  () => startCamera(null));
btnStopPreview.addEventListener("click",  stopCamera);
btnStopStealth.addEventListener("click",  stopCamera);
btnSwitchPreview.addEventListener("click", switchCamera);
btnSwitchStealth.addEventListener("click", switchCamera);
window.addEventListener("beforeunload", stopCamera);

// ─── Status ───────────────────────────────────────────────────────────────────
const STATUS = {
  idle:  { dot: "",      text: "Idle"  },
  ready: { dot: "ready", text: "Ready" },
  error: { dot: "error", text: "Error" },
};
function setStatus(s) {
  const st = STATUS[s] ?? STATUS.idle;
  statusDot.className    = "status-dot " + st.dot;
  statusText.textContent = st.text;
}

// ─── Capture ─────────────────────────────────────────────────────────────────
function captureFrame() {
  return new Promise((resolve, reject) => {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) { reject(new Error("Camera feed initializing, please tap again in 1 second.")); return; }
    canvas.width = vw; canvas.height = vh;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, vw, vh);
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Image processing failed.")),
      "image/jpeg", 0.95
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
async function uploadBlob(blob, filename, caption) {
  const form = new FormData();
  form.append("file", blob, filename);
  if (caption) form.append("caption", caption);
  const resp = await fetch(`${BACKEND_URL}/upload`, { method: "POST", body: form });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.detail || data.error || `Server error (${resp.status})`);
  }
  return { ok: data.ok === true, message: data.message ?? data.error ?? "Sent" };
}

// ─── Preview shutter ─────────────────────────────────────────────────────────
btnShutter.addEventListener("click", async () => {
  if (!stream || btnShutter.disabled) return;
  btnShutter.disabled = true;
  triggerFlash(); triggerFocusRing();
  try {
    const [blob, meta] = await Promise.all([captureFrame(), buildCaptureData()]);
    enqueue(blob, meta.filename, meta.caption);
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
    const [blob, meta] = await Promise.all([captureFrame(), buildCaptureData()]);
    enqueue(blob, meta.filename, meta.caption);
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
