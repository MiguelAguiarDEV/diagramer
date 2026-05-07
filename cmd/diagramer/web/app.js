const NODE_H = 44;
const NODE_PAD_X = 20;
const NODE_MIN_W = 80;
const NODE_MAX_W = 320;
const NODE_FONT = "13px system-ui, sans-serif";

const _measureCtx = document.createElement("canvas").getContext("2d");
_measureCtx.font = NODE_FONT;

function nodeWidth(node) {
  const label = node.data.label || "";
  // Canvas measureText doesn't exactly match the SVG text render so we add a
  // small safety buffer (8 px) on top of the symmetric horizontal padding.
  const w = _measureCtx.measureText(label).width + NODE_PAD_X * 2 + 8;
  return Math.max(NODE_MIN_W, Math.min(NODE_MAX_W, Math.ceil(w)));
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.1;

const canvas = document.getElementById("canvas");
const viewportLayer = document.getElementById("viewport");
const edgesLayer = document.getElementById("edges");
const nodesLayer = document.getElementById("nodes");
const addBtn = document.getElementById("add-box");
const connectBtn = document.getElementById("connect-mode");
const deleteBtn = document.getElementById("delete");
const statusEl = document.getElementById("status");
const editorEl = document.getElementById("node-editor");
console.log("[editor] element lookup:", editorEl);

let diagram = null;
let selectedId = null;
let selectedEdgeId = null;
let connecting = false;
let connectSource = null;
let dragging = null;
let panning = null;
let pendingEdge = null;
let editing = null;
let saveTimer = null;

function setStatus(msg) {
  statusEl.textContent = msg;
  if (msg) clearTimeout(setStatus._t);
  setStatus._t = setTimeout(() => (statusEl.textContent = ""), 1500);
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// True if a connection already exists between the two nodes in either
// direction. Bidirectional duplicates aren't supported yet.
function edgeExists(srcId, tgtId) {
  return diagram.edges.some(
    (e) =>
      (e.source === srcId && e.target === tgtId) ||
      (e.source === tgtId && e.target === srcId)
  );
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
    const isSel = e.id === selectedEdgeId;
    const eg = svg("g", {
      class: "edge-group" + (isSel ? " selected" : ""),
      "data-id": e.id,
    });
    // Invisible thick hit area to make edges easy to click.
    eg.appendChild(svg("line", {
      class: "edge-hit",
      x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y,
    }));
    eg.appendChild(svg("line", {
      class: "edge",
      "marker-end": isSel ? "url(#arrow-selected)" : "url(#arrow)",
      x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y,
    }));
    edgesLayer.appendChild(eg);
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
    // n8n-style "+" handle on the right side; visible on hover/select via CSS.
    const handle = svg("g", { class: "conn-handle", "data-id": n.id });
    handle.appendChild(svg("rect", {
      x: w + 6, y: NODE_H / 2 - 8, width: 16, height: 16, rx: 3,
    }));
    const ht = svg("text", {
      x: w + 14, y: NODE_H / 2 + 4, "text-anchor": "middle",
    });
    ht.textContent = "+";
    handle.appendChild(ht);
    g.appendChild(handle);

    const t = svg("text", { x: w / 2, y: NODE_H / 2 + 4, "text-anchor": "middle" });
    t.textContent = n.data.label || "";
    g.appendChild(t);
    nodesLayer.appendChild(g);
  }

  if (editing) positionEditor();

  deleteBtn.disabled = selectedId === null && selectedEdgeId === null;
  connectBtn.classList.toggle("active", connecting);
  canvas.classList.toggle("connecting", connecting);
  applyViewport();
  syncPendingEdge();
}

// Draws (or removes) the ghost line shown while dragging from a "+" handle.
function syncPendingEdge() {
  let line = edgesLayer.querySelector(".pending-edge");
  if (!pendingEdge) {
    if (line) line.remove();
    return;
  }
  const src = diagram.nodes.find((n) => n.id === pendingEdge.sourceId);
  if (!src) return;
  const a = sideAnchor(src, pendingEdge.cursor);
  if (!line) {
    line = svg("line", { class: "pending-edge", "marker-end": "url(#arrow)" });
    edgesLayer.appendChild(line);
  }
  line.setAttribute("x1", a.x);
  line.setAttribute("y1", a.y);
  line.setAttribute("x2", pendingEdge.cursor.x);
  line.setAttribute("y2", pendingEdge.cursor.y);
}

function applyViewport() {
  const { x, y, zoom } = diagram.viewport;
  viewportLayer.setAttribute("transform", `translate(${x},${y}) scale(${zoom})`);
  if (editing) positionEditor();
}

function svg(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function clientToModel(evt) {
  const rect = canvas.getBoundingClientRect();
  const sx = evt.clientX - rect.left;
  const sy = evt.clientY - rect.top;
  const { x, y, zoom } = diagram.viewport;
  return { x: (sx - x) / zoom, y: (sy - y) / zoom };
}

addBtn.addEventListener("click", () => {
  const label = prompt("Box text:");
  if (label === null) return;
  // Drop the new box near the centre of the visible viewport, in model coords.
  const rect = canvas.getBoundingClientRect();
  const { x: vx, y: vy, zoom } = diagram.viewport;
  const mx = (rect.width / 2 - vx) / zoom;
  const my = (rect.height / 2 - vy) / zoom;
  const x = mx - NODE_MIN_W / 2 + (Math.random() - 0.5) * 80;
  const y = my - NODE_H / 2 + (Math.random() - 0.5) * 80;
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

deleteBtn.addEventListener("click", deleteSelected);

function deleteSelected() {
  if (selectedEdgeId) {
    diagram.edges = diagram.edges.filter((e) => e.id !== selectedEdgeId);
    selectedEdgeId = null;
    save();
    render();
    return;
  }
  if (selectedId) {
    diagram.nodes = diagram.nodes.filter((n) => n.id !== selectedId);
    diagram.edges = diagram.edges.filter(
      (e) => e.source !== selectedId && e.target !== selectedId
    );
    selectedId = null;
    save();
    render();
  }
}

function positionEditor() {
  const node = diagram.nodes.find((n) => n.id === editing);
  if (!node) { console.warn("[positionEditor] node not found for editing id:", editing); return; }
  const w = nodeWidth(node);
  const { x: vx, y: vy, zoom } = diagram.viewport;
  const canvasRect = canvas.getBoundingClientRect();
  const sx = canvasRect.left + node.position.x * zoom + vx;
  const sy = canvasRect.top + node.position.y * zoom + vy;
  editorEl.style.left = sx + "px";
  editorEl.style.top = sy + "px";
  editorEl.style.width = (w * zoom) + "px";
  editorEl.style.height = (NODE_H * zoom) + "px";
  editorEl.style.fontSize = (13 * zoom) + "px";
  console.log("[positionEditor]", { sx, sy, w: w*zoom, h: NODE_H*zoom, hidden: editorEl.hidden });
}

function startEdit(id) {
  console.log("[startEdit] id:", id);
  const node = diagram.nodes.find((n) => n.id === id);
  if (!node) { console.warn("[startEdit] node not found"); return; }
  editing = id;
  selectedId = id;
  dragging = null;
  editorEl.value = node.data.label || "";
  editorEl.hidden = false;
  console.log("[startEdit] hidden after set:", editorEl.hidden, "value:", editorEl.value);
  positionEditor();
  // Defer focus one frame so layout settles before selecting the text.
  requestAnimationFrame(() => {
    editorEl.focus();
    editorEl.select();
    console.log("[startEdit rAF] focused, activeElement:", document.activeElement === editorEl);
  });
  render();
}

function commitEdit(value) {
  if (!editing) return;
  const node = diagram.nodes.find((n) => n.id === editing);
  if (node) {
    const v = (value || "").trim();
    if (v) node.data.label = v;
  }
  editing = null;
  editorEl.hidden = true;
  save();
  render();
}

function cancelEdit() {
  editing = null;
  editorEl.hidden = true;
  render();
}

editorEl.addEventListener("keydown", (ev) => {
  console.log("[editor keydown]", ev.key);
  if (ev.key === "Enter") { ev.preventDefault(); commitEdit(editorEl.value); }
  else if (ev.key === "Escape") { ev.preventDefault(); cancelEdit(); }
});
editorEl.addEventListener("blur", () => {
  console.log("[editor blur] editing:", editing);
  if (editing) commitEdit(editorEl.value);
});

canvas.addEventListener("mousedown", (evt) => {
  // Middle button starts a pan, regardless of what's under the cursor.
  if (evt.button === 1) {
    evt.preventDefault();
    panning = {
      sx: evt.clientX,
      sy: evt.clientY,
      vx: diagram.viewport.x,
      vy: diagram.viewport.y,
    };
    canvas.classList.add("panning");
    return;
  }
  // While editing, let the input handle its own clicks; ignore on canvas.
  if (evt.target.tagName === "INPUT") return;

  // n8n-style: clicking the "+" handle starts a pending edge from that node.
  const handleEl = evt.target.closest(".conn-handle");
  if (handleEl) {
    evt.stopPropagation();
    pendingEdge = { sourceId: handleEl.dataset.id, cursor: clientToModel(evt) };
    syncPendingEdge();
    return;
  }

  const nodeEl = evt.target.closest(".node");
  const edgeEl = evt.target.closest(".edge-group");

  // Double-click on a node enters in-place edit. Detected via evt.detail
  // because we re-render on every click, which destroys the target the
  // browser uses to correlate clicks for the native `dblclick` event.
  if (nodeEl && evt.detail >= 2) {
    console.log("[mousedown detail>=2 on node] starting edit", nodeEl.dataset.id);
    startEdit(nodeEl.dataset.id);
    return;
  }

  if (!nodeEl && !edgeEl) {
    selectedId = null;
    selectedEdgeId = null;
    connectSource = null;
    render();
    return;
  }

  if (edgeEl && !nodeEl) {
    selectedEdgeId = edgeEl.dataset.id;
    selectedId = null;
    connectSource = null;
    render();
    return;
  }

  const id = nodeEl.dataset.id;
  selectedEdgeId = null;

  if (connecting) {
    if (!connectSource) {
      connectSource = id;
      render();
    } else if (connectSource !== id) {
      if (edgeExists(connectSource, id)) {
        setStatus("already connected");
      } else {
        diagram.edges.push({ id: uid(), source: connectSource, target: id });
        save();
      }
      connectSource = null;
      render();
    }
    return;
  }

  selectedId = id;
  const node = diagram.nodes.find((n) => n.id === id);
  const p = clientToModel(evt);
  dragging = {
    id,
    offsetX: p.x - node.position.x,
    offsetY: p.y - node.position.y,
    moved: false,
  };
  render();
});

window.addEventListener("mousemove", (evt) => {
  if (panning) {
    diagram.viewport.x = panning.vx + (evt.clientX - panning.sx);
    diagram.viewport.y = panning.vy + (evt.clientY - panning.sy);
    applyViewport();
    return;
  }
  if (pendingEdge) {
    pendingEdge.cursor = clientToModel(evt);
    syncPendingEdge();
    return;
  }
  if (!dragging) return;
  const node = diagram.nodes.find((n) => n.id === dragging.id);
  if (!node) return;
  const p = clientToModel(evt);
  node.position.x = p.x - dragging.offsetX;
  node.position.y = p.y - dragging.offsetY;
  dragging.moved = true;
  render();
});

window.addEventListener("mouseup", (evt) => {
  if (panning) {
    panning = null;
    canvas.classList.remove("panning");
    save();
    return;
  }
  if (pendingEdge) {
    const targetNode = evt.target.closest && evt.target.closest(".node");
    if (targetNode) {
      const targetId = targetNode.dataset.id;
      if (targetId !== pendingEdge.sourceId) {
        if (edgeExists(pendingEdge.sourceId, targetId)) {
          setStatus("already connected");
        } else {
          diagram.edges.push({
            id: uid(),
            source: pendingEdge.sourceId,
            target: targetId,
          });
          save();
        }
      }
    }
    pendingEdge = null;
    render();
    return;
  }
  if (!dragging) return;
  if (dragging.moved) save();
  dragging = null;
});

canvas.addEventListener("wheel", (evt) => {
  evt.preventDefault();
  const oldZoom = diagram.viewport.zoom || 1;
  const factor = evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, oldZoom * factor));
  if (newZoom === oldZoom) return;
  const rect = canvas.getBoundingClientRect();
  const cx = evt.clientX - rect.left;
  const cy = evt.clientY - rect.top;
  // Keep the model point under the cursor stationary across zoom.
  const mx = (cx - diagram.viewport.x) / oldZoom;
  const my = (cy - diagram.viewport.y) / oldZoom;
  diagram.viewport.x = cx - mx * newZoom;
  diagram.viewport.y = cy - my * newZoom;
  diagram.viewport.zoom = newZoom;
  applyViewport();
  save();
}, { passive: false });

window.addEventListener("keydown", (evt) => {
  const tag = evt.target && evt.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  if (evt.key === "Delete" || evt.key === "Backspace") {
    if (selectedId || selectedEdgeId) {
      evt.preventDefault();
      deleteSelected();
    }
    return;
  }

  if (evt.key === "Escape") {
    if (editing) { cancelEdit(); return; }
    if (pendingEdge) { pendingEdge = null; syncPendingEdge(); return; }
    if (connecting || connectSource) {
      connecting = false;
      connectSource = null;
      render();
      return;
    }
    if (selectedId || selectedEdgeId) {
      selectedId = null;
      selectedEdgeId = null;
      render();
    }
  }
});

init().catch((e) => {
  console.error(e);
  setStatus("failed to load");
});
