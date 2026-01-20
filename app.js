import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase, ref, push, onValue, remove, get, update
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
let offeredCache = null;

async function expireOffersNow() {
  const snap = await get(queueRef);
  if (!snap.exists()) return;

  const now = Date.now();
  const entries = Object.entries(snap.val());

}

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
  acceptBtn.disabled = true;
  offerInfo.textContent = "";

  if (!offeredCache) return;

  const v = offeredCache.val;
  const stillValid = (v.status === "OFFERED") && ((v.offerExpiresAt ?? 0) > Date.now());

  if (!stillValid) return;

  if (isMeForOffer(v)) {
    acceptBtn.disabled = false;
    offerInfo.textContent = "You have an active offer. Click Accept Ride.";
  } else {
    // helpful UX: show who is being offered (but still disable)
    offerInfo.textContent = `Currently offering: ${v.name}`;
  }
}

async function joinQueue() {
  const name = driverNameInput.value.trim();
  const carColor = driverColorInput.value.trim();
  const plate = driverPlateInput.value.trim();

  if (!name || !plate) return alert("Enter name and plate.");

  const driverKey = `${norm(name)}_${norm(plate)}`;

  // Read existing record so we don't "duplicate" the driver
  const driverRef = ref(db, "queue/" + driverKey);
  const snap = await get(driverRef);

  // If driver already exists, KEEP their joinedAt (keeps position stable)
  const joinedAt = snap.exists() ? (snap.val().joinedAt ?? Date.now()) : Date.now();

  // If they were OFFERED/ACCEPTED already, do not blindly overwrite status.
  // Keep status unless it was missing.
  const prevStatus = snap.exists() ? snap.val().status : null;
  const status = prevStatus ?? "WAITING";

  await set(driverRef, {
    name,
    carColor,
    plate,
    status,
    joinedAt,

    // If they re-join and they had old offer fields, keep them (or clear if you prefer)
    offerStartedAt: snap.exists() ? (snap.val().offerStartedAt ?? null) : null,
    offerExpiresAt: snap.exists() ? (snap.val().offerExpiresAt ?? null) : null
  });

  refreshAcceptUI();
}
async function leaveQueue() {
  const snap = await get(queueRef);
  if (!snap.exists()) return;
  const entries = Object.entries(snap.val());
  const name = driverNameInput.value.trim().toLowerCase();
  const plate = driverPlateInput.value.trim().toLowerCase();
  const found = entries.find(([k,v]) => v.name.toLowerCase()===name && v.plate.toLowerCase()===plate);
  if (found) await remove(ref(db, "queue/"+found[0]));
}

async function callNext() {
  if (doormanPinInput.value.trim() !== DOORMAN_PIN) return alert("Wrong PIN");

  const snap = await get(queueRef);
  if (!snap.exists()) return;

  const now = Date.now();
  const entries = Object.entries(snap.val());

  // Safety: block new offer if one is already active
  const hasActiveOffer = entries.some(([k, v]) =>
    v.status === "OFFERED" && (v.offerExpiresAt ?? 0) > now
  );
  if (hasActiveOffer) return alert("An offer is already active. Wait for accept/expire.");

  // Safety: block if someone already accepted (doorman should Complete Pickup)
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

  const v = offeredCache.val;

  // Must be the matching driver
  if (!isMeForOffer(v)) {
    return alert("This offer is not for you. Check your Name + Plate.");
  }

  // Must still be valid
  if (v.status !== "OFFERED" || (v.offerExpiresAt ?? 0) <= Date.now()) {
    refreshAcceptUI();
    return alert("Offer expired. Please wait for the next call.");
  }

  // Accept
  await update(ref(db, "queue/" + offeredCache.key), {
    status: "ACCEPTED",
    offerStartedAt: null,
    offerExpiresAt: null
  });
}
async function completePickup(){
  if (doormanPinInput.value.trim()!==DOORMAN_PIN) return;
  const snap=await get(queueRef);
  if(!snap.exists())return;
  const acc=Object.entries(snap.val()).find(([k,v])=>v.status==="ACCEPTED");
  if(acc) await remove(ref(db,"queue/"+acc[0]));
}

setInterval(expireOffersNow, 1000);

onValue(queueRef, (snap) => {
  queueList.innerHTML = "";
  calledBox.innerHTML = "";
  offeredCache = null;

  if (!snap.exists()) {
    refreshAcceptUI();
    return;
  }

  const now = Date.now();
  const entries = Object.entries(snap.val());

  // 1) expire old offers (ONLY place this logic exists)
entries.forEach(([k, v]) => {
  if (v.status === "OFFERED" && (v.offerExpiresAt ?? 0) <= now) {
    update(ref(db, "queue/" + k), {
      status: "WAITING",
      offerStartedAt: null,
      offerExpiresAt: null
    });
  }
});
  
  // 2) render queue (sorted by joinedAt)
  entries
    .slice()
    .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0))
    .forEach(([k, v], i) => {
      const li = document.createElement("li");
      li.textContent = `${i + 1}. ${v.name} ${v.carColor} ${v.plate} ${v.status}`;
      queueList.appendChild(li);
    });

  // 3) find active OFFERED (if any) and cache it
  const offered = entries
    .filter(([k, v]) => v.status === "OFFERED" && (v.offerExpiresAt ?? 0) > now)
    .sort((a, b) => (a[1].offerStartedAt ?? 0) - (b[1].offerStartedAt ?? 0));

  offeredCache = offered.length ? { key: offered[0][0], val: offered[0][1] } : null;

  refreshAcceptUI();

  calledBox.textContent = offeredCache
    ? "Now Offering: " + offeredCache.val.name
    : "";
});

// Button wiring (must be BELOW onValue)
joinBtn.onclick = joinQueue;
leaveBtn.onclick = leaveQueue;
callNextBtn.onclick = callNext;
acceptBtn.onclick = acceptRide;
completeBtn.onclick = completePickup;

// keep Accept button state updated as user types
driverNameInput.oninput = refreshAcceptUI;
driverPlateInput.oninput = refreshAcceptUI;

window.debug = { norm, isMeForOffer, refreshAcceptUI };
