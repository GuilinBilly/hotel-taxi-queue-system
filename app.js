// app.js (final cleaned version)

// Firebase (App + RTDB)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
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
const callNextBtn = document.getElementById("callNextBtn");
const completeBtn = document.getElementById("completeBtn");
const resetBtn = document.getElementById("resetBtn");

const doormanPinInput = document.getElementById("doormanPin");

const queueList = document.getElementById("queueList");
const calledBox = document.getElementById("calledBox");

const offerInfo = document.getElementById("offerInfo"); // optional
const netStatus = document.getElementById("netStatus"); // optional
const queueEmpty = document.getElementById("queueEmpty"); // optional
const soundToggle = document.getElementById("soundToggle"); // optional

// -----------------------------
// STATE
// -----------------------------


let myDriverKey = sessionStorage.getItem("htqs.driverKey") || null;
let offeredCache = null;

let soundEnabled = true;
let suppressOfferBeep = false;

// Audio
let audioCtx = null;
let audioUnlocked = false;
let offerBeepIntervalId = null;
let offerBeepStopTimeoutId = null;

let lastOfferKey = null;
let suppressOfferBeep = false; // make sure it exists only once in the whole file

// Single listener handle
let unsubscribeQueue = null;

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

function lockDriverInputs(locked) {
  if (driverNameInput) driverNameInput.disabled = locked;
  if (driverColorInput) driverColorInput.disabled = locked;
  if (driverPlateInput) driverPlateInput.disabled = locked;

  if (joinBtn) joinBtn.disabled = locked;
  if (leaveBtn) leaveBtn.disabled = !locked;
}

function canPlayAlerts() {
  return soundEnabled && !document.hidden;
}

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
  const hasOfferForMe = !!offeredCache;

  const btn = document.getElementById("acceptBtn");
  if (btn) btn.disabled = !hasOfferForMe; // keep this simple

  // Pulse/animation driven ONLY by offeredCache
  if (typeof setOfferPulse === "function") setOfferPulse(hasOfferForMe);

  // Safety: if no offer, ensure beep stops
  if (!hasOfferForMe) stopOfferBeepLoop();
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

  // Buttons temporarily locked during async work
  const ids = ["joinBtn", "leaveBtn", "acceptBtn", "callNextBtn", "completeBtn", "resetBtn"];

  ids.forEach((id) => {
    const b = document.getElementById(id);
    if (!b) return;

    if (on) {
      // Save current disabled state each time we go busy
      b.dataset.prevDisabled = String(b.disabled);
      b.disabled = true;
      b.classList.add("is-loading");
    } else {
      // Restore previous state for most buttons...
      if (id !== "acceptBtn") {
        b.disabled = (b.dataset.prevDisabled === "true");
      } else {
        // ...but for Accept, ALWAYS let refreshAcceptUI() decide later
        b.disabled = false;
      }

      b.classList.remove("is-loading");
      delete b.dataset.prevDisabled;
    }
  });

  // After unlocking, recompute the real states (especially Accept / Leave)
  if (!on && typeof refreshAcceptUI === "function") {
    refreshAcceptUI();
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
// SOUND
// -----------------------------

function unlockAudio() {
  if (audioUnlocked) return;

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;

  if (!audioCtx) audioCtx = new Ctx();

  audioCtx
    .resume()
    .then(() => {
      audioUnlocked = true;
      console.log("Audio unlocked");
      updateSoundHint();
    })
    .catch((e) => {
      console.warn("Audio unlock blocked:", e);
      updateSoundHint();
    });
}

function playOfferTone() {
  if (!audioCtx || !audioUnlocked) return;

  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.08;

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const t = audioCtx.currentTime;
    osc.start(t);
    osc.stop(t + 0.12);
  } catch (e) {
    console.warn("playOfferTone failed:", e);
  }
}
function stopOfferBeepLoop() {
  clearInterval(offerBeepIntervalId);
  clearTimeout(offerBeepStopTimeoutId);
  offerBeepIntervalId = null;
  offerBeepStopTimeoutId = null;
}

function startOfferBeepLoop(maxMs = OFFER_MS) {
  stopOfferBeepLoop();
  playOfferTone();

  offerBeepIntervalId = setInterval(playOfferTone, 1200);
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

    if (existing && existing.status === "LEFT") {
      await remove(driverRef);
    }

    const joinedAt =
      existing && existing.status !== "LEFT" && existing.joinedAt != null
        ? existing.joinedAt
        : Date.now();

    await set(driverRef, {
      status: "WAITING",
      name,
      carColor,
      plate,
      joinedAt,
      offerStartedAt: null,
      offerExpiresAt: null,
    });

    myDriverKey = driverKey;
    sessionStorage.setItem("htqs.driverKey", driverKey);

    lockDriverInputs(true);
    refreshAcceptUI();

    console.log("joinQueue success", driverKey);
    showToast("Joined queue ✅", "ok");
  } catch (err) {
    console.error("joinQueue error:", err);
    showToast("Join failed — try again", "err", 2400);
    alert("Join failed");
  } finally {
    setBusy(false);
  }
}
async function leaveQueue() {
  if (isBusy) return;
  setBusy(true, "Leaving…");

  try {
    if (!myDriverKey) return;

    await update(ref(db, "queue/" + myDriverKey), { status: "LEFT" });

    sessionStorage.removeItem("htqs.driverKey");
    myDriverKey = null;

    lockDriverInputs(false);
    stopOfferBeepLoop();
    setOfferPulse(false);
    refreshAcceptUI();
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

  const now = Date.now();
  const entries = Object.entries(snap.val());
  let bump = 0;

  await Promise.all(
    entries.map(async ([k, v]) => {
      const isExpired = v.status === "OFFERED" && (v.offerExpiresAt ?? 0) <= now;
      if (!isExpired) return;

      await update(ref(db, "queue/" + k), {
        status: "WAITING",
        offerStartedAt: null,
        offerExpiresAt: null,
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
    await expireOffersNow();

    const snap = await get(queueRef);
    const data = snap.exists() ? snap.val() : {};
    const entries = Object.entries(data);

    const waiting = entries
      .filter(([_, v]) => (v.status ?? "WAITING") === "WAITING")
      .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));

    if (!waiting.length) {
      if (typeof showToast === "function") showToast("No WAITING taxis.", "warn", 2000);
      else alert("No WAITING taxis.");
      return;
    }

    const [key] = waiting[0];
    const now = Date.now();

    await update(ref(db, "queue/" + key), {
      status: "OFFERED",
      offerStartedAt: now,
      offerExpiresAt: now + OFFER_MS,
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

async function acceptRide() {
  if (isBusy) return;
  setBusy(true, "Accepting…");
  unlockAudio();

  try {
    suppressOfferBeep = true;
    stopOfferBeepLoop();

    if (!offeredCache) return alert("No active offer.");

    const offerKey = offeredCache.key;

    const snap = await get(ref(db, "queue/" + offerKey));
    if (!snap.exists()) return alert("Offer disappeared.");

    const v = snap.val();

    if (v.status !== "OFFERED" || (v.offerExpiresAt ?? 0) <= Date.now()) {
      return alert("Offer expired — wait for next call.");
    }

    if (!isMeForOffer(v)) {
      return alert("This offer is not for you.");
    }

    await update(ref(db, "queue/" + offerKey), {
      status: "ACCEPTED",
      offerStartedAt: null,
      offerExpiresAt: null,
    });

    offeredCache = null;
    refreshAcceptUI();
  } finally {
    setBusy(false);
  }
}

async function completePickup() {
  if (isBusy) return;
  setBusy(true, "Completing…");

  try {
    stopOfferBeepLoop();

    if (doormanPinInput.value.trim() !== DOORMAN_PIN) return alert("Wrong PIN");

    const snap = await get(queueRef);
    if (!snap.exists()) return;

    const accepted = Object.entries(snap.val()).find(([_, v]) => v.status === "ACCEPTED");
    if (!accepted) return alert("No ACCEPTED ride to complete.");

    await remove(ref(db, "queue/" + accepted[0]));
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
      queueList.innerHTML = "";
      calledBox.textContent = "";
      offeredCache = null;
      stopOfferBeepLoop();
      setOfferPulse(false);
      updateEmptyState();
      refreshAcceptUI();
      return;
    }

    const now = Date.now();
    const data = snap.val() || {};
    const entries = Object.entries(data);

    // Safety: if my driver got removed/LEFT
    if (myDriverKey) {
      const mine = data[myDriverKey];
      if (!mine || mine.status === "LEFT") {
        sessionStorage.removeItem("htqs.driverKey");
        myDriverKey = null;
        lockDriverInputs(false);
      }
    }

    // Render
    queueList.innerHTML = "";
    calledBox.textContent = "";
    offeredCache = null;

    const active = entries
      .filter(([_, v]) => v && (v.status ?? "WAITING") !== "LEFT")
      .slice()
      .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));

    active.forEach(([k, v], i) => {
      const li = document.createElement("li");
      const status = (v.status ?? "WAITING").toUpperCase();
      li.classList.add("queue-item", `status-${status.toLowerCase()}`);
      li.innerHTML = `
        <span class="pos">${i + 1}.</span>
        <span class="driver">${v.name} ${v.carColor ?? ""} ${v.plate}</span>
        <span class="badge">${status}</span>
      `;
      queueList.appendChild(li);
    });

    updateEmptyState();

    // ✅ ONLY cache an OFFERED entry if it's for THIS driver
offeredCache = findOfferForMe(data);

// ✅ Accept UI depends ONLY on offeredCache
refreshAcceptUI();

// ✅ Beep/pulse depends ONLY on offeredCache
if (!offeredCache) {
  stopOfferBeepLoop();
  if (typeof setOfferPulse === "function") setOfferPulse(false);
  calledBox.textContent = "";
} else {
  if (typeof setOfferPulse === "function") setOfferPulse(true);

  if (canPlayAlerts() && !suppressOfferBeep /* && soundEnabled */) {
    startOfferBeepLoop(OFFER_MS);
  } else {
    stopOfferBeepLoop();
  }

  calledBox.textContent = "Now Offering: " + offeredCache.val.name;
}
  });
}

// -----------------------------
// BOOT
// -----------------------------
console.log("✅ app.js loaded");

// Auth first (fixes PERMISSION_DENIED if you set rules to auth != null)
ensureSignedIn();
updateSoundHint();

onAuthStateChanged(auth, (user) => {
  if (user) console.log("✅ Signed in (anonymous)", user.uid);
});

wireConnectionBadge();
loadSoundPref();
wireSoundToggle();
subscribeQueue();

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
callNextBtn.onclick = callNext;
completeBtn.onclick = completePickup;
resetBtn.onclick = resetDemo;

// Keep UI updated while typing
driverNameInput.oninput = refreshAcceptUI;
driverPlateInput.oninput = refreshAcceptUI;

lockDriverInputs(!!myDriverKey);
updateEmptyState();
refreshAcceptUI();
