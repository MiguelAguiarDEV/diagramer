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
  selectedIds.clear();
  render();
});

deleteBtn.addEventListener("click", deleteSelected);

function deleteSelected() {
  let changed = false;
  if (selectedEdgeId) {
    diagram.edges = diagram.edges.filter((e) => e.id !== selectedEdgeId);
    selectedEdgeId = null;
    changed = true;
  }
  if (selectedIds.size > 0) {
    const ids = selectedIds;
    diagram.nodes = diagram.nodes.filter((n) => !ids.has(n.id));
    diagram.edges = diagram.edges.filter(
      (e) => !ids.has(e.source) && !ids.has(e.target)
    );
    selectedIds = new Set();
    changed = true;
  }
  if (changed) {
    save();
    render();
  }
}

function positionEditor() {
  const node = diagram.nodes.find((n) => n.id === editing);
  if (!node) return;
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
}

function startEdit(id) {
  const node = diagram.nodes.find((n) => n.id === id);
  if (!node) return;
  editing = id;
  selectedIds.clear();
  selectedIds.add(id);
  dragging = null;
  editorEl.value = node.data.label || "";
  editorEl.hidden = false;
  positionEditor();
  // Defer focus one frame so layout settles before selecting the text.
  requestAnimationFrame(() => { editorEl.focus(); editorEl.select(); });
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

  // Double-click on a node enters in-place edit. Detected via evt.detail
  // because we re-render on every click, which destroys the target the
  // browser uses to correlate clicks for the native `dblclick` event.
  if (nodeEl && evt.detail >= 2) {
    startEdit(nodeEl.dataset.id);
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
  dragging = { offsets, moved: false };
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
  if (dragging.moved) save();
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

  if (evt.key === "Delete" || evt.key === "Backspace") {
    if (selectedIds.size > 0 || selectedEdgeId) {
      evt.preventDefault();
      deleteSelected();
    }
    return;
  }

  if (evt.key === "Escape") {
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

init().catch((e) => {
  console.error(e);
  setStatus("failed to load");
});
