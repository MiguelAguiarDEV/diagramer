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
const sidebarListEl = document.getElementById("diagram-list");
const newDiagramBtn = document.getElementById("new-diagram");
const diagramNameEl = document.getElementById("diagram-name");
const ctxMenuEl = document.getElementById("ctx-menu");
const importBtn = document.getElementById("import");
const exportBtn = document.getElementById("export");

let diagram = null;
let selectedIds = new Set();
let selectedEdgeId = null;
let connecting = false;
let connectSource = null;
let dragging = null;
let panning = null;
let spaceDown = false;
let ctrlDown = false;
let pendingEdge = null;
let lasso = null;
let editing = null; // { kind: "node" | "edge", id }
let saveTimer = null;

const HISTORY_LIMIT = 50;
let past = [];
let future = [];

const EDGE_EDITOR_W = 140;
const EDGE_EDITOR_H = 28;

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

// Parses the diagram id out of a /d/{id} URL, or returns null for any other.
function diagramIdFromPath() {
  const m = location.pathname.match(/^\/d\/([^/]+)/);
  return m ? m[1] : null;
}

async function init() {
  const targetId = diagramIdFromPath();
  let list = await api("GET", "/api/diagrams");
  if (!list) list = [];

  let toLoad = null;
  if (targetId && list.some((d) => d.id === targetId)) {
    toLoad = targetId;
  } else if (list.length > 0) {
    toLoad = list[0].id;
  } else {
    const created = await api("POST", "/api/diagrams", { name: "Untitled" });
    list = [created];
    toLoad = created.id;
  }

  renderSidebar(list, toLoad);
  await loadDiagram(toLoad, { push: targetId !== toLoad });
}

async function refreshSidebar() {
  const list = (await api("GET", "/api/diagrams")) || [];
  renderSidebar(list, diagram && diagram.id);
}

function renderSidebar(list, activeId) {
  sidebarListEl.innerHTML = "";
  // Most-recently updated first.
  list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  for (const m of list) {
    const li = document.createElement("li");
    if (m.id === activeId) li.classList.add("active");
    li.dataset.id = m.id;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = m.name;
    name.title = m.name;
    li.appendChild(name);
    const del = document.createElement("button");
    del.className = "del";
    del.title = "Delete";
    del.textContent = "×";
    li.appendChild(del);
    sidebarListEl.appendChild(li);
  }
}

// Flush a pending debounced save so we don't lose the last edit when
// navigating away from the current diagram.
async function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!diagram) return;
  try {
    await api("PUT", `/api/diagrams/${diagram.id}`, {
      name: diagram.name,
      nodes: diagram.nodes,
      edges: diagram.edges,
      viewport: diagram.viewport,
    });
  } catch (e) {
    console.error("flushSave failed", e);
  }
}

async function loadDiagram(id, opts = {}) {
  await flushSave();
  // Reset transient interaction state.
  selectedIds.clear();
  selectedEdgeId = null;
  connecting = false;
  connectSource = null;
  dragging = null;
  pendingEdge = null;
  lasso = null;
  past = [];
  future = [];
  if (editing) { editing = null; editorEl.hidden = true; }

  diagram = await api("GET", `/api/diagrams/${id}`);
  diagramNameEl.textContent = diagram.name;
  document.title = `${diagram.name} — diagramer`;
  for (const li of sidebarListEl.children) {
    li.classList.toggle("active", li.dataset.id === id);
  }
  if (opts.push !== false) {
    history.pushState({ id }, "", `/d/${id}`);
  }
  render();
}

// ---------- undo / redo ----------

// Snapshot only the persistent diagram content (nodes + edges). Viewport
// changes from pan/zoom aren't worth a history slot.
function snapshot() {
  return {
    nodes: structuredClone(diagram.nodes),
    edges: structuredClone(diagram.edges),
  };
}

function pushHistory(snap) {
  past.push(snap || snapshot());
  if (past.length > HISTORY_LIMIT) past.shift();
  future = [];
}

function applySnapshot(s) {
  diagram.nodes = s.nodes;
  diagram.edges = s.edges;
}

function resetTransientForHistory() {
  selectedIds.clear();
  selectedEdgeId = null;
  connectSource = null;
  pendingEdge = null;
  dragging = null;
  if (editing) { editing = null; editorEl.hidden = true; }
}

function undo() {
  if (past.length === 0) return;
  future.push(snapshot());
  applySnapshot(past.pop());
  resetTransientForHistory();
  save();
  render();
}

function redo() {
  if (future.length === 0) return;
  past.push(snapshot());
  applySnapshot(future.pop());
  resetTransientForHistory();
  save();
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
    // Edge label centred on the midpoint with a small background for legibility.
    if (e.label && !(editing && editing.kind === "edge" && editing.id === e.id)) {
      const midX = (pa.x + pb.x) / 2;
      const midY = (pa.y + pb.y) / 2;
      const tw = _measureCtx.measureText(e.label).width + 10;
      const th = 16;
      eg.appendChild(svg("rect", {
        class: "edge-label-bg",
        x: midX - tw / 2, y: midY - th / 2,
        width: tw, height: th, rx: 3,
      }));
      const lt = svg("text", {
        class: "edge-label",
        x: midX, y: midY + 4, "text-anchor": "middle",
      });
      lt.textContent = e.label;
      eg.appendChild(lt);
    }
    edgesLayer.appendChild(eg);
  }

  for (const n of diagram.nodes) {
    const g = svg("g", {
      class: "node" +
        (selectedIds.has(n.id) ? " selected" : "") +
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

  deleteBtn.disabled = selectedIds.size === 0 && selectedEdgeId === null;
  connectBtn.classList.toggle("active", connecting);
  canvas.classList.toggle("connecting", connecting);
  applyViewport();
  syncPendingEdge();
  syncLasso();
}

// Draws (or removes) the dashed lasso rectangle in model coords.
function syncLasso() {
  let rect = edgesLayer.querySelector(".lasso");
  if (!lasso) {
    if (rect) rect.remove();
    return;
  }
  const bbox = lassoBBox();
  if (!rect) {
    rect = svg("rect", { class: "lasso" });
    edgesLayer.appendChild(rect);
  }
  rect.setAttribute("x", bbox.x);
  rect.setAttribute("y", bbox.y);
  rect.setAttribute("width", bbox.w);
  rect.setAttribute("height", bbox.h);
}

function lassoBBox() {
  const x = Math.min(lasso.start.x, lasso.current.x);
  const y = Math.min(lasso.start.y, lasso.current.y);
  const w = Math.abs(lasso.current.x - lasso.start.x);
  const h = Math.abs(lasso.current.y - lasso.start.y);
  return { x, y, w, h };
}

function rectsOverlap(a, b) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
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

function addBoxAt(modelX, modelY) {
  const label = prompt("Box text:");
  if (label === null) return;
  pushHistory();
  diagram.nodes.push({
    id: uid(),
    position: { x: modelX - NODE_MIN_W / 2, y: modelY - NODE_H / 2 },
    data: { label: label.trim() || "Untitled" },
  });
  save();
  render();
}

addBtn.addEventListener("click", () => {
  // Drop the new box near the centre of the visible viewport, in model coords.
  const rect = canvas.getBoundingClientRect();
  const { x: vx, y: vy, zoom } = diagram.viewport;
  const mx = (rect.width / 2 - vx) / zoom + (Math.random() - 0.5) * 80;
  const my = (rect.height / 2 - vy) / zoom + (Math.random() - 0.5) * 80;
  addBoxAt(mx, my);
});

connectBtn.addEventListener("click", () => {
  connecting = !connecting;
  connectSource = null;
  selectedIds.clear();
  render();
});

deleteBtn.addEventListener("click", deleteSelected);

function deleteSelected() {
  if (selectedEdgeId === null && selectedIds.size === 0) return;
  pushHistory();
  if (selectedEdgeId) {
    diagram.edges = diagram.edges.filter((e) => e.id !== selectedEdgeId);
    selectedEdgeId = null;
  }
  if (selectedIds.size > 0) {
    const ids = selectedIds;
    diagram.nodes = diagram.nodes.filter((n) => !ids.has(n.id));
    diagram.edges = diagram.edges.filter(
      (e) => !ids.has(e.source) && !ids.has(e.target)
    );
    selectedIds = new Set();
  }
  save();
  render();
}

function positionEditor() {
  if (!editing) return;
  const { x: vx, y: vy, zoom } = diagram.viewport;
  const canvasRect = canvas.getBoundingClientRect();

  if (editing.kind === "node") {
    const node = diagram.nodes.find((n) => n.id === editing.id);
    if (!node) return;
    const w = nodeWidth(node);
    editorEl.style.left = (canvasRect.left + node.position.x * zoom + vx) + "px";
    editorEl.style.top = (canvasRect.top + node.position.y * zoom + vy) + "px";
    editorEl.style.width = (w * zoom) + "px";
    editorEl.style.height = (NODE_H * zoom) + "px";
    editorEl.style.fontSize = (13 * zoom) + "px";
    return;
  }

  // Edge: position over the midpoint of the segment in screen coords.
  const edge = diagram.edges.find((e) => e.id === editing.id);
  if (!edge) return;
  const a = diagram.nodes.find((n) => n.id === edge.source);
  const b = diagram.nodes.find((n) => n.id === edge.target);
  if (!a || !b) return;
  const pa = sideAnchor(a, center(b));
  const pb = sideAnchor(b, center(a));
  const midX = (pa.x + pb.x) / 2;
  const midY = (pa.y + pb.y) / 2;
  editorEl.style.left =
    (canvasRect.left + (midX - EDGE_EDITOR_W / 2) * zoom + vx) + "px";
  editorEl.style.top =
    (canvasRect.top + (midY - EDGE_EDITOR_H / 2) * zoom + vy) + "px";
  editorEl.style.width = (EDGE_EDITOR_W * zoom) + "px";
  editorEl.style.height = (EDGE_EDITOR_H * zoom) + "px";
  editorEl.style.fontSize = (12 * zoom) + "px";
}

function startEdit(kind, id) {
  if (kind === "node") {
    const node = diagram.nodes.find((n) => n.id === id);
    if (!node) return;
    selectedIds.clear();
    selectedIds.add(id);
    selectedEdgeId = null;
    editorEl.value = node.data.label || "";
  } else if (kind === "edge") {
    const edge = diagram.edges.find((e) => e.id === id);
    if (!edge) return;
    selectedEdgeId = id;
    selectedIds.clear();
    editorEl.value = edge.label || "";
  } else {
    return;
  }
  editing = { kind, id };
  dragging = null;
  editorEl.hidden = false;
  positionEditor();
  // Defer focus one frame so layout settles before selecting the text.
  requestAnimationFrame(() => { editorEl.focus(); editorEl.select(); });
  render();
}

function commitEdit(value) {
  if (!editing) return;
  const v = (value || "").trim();
  let changed = false;
  if (editing.kind === "node") {
    const node = diagram.nodes.find((n) => n.id === editing.id);
    // Empty input is ignored for nodes (we don't want labelless boxes).
    if (node && v && node.data.label !== v) {
      pushHistory();
      node.data.label = v;
      changed = true;
    }
  } else if (editing.kind === "edge") {
    const edge = diagram.edges.find((e) => e.id === editing.id);
    // Empty input clears the edge label; the edge stays.
    if (edge && (edge.label || "") !== v) {
      pushHistory();
      edge.label = v;
      changed = true;
    }
  }
  editing = null;
  editorEl.hidden = true;
  if (changed) save();
  render();
}

function cancelEdit() {
  editing = null;
  editorEl.hidden = true;
  render();
}

editorEl.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") { ev.preventDefault(); commitEdit(editorEl.value); }
  else if (ev.key === "Escape") { ev.preventDefault(); cancelEdit(); }
});
editorEl.addEventListener("blur", () => {
  if (editing) commitEdit(editorEl.value);
});

function startPan(evt) {
  evt.preventDefault();
  panning = {
    sx: evt.clientX,
    sy: evt.clientY,
    vx: diagram.viewport.x,
    vy: diagram.viewport.y,
  };
  canvas.classList.add("panning");
}

canvas.addEventListener("mousedown", (evt) => {
  // Middle button or Space+left = pan, regardless of what's under the cursor.
  if (evt.button === 1 || (evt.button === 0 && spaceDown)) {
    startPan(evt);
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

  // Double-click on a node or edge enters in-place edit. Detected via
  // evt.detail because we re-render on every click, which destroys the
  // target the browser uses to correlate native `dblclick` events.
  if (nodeEl && evt.detail >= 2) {
    startEdit("node", nodeEl.dataset.id);
    return;
  }
  if (edgeEl && !nodeEl && evt.detail >= 2) {
    startEdit("edge", edgeEl.dataset.id);
    return;
  }

  if (!nodeEl && !edgeEl) {
    // Click on empty canvas starts a lasso selection.
    const start = clientToModel(evt);
    lasso = {
      start,
      current: { ...start },
      additive: evt.shiftKey,
      baseSelection: new Set(selectedIds),
    };
    connectSource = null;
    selectedEdgeId = null;
    if (!evt.shiftKey) selectedIds.clear();
    render();
    return;
  }

  if (edgeEl && !nodeEl) {
    selectedEdgeId = edgeEl.dataset.id;
    selectedIds.clear();
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
        pushHistory();
        diagram.edges.push({ id: uid(), source: connectSource, target: id });
        save();
      }
      connectSource = null;
      render();
    }
    return;
  }

  // Shift+click toggles a node in the selection without starting a drag.
  if (evt.shiftKey) {
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    render();
    return;
  }

  // Plain click on an unselected node clears the selection and picks just it.
  // Click on an already-selected node keeps the set so we can drag-move all.
  if (!selectedIds.has(id)) {
    selectedIds.clear();
    selectedIds.add(id);
  }

  const p = clientToModel(evt);
  const offsets = new Map();
  for (const sid of selectedIds) {
    const node = diagram.nodes.find((n) => n.id === sid);
    if (!node) continue;
    offsets.set(sid, {
      dx: p.x - node.position.x,
      dy: p.y - node.position.y,
    });
  }
  // Capture pre-drag snapshot for undo; only commit it to history if the
  // pointer actually moves (a stray click shouldn't pollute the history).
  dragging = { offsets, moved: false, snapshot: snapshot() };
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
  if (lasso) {
    lasso.current = clientToModel(evt);
    syncLasso();
    return;
  }
  if (!dragging) return;
  const p = clientToModel(evt);
  for (const [sid, off] of dragging.offsets) {
    const node = diagram.nodes.find((n) => n.id === sid);
    if (!node) continue;
    node.position.x = p.x - off.dx;
    node.position.y = p.y - off.dy;
  }
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
          pushHistory();
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
  if (lasso) {
    const box = lassoBBox();
    // A tiny drag (≤3 model px in either axis) is treated as a plain click
    // on empty: keep the deselection that the mousedown already applied.
    if (box.w > 3 || box.h > 3) {
      const next = lasso.additive ? new Set(lasso.baseSelection) : new Set();
      for (const n of diagram.nodes) {
        const nb = { x: n.position.x, y: n.position.y, w: nodeWidth(n), h: NODE_H };
        if (rectsOverlap(box, nb)) next.add(n.id);
      }
      selectedIds = next;
    }
    lasso = null;
    render();
    return;
  }
  if (!dragging) return;
  if (dragging.moved) {
    pushHistory(dragging.snapshot);
    save();
  }
  dragging = null;
});

canvas.addEventListener("wheel", (evt) => {
  evt.preventDefault();

  // Zoom only when the user really pressed Ctrl/Cmd (tracked via keydown).
  // The trackpad pinch gesture also arrives as a wheel with ctrlKey=true
  // but we don't want that — only explicit Ctrl/Cmd + wheel zooms.
  if (!ctrlDown) {
    diagram.viewport.x -= evt.deltaX;
    diagram.viewport.y -= evt.deltaY;
    applyViewport();
    save();
    return;
  }

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

  // Hold Space to pan with left-click drag (Figma/Miro convention).
  if (evt.code === "Space") {
    evt.preventDefault();
    if (!evt.repeat && !spaceDown) {
      spaceDown = true;
      canvas.classList.add("space-pan");
    }
    return;
  }

  // Track physical Ctrl/Cmd separately from evt.ctrlKey on wheel so trackpad
  // pinch (synthesised as ctrlKey=true) does not trigger zoom.
  if (evt.key === "Control" || evt.key === "Meta") {
    ctrlDown = true;
  }

  const mod = evt.ctrlKey || evt.metaKey;
  const key = evt.key.toLowerCase();
  if (mod && key === "z" && !evt.shiftKey) {
    evt.preventDefault();
    undo();
    return;
  }
  if (mod && (key === "y" || (key === "z" && evt.shiftKey))) {
    evt.preventDefault();
    redo();
    return;
  }

  if (evt.key === "Delete" || evt.key === "Backspace") {
    if (selectedIds.size > 0 || selectedEdgeId) {
      evt.preventDefault();
      deleteSelected();
    }
    return;
  }

  if (evt.key === "Escape") {
    if (!ctxMenuEl.hidden) { hideContextMenu(); return; }
    if (editing) { cancelEdit(); return; }
    if (pendingEdge) { pendingEdge = null; syncPendingEdge(); return; }
    if (lasso) { lasso = null; render(); return; }
    if (connecting || connectSource) {
      connecting = false;
      connectSource = null;
      render();
      return;
    }
    if (selectedIds.size > 0 || selectedEdgeId) {
      selectedIds.clear();
      selectedEdgeId = null;
      render();
    }
  }
});

window.addEventListener("keyup", (evt) => {
  if (evt.code === "Space" && spaceDown) {
    spaceDown = false;
    canvas.classList.remove("space-pan");
  }
  if (evt.key === "Control" || evt.key === "Meta") {
    ctrlDown = false;
  }
});

// If the window loses focus mid-press (e.g. Alt-tab), forget modifier state
// so the cursor doesn't get stuck and zoom doesn't fire on next wheel.
window.addEventListener("blur", () => {
  if (spaceDown) {
    spaceDown = false;
    canvas.classList.remove("space-pan");
  }
  ctrlDown = false;
});

newDiagramBtn.addEventListener("click", async () => {
  const name = prompt("Name:", "Untitled");
  if (name === null) return;
  const trimmed = name.trim() || "Untitled";
  try {
    const created = await api("POST", "/api/diagrams", { name: trimmed });
    await refreshSidebar();
    await loadDiagram(created.id, { push: true });
  } catch (e) {
    setStatus("create failed");
    console.error(e);
  }
});

sidebarListEl.addEventListener("click", async (evt) => {
  const li = evt.target.closest("li");
  if (!li) return;
  const id = li.dataset.id;

  if (evt.target.classList.contains("del")) {
    evt.stopPropagation();
    const name = li.querySelector(".name").textContent;
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await api("DELETE", `/api/diagrams/${id}`);
    } catch (e) {
      setStatus("delete failed");
      console.error(e);
      return;
    }
    // If we deleted the currently open diagram, fall back to another or
    // create a fresh one so we always have something on screen.
    if (diagram && diagram.id === id) {
      const list = (await api("GET", "/api/diagrams")) || [];
      let next = list[0];
      if (!next) {
        next = await api("POST", "/api/diagrams", { name: "Untitled" });
      }
      renderSidebar(list.length ? list : [next], next.id);
      await loadDiagram(next.id, { push: true });
    } else {
      await refreshSidebar();
    }
    return;
  }

  if (id !== (diagram && diagram.id)) {
    await loadDiagram(id, { push: true });
  }
});

// Double-click a name to rename in place.
sidebarListEl.addEventListener("dblclick", (evt) => {
  const nameEl = evt.target.closest(".name");
  if (!nameEl) return;
  const li = nameEl.parentElement;
  startRename(li, nameEl);
});

function startRename(li, nameEl) {
  const id = li.dataset.id;
  const original = nameEl.textContent;
  const input = document.createElement("input");
  input.className = "name-input";
  input.value = original;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const newName = input.value.trim();
    const replacement = document.createElement("span");
    replacement.className = "name";
    replacement.title = commit && newName ? newName : original;
    replacement.textContent = commit && newName ? newName : original;
    input.replaceWith(replacement);
    if (commit && newName && newName !== original) {
      try {
        await api("PATCH", `/api/diagrams/${id}`, { name: newName });
        if (diagram && diagram.id === id) {
          diagram.name = newName;
          diagramNameEl.textContent = newName;
          document.title = `${newName} — diagramer`;
        }
      } catch (e) {
        setStatus("rename failed");
        console.error(e);
      }
    }
  };

  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
    else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
}

window.addEventListener("popstate", async () => {
  const id = diagramIdFromPath();
  if (id && (!diagram || diagram.id !== id)) {
    await loadDiagram(id, { push: false });
  }
});

// ---------- context menu ----------

function showContextMenu(clientX, clientY, items) {
  ctxMenuEl.innerHTML = "";
  for (const it of items) {
    if (it.separator) {
      const sep = document.createElement("div");
      sep.className = "sep";
      ctxMenuEl.appendChild(sep);
      continue;
    }
    const btn = document.createElement("button");
    btn.textContent = it.label;
    btn.addEventListener("click", () => {
      hideContextMenu();
      it.action();
    });
    ctxMenuEl.appendChild(btn);
  }
  // Clamp into viewport so it doesn't fall off-screen.
  ctxMenuEl.hidden = false;
  const { innerWidth, innerHeight } = window;
  const rect = ctxMenuEl.getBoundingClientRect();
  const x = Math.min(clientX, innerWidth - rect.width - 4);
  const y = Math.min(clientY, innerHeight - rect.height - 4);
  ctxMenuEl.style.left = x + "px";
  ctxMenuEl.style.top = y + "px";
}

function hideContextMenu() {
  ctxMenuEl.hidden = true;
}

// Align every node in selectedIds along the given axis.
//   axis: "x" (line up horizontally → same X-related coordinate)
//   mode: "min" (left/top), "center", "max" (right/bottom)
function alignSelected(axis, mode) {
  const nodes = [...selectedIds]
    .map((id) => diagram.nodes.find((n) => n.id === id))
    .filter(Boolean);
  if (nodes.length < 2) return;
  pushHistory();

  if (axis === "x") {
    const lefts = nodes.map((n) => n.position.x);
    const rights = nodes.map((n) => n.position.x + nodeWidth(n));
    let target;
    if (mode === "min") target = Math.min(...lefts);
    else if (mode === "max") target = Math.max(...rights);
    else target = (Math.min(...lefts) + Math.max(...rights)) / 2;
    for (const n of nodes) {
      const w = nodeWidth(n);
      if (mode === "min") n.position.x = target;
      else if (mode === "max") n.position.x = target - w;
      else n.position.x = target - w / 2;
    }
  } else {
    const tops = nodes.map((n) => n.position.y);
    const bottoms = nodes.map((n) => n.position.y + NODE_H);
    let target;
    if (mode === "min") target = Math.min(...tops);
    else if (mode === "max") target = Math.max(...bottoms);
    else target = (Math.min(...tops) + Math.max(...bottoms)) / 2;
    for (const n of nodes) {
      if (mode === "min") n.position.y = target;
      else if (mode === "max") n.position.y = target - NODE_H;
      else n.position.y = target - NODE_H / 2;
    }
  }
  save();
  render();
}

function emptyMenuItems(modelPos) {
  return [
    { label: "Add box here", action: () => addBoxAt(modelPos.x, modelPos.y) },
  ];
}

function singleNodeMenuItems(id) {
  return [
    { label: "Edit text", action: () => startEdit("node", id) },
    { separator: true },
    { label: "Delete", action: () => deleteSelected() },
  ];
}

function singleEdgeMenuItems(id) {
  return [
    { label: "Edit label", action: () => startEdit("edge", id) },
    { separator: true },
    { label: "Delete", action: () => deleteSelected() },
  ];
}

function multiNodesMenuItems() {
  // Naming convention: "Vertical · …" means "line them up on a vertical line"
  // (same X, varied Y). "Horizontal · …" means line them up on a horizontal
  // line (same Y, varied X).
  return [
    { label: "Vertical · left",   action: () => alignSelected("x", "min") },
    { label: "Vertical · center", action: () => alignSelected("x", "center") },
    { label: "Vertical · right",  action: () => alignSelected("x", "max") },
    { separator: true },
    { label: "Horizontal · top",    action: () => alignSelected("y", "min") },
    { label: "Horizontal · center", action: () => alignSelected("y", "center") },
    { label: "Horizontal · bottom", action: () => alignSelected("y", "max") },
    { separator: true },
    { label: "Delete all", action: () => deleteSelected() },
  ];
}

canvas.addEventListener("contextmenu", (evt) => {
  evt.preventDefault();
  hideContextMenu();
  if (editing) return; // don't pop the menu while editing

  const nodeEl = evt.target.closest(".node");
  const edgeEl = evt.target.closest(".edge-group");
  let items;

  if (nodeEl) {
    const id = nodeEl.dataset.id;
    // Right-click on a non-selected node selects only that one (convention).
    if (!selectedIds.has(id)) {
      selectedIds.clear();
      selectedIds.add(id);
      selectedEdgeId = null;
      render();
    }
    items = selectedIds.size > 1
      ? multiNodesMenuItems()
      : singleNodeMenuItems(id);
  } else if (edgeEl) {
    const id = edgeEl.dataset.id;
    selectedEdgeId = id;
    selectedIds.clear();
    render();
    items = singleEdgeMenuItems(id);
  } else {
    items = emptyMenuItems(clientToModel(evt));
  }

  showContextMenu(evt.clientX, evt.clientY, items);
});

// Any click outside the menu closes it. Use capture so it runs before the
// canvas mousedown handler that would otherwise re-render and steal focus.
document.addEventListener("mousedown", (evt) => {
  if (!ctxMenuEl.hidden && !ctxMenuEl.contains(evt.target)) {
    hideContextMenu();
  }
}, true);

// ---------- import / export ----------

function sanitizeFilename(s) {
  return (s || "diagram").trim().replace(/[^a-z0-9._-]+/gi, "_") || "diagram";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportJSON() {
  const payload = {
    name: diagram.name,
    nodes: diagram.nodes,
    edges: diagram.edges,
    viewport: diagram.viewport,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  downloadBlob(blob, sanitizeFilename(diagram.name) + ".json");
}

function isValidImport(raw) {
  if (typeof raw !== "object" || raw === null) return false;
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return false;
  for (const n of raw.nodes) {
    if (typeof n.id !== "string") return false;
    if (!n.position || typeof n.position.x !== "number" || typeof n.position.y !== "number") return false;
    if (!n.data || typeof n.data.label !== "string") return false;
  }
  for (const e of raw.edges) {
    if (typeof e.id !== "string" || typeof e.source !== "string" || typeof e.target !== "string") return false;
    if (e.label !== undefined && typeof e.label !== "string") return false;
  }
  return true;
}

async function importJSONFile(file) {
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    setStatus("import: invalid JSON");
    return;
  }
  if (!isValidImport(raw)) {
    setStatus("import: bad shape");
    return;
  }
  const name = (typeof raw.name === "string" && raw.name.trim())
    ? raw.name.trim()
    : file.name.replace(/\.json$/i, "") || "Imported";
  try {
    const created = await api("POST", "/api/diagrams", { name });
    await api("PUT", `/api/diagrams/${created.id}`, {
      name,
      nodes: raw.nodes,
      edges: raw.edges,
      viewport: raw.viewport || { x: 0, y: 0, zoom: 1 },
    });
    await refreshSidebar();
    await loadDiagram(created.id, { push: true });
    setStatus("imported");
  } catch (e) {
    setStatus("import failed");
    console.error(e);
  }
}

importBtn.addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (file) importJSONFile(file);
  });
  input.click();
});

exportBtn.addEventListener("click", () => {
  const rect = exportBtn.getBoundingClientRect();
  showContextMenu(rect.left, rect.bottom + 2, exportMenuItems());
});

function exportMenuItems() {
  return [
    { label: "Export as JSON", action: exportJSON },
    { label: "Export as SVG",  action: () => exportSVG().catch(logExportError) },
    { label: "Export as PNG",  action: () => exportPNG().catch(logExportError) },
  ];
}

function logExportError(e) {
  console.error(e);
  setStatus("export failed");
}

function nodesBBox() {
  if (diagram.nodes.length === 0) {
    return { x: -200, y: -100, w: 400, h: 200 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of diagram.nodes) {
    const w = nodeWidth(n);
    if (n.position.x < minX) minX = n.position.x;
    if (n.position.y < minY) minY = n.position.y;
    if (n.position.x + w > maxX) maxX = n.position.x + w;
    if (n.position.y + NODE_H > maxY) maxY = n.position.y + NODE_H;
  }
  const PAD = 30;
  return {
    x: minX - PAD,
    y: minY - PAD,
    w: (maxX - minX) + PAD * 2,
    h: (maxY - minY) + PAD * 2,
  };
}

let _cssCache = null;
async function loadCanvasCss() {
  if (_cssCache !== null) return _cssCache;
  const res = await fetch("/style.css");
  _cssCache = await res.text();
  return _cssCache;
}

// Builds a self-contained <svg> ready to be serialised: viewport transform
// reset, transient overlays removed, selection highlights stripped, app CSS
// inlined as <style>. Dimensions match the bounding box of the diagram.
async function buildExportSvg() {
  const bbox = nodesBBox();
  const cloned = canvas.cloneNode(true);
  const viewportClone = cloned.querySelector("#viewport");
  if (viewportClone) viewportClone.removeAttribute("transform");
  cloned.querySelectorAll(
    ".lasso, .pending-edge, .conn-handle, .edge-hit"
  ).forEach((el) => el.remove());
  cloned.querySelectorAll(".selected").forEach((el) =>
    el.classList.remove("selected")
  );
  cloned.setAttribute("viewBox", `${bbox.x} ${bbox.y} ${bbox.w} ${bbox.h}`);
  cloned.setAttribute("width", String(bbox.w));
  cloned.setAttribute("height", String(bbox.h));
  cloned.removeAttribute("id");
  cloned.removeAttribute("class");
  cloned.style.cssText = "";
  // Inline the app CSS so the SVG looks right outside the browser.
  const css = await loadCanvasCss();
  const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
  styleEl.textContent = css;
  cloned.insertBefore(styleEl, cloned.firstChild);
  return { svgEl: cloned, bbox };
}

async function exportSVG() {
  const { svgEl } = await buildExportSvg();
  const xml = new XMLSerializer().serializeToString(svgEl);
  const blob = new Blob(
    [`<?xml version="1.0" encoding="UTF-8"?>\n`, xml],
    { type: "image/svg+xml" }
  );
  downloadBlob(blob, sanitizeFilename(diagram.name) + ".svg");
}

async function exportPNG() {
  const { svgEl, bbox } = await buildExportSvg();
  const xml = new XMLSerializer().serializeToString(svgEl);
  const svgBlob = new Blob([xml], { type: "image/svg+xml" });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const img = await loadImage(svgUrl);
    const SCALE = 2; // hi-dpi
    const c = document.createElement("canvas");
    c.width = Math.ceil(bbox.w * SCALE);
    c.height = Math.ceil(bbox.h * SCALE);
    const ctx = c.getContext("2d");
    // Solid dark background matches what the user sees in-app.
    ctx.fillStyle = "#0b0b0d";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((resolve) =>
      c.toBlob(resolve, "image/png")
    );
    if (!blob) throw new Error("toBlob returned null");
    downloadBlob(blob, sanitizeFilename(diagram.name) + ".png");
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

init().catch((e) => {
  console.error(e);
  setStatus("failed to load");
});
