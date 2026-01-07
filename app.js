let queue = [];

function joinQueue() {
  const name = document.getElementById("driverName").value;
  if (!name) return alert("Enter your name");
  queue.push(name);
  updateQueue();
  document.getElementById("driverName").value = "";
}

function callNext() {
  if (queue.length === 0) return alert("No drivers waiting");
  alert(queue.shift() + " please go to hotel entrance");
  updateQueue();
}

function updateQueue() {
  const list = document.getElementById("queueList");
  list.innerHTML = "";
  queue.forEach((d, i) => {
    list.innerHTML += `<li>${i + 1}. ${d}</li>`;
  });
}
