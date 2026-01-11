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
// Simple MVP PIN
const DOORMAN_PIN = "1688";

// Safety check
if (!driverNameInput || !queueList || !joinBtn || !leaveBtn || !callNextBtn || !doormanPinInput || !completeBtn || !calledBox) {
  alert("HTQS setup error: HTML element IDs do not match app.js.");
}

// 1) Driver joins queue -> push to DB
async function joinQueue() {
  const name = (driverNameInput.value || "").trim();
  if (!name) return alert("Enter your name");

  await push(queueRef, {
  name,
  status: "WAITING",
  joinedAt: Date.now()
});

  driverNameInput.value = "";
}

// 2) Driver leaves queue -> remove first matching name
async function leaveQueue() {
  const name = (driverNameInput.value || "").trim();
  if (!name) return alert("Enter your name to leave the queue");

  const snapshot = await get(queueRef);
  if (!snapshot.exists()) return alert("Queue is empty");

  const data = snapshot.val();
  const entries = Object.entries(data);

  const found = entries.find(([key, value]) =>
    (value.name || "").toLowerCase() === name.toLowerCase()
  );

  if (!found) return alert("Name not found in queue");

  const [keyToRemove] = found;
  await remove(ref(db, `queue/${keyToRemove}`));

  alert("Removed from queue.");
}

// 3) Doorman calls next -> remove earliest item (FIFO)
async function callNext() {
  const pin = (doormanPinInput.value || "").trim();
  if (pin !== DOORMAN_PIN) return alert("Invalid PIN. Doorman only.");

  const snapshot = await get(queueRef);
  if (!snapshot.exists()) return alert("No drivers waiting");

  const data = snapshot.val();
  const entries = Object.entries(data);

  // Only pick drivers that are still WAITING
  const waiting = entries
    .filter(([key, value]) => (value.status || "WAITING") === "WAITING")
    .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));

  if (waiting.length === 0) return alert("No WAITING drivers. (Someone is already CALLED.)");

  const [firstKey, firstValue] = waiting[0];

  // Mark as CALLED
  await update(ref(db, `queue/${firstKey}`), {
    status: "CALLED",
    calledAt: Date.now()
  });

  alert(`${firstValue.name} please go to hotel entrance`);
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
onValue(queueRef, (snapshot) => {
  queueList.innerHTML = "";

  if (!snapshot.exists()) {
    queueList.innerHTML = "<li>(No drivers waiting)</li>";
    return;
  }

  const data = snapshot.val();
  const entries = Object.entries(data);

  entries.sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));

  entries.forEach(([key, value], index) => {
    const li = document.createElement("li");
    li.textContent = `${index + 1}. ${value.name}`;
    queueList.appendChild(li);
  });
});

// Wire buttons
joinBtn.addEventListener("click", joinQueue);
leaveBtn.addEventListener("click", leaveQueue);
callNextBtn.addEventListener("click", callNext);

// Enter to join
driverNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinQueue();
});
