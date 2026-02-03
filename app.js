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

// ---------------------------------
// Firebase config
// ---------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyAFpipCO1XuETiPzuCptlTJhpHy4v7teo4",
  authDomain: "htqs-afa97.firebaseapp.com",
  databaseURL: "https://htqs-afa97-default-rtdb.firebaseio.com",
  projectId: "htqs-afa97",
  storageBucket: "htqs-afa97.appspot.com",
  messagingSenderId: "900324034014",
  appId: "1:900324034014:web:4e6cf9b46567a9ee17494f",
};

// ---------------------------------
// ✅ DOORMAN PIN (YOU MUST SET THIS)
// ---------------------------------
const DOORMAN_PIN = "1234"; // <- change to your desired PIN

let isConnected = true;

// ---------------------------------
// Initialize App & DB
// ---------------------------------
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const queueRef = ref(db, "queue");

// ---------------------------------
// DOM Elements
// ---------------------------------
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
const offerInfo = document.getElementById("offerInfo");

// ---------------------------------
// Local state
// ---------------------------------
let myDriverKey = sessionStorage.getItem("htqs.driverKey") || null;
let offeredCache = null;

let soundEnabled = true;
let suppressOfferBeep = false;

// ---------------------------------
// Sound helper state
// ---------------------------------
let audioCtx = null;
let audioUnlocked = false;
let offerBeepIntervalId = null;
let offerBeepStopTimeoutId = null;

// ---------------------------------
// Connection badge (RTDB .info/connected)
// ---------------------------------
function wireConnectionBadge() {
  const connectedRef = ref(db, ".info/connected");
  let wasConnected = true;

  onValue(connectedRef, (snap) => {
    isConnected = snap.val() === true;

    if (wasConnected && !isConnected) {
      console.warn("⚠️ RTDB disconnected — UI may be stale until reconnect");
    }
    wasConnected = isConnected;

    const el = document.getElementById("netStatus");
    if (el) {
      el.textContent = isConnected ? "Online" : "Reconnecting…";
      el.classList.toggle("offline", !isConnected);
    }
  });
}

// ---------------------------------
// UI Utilities
// ---------------------------------
function updateEmptyState() {
  const empty = document.getElementById("queueEmpty");
  if (!empty || !queueList) return;
  empty.style.display = queueList.children.length ? "none" : "block";
}

function setOfferPulse(on) {
  const driverCardEl = document.querySelector(".card.driver");
  if (acceptBtn) acceptBtn.classList.toggle("is-offered", !!on);
  if (driverCardEl) driverCardEl.classList.toggle("is-offered", !!on);
}

function lockDriverInputs(locked) {
  driverNameInput.disabled = locked;
  driverColorInput.disabled = locked;
  driverPlateInput.disabled = locked;

  joinBtn.disabled = locked;
  leaveBtn.disabled = !locked;
}

function norm(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

function isMeForOffer(v) {
  if (!v) return false;
  const inputName = norm(driverNameInput.value);
  const inputPlate = norm(driverPlateInput.value);
  return inputName && inputPlate && norm(v.name) === inputName && norm(v.plate) === inputPlate;
}

function canPlayAlerts() {
  return soundEnabled && !document.hidden;
}

function refreshAcceptUI() {
  const offeredToMe =
    !!offeredCache &&
    !!myDriverKey &&
    isMeForOffer(offeredCache.val) &&
    (offeredCache.val.offerExpiresAt ?? 0) > Date.now();

  if (acceptBtn) acceptBtn.disabled = !offeredToMe;

  if (offerInfo) {
    offerInfo.textContent = offeredCache
      ? `Offer: ${offeredCache.val.name} (${offeredCache.val.plate})`
      : "";
  }
}

// ---------------------------------
// Sound & Beep Logic
// ---------------------------------
function unlockAudio() {
  if (audioUnlocked) return;

  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;

  if (!audioCtx) audioCtx = new Ctx();

  audioCtx.resume()
    .then(() => {
      audioUnlocked = true;
      console.log("Audio unlocked");
    })
    .catch((e) => {
      console.warn("Audio unlock blocked:", e);
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

function startOfferBeepLoop(maxMs = 25000) {
  stopOfferBeepLoop();
  playOfferTone();

  offerBeepIntervalId = setInterval(() => {
    playOfferTone();
  }, 1200);

  offerBeepStopTimeoutId = setTimeout(() => {
    stopOfferBeepLoop();
  }, maxMs);
}

function loadSoundPref() {
  const saved = localStorage.getItem("htqs.soundEnabled");
  soundEnabled = saved === null ? true : saved === "true";

  const toggle = document.getElementById("soundToggle");
  if (toggle) toggle.checked = soundEnabled;
}

function wireSoundToggle() {
  const toggle = document.getElementById("soundToggle");
  if (!toggle) return;

  toggle.addEventListener("change", () => {
    soundEnabled = toggle.checked;
    localStorage.setItem("htqs.soundEnabled", String(soundEnabled));
    if (soundEnabled) unlockAudio();
    else stopOfferBeepLoop();
  });
}

// ---------------------------------
// Expire offers (auto bump WAITING)
// ---------------------------------
async function expireOffersNow() {
  const snap = await get(queueRef);
  if (!snap.exists()) return;

  const now = Date.now();
  const entries = Object.entries(snap.val());

  let bump = 0;

  await Promise.all(entries.map(async ([k, v]) => {
    const expired = v.status === "OFFERED" && (v.offerExpiresAt ?? 0) <= now;
    if (!expired) return;

    await update(ref(db, "queue/" + k), {
      status: "WAITING",
      offerStartedAt: null,
      offerExpiresAt: null,
      joinedAt: now + (bump++),
    });
  }));
}

// ---------------------------------
// Driver / Doorman actions
// ---------------------------------
async function joinQueue() {
  unlockAudio();

  try {
    if (!driverNameInput.value.trim() || !driverPlateInput.value.trim()) {
      alert("Enter name and plate.");
      return;
    }

    const driverKey = `${norm(driverNameInput.value)}_${norm(driverPlateInput.value)}`;
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
      name: driverNameInput.value.trim(),
      carColor: driverColorInput.value.trim(),
      plate: driverPlateInput.value.trim(),
      joinedAt,
      offerStartedAt: null,
      offerExpiresAt: null,
    });

    myDriverKey = driverKey;
    sessionStorage.setItem("htqs.driverKey", driverKey);

    lockDriverInputs(true);
    refreshAcceptUI();
  } catch (err) {
    console.error(err);
    alert("Join failed");
  }
}

async function leaveQueue() {
  try {
    if (!myDriverKey) return;

    await update(ref(db, "queue/" + myDriverKey), {
      status: "LEFT",
      offerStartedAt: null,
      offerExpiresAt: null,
    });

    sessionStorage.removeItem("htqs.driverKey");
    myDriverKey = null;

    offeredCache = null;
    suppressOfferBeep = false;
    stopOfferBeepLoop();
    setOfferPulse(false);

    lockDriverInputs(false);
    refreshAcceptUI();
    updateEmptyState();
  } catch (e) {
    console.error(e);
    alert("Leave failed");
  }
}

async function callNext() {
  if (doormanPinInput.value.trim() !== DOORMAN_PIN) return alert("Wrong PIN");

  await expireOffersNow();

  const snap = await get(queueRef);
  const data = snap.exists() ? snap.val() : {};
  const entries = Object.entries(data);

  const waiting = entries
    .filter(([_, v]) => (v.status ?? "WAITING") === "WAITING")
    .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));

  if (waiting.length === 0) return alert("No WAITING taxis.");

  const [key] = waiting[0];
  const now = Date.now();

  await update(ref(db, "queue/" + key), {
    status: "OFFERED",
    offerStartedAt: now,
    offerExpiresAt: now + 25000,
  });
}

async function acceptRide() {
  unlockAudio();

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
}

async function completePickup() {
  stopOfferBeepLoop();
  if (doormanPinInput.value.trim() !== DOORMAN_PIN) return alert("Wrong PIN");

  const snap = await get(queueRef);
  if (!snap.exists()) return;

  const accepted = Object.entries(snap.val()).find(([_, v]) => v.status === "ACCEPTED");
  if (!accepted) return alert("No ACCEPTED ride to complete.");

  await remove(ref(db, "queue/" + accepted[0]));
}

async function resetDemo() {
  const pin = doormanPinInput.value.trim();
  if (pin !== DOORMAN_PIN) return alert("Invalid PIN.");

  if (!confirm("Reset demo? This will clear the entire queue.")) return;

  const snap = await get(queueRef);
  if (!snap.exists()) return;

  const keys = Object.keys(snap.val());
  await Promise.all(keys.map((k) => remove(ref(db, "queue/" + k))));

  offeredCache = null;
  refreshAcceptUI();
  updateEmptyState();
}

// ---------------------------------
// Live UI render
// ---------------------------------
let unsubscribeQueue = null;

function subscribeQueue() {
  if (typeof unsubscribeQueue === "function") unsubscribeQueue();

  unsubscribeQueue = onValue(queueRef, (snap) => {
    // Snapshot empty
    if (!snap.exists()) {
      if (!isConnected) return; // offline/reconnecting: keep last UI
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

    // ✅ Driver-left cleanup
    if (myDriverKey) {
      const mine = data[myDriverKey];
      if (!mine || mine.status === "LEFT") {
        sessionStorage.removeItem("htqs.driverKey");
        myDriverKey = null;
        lockDriverInputs(false);

        offeredCache = null;
        stopOfferBeepLoop();
        setOfferPulse(false);
      }
    }

    // Render
    queueList.innerHTML = "";
    calledBox.textContent = "";
    offeredCache = null;

    const active = entries
      .filter(([_, v]) => v && (v.status ?? "WAITING") !== "LEFT")
      .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));

    active.forEach(([_, v], i) => {
      const li = document.createElement("li");
      const status = (v.status ?? "WAITING").toUpperCase();
      li.className = `queue-item status-${status.toLowerCase()}`;

      li.innerHTML = `
        <span class="pos">${i + 1}.</span>
        <span class="driver">${v.name} ${v.carColor ?? ""} ${v.plate}</span>
        <span class="badge">${status}</span>
      `;

      queueList.appendChild(li);
    });

    updateEmptyState();

    // Offer selection
    const offered = entries
      .filter(([_, v]) => v && v.status === "OFFERED" && (v.offerExpiresAt ?? 0) > now)
      .sort((a, b) => (a[1].offerStartedAt ?? 0) - (b[1].offerStartedAt ?? 0));

    offeredCache = offered.length ? { key: offered[0][0], val: offered[0][1] } : null;

    const offeredToMe =
      !!offeredCache &&
      !!myDriverKey &&
      isMeForOffer(offeredCache.val);

    setOfferPulse(offeredToMe);

    if (offeredToMe && canPlayAlerts() && !suppressOfferBeep) {
      startOfferBeepLoop(25000);
    } else {
      stopOfferBeepLoop();
    }

    refreshAcceptUI();
    calledBox.textContent = offeredCache ? "Now Offering: " + offeredCache.val.name : "";
  });
}

// ---------------------------------
// App boot (run once)
// ---------------------------------
console.log("✅ app.js loaded");
wireConnectionBadge();
loadSoundPref();
wireSoundToggle();
subscribeQueue();

// Unlock audio on first interaction (mobile friendly)
window.addEventListener("pointerdown", unlockAudio, { once: true });
window.addEventListener("touchstart", unlockAudio, { once: true, passive: true });

// Expire loop
setInterval(expireOffersNow, 1000);

// Button wiring
joinBtn.onclick = joinQueue;
leaveBtn.onclick = leaveQueue;
callNextBtn.onclick = callNext;
acceptBtn.onclick = acceptRide;
completeBtn.onclick = completePickup;
resetBtn.onclick = resetDemo;

// Keep Accept UI updated while typing
driverNameInput.oninput = refreshAcceptUI;
driverPlateInput.oninput = refreshAcceptUI;

updateEmptyState();

// Optional debug helpers
window.debug = {
  norm,
  isMeForOffer,
  refreshAcceptUI,
  getOfferedCache: () => offeredCache,
};
