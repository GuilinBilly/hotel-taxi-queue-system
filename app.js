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

function refreshAcceptUI() {
  // Default state
  acceptBtn.disabled = true;
  offerInfo.textContent = "";

  // No active offer -> nothing to accept
  if (!offeredCache) return;

  const v = offeredCache.val;

  // What the driver typed
  const inputName = (driverNameInput.value || "").trim().toLowerCase();
  const inputPlate = (driverPlateInput.value || "").trim().toLowerCase();

  // Does this offer belong to this driver?
  const isMe =
    inputName &&
    inputPlate &&
    (v.name || "").toLowerCase() === inputName &&
    (v.plate || "").toLowerCase() === inputPlate;

  if (isMe) {
    acceptBtn.disabled = false;
    offerInfo.textContent = "You have an active offer. Click Accept Ride.";
  }
}
async function joinQueue() {
  const name = driverNameInput.value.trim();
  const color = driverColorInput.value.trim();
  const plate = driverPlateInput.value.trim();
  if (!name || !color || !plate) return alert("Fill all fields");
  await push(queueRef, { name, carColor: color, plate, status: "WAITING", joinedAt: Date.now() });
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
  const entries = Object.entries(snap.val())
    .filter(([k,v])=>v.status==="WAITING")
    .sort((a,b)=>a[1].joinedAt-b[1].joinedAt);
  if (!entries.length) return;
  const now = Date.now();
 await update(ref(db,"queue/"+entries[0][0]), {
  status: "OFFERED",
  offerStartedAt: now,
  offerExpiresAt: now + OFFER_TIMEOUT_MS
});
}

async function acceptRide(){
  if(!offeredCache) return alert("No offer");
  await update(ref(db,"queue/"+offeredCache.key),{status:"ACCEPTED"});
}

async function completePickup(){
  if (doormanPinInput.value.trim()!==DOORMAN_PIN) return;
  const snap=await get(queueRef);
  if(!snap.exists())return;
  const acc=Object.entries(snap.val()).find(([k,v])=>v.status==="ACCEPTED");
  if(acc) await remove(ref(db,"queue/"+acc[0]));
}

onValue(queueRef,(snap)=>{
  queueList.innerHTML="";
  calledBox.innerHTML="";
  offeredCache=null;
  if(!snap.exists())return;
  const now=Date.now();
  const entries=Object.entries(snap.val());
  entries.forEach(([k,v])=>{
    if(v.status==="OFFERED" && v.offerExpiresAt<now){
      update(ref(db,"queue/"+k),{status:"WAITING",offerExpiresAt:null});
    }
  });
  entries.sort((a,b)=>a[1].joinedAt-b[1].joinedAt);
  entries.forEach(([k,v],i)=>{
    const li=document.createElement("li");
    li.textContent=`${i+1}. ${v.name} ${v.carColor} ${v.plate} ${v.status}`;
    queueList.appendChild(li);
    // Find active OFFERED (if any) and cache it
const offered = entries
  .filter(([k, v]) => v.status === "OFFERED" && (v.offerExpiresAt ?? 0) > now)
  .sort((a, b) => (a[1].offerStartedAt ?? 0) - (b[1].offerStartedAt ?? 0));

offeredCache = offered.length
  ? { key: offered[0][0], val: offered[0][1] }
  : null;

refreshAcceptUI();

calledBox.textContent = offeredCache
  ? "Now Offering: " + offeredCache.val.name
  : "";
});

joinBtn.onclick = joinQueue;
leaveBtn.onclick = leaveQueue;
callNextBtn.onclick = callNext;
acceptBtn.onclick = acceptRide;
completeBtn.onclick = completePickup;

driverNameInput.oninput = refreshAcceptUI;
driverPlateInput.oninput = refreshAcceptUI;
