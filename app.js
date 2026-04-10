// app.js (final cleaned version)
// Firebase (App + RTDB)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  onDisconnect,
  remove,
  get,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
// Firebase Auth (Anonymous)
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

// -----------------------------
// CONFIG
// -----------------------------
const firebaseConfig = {
  apiKey: "AIzaSyAFpipCO1XuETiPzuCptlTJhpHy4v7teo4",
  authDomain: "htqs-afa97.firebaseapp.com",
  databaseURL: "https://htqs-afa97-default-rtdb.firebaseio.com",
  projectId: "htqs-afa97",
  storageBucket: "htqs-afa97.appspot.com",
  messagingSenderId: "900324034014",
  appId: "1:900324034014:web:4e6cf9b46567a9ee17494f",
};

// ✅ Change this to your real doorman PIN
const DOORMAN_PIN = "1400";

// Offer timing
const OFFER_MS = 25000;

// -----------------------------
// INIT
// -----------------------------
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
// Detect Firebase connection state
const connectedRef = ref(db, ".info/connected");

onValue(connectedRef, (snap) => {
  const connected = snap.val();

  if (connected === true) {
    console.log("RTDB connected");

    // Refresh queue view after reconnect
    refreshJoinUI?.();
    refreshAcceptUI?.();
  } else {
    console.warn("RTDB disconnected — waiting for reconnect");
  }
});
const auth = getAuth(app);

const queueRef = ref(db, "queue");

// -----------------------------
// DOM
// -----------------------------
const driverNameInput = document.getElementById("driverName");
const driverColorInput = document.getElementById("driverColor");
const driverPlateInput = document.getElementById("driverPlate");

const joinBtn = document.getElementById("joinBtn");
const leaveBtn = document.getElementById("leaveBtn");
const acceptBtn = document.getElementById("acceptBtn");
const acceptBtnLabel = acceptBtn?.querySelector(".btn-label");
const callNextBtn = document.getElementById("callNextBtn");
const completeBtn = document.getElementById("completeBtn");
const resetBtn = document.getElementById("resetBtn");

const doormanPinInput = document.getElementById("doormanPin");

const queueList = document.getElementById("queueList");
const calledBox = document.getElementById("calledBox");
const queueHealthBox = document.getElementById("queueHealthBox");
const offerInfo = document.getElementById("offerInfo"); // optional

const offerAlertBox = document.getElementById("offerAlertBox");
const offerAlertText = document.getElementById("offerAlertText");
const offerAlertCountdown = document.getElementById("offerAlertCountdown");

const netStatus = document.getElementById("netStatus"); // optional
const queueEmpty = document.getElementById("queueEmpty"); // optional
const soundToggle = document.getElementById("soundToggle"); // optional

// -----------------------------
// STATE
// -----------------------------

let offerBeepIntervalId = null;
let offerBeepStopTimeoutId = null;
let offerBeepCount = 0;
let urgentBeepIntervalId = null;
let urgentDoublePulseActive = false;
let urgentSecondPulseTimeoutId = null;
let myDriverKey = sessionStorage.getItem("htqs.driverKey") || null;
let driverHeartbeatId = null;
let offeredCache = null;

// C3: offer lifecycle UX (driver-side)
let lastOfferWasForMe = false;
let lastOfferKeyForMe = null;
let offerCountdownTimer = null;
let lastQueueSnapshot = {};
let queueHealthTimer = null;
let lastOfferSig = null; // key + startedAt
let soundEnabled = true;
let suppressOfferBeep = false;

// Audio
let audioCtx = null;
let audioUnlocked = false;


// Single listener handle
let unsubscribeQueue = null;

window.htqs = {
  get soundEnabled() { return soundEnabled; },
  set soundEnabled(v) { soundEnabled = !!v; },
  get audioUnlocked() { return audioUnlocked; },
  canPlayAlerts,
};

// -----------------------------
// HELPERS
// -----------------------------
function norm(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

function updateEmptyState() {
  if (!queueEmpty || !queueList) return;
  queueEmpty.style.display = queueList.children.length ? "none" : "block";
}

function setOfferPulse(on) {
  const driverCardEl = document.querySelector(".card.driver");
  if (acceptBtn) acceptBtn.classList.toggle("is-offered", !!on);
  if (driverCardEl) driverCardEl.classList.toggle("is-offered", !!on);
}

function updateAcceptButtonVisual(msLeft = null) {
  if (!acceptBtn) return;

  acceptBtn.classList.remove("offer-ready", "final-seconds");

  if (!offeredCache) return;

  acceptBtn.classList.add("offer-ready");

  if (typeof msLeft === "number" && msLeft > 0 && msLeft <= 2000) {
    acceptBtn.classList.add("final-seconds");
  }
}

function setAcceptButtonLabel(msLeft = null) {
  if (!acceptBtn || !acceptBtnLabel) return;

  if (msLeft == null) {
    acceptBtnLabel.textContent = "Accept Ride";
    return;
  }

  const secLeft = Math.max(0, Math.ceil(msLeft / 1000));

  if (secLeft <= 0) {
    acceptBtnLabel.textContent = "Offer Expired";
  } else if (secLeft <= 2) {
    acceptBtnLabel.textContent = `Accept Now (${secLeft}s)`;
  } else if (secLeft <= 5) {
    acceptBtnLabel.textContent = `Accept Ride (${secLeft}s)`;
  } else {
    acceptBtnLabel.textContent = `Accept Ride (${secLeft}s)`;
  }
}
function triggerAcceptClickFeedback() {
  if (!acceptBtn || acceptBtn.disabled) return;
  if (!acceptBtn.classList.contains("is-offered")) return;

  acceptBtn.classList.remove("is-clicked");
  void acceptBtn.offsetWidth;
  acceptBtn.classList.add("is-clicked");

  setTimeout(() => {
    acceptBtn.classList.remove("is-clicked");
  }, 180);
}
function triggerAcceptSuccessFeedback() {
  if (!acceptBtn || !acceptBtnLabel) return;

  acceptBtn.classList.remove("is-clicked");
  acceptBtn.classList.add("is-success");

  const oldText = acceptBtnLabel.textContent;
  acceptBtnLabel.textContent = "Accepted ✓";

  setTimeout(() => {
    acceptBtn.classList.remove("is-success");
    acceptBtnLabel.textContent = oldText;
  }, 900);
}
function animateQueueReorder(parentEl, buildRowsFn) {
  if (!parentEl) return buildRowsFn();

  const oldPositions = new Map();

  Array.from(parentEl.children).forEach((child) => {
    const key = child.dataset.key;
    if (!key) return;
    oldPositions.set(key, child.getBoundingClientRect());
  });

  buildRowsFn();

  Array.from(parentEl.children).forEach((child) => {
    const key = child.dataset.key;
    if (!key || !oldPositions.has(key)) return;

    const oldRect = oldPositions.get(key);
    const newRect = child.getBoundingClientRect();
    const deltaY = oldRect.top - newRect.top;

    if (Math.abs(deltaY) > 1) {
      child.classList.add("queue-moving");
      child.style.transform = `translateY(${deltaY}px)`;

      requestAnimationFrame(() => {
        child.style.transform = "translateY(0)";
      });

      child.addEventListener(
        "transitionend",
        () => {
          child.classList.remove("queue-moving");
          child.style.transform = "";
        },
        { once: true }
      );
    }
  });
}
function lockDriverInputs(locked) {
  if (driverNameInput) driverNameInput.disabled = locked;
  if (driverColorInput) driverColorInput.disabled = locked;
  if (driverPlateInput) driverPlateInput.disabled = locked;

  if (joinBtn) joinBtn.disabled = locked;
  if (leaveBtn) leaveBtn.disabled = !locked;
}
// Network wake: when Wi-Fi reconnects after sleep
window.addEventListener("online", () => {
  dlog("Network online — trying audio resume");
  ensureAudioReady("network-wake", 1500, false);
});
document.addEventListener("visibilitychange", async () => {
  if (!document.hidden) {
    console.log("Page visible again — forcing audio resume");
    await ensureAudioReady("visibility-wake", 2000, true);
    try {
  await forceResumeAudio("visibility-return");
} catch (e) {
  console.warn("forceResumeAudio visibility-return failed:", e);
}
    unlockAudio();
    allowAudioFor(2500);
    console.log("visibility-wake complete");

    try {
      refreshJoinUI();
      refreshAcceptUI();
      updateQueueHealth(lastQueueSnapshot || {});
      updateEmptyState?.();

      if (myDriverKey) {
        startDriverHeartbeat();
      }

      if (offeredCache) {
        const offerObj = unwrapOfferCache(offeredCache);
        calledBox.textContent =
          "Now Offering: " + (offerObj?.name ?? offerObj?.driverName ?? "");
      } else {
        calledBox.textContent = "";
      }

      console.log("Foreground resync complete");
    } catch (e) {
      console.warn("Foreground resync failed:", e);
    }
  }
});
// Extra protection: when window regains focus (after sleep)
  window.addEventListener("focus", async () => {
  console.log("Window focus — forcing audio resume");
 await ensureAudioReady("focus-wake", 2000, true);
    try {
  await forceResumeAudio("focus-return");
} catch (e) {
  console.warn("forceResumeAudio focus-return failed:", e);
} 
    unlockAudio();
    allowAudioFor(2500);
    console.log("focus-wake complete");
  try {
    refreshJoinUI();
    refreshAcceptUI();
    updateQueueHealth(lastQueueSnapshot || {});
    updateEmptyState?.();

    if (myDriverKey) {
      startDriverHeartbeat();
    }

    if (offeredCache) {
      const offerObj = unwrapOfferCache(offeredCache);
      calledBox.textContent =
        "Now Offering: " + (offerObj?.name ?? offerObj?.driverName ?? "");
    } else {
      calledBox.textContent = "";
    }

    console.log("Focus resync complete");
  } catch (e) {
    console.warn("Focus resync failed:", e);
  }
});

// Allow audio briefly even if Safari says the page isn't focused yet
let allowAudioWhenNotFocusedUntil = 0;

function allowAudioFor(ms = 1500) {
  allowAudioWhenNotFocusedUntil = Date.now() + ms;
}

function isFocusOverrideActive() {
  return Date.now() < allowAudioWhenNotFocusedUntil;
}

function canPlayAlerts(opts = {}) {
  const focused = document.hasFocus?.() ?? true;
  const allow = focused || (opts.allowWhenNotFocused && isFocusOverrideActive());
  return soundEnabled && audioUnlocked && allow;
}
function formatWaitMs(ms) {
  if (!ms || ms < 0) return "0s";

  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;

  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}

function updateQueueHealth(queueObj = {}) {
  if (!queueHealthBox) return;

  const now = Date.now();
  const drivers = Object.entries(queueObj)
    .map(([key, value]) => ({ key, ...value }))
    .filter(driver => driver && driver.status === "WAITING");

  const waitingCount = drivers.length;

  let longestWaitMs = 0;
  let inactiveCount = 0;

  for (const driver of drivers) {
    const joinedAt = driver.joinedAt ?? now;
    const waitMs = now - joinedAt;
    if (waitMs > longestWaitMs) longestWaitMs = waitMs;

    const lastSeenAt = driver.lastSeenAt ?? 0;
    const staleMs = now - lastSeenAt;

    // treat 45s+ as inactive/stale
    if (!lastSeenAt || staleMs > 90000) {
  inactiveCount++;
}
  }

  let systemStatus = "OK";
  if (inactiveCount > 0) {
    systemStatus = "Check inactive drivers";
  } else if (waitingCount >= 8) {
    systemStatus = "Busy";
  }

  queueHealthBox.innerHTML = `
    <div>Drivers waiting: ${waitingCount}</div>
    <div>Longest wait: ${formatWaitMs(longestWaitMs)}</div>
    <div>Inactive drivers: ${inactiveCount}</div>
    <div>System status: ${systemStatus}</div>
  `;
}
 function showOfferAlert(message, countdownText = "", mode = "normal") {
  if (!offerAlertBox) return;

  offerAlertText.textContent = message || "Taxi offer";
  offerAlertCountdown.textContent = countdownText || "";

  offerAlertBox.classList.remove("hidden", "urgent", "final-seconds");
  offerAlertBox.classList.add("active");

  if (mode === "urgent") {
    offerAlertBox.classList.add("urgent");
  } else if (mode === "final") {
    offerAlertBox.classList.add("final-seconds");
  }
}

function hideOfferAlert() {
  if (!offerAlertBox) return;

  offerAlertText.textContent = "No active offer";
  offerAlertCountdown.textContent = "";

  offerAlertBox.classList.add("hidden");
  offerAlertBox.classList.remove("active", "urgent", "final-seconds");
}
// =============================
// TONE ENGINE (Phase 1)
// =============================

// Simple “profiles” you can tune later
const TONE_PROFILES = {
 offer: {
  seq: [
    { wave: "square", freq: 880, dur: 0.12, attack: 0.005, decay: 0.10, volume: 0.28 },
    { wave: "square", freq: 880, dur: 0.12, attack: 0.005, decay: 0.10, volume: 0.28 },
    { wave: "square", freq: 880, dur: 0.16, attack: 0.005, decay: 0.12, volume: 0.32 },
  ],
  gap: 0.10,
},
  urgent: {
  wave: "triangle",   // sharper than sine, but not harsh like square
  freq: 1320,         // slightly higher pitch (more urgent)
  dur: 0.07,          // slightly shorter = more punchy
  attack: 0.002,      // faster attack
  decay: 0.045,       // slightly tighter decay
  volume: 0.34,       // small bump (not huge)
},
  expiring: {
    wave: "triangle",
    freq: 988,        // B5
    dur: 0.10,
    attack: 0.005,
    decay: 0.08,
    volume: 0.16,
  },
  accepted: {
    // A short “two-note” confirmation (sounds nicer than one beep)
    seq: [
      { wave: "sine", freq: 659.25, dur: 0.08, attack: 0.005, decay: 0.06, volume: 0.10 }, // E5
      { wave: "sine", freq: 880,    dur: 0.10, attack: 0.005, decay: 0.08, volume: 0.12 }, // A5
    ], 
    gap: 0.03, // seconds between notes
  },
};

function playOfferArrivedBeep() {
  const isFirst = offerBeepCount === 0;

  // Subtle fade-in only on the first offer beep
  playTone(
    "offer",
    isFirst
      ? { force: true, allowNoFocus: true, volumeMul: 1.3, attack: 0.03, decay: 0.12 }
      : { force: true, allowNoFocus: true, volumeMul: 1.3 }
  );

  // Optional: vibrate only on the first beep (or every beep if you prefer)
  if (isFirst) vibratePattern("offer");

  offerBeepCount++;
}
// Low-level: play one oscillator “beep”
function _playOneBeep(p, opts = {}) {
  const force = !!opts.force;

  // Gate by your policy first (keep)
  if (typeof canPlayAlerts === "function" && !canPlayAlerts({ allowWhenNotFocused: force })) {
    return false;
  }

  // Ensure audio context exists
  if (!audioCtx) {
    if (typeof ensureAudioCtx === "function") ensureAudioCtx("beep");
  }
  if (!audioCtx) return false;

  // ✅ Do NOT hard-stop if not running yet (Safari sleep/focus case)
  if (audioCtx.state !== "running") {
    try { audioCtx.resume(); } catch {}
    // continue anyway; the scheduled beep will play once the ctx resumes
  }

  const t0 = audioCtx.currentTime + (opts.delay ?? 0);
  const freq = (opts.freq ?? p.freq) * (opts.pitchMul ?? 1);
  const wave = opts.wave ?? p.wave ?? "sine";

  const vol = Math.max(0, (p.volume ?? 0.1) * (opts.volumeMul ?? 1));

  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t0);

    const attack = Math.max(0.001, opts.attack ?? p.attack ?? 0.005);
    const decay  = Math.max(0.01,  opts.decay  ?? p.decay  ?? 0.08);
    const endT   = t0 + Math.max(0.02, opts.dur ?? p.dur ?? 0.1);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, endT);
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(t0);
    osc.stop(endT + 0.02);

    osc.onended = () => {
      try { osc.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
    };

    return true;
  } catch (e) {
    console.warn("Tone play failed:", e);
    return false;
  }
}
/**
 * Public API:
 * playTone("offer")
 * playTone("accepted")
 * playTone("expiring", { volumeMul: 1.2 })
 */
function playTone(name, opts = {}) {
  const profile = TONE_PROFILES[name];
  if (!profile) return false;

  // If this tone is a sequence, play notes with small gaps
  if (Array.isArray(profile.seq)) {
    let delay = opts.delay ?? 0;
    const gap = profile.gap ?? 0;

    for (const note of profile.seq) {
      _playOneBeep(note, { ...opts, delay });
      delay += (note.dur ?? 0.08) + gap;
    }
    return true;
  }

  // Single beep
  return _playOneBeep(profile, opts);
}

// =============================
// Backward-compatible wrappers
// (so you don’t have to refactor yet)
// =============================
function playOfferTone() {
  // Your existing code calls this — keep it stable
  playTone("offer");
}

function playAcceptedTone() {
  playTone("accepted");
}

function playExpiringTone() {
  playTone("expiring");
}

window.playOfferTone = playOfferTone;
window.playAcceptedTone = playAcceptedTone;
window.playExpiringTone = playExpiringTone;

function updateSoundHint() {
  const el = document.getElementById("soundHint");
  if (!el) return;

  if (audioUnlocked) {
    el.style.display = "none";
    el.textContent = "";
  } else {
    el.style.display = "block";
    el.textContent = "🔊 Tap anywhere to enable sound alerts";
  }
}
function isMeForOffer(v) {
  if (!v) return false;
  const inputName = norm(driverNameInput?.value);
  const inputPlate = norm(driverPlateInput?.value);
  return inputName && inputPlate && norm(v.name) === inputName && norm(v.plate) === inputPlate;
}

function findOfferForMe(data) {
  const entries = Object.entries(data || {});
  const now = Date.now();

  const match = entries.find(([_, v]) => {
    if (!v) return false;
    if ((v.status ?? "WAITING") !== "OFFERED") return false;

    // ignore expired offers if timestamp exists
    if ((v.offerExpiresAt ?? 0) <= now) return false;

    return isMeForOffer(v);
  });

  if (!match) return null;

  const [key, v] = match;
  return { key, val: v };
}
function refreshAcceptUI() {
  if (!acceptBtn) return;

  const offer = unwrapOfferCache(offeredCache);

  const hasOffer = !!offer;
  const status = (offer?.status ?? "").toUpperCase();

  const now = Date.now();
  const expiresAt = offer?.offerExpiresAt ?? 0;
  const notExpired = !expiresAt || expiresAt > now;

  const canAccept = hasOffer && status === "OFFERED" && notExpired;

  acceptBtn.disabled = !canAccept;

  // Pulse + beep should follow "canAccept"
  if (typeof setOfferPulse === "function") setOfferPulse(canAccept);

  if (canAccept) {
    // start beeps only if allowed
    if (!suppressOfferBeep && soundEnabled) startOfferBeepLoop?.();
  } else {
    stopOfferBeepLoop?.();
    suppressOfferBeep = false; // reset so next offer can beep
  }
}
let toastTimer = null;

function showToast(msg, type = "ok", ms = 1800) {
  const el = document.getElementById("toast");
  if (!el) return;

  el.className = `toast show ${type}`;
  el.textContent = msg;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = "toast";
    el.textContent = "";
  }, ms);
}


// -----------------------------
// INPUT POLISH (C1)
// -----------------------------
function normSpaces(s) {
  return (s || "").trim().replace(/\s+/g, " ");
}

function normPlate(s) {
  // Trim + uppercase, keep spaces as single space
  return normSpaces(s).toUpperCase();
}

function titleCase(s) {
  s = normSpaces(s).toLowerCase();
  if (!s) return "";
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
// -----------------------------
// CONNECTION BADGE (.info/connected)
// -----------------------------
let isConnected = true;
let isBusy = false;

function setBusy(on, msg = "Working…") {
  isBusy = on;

  const ids = ["joinBtn", "leaveBtn", "acceptBtn", "callNextBtn", "completeBtn", "resetBtn"];

  ids.forEach((id) => {
    const b = document.getElementById(id);
    if (!b) return;

    b.disabled = !!on;
    b.classList.toggle("is-loading", !!on);
  });

  if (!on) {
    // IMPORTANT: when we unlock, re-apply "real" enabled/disabled rules
    if (typeof refreshAcceptUI === "function") refreshAcceptUI();
    if (typeof refreshJoinLeaveUI === "function") refreshJoinLeaveUI(); // if you have it
  }

  if (on && typeof showToast === "function") showToast(msg, "warn", 1200);
}

function wireConnectionBadge() {
  const connectedRef = ref(db, ".info/connected");
  let wasConnected = true;

  onValue(connectedRef, (snap) => {
    isConnected = snap.val() === true;

    if (wasConnected && !isConnected) {
      console.warn("⚠️ RTDB disconnected — UI may be stale until reconnect");
    }
    wasConnected = isConnected;

    if (netStatus) {
      netStatus.textContent = isConnected ? "Online" : "Reconnecting…";
      netStatus.classList.toggle("offline", !isConnected);
    }
  });
}

// -----------------------------
// C2 — SMART INPUT UX
// -----------------------------
const INPUT_STORE_KEY = "htqs.inputs.v1";

function getInputs() {
  return {
    name: normSpaces(driverNameInput?.value),
    carColor: normSpaces(driverColorInput?.value),
    plate: normPlate(driverPlateInput?.value),
  };
}

// Decide what is "valid enough" to Join
function canJoinNow() {
  const { name, plate } = getInputs();

  // required: name + plate (you can also require color if you want)
  if (!name) return false;
  if (!plate) return false;

  // optional: basic plate sanity (adjust if you want)
  // allow letters, numbers, space, dash
  if (!/^[A-Z0-9 -]+$/.test(plate)) return false;

  return true;
}

// Enable/disable Join button based on input state + other conditions
function refreshJoinUI() {
  const joinBtn = document.getElementById("joinBtn");
  if (!joinBtn) return;

  // Don't enable Join while busy
  if (isBusy) {
    joinBtn.disabled = true;
    return;
  }

  // If already joined (myDriverKey exists), Join should be disabled
  if (myDriverKey) {
    joinBtn.disabled = true;
    return;
  }

  joinBtn.disabled = !canJoinNow();
}

// Save inputs to localStorage
function saveInputs() {
  try {
    const { name, carColor, plate } = getInputs();
    localStorage.setItem(INPUT_STORE_KEY, JSON.stringify({ name, carColor, plate }));
  } catch (_) {}
}

// Restore inputs from localStorage
function restoreInputs() {
  try {
    const raw = localStorage.getItem(INPUT_STORE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);

    if (driverNameInput && data.name) driverNameInput.value = data.name;
    if (driverColorInput && data.carColor) driverColorInput.value = data.carColor;
    if (driverPlateInput && data.plate) driverPlateInput.value = data.plate;
  } catch (_) {}
}

// Format inputs *without fighting the cursor*:
// - do formatting on blur/change instead of every keystroke
function wireSmartInputs() {
  if (!driverNameInput || !driverColorInput || !driverPlateInput) return;

  // Restore saved values once
  restoreInputs();
  refreshJoinUI();

  // Live typing: validate + save (no formatting here)
  const onTyping = () => {
    saveInputs();
    refreshJoinUI();

    // Optional: if offer UI depends on typed inputs, refresh it here
    if (typeof refreshAcceptUI === "function") refreshAcceptUI();
  };

  driverNameInput.addEventListener("input", onTyping);
  driverColorInput.addEventListener("input", onTyping);
  driverPlateInput.addEventListener("input", onTyping);

  // On blur: apply formatting
  driverNameInput.addEventListener("blur", () => {
    driverNameInput.value = titleCase(driverNameInput.value);
    saveInputs();
    refreshJoinUI();
    if (typeof refreshAcceptUI === "function") refreshAcceptUI();
  });

  driverColorInput.addEventListener("blur", () => {
    driverColorInput.value = titleCase(driverColorInput.value);
    saveInputs();
    refreshJoinUI();
  });

  driverPlateInput.addEventListener("blur", () => {
    driverPlateInput.value = normPlate(driverPlateInput.value);
    saveInputs();
    refreshJoinUI();
    if (typeof refreshAcceptUI === "function") refreshAcceptUI();
  });

  // Optional: pressing Enter in plate field triggers Join (if valid)
  driverPlateInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (canJoinNow() && typeof joinQueue === "function") joinQueue();
    }
  });
}
// -----------------------------
// SOUND
// -----------------------------

// -----------------------------
// Universal Audio Unlock Listener (Safari / iOS safe)
// Call ONCE during boot
// -----------------------------
function addUniversalAudioUnlock() {
  let installed = false;

  function install() {
    if (installed) return;
    installed = true;

    const opts = { capture: true, passive: true };

    const handler = async () => {
      // Any real user gesture should be allowed to unlock/resume audio
      try {
        await ensureAudioReady("global-gesture", 2000, true);
      } catch {}
    };

    // Use multiple gesture types for Safari reliability
    window.addEventListener("pointerdown", handler, opts);
    window.addEventListener("touchstart", handler, opts);
    window.addEventListener("mousedown", handler, opts);
    window.addEventListener("keydown", handler, opts);
  }

  install();
}
// Safari-safe: do everything "now" inside a user gesture (no await)
function ensureAudioNow(reason = "") {
  try {
    ensureAudioCtx(reason); // creates audioCtx if needed
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume(); // DO NOT await (keeps gesture chain)
    }
    audioUnlocked = true; // mark unlocked (your app uses this flag)
  } catch (e) {
    dwarn("ensureAudioNow failed:", e);
  }
}
function ensureAudioCtx(reason = "") {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return false;

  if (!audioCtx) {
    audioCtx = new Ctx();
    return true;
  }

  // Safari can go weird; if interrupted, recreate
  if (audioCtx.state === "interrupted") {
    try { audioCtx.close?.(); } catch {}
    audioCtx = new Ctx();
    audioUnlocked = false;
    updateSoundHint?.();
    return true;
  }

  return true;
}

// ✅ Safari-safe: resume AudioContext (optionally recreate only when allowed)
async function forceResumeAudio(reason = "", allowRecreate = true) {
  ensureAudioCtx?.(reason);
  if (!audioCtx) return false;

  // Try normal resume first
  try { await audioCtx.resume?.(); } catch {}

  // If still not running...
  if (audioCtx.state !== "running") {

    // ✅ IMPORTANT: do NOT recreate unless explicitly allowed
    if (!allowRecreate) return false;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;

    // Close old context and recreate
    try { await audioCtx.close?.(); } catch {}

    audioCtx = new Ctx();
    audioUnlocked = false;
    updateSoundHint?.();

    // Try resume again
    try { await audioCtx.resume?.(); } catch {}
  }

  return audioCtx?.state === "running";
}
// ✅ Master audio wake-up (use everywhere)
async function ensureAudioReady(reason = "ensure", ms = 1500, allowRecreate = false) {
  // Only recreate AudioContext when explicitly allowed (real user gesture paths)
  try { await forceResumeAudio?.(reason, allowRecreate); } catch {}
  try { unlockAudio?.(); } catch {}
  try { allowAudioFor?.(ms); } catch {}

  // Extra safety: try resuming AudioContext directly
  try { await audioCtx?.resume?.(); } catch {}
}

// Safari/iOS: unlock audio on the first real user gesture anywhere
window.addEventListener("pointerdown", () => {
  ensureAudioReady("pointerdown", 2000, true); // allowRecreate = true ONLY for real gestures
}, { once: true, passive: true });

window.addEventListener("touchstart", () => {
  ensureAudioReady("touchstart", 2000, true);
}, { once: true, passive: true });

// ---------------------------------------------------
// HARD AUDIO FALLBACK (Safari safety)
// Used if playTone() fails or audioCtx is blocked
// ---------------------------------------------------
function hardBeepFallback() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    ctx.resume?.();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 440;

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.6, now + 0.02);
    gain.gain.linearRampToValueAtTime(0.0001, now + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.26);

    osc.onended = () => {
      try { osc.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
      try { ctx.close(); } catch {}
    };
  } catch (e) {
    console.warn("hardBeepFallback failed:", e);
  }
}

function unlockAudio() {
  if (audioUnlocked) return;

  ensureAudioCtx();
  if (!audioCtx) return;

  audioCtx.resume()
    .then(() => {
      audioUnlocked = true;
      dlog("Audio unlocked");
      updateSoundHint();
    })
    .catch((e) => {
      console.warn("Audio unlock blocked:", e);
      updateSoundHint();
    });
}


function canVibrate() {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

function vibratePattern(kind) {
  if (!canVibrate()) return;

  // Respect user intent: only vibrate if Sound alerts is enabled
  if (!soundEnabled) return;

  // Patterns are in milliseconds
  const patterns = {
    offer: [20],
    urgent: [20, 40, 20, 40, 20],
    accepted: [30, 30, 60],
  };

  navigator.vibrate(patterns[kind] || [20]);
}
function stopOfferBeepLoop() {
  // ✅ stop urgent loop (if running)
  if (urgentBeepIntervalId) {
    clearInterval(urgentBeepIntervalId);
    urgentBeepIntervalId = null;
  }

  // ✅ stop the "double pulse" second-beep timeout (important)
  clearTimeout(urgentSecondPulseTimeoutId);
  urgentSecondPulseTimeoutId = null;
  urgentDoublePulseActive = false;

  // ✅ stop offer loop (if running)
  clearInterval(offerBeepIntervalId);
  clearTimeout(offerBeepStopTimeoutId);
  offerBeepIntervalId = null;
  offerBeepStopTimeoutId = null;
}

function startUrgentBeepLoop() {
  if (urgentBeepIntervalId) return;

  vibratePattern("urgent");

  const startedAt = Date.now();

  urgentBeepIntervalId = setInterval(() => {
    // 1) Main urgent pulse
    playTone("urgent", { force: true });

    // 2) Final ~2 seconds: add a softer second pulse shortly after
    const elapsed = Date.now() - startedAt; // urgent loop typically lasts ~5s
    urgentDoublePulseActive = elapsed >= 3000; // last 2s of a 5s urgent window

    if (urgentDoublePulseActive) {
      clearTimeout(urgentSecondPulseTimeoutId);
      urgentSecondPulseTimeoutId = setTimeout(() => {
        playTone("urgent", { force: true, volumeMul: 0.75 });
      }, 150);
    }
  }, 500);
}
const OFFER_BEEP_INTERVAL_MS = 800;

function startOfferBeepLoop(maxMs = OFFER_MS) {
  stopOfferBeepLoop();

  offerBeepCount = 0;
  playOfferArrivedBeep();

  offerBeepIntervalId = setInterval(() => {
    const bgBoost = document.hidden ? 1.45 : 1.0;
playTone("offer", {
  force: true,
  allowNoFocus: true,
  volumeMul: bgBoost
});
  }, OFFER_BEEP_INTERVAL_MS);

  offerBeepStopTimeoutId = setTimeout(stopOfferBeepLoop, maxMs);
}

function loadSoundPref() {
  const saved = localStorage.getItem("htqs.soundEnabled");
  soundEnabled = saved === null ? true : saved === "true";
  if (soundToggle) soundToggle.checked = soundEnabled;
}

function wireSoundToggle() {
  if (!soundToggle) return;

  soundToggle.addEventListener("change", () => {
    soundEnabled = soundToggle.checked;
    localStorage.setItem("htqs.soundEnabled", String(soundEnabled));
    if (soundEnabled) unlockAudio();
    else stopOfferBeepLoop();
  });
}

function ensureMuteIndicator() {
  // Put 🔇 next to the Sound alerts checkbox (soundToggle)
  const soundToggle = document.getElementById("soundToggle");
  if (!soundToggle) return;

  let badge = document.getElementById("muteIndicator");
  if (!badge) {
    badge = document.createElement("span");
    badge.id = "muteIndicator";
    badge.textContent = " 🔇";
    badge.style.marginLeft = "6px";
    badge.style.opacity = "0.75";
    badge.style.display = "none";
    badge.title = "Tab inactive — Safari may block audio until you interact";
    soundToggle.parentElement?.appendChild(badge);
  }
}

function updateMuteIndicator() {
  const badge = document.getElementById("muteIndicator");
  if (!badge) return;

  const tabInactive = document.visibilityState === "hidden" || !document.hasFocus();
  badge.style.display = tabInactive ? "inline" : "none";
}
// -----------------------------
// AUTH (Anonymous)
// -----------------------------
async function ensureSignedIn() {
  try {
    await signInAnonymously(auth);
  } catch (e) {
    console.error("Anonymous sign-in failed:", e);
  }
}

// -----------------------------
// CORE ACTIONS
// -----------------------------
async function joinQueue() {
  if (isBusy) return;
  setBusy(true, "Joining…");
  unlockAudio();

  try {
    const name = normSpaces(driverNameInput.value);
    const plate = normPlate(driverPlateInput.value);
    const carColor = titleCase(driverColorInput.value);

    driverNameInput.value = name;
    driverPlateInput.value = plate;
    driverColorInput.value = carColor;

    if (!name || !plate) {
      alert("Enter name and cab number.");
      return;
    }

    const driverKey = `${norm(name)}_${norm(plate)}`;
    const driverRef = ref(db, "queue/" + driverKey);

    const existingSnap = await get(driverRef);
    const existing = existingSnap.exists() ? existingSnap.val() : null;
    const status = (existing?.status ?? "").toUpperCase();

    // ✅ If record is already active, recover state and do NOT overwrite
    if (existing && status !== "LEFT") {
      myDriverKey = driverKey;
      sessionStorage.setItem("htqs.driverKey", driverKey);

      lockDriverInputs(true);
      refreshJoinUI();
      refreshAcceptUI();

      showToast?.(`Already in queue (${status})`, "warn", 1800);
      console.log("joinQueue ignored (already active)", driverKey, status);
      return;
    }

    // Clean up old LEFT record
    if (existing && status === "LEFT") {
      await remove(driverRef);
    }

    const joinedAt =
      existing && status !== "LEFT" && existing.joinedAt != null
        ? existing.joinedAt
        : Date.now();

    // ✅ Normal join: safe to create fresh record
    await set(driverRef, {
      status: "WAITING",
      name,
      carColor,
      plate,
      joinedAt,
      offerStartedAt: null,
      offerExpiresAt: null,
      lastSeenAt: Date.now(),
    });

    myDriverKey = driverKey;
    sessionStorage.setItem("htqs.driverKey", driverKey);
    startDriverHeartbeat();
    lockDriverInputs(true);
    refreshJoinUI();
    refreshAcceptUI();
   // Mark this driver stale if device/tab disconnects unexpectedly
try {
  await onDisconnect(ref(db, `queue/${myDriverKey}/lastSeenAt`)).set(0);
  console.log("onDisconnect stale-marker armed for", myDriverKey);
} catch (e) {
  console.warn("Failed to arm onDisconnect stale-marker for", myDriverKey, e);
}
    console.log("joinQueue success", driverKey);
    

   // 🔊 Auto test sound so driver knows alerts work
   setTimeout(() => {
   const bgBoost = document.hidden ? 1.45 : 1.0;

   playTone("offer", {
    force: true,
    allowNoFocus: true,
    volumeMul: bgBoost
  });
}, 300);

    showToast("Joined queue ✅", "ok");
  } catch (err) {
    console.error("joinQueue error:", err);
    showToast("Join failed — try again", "err", 2400);
    alert("Join failed");
  } finally {
    setBusy(false);
  }
}
// ============================
// Driver heartbeat helpers
// ============================
function startDriverHeartbeat() {
  
  // Prevent duplicate intervals
  stopDriverHeartbeat();

  // Write immediately once
  update(ref(db, "queue/" + myDriverKey), {
    lastSeenAt: Date.now()
  }).catch((e) => {
    console.warn("Heartbeat initial write failed:", e);
  });
  // Then keep updating every 15 seconds
 driverHeartbeatId = setInterval(() => {

  if (!myDriverKey) return;

  update(ref(db, "queue/" + myDriverKey), {
    lastSeenAt: Date.now()
  }).catch((e) => {
    console.warn("Heartbeat update failed:", e);
  });

}, 15000);
}

function stopDriverHeartbeat() {
  if (driverHeartbeatId) {
    clearInterval(driverHeartbeatId);
    driverHeartbeatId = null;
  }
}
async function leaveQueue() {
  if (isBusy) return;
  setBusy(true, "Leaving…");

  try {
    if (!myDriverKey) return;
    // ✅ Safety: don't allow leaving during an active offer/ride
    const snap = await get(ref(db, "queue/" + myDriverKey));
    if (!snap.exists()) return;

    const status = (snap.val()?.status ?? "").toUpperCase();
    if (status === "OFFERED" || status === "ACCEPTED") {
      showToast?.(`Can't leave while ${status}.`, "warn", 2000);
      return;
    }    
    try {
  await onDisconnect(ref(db, `queue/${myDriverKey}/lastSeenAt`)).cancel();
  console.log("onDisconnect stale-marker canceled for", myDriverKey);
} catch (e) {
  console.warn("Failed to cancel onDisconnect stale-marker for", myDriverKey, e);
}
    await update(ref(db, "queue/" + myDriverKey), { status: "LEFT" });
    hideOfferAlert();
    updateAcceptButtonVisual(null);
    setAcceptButtonLabel(null);
    sessionStorage.removeItem("htqs.driverKey");
    stopDriverHeartbeat();
    myDriverKey = null;

    lockDriverInputs(false);
    refreshJoinUI();
    refreshAcceptUI();
    stopOfferBeepLoop();
    setOfferPulse(false);
    
  } catch (err) {
    console.error("leaveQueue error:", err);
    alert("Leave failed");
  } finally {
    setBusy(false);
  }
}

async function expireOffersNow() {
  const snap = await get(queueRef);
  if (!snap.exists()) return;
  //console.log("Queue data:", snap.val());
  const now = Date.now();
  const entries = Object.entries(snap.val() || {});
  let bump = 0;

  await Promise.all(
    entries.map(async ([k, v]) => {
      if (!v) return;

      const isExpired =
        (v.status ?? "WAITING") === "OFFERED" &&
        (v.offerExpiresAt ?? 0) <= now;

      if (!isExpired) return;

      // C3: mark it as "missed" so the driver UI can show a toast if desired
      await update(ref(db, "queue/" + k), {
        status: "WAITING",
        offerStartedAt: null,
        offerExpiresAt: null,

        lastMissedAt: now,     // ✅ key for C3 UX
        lastMissedOfferAt: now, // optional duplicate name if you prefer

        // keep fairness: put them at end (your original behavior)
        joinedAt: now + bump++,
      });
    })
  );
}
async function callNext() {
  // Guard #1 — offline
  if (!isConnected) {
    if (typeof showToast === "function") showToast("Offline — try again in a moment", "warn", 2000);
    else alert("Offline — try again in a moment");
    return;
  }

  // Guard #2 — double-click
  if (isBusy) return;

  // PIN check first (don’t lock UI if PIN is wrong)
  if (doormanPinInput.value.trim() !== DOORMAN_PIN) {
    if (typeof showToast === "function") showToast("Wrong PIN", "err", 1800);
    else alert("Wrong PIN");
    return;
  }

  unlockAudio();
  setBusy(true);

  try {
    const now = Date.now();

    // 1) Expire any expired offers first
    await expireOffersNow();

    // 2) Pull fresh queue
    const snap = await get(queueRef);
    const data = snap.exists() ? snap.val() : {};
    const entries = Object.entries(data);

    // 3) C3 rule: do NOT create a new offer if one is still active
    const activeOffer = entries.find(([_, v]) =>
      v &&
      (v.status ?? "WAITING") === "OFFERED" &&
      (v.offerExpiresAt ?? 0) > now
    );

    if (activeOffer) {
      const [, v] = activeOffer;
      const name = v?.name ?? "a driver";
      const secs = Math.ceil(((v.offerExpiresAt ?? now) - now) / 1000);
      if (typeof showToast === "function") showToast(`Already offering ${name} (${secs}s left)`, "warn", 2200);
      else alert(`Already offering ${name} (${secs}s left)`);
      return;
    }

    // 4) Find oldest WAITING
    const waiting = entries
      .filter(([_, v]) => (v && (v.status ?? "WAITING") === "WAITING"))
      .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));

    if (!waiting.length) {
      if (typeof showToast === "function") showToast("No WAITING taxis.", "warn", 2000);
      else alert("No WAITING taxis.");
      return;
    }

    const [key] = waiting[0];

    // 5) Set OFFERED
    await update(ref(db, "queue/" + key), {
      status: "OFFERED",
      offerStartedAt: now,
      offerExpiresAt: now + OFFER_MS,
      lastOfferedAt: now,        // C3: helpful for UI/debug
      lastOfferedBy: "doorman",  // optional
      offerBeepCount: 0,
    });

    if (typeof showToast === "function") showToast("Offer sent ✅", "ok", 1500);
  } catch (err) {
    console.error("callNext error:", err);
    if (typeof showToast === "function") showToast("Call Next failed — check connection", "err", 2500);
    else alert("Call Next failed — check connection");
  } finally {
    setBusy(false);
  }
}

function unwrapOfferCache(offeredCache) {
  if (!offeredCache) return null;

  // Firebase DataSnapshot shape
  if (typeof offeredCache.val === "function") return offeredCache.val();

  // Your own wrapper shape: { key, val: <offerObject> }
  if (offeredCache.val && typeof offeredCache.val === "object") return offeredCache.val;

  // Already a plain offer object
  return offeredCache;
}
async function acceptRide() {
  if (!offeredCache || !myDriverKey) return;
  triggerAcceptClickFeedback();
  const offer = offeredCache?.val ?? offeredCache;
  const key = offeredCache?.key ?? myDriverKey;

  const now = Date.now();
  const expiresAt = offer?.offerExpiresAt ?? 0;

  if ((offer?.status ?? "").toUpperCase() !== "OFFERED") return;
  if (expiresAt && expiresAt <= now) return;

  unlockAudio();

  // Stop UX immediately
  suppressOfferBeep = true;
  stopOfferBeepLoop?.();
  if (typeof setOfferPulse === "function") setOfferPulse(false);

  setBusy(true);

  let accepted = false; // ✅ track success

  try {
    // Re-read latest to prevent race condition
    const snap = await get(ref(db, "queue/" + key));
    if (!snap.exists()) {
      showToast?.("Offer no longer available", "warn", 2000);
      return;
    }

    const latest = snap.val();
    const latestStatus = (latest.status ?? "").toUpperCase();
    const latestExpires = latest.offerExpiresAt ?? 0;

    if (latestStatus !== "OFFERED") {
      showToast?.("Offer no longer available", "warn", 2000);
      return;
    }

    if (latestExpires && latestExpires <= Date.now()) {
      showToast?.("Offer expired", "warn", 2000);
      return;
    }

    await update(ref(db, "queue/" + key), {
      status: "ACCEPTED",
      acceptedAt: Date.now(),
    });
    triggerAcceptSuccessFeedback();
    hideOfferAlert();
    setAcceptButtonLabel(null);
    accepted = true; // ✅ success
    suppressOfferBeep = true; // keep silent after accept
    showToast?.("Accepted ✅", "ok", 1500);

  } catch (err) {
    console.error("acceptRide error:", err);
    showToast?.("Accept failed", "err", 2000);
  } finally {
    // ✅ Key fix: if accept did NOT succeed, allow future beeps again
    if (!accepted) suppressOfferBeep = false;

    setBusy(false);
    refreshAcceptUI();
  }
}
async function completePickup() {
  console.log("=== Complete Pickup Clicked ===");
  if (isBusy) return;
  setBusy(true, "Completing…");

  try {
    stopOfferBeepLoop();

    if (doormanPinInput.value.trim() !== DOORMAN_PIN) return alert("Wrong PIN");

    const snap = await get(queueRef);
    if (!snap.exists()) return;

    const accepted = Object.entries(snap.val()).find(([_, v]) => v.status === "ACCEPTED");
    console.log("Found accepted:", accepted);
    
    if (!accepted) return alert("No ACCEPTED ride to complete.");
    
    console.log("Removing key:", accepted[0]);
    await remove(ref(db, "queue/" + accepted[0]));
    console.log("Removed successfully:", accepted[0]);
    
    const removedKey = accepted[0];

// clear local UI immediately
const row = queueList?.querySelector(`[data-key="${removedKey}"]`);
if (row) row.remove();

calledBox.textContent = "";
offeredCache = null;
lastOfferSig = null;
suppressOfferBeep = false;

hideOfferAlert();
if (typeof setOfferPulse === "function") setOfferPulse(false);
updateAcceptButtonVisual(null);
setAcceptButtonLabel(null);

updateEmptyState();
refreshAcceptUI();
updateQueueHealth(lastQueueSnapshot || {});
    console.log("Removed successfully:", accepted[0]);
  } finally {
    setBusy(false);
  }
}
async function resetDemo() {
  if (!isConnected) {
    if (typeof showToast === "function") showToast("Offline — try again in a moment", "warn", 2000);
    else alert("Offline — try again in a moment");
    return;
  }
  if (isBusy) return;

  if (doormanPinInput.value.trim() !== DOORMAN_PIN) return alert("Invalid PIN.");
  if (!confirm("Reset demo? This will clear the entire queue.")) return;

  setBusy(true);
  try {
    const snap = await get(queueRef);
    if (!snap.exists()) return;

    const keys = Object.keys(snap.val());
    await Promise.all(keys.map((k) => remove(ref(db, "queue/" + k))));

    offeredCache = null;
    stopOfferBeepLoop();
    setOfferPulse(false);
    refreshAcceptUI();

    if (!offeredCache) {
  stopOfferBeepLoop();
  setOfferPulse(false);
} else {
  setOfferPulse(true);
  if (soundEnabled && !suppressOfferBeep) startOfferBeepLoop();
}
    if (typeof showToast === "function") showToast("Demo reset ✅", "ok", 1500);
  } catch (err) {
    console.error("resetDemo error:", err);
    if (typeof showToast === "function") showToast("Reset failed — check connection", "err", 2500);
    else alert("Reset failed — check connection");
  } finally {
    setBusy(false);
  }
}
// -----------------------------
// LIVE RENDER (single onValue)
// -----------------------------
function subscribeQueue() {
  if (typeof unsubscribeQueue === "function") unsubscribeQueue();

  unsubscribeQueue = onValue(queueRef, (snap) => {
    // If empty and offline, keep current UI
    if (!snap.exists()) {
      if (!isConnected) return;

      calledBox.textContent = "";
      offeredCache = null;

      lastOfferSig = null;
      suppressOfferBeep = false;
      stopOfferBeepLoop();
      if (typeof setOfferPulse === "function") setOfferPulse(false);
      
      // ✅ ADD THIS: if queue is empty, nobody is “joined”
  if (myDriverKey) {
    sessionStorage.removeItem("htqs.driverKey");
    myDriverKey = null;
    lockDriverInputs(false);
    refreshJoinUI();
    refreshAcceptUI();
  }
      updateEmptyState();
      refreshAcceptUI();
      updateQueueHealth({});
      return;
    }

   const data = snap.val() || {};
   lastQueueSnapshot = data;
   updateQueueHealth(data);
    
    const entries = Object.entries(data);
    
   if (myDriverKey) {
  const mine = data[myDriverKey];
  if (!mine || mine.status === "LEFT") {
    sessionStorage.removeItem("htqs.driverKey");
    myDriverKey = null;

    stopDriverHeartbeat();
    offeredCache = null;
    calledBox.textContent = "";

    lastOfferWasForMe = false;
    lastOfferKeyForMe = null;
    lastOfferSig = null;
    suppressOfferBeep = false;

    stopOfferBeepLoop?.();
    if (typeof setOfferPulse === "function") setOfferPulse(false);

    lockDriverInputs(false);
    refreshJoinUI();
    refreshAcceptUI();
    updateEmptyState();
  }
}
    // Render list
    calledBox.textContent = "";

    const active = entries
  .filter(([_, v]) =>
    v &&
    (v.status ?? "WAITING") !== "LEFT" &&
    (v.name || v.plate || v.carColor)
  )
  .slice()
  .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));
animateQueueReorder(queueList, () => {
  queueList.innerHTML = "";

  active.forEach(([k, v], i) => {
    const li = document.createElement("li");
    li.dataset.key = k;
    li.classList.add("queue-enter");

    li.addEventListener("animationend", () => {
      li.classList.remove("queue-enter");
    }, { once: true });

    const status = (v.status ?? "WAITING").toUpperCase();

    const safeName = v?.name || "Unknown Driver";
    const safeColor = v?.carColor || "";
    const safePlate = v?.plate || "";
    const driverLabel = `${safeName} ${safeColor} ${safePlate}`.replace(/\s+/g, " ").trim();

    li.classList.add("queue-item", `status-${status.toLowerCase()}`);
    li.innerHTML = `
      <span>${i + 1}. ${driverLabel}</span>
      <span>${status}</span>
    `;

    queueList.appendChild(li);
  });
});  

updateEmptyState();

// ✅ Only cache an offer if it’s for THIS driver
offeredCache = findOfferForMe(data);
    
// =============================
// C3: Beep/pulse + "Offer missed" + countdown
// Put this RIGHT AFTER: offeredCache = findOfferForMe(data);
// =============================

const hasOfferNow = !!offeredCache;
const offerKeyNow = hasOfferNow ? offeredCache.key : null;

// ---- A) Beep/Pulse trigger using signature (key + offerStartedAt) ----
if (!hasOfferNow) {
  lastOfferSig = null;
  suppressOfferBeep = false;        // allow next offer to beep
  stopOfferBeepLoop?.();            // safe-call
  if (typeof setOfferPulse === "function") setOfferPulse(false);

} else {
  const offerObj = unwrapOfferCache(offeredCache);
  const startedAt = offerObj?.offerStartedAt ?? 0;
  const key = offeredCache?.key ?? offerObj?.key ?? null;
  const sigNow = `${key}:${startedAt}`;

  if (sigNow && sigNow !== lastOfferSig) {
    lastOfferSig = sigNow;

    suppressOfferBeep = false;
    startOfferBeepLoop?.();
    if (typeof setOfferPulse === "function") setOfferPulse(true);
  }
}    
// ---- B) "Offer missed" toast when an offer for YOU ends ----
const mineNow = myDriverKey ? data[myDriverKey] : null;

if (lastOfferWasForMe && !hasOfferNow) {
  const statusNow = (mineNow?.status ?? "WAITING").toUpperCase();

  // show missed only if you are back to WAITING (not ACCEPTED)
  if (statusNow === "WAITING") {
    if (typeof showToast === "function") showToast("Offer missed ⏰ — back to WAITING", "warn", 2200);
  }

  // stop countdown
  if (offerCountdownTimer) {
    clearInterval(offerCountdownTimer);
    offerCountdownTimer = null;
  }

  const offerInfo = document.getElementById("offerInfo");
  if (offerInfo) offerInfo.textContent = "";
}

// ---- C) Countdown restart when NEW offer for YOU starts ----
if (hasOfferNow && offerKeyNow !== lastOfferKeyForMe) {
  if (offerCountdownTimer) {
    clearInterval(offerCountdownTimer);
    offerCountdownTimer = null;
  }

  const offerInfo = document.getElementById("offerInfo");
  offerCountdownTimer = setInterval(() => {
  if (!offeredCache) {
    clearInterval(offerCountdownTimer);
    offerCountdownTimer = null;
    if (offerInfo) offerInfo.textContent = "";
    stopOfferBeepLoop();
    hideOfferAlert();
    return;
  }

  const v = unwrapOfferCache(offeredCache);    
  // ✅ compute time-left FIRST
  const msLeft = Math.max(0, (v.offerExpiresAt ?? 0) - Date.now());
    setAcceptButtonLabel(msLeft);
    updateAcceptButtonVisual(msLeft);
    urgentDoublePulseActive = (msLeft > 0 && msLeft <= 2000);
  // ✅ urgent trigger uses msLeft (not "remaining")
  if (msLeft <= 5000 && !urgentBeepIntervalId) {
    startUrgentBeepLoop();
  }

  const secLeft = Math.ceil(msLeft / 1000);
const offerName = v?.name ?? v?.driverName ?? "Taxi offer";

if (msLeft > 5000) {
  showOfferAlert(
    `Now offering: ${offerName}`,
    `Expires in ${secLeft}s`,
    "normal"
  );
} else if (msLeft > 2000) {
  showOfferAlert(
    `Now offering: ${offerName}`,
    `Expires in ${secLeft}s`,
    "urgent"
  );
} else if (msLeft > 0) {
  showOfferAlert(
    `Now offering: ${offerName}`,
    `Expires in ${secLeft}s`,
    "final"
  );
} else {
  showOfferAlert(
    `Now offering: ${offerName}`,
    `Offer expired`,
    "final"
  );
}
    if (msLeft <= 0) {
  stopOfferBeepLoop();
  hideOfferAlert();
  updateAcceptButtonVisual(null);
  setAcceptButtonLabel(null);
    }
  }, 250);
}

// Track for next onValue tick
lastOfferWasForMe = hasOfferNow;
lastOfferKeyForMe = offerKeyNow;

// Track for next onValue tick
lastOfferWasForMe = hasOfferNow;
lastOfferKeyForMe = offerKeyNow;

// ✅ UI depends ONLY on offeredCache
refreshAcceptUI();

// ✅ If no offer for me, clear "Now Offering" and stop
if (!offeredCache) {
  calledBox.textContent = "";
  hideOfferAlert();
  updateAcceptButtonVisual(null);
  setAcceptButtonLabel(null);
  return;
}
// offeredCache exists (for THIS driver)
if (typeof setOfferPulse === "function") setOfferPulse(true);

const offerObj = unwrapOfferCache(offeredCache);
calledBox.textContent =
  "Now Offering: " + (offerObj?.name ?? offerObj?.driverName ?? "");

// 🔥 Safari fix: force re-resume right when an offer arrives
forceResumeAudio("offer-arrived")
  .catch(() => {}) // ignore errors, continue
  .then(() => {
    unlockAudio();           // safe no-op if already unlocked
    allowAudioFor?.(2000);   // optional but helps Safari

    if (canPlayAlerts() && !suppressOfferBeep) {
     const bgBoost = document.hidden ? 1.45 : 1.0;

playTone("offer", {
  force: true,
  allowNoFocus: true,
  volumeMul: bgBoost
});
      startOfferBeepLoop(); // ✅ DO NOT pass 800 here
    } else {
      stopOfferBeepLoop();
    }
  });
  });  //  ✅ closes onValue(queueRef, (snap) => { ... })
  }    // ✅ closes function subscribeQueue() { ... }

// -----------------------------
// BOOT
// -----------------------------
console.log("✅ app.js loaded");
const BUILD = "2026-03-05-AUDIO-STABLE";
console.log("BUILD:", BUILD);
// -----------------------------
// DEBUG SWITCH
// -----------------------------
const DEBUG = false; // ✅ change to true when troubleshooting

function dlog(...args) {
  if (DEBUG) console.log(...args);
}
function dwarn(...args) {
  if (DEBUG) console.warn(...args);
}
addUniversalAudioUnlock(); 
// Auth first (fixes PERMISSION_DENIED if you set rules to auth != null)
ensureSignedIn();
updateSoundHint();

onAuthStateChanged(auth, (user) => {
  if (user) console.log("✅ Signed in (anonymous)", user.uid);
});

wireConnectionBadge();
loadSoundPref();
wireSoundToggle();
   
// 🔇 indicator wiring (tab inactive / hidden)
ensureMuteIndicator();
updateMuteIndicator();
document.addEventListener("visibilitychange", updateMuteIndicator);
window.addEventListener("focus", updateMuteIndicator);
window.addEventListener("blur", updateMuteIndicator);
wireSmartInputs();
refreshJoinUI(); // optional but good
subscribeQueue();
if (!queueHealthTimer) {
  queueHealthTimer = setInterval(() => {
    updateQueueHealth(lastQueueSnapshot || {});
  }, 1000);
}
// Mobile audio unlock
window.addEventListener("pointerdown", () => {
  unlockAudio();
  updateSoundHint();
}, { once: true });

window.addEventListener("touchstart", () => {
  unlockAudio();
  updateSoundHint();
}, { once: true, passive: true });

// Expire loop
setInterval(expireOffersNow, 1000);

// Buttons
joinBtn.onclick = joinQueue;
leaveBtn.onclick = leaveQueue;
acceptBtn.onclick = acceptRide;

const testBeepBtn = document.getElementById("testBeepBtn");
console.log("🔧 testBeepBtn found?", !!testBeepBtn, testBeepBtn);

testBeepBtn?.addEventListener("click", () => {
  console.log("🔔 Test Beep clicked");

  // Make sure sound gating can't block the test
  soundEnabled = true;
  localStorage.setItem("htqs.soundEnabled", "true");

  // Wake/resume the real shared context
  ensureAudioNow("test-beep-click");

  // Give Safari a tiny moment after resume
  const ok = playTone("offer", {
    force: true,
    allowNoFocus: true,
    volumeMul: 1.5,
    delay: 0.03
  });

  console.log("playTone('offer') returned:", ok, "ctx:", audioCtx?.state);

  // Safety fallback if normal tone truly fails
  if (!ok) {
    console.warn("playTone failed — using hard fallback beep");
    hardBeepFallback();
  }
});

callNextBtn.onclick = callNext;
completeBtn.onclick = completePickup;
resetBtn.onclick = resetDemo;

// Keep UI updated while typing
driverNameInput.oninput = refreshAcceptUI;
driverPlateInput.oninput = refreshAcceptUI;

lockDriverInputs(!!myDriverKey);
updateEmptyState();
refreshAcceptUI();

window.HTQS = {
  state: () => ({
    isConnected,
    soundEnabled,
    audioUnlocked,
    suppressOfferBeep,
    offeredCache,
    offerBeepIntervalId
  })
};
