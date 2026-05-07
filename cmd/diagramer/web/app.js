const NODE_W = 140;
const NODE_H = 44;

const canvas = document.getElementById("canvas");
const edgesLayer = document.getElementById("edges");
const nodesLayer = document.getElementById("nodes");
const addBtn = document.getElementById("add-box");
const connectBtn = document.getElementById("connect-mode");
const deleteBtn = document.getElementById("delete");
const statusEl = document.getElementById("status");

let diagram = null;
let selectedId = null;
let connecting = false;
let connectSource = null;
let dragging = null;
let saveTimer = null;

function setStatus(msg) {
  statusEl.textContent = msg;
  if (msg) clearTimeout(setStatus._t);
  setStatus._t = setTimeout(() => (statusEl.textContent = ""), 1500);
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

async function init() {
  let list = await api("GET", "/api/diagrams");
  if (!list || list.length === 0) {
    const created = await api("POST", "/api/diagrams", { name: "Untitled" });
    diagram = await api("GET", `/api/diagrams/${created.id}`);
  } else {
    diagram = await api("GET", `/api/diagrams/${list[0].id}`);
  }
  render();
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await api("PUT", `/api/diagrams/${diagram.id}`, {
        name: diagram.name,
        nodes: diagram.nodes,
        edges: diagram.edges,
        viewport: diagram.viewport,
      });
      setStatus("saved");
    } catch (e) {
      setStatus("save failed");
      console.error(e);
    }
  }, 200);
}

function center(node) {
  return { x: node.position.x + NODE_W / 2, y: node.position.y + NODE_H / 2 };
}

function render() {
  edgesLayer.innerHTML = "";
  nodesLayer.innerHTML = "";

  for (const e of diagram.edges) {
    const a = diagram.nodes.find((n) => n.id === e.source);
    const b = diagram.nodes.find((n) => n.id === e.target);
    if (!a || !b) continue;
    const ca = center(a);
    const cb = center(b);
    const line = svg("line", {
      class: "edge",
      x1: ca.x, y1: ca.y, x2: cb.x, y2: cb.y,
    });
    edgesLayer.appendChild(line);
  }

  for (const n of diagram.nodes) {
    const g = svg("g", {
      class: "node" +
        (n.id === selectedId ? " selected" : "") +
        (n.id === connectSource ? " connect-source" : ""),
      "data-id": n.id,
      transform: `translate(${n.position.x},${n.position.y})`,
    });
    g.appendChild(svg("rect", { width: NODE_W, height: NODE_H }));
    const t = svg("text", { x: NODE_W / 2, y: NODE_H / 2 + 4, "text-anchor": "middle" });
    t.textContent = n.data.label || "";
    g.appendChild(t);
    nodesLayer.appendChild(g);
  }

  deleteBtn.disabled = selectedId === null;
  connectBtn.classList.toggle("active", connecting);
  canvas.classList.toggle("connecting", connecting);
}

function svg(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function clientToCanvas(evt) {
  const rect = canvas.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}

addBtn.addEventListener("click", () => {
  const label = prompt("Box text:");
  if (label === null) return;
  const rect = canvas.getBoundingClientRect();
  const x = rect.width / 2 - NODE_W / 2 + (Math.random() - 0.5) * 80;
  const y = rect.height / 2 - NODE_H / 2 + (Math.random() - 0.5) * 80;
  diagram.nodes.push({
    id: uid(),
    position: { x, y },
    data: { label: label.trim() || "Untitled" },
  });
  save();
  render();
});

connectBtn.addEventListener("click", () => {
  connecting = !connecting;
  connectSource = null;
  selectedId = null;
  render();
});

deleteBtn.addEventListener("click", () => {
  if (!selectedId) return;
  diagram.nodes = diagram.nodes.filter((n) => n.id !== selectedId);
  diagram.edges = diagram.edges.filter(
    (e) => e.source !== selectedId && e.target !== selectedId
  );
  selectedId = null;
  save();
  render();
});

canvas.addEventListener("mousedown", (evt) => {
  const nodeEl = evt.target.closest(".node");

  if (!nodeEl) {
    selectedId = null;
    connectSource = null;
    render();
    return;
  }

  const id = nodeEl.dataset.id;

  if (connecting) {
    if (!connectSource) {
      connectSource = id;
      render();
    } else if (connectSource !== id) {
      diagram.edges.push({ id: uid(), source: connectSource, target: id });
      connectSource = null;
      save();
      render();
    }
    return;
  }

  selectedId = id;
  const node = diagram.nodes.find((n) => n.id === id);
  const p = clientToCanvas(evt);
  dragging = {
    id,
    offsetX: p.x - node.position.x,
    offsetY: p.y - node.position.y,
    moved: false,
  };
  render();
});

window.addEventListener("mousemove", (evt) => {
  if (!dragging) return;
  const node = diagram.nodes.find((n) => n.id === dragging.id);
  if (!node) return;
  const p = clientToCanvas(evt);
  node.position.x = p.x - dragging.offsetX;
  node.position.y = p.y - dragging.offsetY;
  dragging.moved = true;
  render();
});

window.addEventListener("mouseup", () => {
  if (!dragging) return;
  if (dragging.moved) save();
  dragging = null;
});

init().catch((e) => {
  console.error(e);
  setStatus("failed to load");
});
