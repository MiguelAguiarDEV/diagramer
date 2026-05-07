const NODE_H = 44;
const NODE_PAD_X = 16;
const NODE_MIN_W = 80;
const NODE_MAX_W = 320;
const NODE_FONT = "13px system-ui, sans-serif";

const _measureCtx = document.createElement("canvas").getContext("2d");
_measureCtx.font = NODE_FONT;

function nodeWidth(node) {
  const label = node.data.label || "";
  const w = _measureCtx.measureText(label).width + NODE_PAD_X * 2;
  return Math.max(NODE_MIN_W, Math.min(NODE_MAX_W, Math.ceil(w)));
}

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
  return { x: node.position.x + nodeWidth(node) / 2, y: node.position.y + NODE_H / 2 };
}

// Returns the midpoint of the node's side that faces `target` (a {x,y} point).
// Picking sides (top/right/bottom/left) by comparing dx/w vs dy/h projects
// each box onto its diagonal so connections always meet a side cleanly.
function sideAnchor(node, target) {
  const w = nodeWidth(node);
  const c = { x: node.position.x + w / 2, y: node.position.y + NODE_H / 2 };
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  if (Math.abs(dx) * NODE_H >= Math.abs(dy) * w) {
    return dx >= 0
      ? { x: node.position.x + w, y: c.y }
      : { x: node.position.x, y: c.y };
  }
  return dy >= 0
    ? { x: c.x, y: node.position.y + NODE_H }
    : { x: c.x, y: node.position.y };
}

function render() {
  edgesLayer.innerHTML = "";
  nodesLayer.innerHTML = "";

  for (const e of diagram.edges) {
    const a = diagram.nodes.find((n) => n.id === e.source);
    const b = diagram.nodes.find((n) => n.id === e.target);
    if (!a || !b) continue;
    const pa = sideAnchor(a, center(b));
    const pb = sideAnchor(b, center(a));
    const line = svg("line", {
      class: "edge",
      "marker-end": "url(#arrow)",
      x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y,
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
    const w = nodeWidth(n);
    g.appendChild(svg("rect", { width: w, height: NODE_H }));
    const t = svg("text", { x: w / 2, y: NODE_H / 2 + 4, "text-anchor": "middle" });
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
  const x = rect.width / 2 - NODE_MIN_W / 2 + (Math.random() - 0.5) * 80;
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
