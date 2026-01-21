import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  remove,
  get,
  set,
  update
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAFpipCO1XuETiPzuCptlTJhpHy4v7teo4",
  authDomain: "htqs-afa97.firebaseapp.com",
  databaseURL: "https://htqs-afa97-default-rtdb.firebaseio.com",
  projectId: "htqs-afa97",
  storageBucket: "htqs-afa97.firebasestorage.app",
  messagingSenderId: "900324034014",
  appId: "1:900324034014:web:4e6cf9b46567a9ee17494f"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const queueRef = ref(db, "queue");

const driverNameInput = document.getElementById("driverName");
const driverColorInput = document.getElementById("driverColor");
const driverPlateInput = document.getElementById("driverPlate");

const joinBtn = document.getElementById("joinBtn");
const leaveBtn = document.getElementById("leaveBtn");
const acceptBtn = document.getElementById("acceptBtn");

const callNextBtn = document.getElementById("callNextBtn");
const completeBtn = document.getElementById("completeBtn");
const doormanPinInput = document.getElementById("doormanPin");

const queueList = document.getElementById("queueList");
const calledBox = document.getElementById("calledBox");
const offerInfo = document.getElementById("offerInfo");

const OFFER_TIMEOUT_MS = 25000;
const DOORMAN_PIN = "1688";

// { key, val } for the *single* active offer (if any)
let offeredCache = null;

// ---------- Helpers (SINGLE COPY ONLY) ----------
function norm(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

// True if the currently typed Name+Plate matches the active offer's driver
function isMeForOffer(v) {
  if (!v) return false;

  const inputName = norm(driverNameInput.value);
  const inputPlate = norm(driverPlateInput.value);

  if (!inputName || !inputPlate) return false;

  return norm(v.name) === inputName && norm(v.plate) === inputPlate;
}

function refreshAcceptUI() {
  // default state
  acceptBtn.disabled = true;
  offerInfo.textContent = "";

  if (!offeredCache) return;

  const v = offeredCache.val;
  const stillValid =
    v.status === "OFFERED" && (v.offerExpiresAt ?? 0) > Date.now();

  if (!stillValid) return;

  if (isMeForOffer(v)) {
    acceptBtn.disabled = false;
    offerInfo.textContent = "You have an active offer. Click Accept Ride.";
  } else {
    offerInfo.textContent = `Currently offering: ${v.name}`;
  }
}

// ---------- Expire offers (SINGLE PATH ONLY) ----------

async function expireOffersNow() {
  const snap = await get(queueRef);
  if (!snap.exists()) return;

  const now = Date.now();
  const entries = Object.entries(snap.val());

  // Move expired OFFERED drivers to end of queue by bumping joinedAt
  let bump = 0;

  for (const [k, v] of entries) {
    if (v.status === "OFFERED" && (v.offerExpiresAt ?? 0) <= now) {
      await update(ref(db, "queue/" + k), {
        status: "WAITING",
        offerStartedAt: null,
        offerExpiresAt: null,

        // key change: push to end
        joinedAt: now + (bump++)
      });
    }
  }
}

// ---------- Driver actions ----------
async function joinQueue() {
  const name = driverNameInput.value.trim();
  const carColor = driverColorInput.value.trim();
  const plate = driverPlateInput.value.trim();

  if (!name || !plate) return alert("Enter name and plate.");

  const driverKey = `${norm(name)}_${norm(plate)}`;
  const driverRef = ref(db, "queue/" + driverKey);

  // read existing record to keep joinedAt stable
  const snap = await get(driverRef);

  const prev = snap.exists() ? snap.val() : null;
  const joinedAt = prev?.joinedAt ?? Date.now();

  // keep previous status if it exists; otherwise WAITING
  const status = prev?.status ?? "WAITING";

  await set(driverRef, {
    name,
    carColor,
    plate,
    status,
    joinedAt,
    offerStartedAt: prev?.offerStartedAt ?? null,
    offerExpiresAt: prev?.offerExpiresAt ?? null
  });

  refreshAcceptUI();
}

async function leaveQueue() {
  const name = norm(driverNameInput.value);
  const plate = norm(driverPlateInput.value);
  if (!name || !plate) return alert("Enter name and plate.");

  const driverKey = `${name}_${plate}`;
  await remove(ref(db, "queue/" + driverKey));
}

async function callNext() {
  if (doormanPinInput.value.trim() !== DOORMAN_PIN) return alert("Wrong PIN");

  // expire first so we don’t block on a stale offer
  await expireOffersNow();

  const snap = await get(queueRef);
  if (!snap.exists()) return;

  const now = Date.now();
  const entries = Object.entries(snap.val());

  // block if already active offer
  const hasActiveOffer = entries.some(([k, v]) =>
    v.status === "OFFERED" && (v.offerExpiresAt ?? 0) > now
  );
  if (hasActiveOffer) return alert("An offer is already active. Wait for accept/expire.");

  // block if already accepted
  const hasAccepted = entries.some(([k, v]) => v.status === "ACCEPTED");
  if (hasAccepted) return alert("A ride is already ACCEPTED. Complete Pickup first.");

  const waiting = entries
    .filter(([k, v]) => v.status === "WAITING")
    .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));

  if (!waiting.length) return alert("No WAITING taxis.");

  const [key] = waiting[0];

  await update(ref(db, "queue/" + key), {
    status: "OFFERED",
    offerStartedAt: now,
    offerExpiresAt: now + OFFER_TIMEOUT_MS
  });
}

async function acceptRide() {
  if (!offeredCache) return alert("No active offer right now.");

  const offerKey = offeredCache.key;

  // Fresh read (reliability)
  const snap = await get(ref(db, "queue/" + offerKey));
  if (!snap.exists()) {
    offeredCache = null;
    refreshAcceptUI();
    return alert("Offer no longer exists.");
  }

  const v = snap.val();

  // Must still be valid
  if (v.status !== "OFFERED" || (v.offerExpiresAt ?? 0) <= Date.now()) {
    offeredCache = null;
    refreshAcceptUI();
    return alert("Offer expired. Please wait for the next call.");
  }

  // Must match the driver typing name+plate
  if (!isMeForOffer(v)) {
    return alert("This offer is not for you. Check your Name + Plate.");
  }

  await update(ref(db, "queue/" + offerKey), {
    status: "ACCEPTED",
    offerStartedAt: null,
    offerExpiresAt: null
  });
}

async function completePickup() {
  if (doormanPinInput.value.trim() !== DOORMAN_PIN) return alert("Wrong PIN");

  const snap = await get(queueRef);
  if (!snap.exists()) return;

  const entries = Object.entries(snap.val());
  const accepted = entries.find(([k, v]) => v.status === "ACCEPTED");
  if (!accepted) return alert("No ACCEPTED ride to complete.");

  await remove(ref(db, "queue/" + accepted[0]));
}

// ---------- Live UI render ----------
onValue(queueRef, (snap) => {
  queueList.innerHTML = "";
  calledBox.textContent = "";
  offeredCache = null;

  if (!snap.exists()) {
    refreshAcceptUI();
    return;
  }

  const now = Date.now();
  const entries = Object.entries(snap.val());

  // Render stable order by joinedAt
  entries
    .slice()
    .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0))
    .forEach(([k, v], i) => {
      const li = document.createElement("li");
      li.textContent = `${i + 1}. ${v.name} ${v.carColor} ${v.plate} ${v.status}`;
      queueList.appendChild(li);
    });

  // Cache the single active offer (oldest offerStartedAt wins)
  const offered = entries
    .filter(([k, v]) => v.status === "OFFERED" && (v.offerExpiresAt ?? 0) > now)
    .sort((a, b) => (a[1].offerStartedAt ?? 0) - (b[1].offerStartedAt ?? 0));

  offeredCache = offered.length ? { key: offered[0][0], val: offered[0][1] } : null;

  refreshAcceptUI();

  calledBox.textContent = offeredCache ? "Now Offering: " + offeredCache.val.name : "";
});

// Expire loop (single place)
setInterval(expireOffersNow, 1000);

// Button wiring
joinBtn.onclick = joinQueue;
leaveBtn.onclick = leaveQueue;
callNextBtn.onclick = callNext;
acceptBtn.onclick = acceptRide;
completeBtn.onclick = completePickup;

// Keep Accept UI updated while typing
driverNameInput.oninput = refreshAcceptUI;
driverPlateInput.oninput = refreshAcceptUI;

// Optional debug helpers
window.debug = {
  norm,
  isMeForOffer,
  refreshAcceptUI,
  getOfferedCache: () => offeredCache
};
