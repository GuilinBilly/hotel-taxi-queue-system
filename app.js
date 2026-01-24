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

function lockDriverInputs(locked) {
  driverNameInput.disabled = locked;
  driverColorInput.disabled = locked;
  driverPlateInput.disabled = locked;

  joinBtn.disabled = locked;
  leaveBtn.disabled = !locked; // optional but recommended
}

const callNextBtn = document.getElementById("callNextBtn");
const completeBtn = document.getElementById("completeBtn");
const doormanPinInput = document.getElementById("doormanPin");

const queueList = document.getElementById("queueList");
const calledBox = document.getElementById("calledBox");
const resetBtn = document.getElementById("resetBtn");
const offerInfo = document.getElementById("offerInfo");

//  Hook up UI events (put right here)
joinBtn.onclick = joinQueue;
leaveBtn.onclick = leaveQueue;
acceptBtn.onclick = acceptRide;

callNextBtn.onclick = callNext;
completeBtn.onclick = completePickup;
resetBtn.onclick = resetDemo;

const OFFER_TIMEOUT_MS = 25000;
const DOORMAN_PIN = "1688";
const WRITE_PIN = DOORMAN_PIN; // pin-gated writes (demo protection)
// Driver identity for THIS browser tab/session
let myDriverKey = sessionStorage.getItem("htqs.driverKey") || null;

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

  await Promise.all(
    entries.map(async ([k, v]) => {
      const isExpired =
        v.status === "OFFERED" && (v.offerExpiresAt ?? 0) <= now;

      if (!isExpired) return;

      await update(ref(db, "queue/" + k), {
        pin: WRITE_PIN,
        status: "WAITING",
        offerStartedAt: null,
        offerExpiresAt: null,
        joinedAt: now + (bump++)
      });
    })
  );
}

// ---------- Driver actions ----------
async function joinQueue() {
  try {
    console.log("joinQueue clicked");

    const name = driverNameInput.value.trim();
    const carColor = driverColorInput.value.trim();
    const plate = driverPlateInput.value.trim(); // Cab Number" in the UI

    if (!name || !cabNumber) {
  alert("Enter name and cab number.");
  return;
}

    const driverKey = `${norm(name)}_${norm(cabNumber)}`;
    console.log("driverKey:", driverKey);

    const driverRef = ref(db, "queue/" + driverKey);

    // If a LEFT record exists, remove it so re-join works
    const existingSnap = await get(driverRef);
    const existing = existingSnap.exists() ? existingSnap.val() : null;

    if (existing && existing.status === "LEFT") {
      console.log("Removing LEFT record before re-join");
      await remove(driverRef);
    }

   const joinedAt =
  (existing && existing.status !== "LEFT" && existing.joinedAt != null)
    ? existing.joinedAt
    : Date.now();
    
    await set(driverRef, {
      pin: WRITE_PIN,
      status: "WAITING",
      name,
      carColor,
      plate,
      joinedAt,
      offerStartedAt: null,
      offerExpiresAt: null
    });

    myDriverKey = driverKey;
    sessionStorage.setItem("htqs.driverKey", driverKey);
    lockDriverInputs(true);
    refreshAcceptUI();

    console.log("joinQueue success");
  } catch (err) {
    console.error("joinQueue failed:", err);
    alert("Join Queue failed. Check console for details.");
  }
}
async function leaveQueue() {
  // Must have joined from THIS device/session
  if (!myDriverKey) return alert("You haven't joined from this device yet.");

  // Extra safety: typed Name+Plate must match the saved key
  const name = driverNameInput.value.trim();
  const plate = driverPlateInput.value.trim();
  if (!name || !plate) return alert("Enter your name and plate first.");

  const typedKey = `${norm(name)}_${norm(plate)}`;
  if (typedKey !== myDriverKey) {
    return alert("You can only leave your own driver entry on this device.");
  }

  const driverRef = ref(db, "queue/" + myDriverKey);

  // Mark as LEFT (keep history; avoids UI timing issues)
  await update(driverRef, {
    status: "LEFT",
    leftAt: Date.now(),
  });

  // Local cleanup
  sessionStorage.removeItem("htqs.driverKey");
  myDriverKey = null;

  lockDriverInputs(false);
  driverNameInput.value = "";
  driverColorInput.value = "";
  driverPlateInput.value = "";

  offeredCache = null;
  refreshAcceptUI();
}
async function callNext() {
  if (doormanPinInput.value.trim() !== DOORMAN_PIN) return alert("Wrong PIN");

  // expire first so we don't block on a stale offer
  await expireOffersNow();

  const snap = await get(queueRef);
  const data = snap.exists() ? snap.val() : {};
  const entries = Object.entries(data);

 // Active = not LEFT
const active = entries.filter(([k, v]) => v && (v.status ?? "WAITING") !== "LEFT");

// Only WAITING drivers (treat missing status as WAITING)
   const waiting = active
  .filter(([k, v]) => (v.status ?? "WAITING") === "WAITING")
  .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));
  
  if (waiting.length === 0) return alert("No WAITING taxis.");

  const [key] = waiting[0];
  const now = Date.now();

  await update(ref(db, "queue/" + key), {
    pin: WRITE_PIN,
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
    pin: WRITE_PIN,
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

async function resetDemo() {
  const pin = doormanPinInput.value.trim();
  if (pin !== DOORMAN_PIN) return alert("Invalid PIN.");

  if (!confirm("Reset demo? This will clear the entire queue.")) return;

   
  // Wipe /queue completely (delete children one-by-one so rules on /queue/$driverId apply)
  const snap = await get(queueRef);
  if (!snap.exists()) return;

  const keys = Object.keys(snap.val());
  await Promise.all(keys.map((k) => remove(ref(db, "queue/" + k))));

  // UI cleanup (onValue will also refresh)
  offeredCache = null;
  refreshAcceptUI();
}
// ---------- Live UI render ----------

// ---------- Live UI render ----------

// Keep exactly ONE active listener
let unsubscribeQueue = null;

function subscribeQueue() {
  // If we already subscribed, unsubscribe first (prevents double-render)
  if (typeof unsubscribeQueue === "function") {
    unsubscribeQueue();
  }

  unsubscribeQueue = onValue(queueRef, (snap) => {
    // Clear UI (single render pass)
    queueList.innerHTML = "";
    calledBox.textContent = "";
    offeredCache = null;

    if (!snap.exists()) {
      refreshAcceptUI();
      return;
    }

    const now = Date.now();
    const entries = Object.entries(snap.val() || {});

    // ✅ ADD THIS BLOCK RIGHT HERE
  if (myDriverKey) {
  const mine = (snap.val() || {})[myDriverKey];

  // ✅ clear if record is missing OR LEFT
  if (!mine || mine.status === "LEFT") {
    sessionStorage.removeItem("htqs.driverKey");
    myDriverKey = null;
    lockDriverInputs(false);

    driverNameInput.value = "";
    driverColorInput.value = "";
    driverPlateInput.value = "";

    offeredCache = null;
    refreshAcceptUI();
  }
}

  // now continue with your existing logic:
  // const active = ...
  // active.slice().sort(...).forEach(...)    
    
    // Active = not LEFT
    const active = entries.filter(([k, v]) => v && (v.status ?? "WAITING") !== "LEFT");
    
    // Render stable order by joinedAt
  // Render stable order by joinedAt (ACTIVE only, so LEFT drivers disappear)
active
  .slice()
  .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0))
  .forEach(([k, v], i) => {
    const li = document.createElement("li");

    const status = (v.status ?? "WAITING").toUpperCase();
    li.classList.add("queue-item", `status-${status.toLowerCase()}`);

    li.innerHTML = `
      <span class="pos">${i + 1}.</span>
      <span class="driver">
      ${v.name} ${v.carColor ?? ""} Cab ${v.plate}
      </span>
      <span class="badge">${status}</span>
    `;

    queueList.appendChild(li);
  });
    // Cache the single active offer (oldest offerStartedAt wins)
    const offered = entries
      .filter(([_, v]) => v.status === "OFFERED" && (v.offerExpiresAt ?? 0) > now)
      .sort((a, b) => (a[1].offerStartedAt ?? 0) - (b[1].offerStartedAt ?? 0));

    offeredCache = offered.length ? { key: offered[0][0], val: offered[0][1] } : null;

    refreshAcceptUI();
    calledBox.textContent = offeredCache ? "Now Offering: " + offeredCache.val.name : "";
  });
}

// Call it ONCE
subscribeQueue();

// Expire loop (single place)
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

// Optional debug helpers
window.debug = {
  norm,
  isMeForOffer,
  refreshAcceptUI,
  getOfferedCache: () => offeredCache
};
