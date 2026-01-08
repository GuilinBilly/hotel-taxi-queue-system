// Firebase (modular SDK) - CDN imports (works with plain HTML + Vercel)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  ref,
  push,
  onValue,
  remove,
  get,
  child
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

// Your Firebase config (from your console)
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

// Quick sanity check (if any are null, buttons won't work)
console.log({
  driverNameInput,
  queueList,
  joinBtn,
  leaveBtn,
  callNextBtn,
  doormanPinInput
});

if (!driverNameInput || !queueList || !joinBtn || !leaveBtn || !callNextBtn || !doormanPinInput) {
  alert("HTQS setup error: one or more HTML element IDs do not match app.js. Check console.");
}

// Simple MVP PIN
const DOORMAN_PIN = "1688";

// 1) Driver joins queue -> push to DB
async function joinQueue() {
  const name = (driverNameInput.value || "").trim();
  if (!name) return alert("Enter your name");

  await push(queueRef, {
    name,
    joinedAt: Date.now()
  });

  driverNameInput.value = "";
}
// 2) Driver leaves queue
async function leaveQueue() {
  const name = (driverNameInput.value || "").trim();
  if (!name) return alert("Enter your name to leave the queue");

  const snapshot = await get(queueRef);
  if (!snapshot.exists()) return alert("Queue is empty");

  const data = snapshot.val();
  const entries = Object.entries(data);

  // find the first matching name (case-insensitive)
  const found = entries.find(([key, value]) =>
    (value.name || "").toLowerCase() === name.toLowerCase()
  );

  if (!found) return alert("Name not found in queue");

  const [keyToRemove] = found;
  await remove(ref(db, `queue/${keyToRemove}`));

  alert("Removed from queue.");
}
// 2) Doorman calls next -> remove earliest item (FIFO)
async function callNext() {
  const pin = (doormanPinInput.value || "").trim();
  if (pin !== DOORMAN_PIN) return alert("Invalid PIN. Doorman only.");

  const snapshot = await get(queueRef);
  if (!snapshot.exists()) return alert("No drivers waiting");

  // ... keep the rest the same
}
async function callNext() {
  const snapshot = await get(queueRef);
  if (!snapshot.exists()) return alert("No drivers waiting");

  const data = snapshot.val(); // { key1: {name, joinedAt}, key2: ... }
  const entries = Object.entries(data);

  // Sort by joinedAt to ensure FIFO
  entries.sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));

  const [firstKey, firstValue] = entries[0];

  alert(`${firstValue.name} please go to hotel entrance`);

  // Remove that driver from queue
  await remove(ref(db, `queue/${firstKey}`));
}

// 3) Live listener -> render queue for everyone in real time
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

// Optional: press Enter to join
driverNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinQueue();
});
