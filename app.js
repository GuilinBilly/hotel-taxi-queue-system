// Firebase (modular SDK) - CDN imports (works with plain HTML + Vercel)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  ref,
  push,
  onValue,
  remove,
  get,
  update
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

// Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyAFpipCO1XuETiPzuCptlTJhpHy4v7teo4",
  authDomain: "htqs-afa97.firebaseapp.com",
  databaseURL: "https://htqs-afa97-default-rtdb.firebaseio.com",
  projectId: "htqs-afa97",
  storageBucket: "htqs-afa97.firebasestorage.app",
  messagingSenderId: "900324034014",
  appId: "1:900324034014:web:4e6cf9b46567a9ee17494f"
};

// Init
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Realtime Database path for the queue
const queueRef = ref(db, "queue");

// UI elements (must match index.html ids)
const driverNameInput = document.getElementById("driverName");
const queueList = document.getElementById("queueList");
const joinBtn = document.getElementById("joinBtn");
const leaveBtn = document.getElementById("leaveBtn");
const callNextBtn = document.getElementById("callNextBtn");
const doormanPinInput = document.getElementById("doormanPin");
const completeBtn = document.getElementById("completeBtn");
const calledBox = document.getElementById("calledBox");
const driverColorInput = document.getElementById("driverColor");
const driverPlateInput = document.getElementById("driverPlate");
const acceptBtn = document.getElementById("acceptBtn");   // ✅ ADD THIS
const offerInfo = document.getElementById("offerInfo");

const OFFER_TIMEOUT_MS = 25000; // 25 seconds (tweak later)

console.log("✅ app.js module loaded");   // ✅ ADD THIS

// Simple MVP PIN
const DOORMAN_PIN = "1688";

// Notification tone helper
function playBeep() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = 880; // tone pitch
    gain.gain.value = 0.08;

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, 250);
  } catch (e) {
    // If browser blocks audio, just ignore
  }
}

// Safety check
if (
  !driverNameInput || !queueList || !joinBtn || !leaveBtn || !callNextBtn ||
  !doormanPinInput || !completeBtn || !calledBox || !driverColorInput ||
  !driverPlateInput || !acceptBtn || !offerInfo
) {
  alert("HTQS setup error: HTML element IDs do not match app.js.");
}

// 1) Driver joins queue -> push to DB
async function joinQueue() {
  const name = (driverNameInput.value || "").trim();
  const color = (driverColorInput.value || "").trim();
  const plate = (driverPlateInput.value || "").trim();

  if (!name) return alert("Enter your name");
  if (!color) return alert("Enter your car color");
  if (!plate) return alert("Enter your plate (or last 4)");

  await push(queueRef, {
    name,
    carColor: color,
    plate,
    status: "WAITING",
    joinedAt: Date.now()
  });

  driverColorInput.value = "";
// keep name + plate so Accept can match
}

// 2) Driver leaves queue -> remove first matching name + plate
async function leaveQueue() {
  const name = (driverNameInput.value || "").trim();
  const plate = (driverPlateInput.value || "").trim();

  if (!name) return alert("Enter your name to leave");
  if (!plate) return alert("Enter your plate (or last 4) to leave");

  const snapshot = await get(queueRef);
  if (!snapshot.exists()) return alert("Queue is empty");

  const data = snapshot.val();
  const entries = Object.entries(data);

  const found = entries.find(([key, value]) => {
    const dbName = (value.name || "").toLowerCase();
    const dbPlate = (value.plate || "").toLowerCase();
    return dbName === name.toLowerCase() && dbPlate === plate.toLowerCase();
  });

  if (!found) return alert("Driver not found (check name + plate)");

  const [keyToRemove] = found;
  await remove(ref(db, `queue/${keyToRemove}`));

  alert("Removed from queue.");
}

// Helper: find the "current" OFFERED driver (earliest offerStartedAt)
function getCurrentOffered(entries) {
  const offered = entries
    .filter(([k, v]) => (v.status || "WAITING") === "OFFERED")
    .sort((a, b) => (a[1].offerStartedAt ?? 0) - (b[1].offerStartedAt ?? 0));
  return offered.length ? offered[0] : null;
}

// 3) Doorman offers next (FIFO) -> status = OFFERED
async function callNext() {
  const pin = (doormanPinInput.value || "").trim();
  if (pin !== DOORMAN_PIN) return alert("Invalid PIN. Doorman only.");

  const snapshot = await get(queueRef);
  if (!snapshot.exists()) return alert("No drivers waiting.");

  const data = snapshot.val();
  const entries = Object.entries(data);

  // Only ONE active offer at a time
  const currentOffer = getCurrentOffered(entries);
  if (currentOffer) return alert("There is already an OFFERED driver. Wait for accept/timeout.");

  const waiting = entries
    .filter(([k, v]) => (v.status || "WAITING") === "WAITING")
    .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));

  if (waiting.length === 0) return alert("No WAITING drivers.");

  const [firstKey] = waiting[0];
  const now = Date.now();

  await update(ref(db, `queue/${firstKey}`), {
    status: "OFFERED",
    offerStartedAt: now,
    offerExpiresAt: now + OFFER_TIMEOUT_MS
  });

  // IMPORTANT: no alert() here
}

let offeredCache = null; // { key, val } or null

function refreshAcceptUI() {
  acceptBtn.disabled = true;
  offerInfo.textContent = "";

  if (!offeredCache) return;

  const v = offeredCache.val;

  const inputName = (driverNameInput.value || "").trim().toLowerCase();
  const inputPlate = (driverPlateInput.value || "").trim().toLowerCase();

  const isMe =
    inputName && inputPlate &&
    (v.name || "").toLowerCase() === inputName &&
    (v.plate || "").toLowerCase() === inputPlate;

  if (isMe) {
    acceptBtn.disabled = false;
    offerInfo.textContent = "You have an active offer. Click Accept.";
  }
}

// Driver clicks Accept Ride -> status = ACCEPTED
async function acceptRide() {
  const name = (driverNameInput.value || "").trim();
  const plate = (driverPlateInput.value || "").trim();

  if (!name || !plate) return alert("Enter your name + plate to accept.");

  const snapshot = await get(queueRef);
  if (!snapshot.exists()) return alert("Queue is empty.");

  const data = snapshot.val();
  const entries = Object.entries(data);

  const currentOffer = getCurrentOffered(entries);
  if (!currentOffer) return alert("No ride is being offered right now.");

  const [offerKey, offerVal] = currentOffer;

  const offerName = (offerVal.name || "").toLowerCase();
  const offerPlate = (offerVal.plate || "").toLowerCase();

  if (offerName !== name.toLowerCase() || offerPlate !== plate.toLowerCase()) {
    return alert("This offer is not for you (name/plate mismatch).");
  }

  // Expired?
  if (offerVal.offerExpiresAt && Date.now() > offerVal.offerExpiresAt) {
    return alert("Offer expired. Wait for next offer.");
  }

  await update(ref(db, `queue/${offerKey}`), {
    status: "ACCEPTED",
    acceptedAt: Date.now()
  });
}

// Doorman completes -> remove ACCEPTED driver
async function completePickup() {
  const pin = (doormanPinInput.value || "").trim();
  if (pin !== DOORMAN_PIN) return alert("Invalid PIN. Doorman only.");

  const snapshot = await get(queueRef);
  if (!snapshot.exists()) return alert("Queue is empty");

  const data = snapshot.val();
  const entries = Object.entries(data);

  const accepted = entries
    .filter(([k, v]) => (v.status || "WAITING") === "ACCEPTED")
    .sort((a, b) => (a[1].acceptedAt ?? 0) - (b[1].acceptedAt ?? 0));

  offeredCache = offered.length ? { key: offered[0][0], val: offered[0][1] } : null;
refreshAcceptUI();
   %       
  if (accepted.length === 0) return alert("No ACCEPTED driver to complete.");

  const [acceptedKey, acceptedVal] = accepted[0];
  await remove(ref(db, `queue/${acceptedKey}`));

  alert(`Completed pickup: ${acceptedVal.name}`);
}

// 4) Live listener -> render queue for everyone in real time
let lastBeepKey = null;
let offeredCache = null;

onValue(queueRef, (snapshot) => {
  queueList.innerHTML = "";
  calledBox.innerHTML = "";
  offerInfo.textContent = "";
  acceptBtn.disabled = true;

  if (!snapshot.exists()) {
    queueList.innerHTML = "<li>(No drivers waiting)</li>";
    calledBox.innerHTML = "<strong>Now Offering:</strong> (none)";
    return;
  }

  const now = Date.now();
  const data = snapshot.val();
  const entries = Object.entries(data);

  // Auto-timeout OFFERED -> back to WAITING
  entries.forEach(([k, v]) => {
    if ((v.status || "WAITING") === "OFFERED" && v.offerExpiresAt && now > v.offerExpiresAt) {
      update(ref(db, `queue/${k}`), {
        status: "WAITING",
        offerStartedAt: null,
        offerExpiresAt: null
      });
    }
  });

  // Sort FIFO by joinedAt
  entries.sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));

  // Render list
  entries.forEach(([key, value], index) => {
    const name = value.name || "(no name)";
    const color = value.carColor || "(color?)";
    const plate = value.plate || "(plate?)";
    const status = value.status || "WAITING";

    const li = document.createElement("li");
    li.innerHTML = `${index + 1}. ${name} — ${color} / ${plate} <span class="statusTag">${status}</span>`;
    queueList.appendChild(li);
  });

  // Find active OFFERED (if any)
 const offered = entries
  const offered = entries
  .filter(([k, v]) => (v.status || "WAITING") === "OFFERED" && (v.offerExpiresAt ?? 0) > now)
  .sort((a, b) => (a[1].offerStartedAt ?? 0) - (b[1].offerStartedAt ?? 0));

offeredCache = offered.length
  ? { key: offered[0][0], val: offered[0][1] }
  : null;

refreshAcceptUI();
offeredCache = offered.length
  ? { key: offered[0][0], val: offered[0][1] }
  : null;

function refreshAcceptUI() {
  acceptBtn.disabled = true;
  offerInfo.textContent = "";

  if (!offeredCache) return;

  const v = offeredCache.val;

 
  const inputPlate = (driverPlateInput.value || "").trim().toLowerCase();

  const isMe =
    inputName && inputPlate &&
    (v.name || "").toLowerCase() === inputName &&
    (v.plate || "").toLowerCase() === inputPlate;

 
}
});

// Wire buttons
joinBtn.addEventListener("click", joinQueue);
leaveBtn.addEventListener("click", leaveQueue);
callNextBtn.addEventListener("click", callNext);
completeBtn.addEventListener("click", completePickup);
acceptBtn.addEventListener("click", acceptRide);
driverNameInput.addEventListener("input", refreshAcceptUI);
driverPlateInput.addEventListener("input", refreshAcceptUI);
// Enter to join
driverNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinQueue();
});
