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

// C3: offer lifecycle UX (driver-side)
let lastOfferWasForMe = false;
let lastOfferKeyForMe = null;
let offerCountdownTimer = null;

let lastOfferKey = null;      // also offer-related
let soundEnabled = true;
let suppressOfferBeep = false;

// Audio
let audioCtx = null;
let audioUnlocked = false;
let offerBeepIntervalId = null;
let offerBeepStopTimeoutId = null;

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
  if (!acceptBtn) return;

  // offeredCache might be {key, val} OR a direct object
  const offer = offeredCache?.val ?? offeredCache;

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
    refreshJoinUI();
    
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

    refreshJoinUI();
    
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
  if (!offeredCache || !myDriverKey) return;

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

  try {
    // Re-read latest to prevent race condition
    const snap = await get(ref(db, "queue/" + key));
    if (!snap.exists()) return;

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

    showToast?.("Accepted ✅", "ok", 1500);

  } catch (err) {
    console.error("acceptRide error:", err);
    showToast?.("Accept failed", "err", 2000);
  } finally {
    setBusy(false);
    refreshAcceptUI();
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

      lastOfferKey = null;
      stopOfferBeepLoop();
      if (typeof setOfferPulse === "function") setOfferPulse(false);

      updateEmptyState();
      refreshAcceptUI();
      return;
    }

    const data = snap.val() || {};
    const entries = Object.entries(data);

    // Safety: if my driver got removed/LEFT
    if (myDriverKey) {
      const mine = data[myDriverKey];
      if (!mine || mine.status === "LEFT") {
        sessionStorage.removeItem("htqs.driverKey");
        myDriverKey = null;
        lockDriverInputs(false);
        refreshJoinUI();
      }
    }

    // Render list
    queueList.innerHTML = "";
    calledBox.textContent = "";

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

    // ✅ Only cache an offer if it’s for THIS driver
    offeredCache = findOfferForMe(data);
    
    // ---- C3: ensure beep is allowed for NEW offers ----
const newOfferKey = offeredCache ? offeredCache.key : null;

// Offer ended → cleanup
if (!newOfferKey) {
  lastOfferKey = null;
  suppressOfferBeep = false;      // allow next offer to beep
  stopOfferBeepLoop();
} else {
  // New offer arrived (key changed) → allow beep again + restart loop
  if (newOfferKey !== lastOfferKey) {
    lastOfferKey = newOfferKey;
    suppressOfferBeep = false;    // IMPORTANT: re-enable beeps for new offer
    stopOfferBeepLoop();          // avoid duplicate timers
    startOfferBeepLoop();         // start beeping now
  }
}
// -----------------------------
// C3: Offer lifecycle UX (driver-side)
// Put this RIGHT AFTER: offeredCache = findOfferForMe(data);
// -----------------------------

const mineNow = myDriverKey ? data[myDriverKey] : null;

// Offer exists for THIS driver if offeredCache is set
const hasOfferNow = !!offeredCache;
const offerKeyNow = hasOfferNow ? offeredCache.key : null;

// If an offer just ended, show "missed" ONLY if we are back to WAITING
// (This avoids false "missed" when you accepted and became ACCEPTED.)
if (lastOfferWasForMe && !hasOfferNow) {
  const statusNow = (mineNow?.status ?? "WAITING").toUpperCase();

  if (statusNow === "WAITING") {
    if (typeof showToast === "function") showToast("Offer missed ⏰ — back to WAITING", "warn", 2200);
  }

  // Stop countdown display
  if (offerCountdownTimer) {
    clearInterval(offerCountdownTimer);
    offerCountdownTimer = null;
  }

  // Optional: clear countdown text if you have a label area
  const offerInfo = document.getElementById("offerInfo"); // keep if you have it
  if (offerInfo) offerInfo.textContent = "";
}

// If a NEW offer starts (or offer key changes), restart countdown timer
if (hasOfferNow && offerKeyNow !== lastOfferKeyForMe) {
  // reset any previous timer
  if (offerCountdownTimer) {
    clearInterval(offerCountdownTimer);
    offerCountdownTimer = null;
  }

  // Optional: show a toast when you get called
  if (typeof showToast === "function") showToast("You’re being called 🚕", "ok", 1400);

  const offerInfo = document.getElementById("offerInfo"); // optional element
  offerCountdownTimer = setInterval(() => {
    // If offer vanished, stop timer
    if (!offeredCache) {
      clearInterval(offerCountdownTimer);
      offerCountdownTimer = null;
      if (offerInfo) offerInfo.textContent = "";
      return;
    }

    const v = offeredCache.val || {};
    const msLeft = Math.max(0, (v.offerExpiresAt ?? 0) - Date.now());
    const secLeft = Math.ceil(msLeft / 1000);

    // Optional UI text (only if element exists)
    if (offerInfo) {
      offerInfo.textContent = secLeft > 0
        ? `Offer expires in ${secLeft}s`
        : `Offer expired`;
    }

    // If expired, stop timer (RTDB will flip to WAITING soon anyway)
    if (secLeft <= 0) {
      clearInterval(offerCountdownTimer);
      offerCountdownTimer = null;
    }
  }, 250);
}

// Update tracking globals for next tick
lastOfferWasForMe = hasOfferNow;
lastOfferKeyForMe = offerKeyNow;
    
// If a NEW offer arrives, allow beep again
if (!offeredCache) {
  lastOfferKey = null;
  suppressOfferBeep = false;
} else if (offeredCache.key !== lastOfferKey) {
  lastOfferKey = offeredCache.key;
  suppressOfferBeep = false;
}
    // ✅ If a NEW offer arrives, allow beeps again
    const newKey = offeredCache ? offeredCache.key : null;
    if (newKey && newKey !== lastOfferKey) {
      suppressOfferBeep = false;
    }
    lastOfferKey = newKey;

    // ✅ UI depends ONLY on offeredCache
    refreshAcceptUI();

    // ✅ Beep/pulse depends ONLY on offeredCache
    if (!offeredCache) {
      stopOfferBeepLoop();
      if (typeof setOfferPulse === "function") setOfferPulse(false);
      calledBox.textContent = "";
      return;
    }

    // offeredCache exists (for THIS driver)
    if (typeof setOfferPulse === "function") setOfferPulse(true);

    calledBox.textContent = "Now Offering: " + offeredCache.val.name;

    if (canPlayAlerts() && !suppressOfferBeep) {
      startOfferBeepLoop(OFFER_MS);
    } else {
      stopOfferBeepLoop();
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
wireSmartInputs();
refreshJoinUI(); // optional but good
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
