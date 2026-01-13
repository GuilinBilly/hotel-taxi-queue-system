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
const acceptBtn = document.getElementById("acceptBtn");
const offerInfo = document.getElementById("offerInfo");

const OFFER_TIMEOUT_MS = 25000; // 25 seconds (tweak later)

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
if (!driverNameInput || !queueList || !joinBtn || !leaveBtn || !callNextBtn ||
    !doormanPinInput || !completeBtn || !calledBox || !driverColorInput ||
    !driverPlateInput || !acceptBtn || !offerInfo) {
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
  carColor: (driverColorInput.value || "").trim(),
  plate: (driverPlateInput.value || "").trim(),
  status: "WAITING",
  joinedAt: Date.now()
});

driverNameInput.value = "";
driverColorInput.value = "";
driverPlateInput.value = "";
}
// 2) Driver leaves queue -> remove first matching name
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
// 3) Doorman calls next -> mark earliest WAITING as CALLED (FIFO)
async function callNext() {
  const pin = (doormanPinInput.value || "").trim();
  if (pin !== DOORMAN_PIN) return alert("Invalid PIN. Doorman only.");

  const snapshot = await get(queueRef);
  if (!snapshot.exists()) return alert("No drivers waiting");

  const now = Date.now();
  const data = snapshot.val();
  const entries = Object.entries(data);

  // 1) Auto-expire any old OFFERED
  const expiredOffers = entries.filter(([k, v]) =>
    v.status === "OFFERED" && (v.offerExpiresAt ?? 0) <= now
  );

  for (const [k] of expiredOffers) {
    await update(ref(db, `queue/${k}`), {
      status: "WAITING",
      offerExpiresAt: null,
      offeredAt: null
    });
  }

  // Refresh local entries after cleanup (simple approach: reuse entries but ignore expired)
  const activeOffer = entries.find(([k, v]) =>
    v.status === "OFFERED" && (v.offerExpiresAt ?? 0) > now
  );

  // Rule: Only one active offer at a time (simple + realistic)
  if (activeOffer) {
    const [, v] = activeOffer;
    return alert(`Waiting for driver to accept: ${v.name}`);
  }

  // 2) Pick first WAITING (FIFO)
  const waiting = entries
    .filter(([k, v]) => (v.status || "WAITING") === "WAITING")
    .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));

  if (waiting.length === 0) return alert("No WAITING drivers.");

  const [firstKey, firstValue] = waiting[0];

  // 3) Mark as OFFERED with timeout
  await update(ref(db, `queue/${firstKey}`), {
    status: "OFFERED",
    offeredAt: now,
    offerExpiresAt: now + OFFER_TIMEOUT_MS
  });

  alert(`Offer sent to: ${firstValue.name} (expires in ${Math.round(OFFER_TIMEOUT_MS/1000)}s)`);
}

async function acceptOffer() {
  const name = (driverNameInput.value || "").trim();
  const plate = (driverPlateInput.value || "").trim();

  if (!name || !plate) return alert("Enter your name + plate to accept.");

  const snapshot = await get(queueRef);
  if (!snapshot.exists()) return alert("Queue is empty");

  const now = Date.now();
  const data = snapshot.val();
  const entries = Object.entries(data);

  // Find OFFERED match by name+plate
  const match = entries.find(([k, v]) =>
    (v.status === "OFFERED") &&
    ((v.offerExpiresAt ?? 0) > now) &&
    ((v.name || "").toLowerCase() === name.toLowerCase()) &&
    ((v.plate || "").toLowerCase() === plate.toLowerCase())
  );

  if (!match) return alert("No active offer found for this name + plate.");

  const [key] = match;

  await update(ref(db, `queue/${key}`), {
    status: "ACCEPTED",
    acceptedAt: now
  });

  alert("Offer accepted. Proceed to hotel entrance.");
}

async function completePickup() {
  const pin = (doormanPinInput.value || "").trim();
  if (pin !== DOORMAN_PIN) return alert("Invalid PIN. Doorman only.");

  const snapshot = await get(queueRef);
  if (!snapshot.exists()) return alert("Queue is empty");

  const data = snapshot.val();
  const entries = Object.entries(data);

  const called = entries
    .filter(([key, value]) => (value.status || "WAITING") === "CALLED")
    .sort((a, b) => (a[1].calledAt ?? 0) - (b[1].calledAt ?? 0));

  if (called.length === 0) return alert("No CALLED driver to complete.");

  const [calledKey, calledValue] = called[0];

  await remove(ref(db, `queue/${calledKey}`));
  alert(`Completed pickup: ${calledValue.name}`);
}

// 4) Live listener -> render queue for everyone in real time
let lastBeepKey = null;

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
    .filter(([k, v]) => v.status === "OFFERED" && (v.offerExpiresAt ?? 0) > now)
    .sort((a, b) => (a[1].offeredAt ?? 0) - (b[1].offeredAt ?? 0));

  if (offered.length === 0) {
    calledBox.innerHTML = "<strong>Now Offering:</strong> (none)";
  } else {
    const [k, v] = offered[0];
    const remainingMs = Math.max(0, (v.offerExpiresAt ?? now) - now);
    const remainingSec = Math.ceil(remainingMs / 1000);

    calledBox.innerHTML =
      `<strong>Now Offering:</strong> ${v.name} — ${v.carColor || ""} / ${v.plate || ""} ` +
      `<span class="statusTag">OFFERED</span> (expires in ${remainingSec}s)`;

    // If this page is "the offered driver", enable Accept + beep once
    const inputName = (driverNameInput.value || "").trim().toLowerCase();
    const inputPlate = (driverPlateInput.value || "").trim().toLowerCase();
    const isMe = inputName && inputPlate &&
      (v.name || "").toLowerCase() === inputName &&
      (v.plate || "").toLowerCase() === inputPlate;

    if (isMe) {
      acceptBtn.disabled = false;
      offerInfo.textContent = "You have an active offer. Click Accept.";
      if (lastBeepKey !== k) {
        playBeep();
        lastBeepKey = k;
      }
    }
  }
});
// Wire buttons
joinBtn.addEventListener("click", joinQueue);
leaveBtn.addEventListener("click", leaveQueue);
callNextBtn.addEventListener("click", callNext);
acceptBtn.addEventListener("click", acceptOffer);
completeBtn.addEventListener("click", completePickup);

// Enter to join
driverNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinQueue();
});
