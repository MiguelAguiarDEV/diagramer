const NODE_H = 44;
const NODE_PAD_X = 20;
const NODE_MIN_W = 80;
const NODE_MAX_W = 320;
const NODE_FONT = "13px system-ui, sans-serif";
const ICON_SIZE = 20;
const ICON_GAP = 6;
// Fixed center-to-center spacing between interface ports on a container edge.
// Containers grow so this never has to shrink (no overlap).
const PORT_GAP = 22;

const _measureCtx = document.createElement("canvas").getContext("2d");
_measureCtx.font = NODE_FONT;

function iconWidth(kind) {
  const k = kind && KINDS[kind];
  return k && k.icon ? ICON_SIZE + ICON_GAP : 0;
}

// nodeSize returns the bbox the node occupies. Most shapes keep the classic
// (variable width, fixed 44 height); symmetric shapes (circle, rhombus) use a
// square bbox; equilateral triangles use side × side·√3/2. All grow with the
// label so the text always fits.
function nodeSize(node) {
  const label = node.data.label || "";
  const tw = label ? _measureCtx.measureText(label).width : 0;
  const iw = iconWidth(node.kind);
  const shape = nodeShape(node);

  // Icon-only nodes (stencil with no label) collapse to a tight square so the
  // icon sits centred instead of pinned to the left of an empty rectangle.
  if (label === "" && iw > 0) {
    return { w: NODE_H, h: NODE_H };
  }

  // Canvas measureText doesn't exactly match SVG text rendering, so add a
  // small safety buffer (8 px) on top of the symmetric horizontal padding.
  const innerW = tw + iw + NODE_PAD_X * 2 + 8;
  let w, h;
  switch (shape) {
    case "circle":
    case "rhombus": {
      // Square bbox; +16 px so the label doesn't kiss the curve / diagonals.
      const d = Math.min(NODE_MAX_W, Math.max(innerW + 16, NODE_H + 8));
      w = d; h = d;
      break;
    }
    case "tri-up":
    case "tri-down": {
      // Equilateral: at the vertical midpoint the triangle is s/2 wide (for
      // tri-up; symmetric for tri-down). Pick s so that mid-width covers the
      // inner content with a small margin.
      const SQRT3_2 = Math.sqrt(3) / 2;
      const s = Math.min(NODE_MAX_W, Math.max(innerW * 1.6 + 8, NODE_H * 2));
      w = s; h = s * SQRT3_2;
      break;
    }
    case "ellipse": {
      // Ellipses need extra width so the curve doesn't clip the text corners.
      const wn = Math.min(NODE_MAX_W, Math.max(innerW + 24, NODE_MIN_W));
      w = wn; h = NODE_H;
      break;
    }
    case "rect":
    default: {
      const wn = Math.min(NODE_MAX_W, Math.max(innerW, NODE_MIN_W));
      w = wn; h = NODE_H;
      break;
    }
  }

  // Containers grow so their ports keep a fixed spacing. The left (in) and top
  // (dep) sides reserve one extra slot for the "add" bolita, so it always has
  // room next to the real ports.
  if (node.data && node.data.subdiagramId) {
    const ports = subPorts.get(node.data.subdiagramId) || [];
    const insN = ports.filter((p) => p.role === "in").length;
    const outsN = ports.filter((p) => p.role === "out").length;
    const depsN = ports.filter((p) => p.role === "dep").length;
    h = Math.max(h, Math.max(insN + 1, outsN) * PORT_GAP + 18);
    w = Math.max(w, (depsN + 1) * PORT_GAP + 28);
    // Room for the in-container minimap + a bottom label strip.
    w = Math.max(w, 132);
    h = Math.max(h, 84);
  }
  return { w: Math.ceil(w), h: Math.ceil(h) };
}

function nodeWidth(node) {
  return nodeSize(node).w;
}

// ---------- node kinds ----------

// Each icon draws into a 20×20 box. Use currentColor so CSS can theme it.
function svgChild(parent, tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.appendChild(el);
  return el;
}

function drawDatabase(g) {
  const a = { fill: "none", stroke: "currentColor", "stroke-width": 1.5 };
  svgChild(g, "ellipse", { cx: 10, cy: 4, rx: 8, ry: 2.5, ...a });
  svgChild(g, "path",    { d: "M2,4 V16 M18,4 V16", ...a });
  svgChild(g, "ellipse", { cx: 10, cy: 16, rx: 8, ry: 2.5, ...a });
  svgChild(g, "path",    { d: "M2,10 Q10,12.5 18,10", ...a });
}

function drawBackend(g) {
  const a = { fill: "none", stroke: "currentColor", "stroke-width": 1.5 };
  svgChild(g, "rect", { x: 2, y: 3, width: 16, height: 14, rx: 2, ...a });
  svgChild(g, "path", { d: "M5,7 H15 M5,10 H15 M5,13 H15", ...a });
  svgChild(g, "circle", { cx: 16, cy: 6, r: 0.8, fill: "currentColor", stroke: "none" });
}

function drawFrontend(g) {
  const a = { fill: "none", stroke: "currentColor", "stroke-width": 1.5 };
  svgChild(g, "rect", { x: 1, y: 3, width: 18, height: 12, rx: 2, ...a });
  svgChild(g, "path", { d: "M1,6 H19", ...a });
  svgChild(g, "circle", { cx: 3.5, cy: 4.5, r: 0.6, fill: "currentColor", stroke: "none" });
  svgChild(g, "circle", { cx: 5.5, cy: 4.5, r: 0.6, fill: "currentColor", stroke: "none" });
  svgChild(g, "circle", { cx: 7.5, cy: 4.5, r: 0.6, fill: "currentColor", stroke: "none" });
  svgChild(g, "path", { d: "M7,18 H13 M10,15 V18", ...a });
}

function drawQueue(g) {
  const a = { fill: "none", stroke: "currentColor", "stroke-width": 1.5 };
  svgChild(g, "rect", { x: 2, y: 4,  width: 16, height: 3.5, rx: 1, ...a });
  svgChild(g, "rect", { x: 2, y: 8.5, width: 16, height: 3.5, rx: 1, ...a });
  svgChild(g, "rect", { x: 2, y: 13, width: 16, height: 3.5, rx: 1, ...a });
}

function drawCache(g) {
  const a = { fill: "none", stroke: "currentColor", "stroke-width": 1.5 };
  svgChild(g, "rect", { x: 4, y: 4, width: 12, height: 12, rx: 1, ...a });
  svgChild(g, "path", { d: "M0,7 H4 M0,10 H4 M0,13 H4 M16,7 H20 M16,10 H20 M16,13 H20", ...a });
  svgChild(g, "path", { d: "M7,4 V0 M10,4 V0 M13,4 V0 M7,20 V16 M10,20 V16 M13,20 V16", ...a });
}

function drawUser(g) {
  const a = { fill: "none", stroke: "currentColor", "stroke-width": 1.5 };
  svgChild(g, "circle", { cx: 10, cy: 6.5, r: 3.1, ...a });
  // Shoulders as a smooth shallow arc that reads as a torso.
  svgChild(g, "path", { d: "M3.8,17.5 C3.8,12.8 16.2,12.8 16.2,17.5", ...a });
}

function drawCloud(g) {
  const a = { fill: "none", stroke: "currentColor", "stroke-width": 1.5 };
  svgChild(g, "path", {
    d: "M6,15.5 C3,15.5 1.5,13.5 1.5,11.5 C1.5,9.3 3.3,8 5.2,8.2 C5.7,5.6 8,4 10.3,4.6 C12.2,5.1 13.4,6.8 13.4,8.4 C15.4,8.1 17.5,9.4 17.5,11.8 C17.5,13.8 16,15.5 13.5,15.5 Z",
    ...a,
  });
}

const KINDS = {
  // Geometric primitives — no icon, the outline shape itself carries meaning.
  rect:       { label: "Rectangle",  shape: "rect" },
  circle:     { label: "Circle",     shape: "circle" },
  ellipse:    { label: "Ellipse",    shape: "ellipse" },
  rhombus:    { label: "Rhombus",    shape: "rhombus" },
  "tri-up":   { label: "Triangle ▲", shape: "tri-up" },
  "tri-down": { label: "Triangle ▼", shape: "tri-down" },
  // Stencils — rectangle outline + icon, all sharing the same bbox so anchors
  // and edges work uniformly.
  database: { label: "Database", shape: "rect", icon: drawDatabase },
  backend:  { label: "Backend",  shape: "rect", icon: drawBackend  },
  frontend: { label: "Frontend", shape: "rect", icon: drawFrontend },
  queue:    { label: "Queue",    shape: "rect", icon: drawQueue    },
  cache:    { label: "Cache",    shape: "rect", icon: drawCache    },
  user:     { label: "User",     shape: "rect", icon: drawUser     },
  cloud:    { label: "Cloud",    shape: "rect", icon: drawCloud    },
};

function nodeShape(node) {
  const k = node.kind && KINDS[node.kind];
  return (k && k.shape) ? k.shape : "rect";
}

// Draws the node outline as the appropriate SVG primitive. The bbox is always
// (0,0)-(w,h) regardless of the actual shape, so anchors stay rectangular.
function drawShape(g, shape, w, h) {
  switch (shape) {
    case "circle": {
      const r = Math.min(w, h) / 2;
      return svgChild(g, "ellipse", {
        class: "node-shape", cx: w / 2, cy: h / 2, rx: r, ry: r,
      });
    }
    case "ellipse":
      return svgChild(g, "ellipse", {
        class: "node-shape", cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2,
      });
    case "rhombus":
      return svgChild(g, "polygon", {
        class: "node-shape",
        points: `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`,
      });
    case "tri-up":
      return svgChild(g, "polygon", {
        class: "node-shape",
        points: `${w / 2},0 ${w},${h} 0,${h}`,
      });
    case "tri-down":
      return svgChild(g, "polygon", {
        class: "node-shape",
        points: `0,0 ${w},0 ${w / 2},${h}`,
      });
    case "rect":
    default:
      return svgChild(g, "rect", {
        class: "node-shape", width: w, height: h, rx: 6, ry: 6,
      });
  }
}

// Computes the local-coords layout of a container's interface ports: "in" on
// the left, "out" on the right, "dep" along the top, at fixed spacing centered
// on each edge (the container is sized to fit them). Pure — used both to draw
// the ports and to anchor edges bound to them. Returns
// [{ id, role, label, cx, cy, side }].
// The left (in) and top (dep) sides reserve one extra "add" slot at the end of
// their line, so the "+" bolita sits exactly where the next port will appear.
function containerPortLayout(node) {
  const result = { ports: [], adds: [] };
  if (!node.data.subdiagramId) return result;
  const list = subPorts.get(node.data.subdiagramId) || [];
  const { w, h } = nodeSize(node);
  const ins = list.filter((p) => p.role === "in");
  const outs = list.filter((p) => p.role === "out");
  const deps = list.filter((p) => p.role === "dep");

  // Left column = ins + a trailing add slot.
  const leftN = ins.length + 1;
  ins.forEach((p, i) =>
    result.ports.push({ id: p.id, role: "in", label: p.label, side: "left", cx: 0, cy: h / 2 + (i - (leftN - 1) / 2) * PORT_GAP }));
  result.adds.push({ role: "in", side: "left", cx: 0, cy: h / 2 + (ins.length - (leftN - 1) / 2) * PORT_GAP });

  // Right column = outs (no add slot — the output appears on its own).
  outs.forEach((p, i) =>
    result.ports.push({ id: p.id, role: "out", label: p.label, side: "right", cx: w, cy: h / 2 + (i - (outs.length - 1) / 2) * PORT_GAP }));

  // Top row = deps + a trailing add slot.
  const topN = deps.length + 1;
  deps.forEach((p, i) =>
    result.ports.push({ id: p.id, role: "dep", label: p.label, side: "top", cx: w / 2 + (i - (topN - 1) / 2) * PORT_GAP, cy: 0 }));
  result.adds.push({ role: "dep", side: "top", cx: w / 2 + (deps.length - (topN - 1) / 2) * PORT_GAP, cy: 0 });

  return result;
}

// Model-coords anchor of a specific port, or null if it no longer exists.
function portAnchor(node, portId) {
  const p = containerPortLayout(node).ports.find((q) => q.id === portId);
  if (!p) return null;
  return { x: node.position.x + p.cx, y: node.position.y + p.cy, side: p.side };
}

// Draws the interface ports plus the "+" add bolitas. in/dep render hollow
// ("plug something here"), out filled ("produced here"); the add bolita is a
// dashed hollow disc with a "+" sitting at the next slot. Top (dep) labels are
// rotated so they stack upward without colliding horizontally.
function drawContainerPorts(g, node) {
  const layout = containerPortLayout(node);
  const labelPos = (p) => {
    if (p.side === "left") return { lx: -9, ly: p.cy + 3, anchor: "end", rot: false };
    if (p.side === "right") return { lx: p.cx + 9, ly: p.cy + 3, anchor: "start", rot: false };
    return { lx: p.cx, ly: -10, anchor: "start", rot: true };
  };
  for (const p of layout.ports) {
    const { lx, ly, anchor, rot } = labelPos(p);
    const pg = svg("g", { class: "port port-" + p.role, "data-port-id": p.id });
    pg.appendChild(svg("circle", { cx: p.cx, cy: p.cy, r: 5 }));
    if (p.label) {
      const tx = svg("text", { x: lx, y: ly, "text-anchor": anchor });
      if (rot) tx.setAttribute("transform", `rotate(-90 ${lx} ${ly})`);
      tx.textContent = p.label;
      pg.appendChild(tx);
    }
    const title = svg("title", {});
    title.textContent = `${p.role}: ${p.label || "(unnamed)"} — drag to connect`;
    pg.appendChild(title);
    g.appendChild(pg);
  }
  for (const a of layout.adds) {
    const ag = svg("g", { class: "add-port add-" + a.role, "data-id": node.id, "data-role": a.role });
    ag.appendChild(svg("circle", { cx: a.cx, cy: a.cy, r: 6 }));
    const t = svg("text", { x: a.cx, y: a.cy + 3.5, "text-anchor": "middle" });
    t.textContent = "+";
    ag.appendChild(t);
    const title = svg("title", {});
    title.textContent = a.role === "in" ? "Add input" : "Add dependency";
    ag.appendChild(title);
    g.appendChild(ag);
  }
}

// Draws a scaled minimap of the subdiagram's contents inside the container's
// body (node rects + edge lines), fit into the area above the bottom label
// strip. Gives an at-a-glance sense of what's inside without drilling in.
function drawSubPreview(g, node, w, h) {
  const pv = subPreview.get(node.data.subdiagramId);
  if (!pv || !pv.bbox || !pv.rects.length) return;
  // Below a readable on-screen size the scaled minimap is just noise, so skip
  // it (the label + ports still convey the container). Threshold in screen px.
  if (w * (diagram.viewport.zoom || 1) < 110) return;
  const padX = 8, top = 7, bottom = 16;
  const aw = w - 2 * padX, ah = h - top - bottom;
  if (aw <= 6 || ah <= 6) return;
  const s = Math.min(aw / (pv.bbox.w || 1), ah / (pv.bbox.h || 1));
  const ox = padX + (aw - pv.bbox.w * s) / 2 - pv.bbox.x * s;
  const oy = top + (ah - pv.bbox.h * s) / 2 - pv.bbox.y * s;
  const pg = svg("g", { class: "sub-preview" });
  for (const ln of pv.lines) {
    pg.appendChild(svg("line", {
      x1: ox + ln.x1 * s, y1: oy + ln.y1 * s, x2: ox + ln.x2 * s, y2: oy + ln.y2 * s,
    }));
  }
  for (const r of pv.rects) {
    const rr = svg("rect", {
      x: ox + r.x * s, y: oy + r.y * s,
      width: Math.max(2, r.w * s), height: Math.max(1.5, r.h * s), rx: 1,
    });
    if (r.fill) rr.setAttribute("fill", r.fill);
    pg.appendChild(rr);
  }
  g.appendChild(pg);
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.1;

const canvas = document.getElementById("canvas");
const viewportLayer = document.getElementById("viewport");
const edgesLayer = document.getElementById("edges");
const nodesLayer = document.getElementById("nodes");
const edgeLabelsLayer = document.getElementById("edge-labels");
const guidesLayer = document.getElementById("guides");
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
const tidyBtn = document.getElementById("tidy");
const navBackBtn = document.getElementById("nav-back");
const navFwdBtn = document.getElementById("nav-fwd");
const fitViewBtn = document.getElementById("fit-view");
const edgeStyleBtn = document.getElementById("edge-style");
const minimapSvg = document.getElementById("minimap");
const minimapContent = document.getElementById("minimap-content");
const minimapVp = document.getElementById("minimap-vp");
const themeToggleBtn = document.getElementById("theme-toggle");

let diagram = null;
let currentEtag = null;
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
let edgeDrag = null; // { edgeId, snapshot }
// Transient alignment guide lines drawn while dragging (model coords).
let alignGuides = [];
const SNAP_PX = 6; // snap threshold in screen pixels
let nudgeHistoryTimer = null; // coalesces arrow-key nudge bursts into one undo
let saveTimer = null;
// Drill-down trail of ancestor diagrams when navigating into subdiagrams.
// Session-only; entries are { id, name }. The current diagram is not included.
let breadcrumb = [];
// Chronological navigation history (independent of the containment breadcrumb):
// "where have I been", so Back/Forward work no matter how a diagram was opened
// (sidebar jump, drill-in, crumb). Each entry snapshots the breadcrumb so the
// containment path is restored too. navigatingHistory guards loadDiagram from
// recording a back/forward move as a fresh navigation.
let navStack = [];
let navIndex = -1;
let navigatingHistory = false;

function recordNav(id) {
  if (navigatingHistory) return;
  const entry = { id, crumbs: breadcrumb.slice() };
  // Re-opening the same diagram (e.g. crumb click within the same place) just
  // refreshes the current entry rather than stacking duplicates.
  if (navStack[navIndex] && navStack[navIndex].id === id) {
    navStack[navIndex] = entry;
  } else {
    navStack = navStack.slice(0, navIndex + 1);
    navStack.push(entry);
    navIndex = navStack.length - 1;
  }
  updateNavButtons();
}

async function gotoNav() {
  const entry = navStack[navIndex];
  if (!entry) return;
  navigatingHistory = true;
  breadcrumb = entry.crumbs.slice();
  try {
    await loadDiagram(entry.id, { keepBreadcrumb: true, replace: true });
  } catch (e) {
    setStatus("diagram missing");
    console.error(e);
  } finally {
    navigatingHistory = false;
  }
  updateNavButtons();
}

async function navBack() {
  if (navIndex <= 0) return;
  navIndex--;
  await gotoNav();
}

async function navForward() {
  if (navIndex >= navStack.length - 1) return;
  navIndex++;
  await gotoNav();
}

function updateNavButtons() {
  if (navBackBtn) navBackBtn.disabled = navIndex <= 0;
  if (navFwdBtn) navFwdBtn.disabled = navIndex >= navStack.length - 1;
}
// Interface ports of referenced subdiagrams, keyed by subdiagram id:
// subId -> [{ id, role: "in"|"out"|"dep", label }]. Filled by
// loadSubdiagramPorts so container nodes can draw their ports without the sub
// being open.
let subPorts = new Map();
// Geometric preview of each referenced subdiagram for the in-container minimap:
// subId -> { rects, lines, bbox }.
let subPreview = new Map();

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

// Like edgeExists but port-aware: two edges are duplicates only if they bind
// the same endpoints AND the same ports, so a node can fan out to several
// ports of one container.
function edgeExistsExact(srcId, tgtId, sp, tp) {
  const a = sp || "", b = tp || "";
  return diagram.edges.some((e) => {
    const es = e.sourcePort || "", et = e.targetPort || "";
    return (
      (e.source === srcId && e.target === tgtId && es === a && et === b) ||
      (e.source === tgtId && e.target === srcId && es === b && et === a)
    );
  });
}

// opts: { ifMatch?: string, wantEtag?: bool }
// Throws on non-2xx; the error has .status so callers can branch on e.g. 412.
async function api(method, path, body, opts = {}) {
  const headers = body ? { "Content-Type": "application/json" } : {};
  if (opts.ifMatch) headers["If-Match"] = opts.ifMatch;
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}`);
    err.status = res.status;
    throw err;
  }
  let data = null;
  if (res.status !== 204) data = await res.json();
  if (opts.wantEtag) return { data, etag: res.headers.get("ETag") };
  return data;
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

  // Candidate ids in priority order: the URL target first, then the rest.
  const ids = [];
  if (targetId && list.some((d) => d.id === targetId)) ids.push(targetId);
  for (const m of list) if (!ids.includes(m.id)) ids.push(m.id);

  renderSidebar(list, ids[0] || null);

  // Try candidates in order; skip any that won't load (a stale index entry
  // whose file was deleted, or a corrupt file) so one bad diagram can't brick
  // the whole app on boot.
  for (const id of ids) {
    try {
      await loadDiagram(id, { push: targetId !== id });
      return;
    } catch (e) {
      console.error("skipping unloadable diagram", id, e);
    }
  }

  // Empty dir, or every entry was unloadable → start fresh.
  const created = await api("POST", "/api/diagrams", { name: "Untitled" });
  list = [created, ...list.filter((m) => m.id !== created.id)];
  renderSidebar(list, created.id);
  await loadDiagram(created.id, { push: false });
}

async function refreshSidebar() {
  const list = (await api("GET", "/api/diagrams")) || [];
  renderSidebar(list, diagram && diagram.id);
}

// Sidebar state: the last metas (id-indexed) and which tree paths are open.
// Expansion is keyed by full path (e.g. "a/b/a"), never by id alone, so a
// diagram that references itself can be expanded level by level without ever
// looping — each open is a distinct user action on a distinct path.
let sidebarById = new Map();
let expandedPaths = new Set();
let sidebarActiveId = null;
// The tree path of the active occurrence ("root/.../current"), so exactly one
// node highlights — the one on the path you reached the diagram by.
let sidebarActivePath = null;

function renderSidebar(list, activeId) {
  sidebarById = new Map(list.map((m) => [m.id, m]));
  sidebarActiveId = activeId;
  sidebarActivePath = diagram ? [...breadcrumb.map((b) => b.id), diagram.id].join("/") : null;
  revealActivePath();
  sidebarListEl.innerHTML = "";
  const byRecent = (a, b) => (a.updatedAt < b.updatedAt ? 1 : -1);
  const diagrams = list.filter((m) => !m.component).sort(byRecent);
  const comps = list.filter((m) => m.component).sort(byRecent);
  appendSidebarSection("Diagrams", diagrams);
  appendSidebarSection("Subdiagrams", comps);
  // Reveal the active item like VS Code's explorer (only scrolls if off-screen).
  const act = sidebarListEl.querySelector(".diagram-item.active");
  if (act) act.scrollIntoView({ block: "nearest" });
}

// Auto-expand every ancestor of the active drill path so the current diagram is
// visible in the tree (its nested occurrence under the path it was reached by).
function revealActivePath() {
  if (!diagram) return;
  const ids = [...breadcrumb.map((b) => b.id), diagram.id];
  for (let i = 1; i < ids.length; i++) {
    expandedPaths.add(ids.slice(0, i).join("/"));
  }
}

function appendSidebarSection(title, metas) {
  const head = document.createElement("li");
  head.className = "sidebar-section";
  head.textContent = title;
  sidebarListEl.appendChild(head);
  if (metas.length === 0) {
    const empty = document.createElement("li");
    empty.className = "sidebar-empty";
    empty.textContent = "—";
    sidebarListEl.appendChild(empty);
    return;
  }
  for (const m of metas) appendSidebarItem(m, m.id, 0);
}

// A rotating chevron (open downward) or an invisible spacer for leaves so all
// rows align. Clicks land on either the svg or its path → handler uses closest.
function sbChevron(hasKids, open) {
  const s = svg("svg", {
    class: "sb-chevron" + (hasKids ? (open ? " open" : "") : " leaf"),
    viewBox: "0 0 16 16",
  });
  svgChild(s, "path", {
    d: "M6 4l4 4-4 4", fill: "none", stroke: "currentColor", "stroke-width": 1.7,
  });
  return s;
}

// Type glyph: stacked layers for a reusable subdiagram (component), a framed
// mini-diagram for a top-level diagram — so the two kinds read at a glance.
function sbTypeIcon(isComponent) {
  const s = svg("svg", {
    class: "sb-typeicon " + (isComponent ? "component" : "diagram"),
    viewBox: "0 0 16 16",
  });
  const a = { fill: "none", stroke: "currentColor", "stroke-width": 1.3 };
  if (isComponent) {
    svgChild(s, "path", { d: "M8 2.2 13.5 5 8 7.8 2.5 5Z", ...a });
    svgChild(s, "path", { d: "M2.5 8 8 10.8 13.5 8", ...a });
    svgChild(s, "path", { d: "M2.5 11 8 13.8 13.5 11", ...a });
  } else {
    svgChild(s, "rect", { x: 2, y: 2.5, width: 12, height: 11, rx: 2.5, ...a });
    svgChild(s, "circle", { cx: 5.4, cy: 6.2, r: 1.2, fill: "currentColor", stroke: "none" });
    svgChild(s, "circle", { cx: 10.6, cy: 9.8, r: 1.2, fill: "currentColor", stroke: "none" });
    svgChild(s, "path", { d: "M6.4 6.9 9.6 9.1", ...a });
  }
  return s;
}

function appendSidebarItem(meta, path, depth) {
  const li = document.createElement("li");
  li.className = "diagram-item";
  if (path === sidebarActivePath) li.classList.add("active");
  li.dataset.id = meta.id;
  li.dataset.path = path;
  li.draggable = true; // drag onto the canvas to place it as a container

  for (let i = 0; i < depth; i++) {
    const ind = document.createElement("span");
    ind.className = "indent";
    li.appendChild(ind);
  }

  const hasKids = (meta.subdiagrams || []).some((id) => sidebarById.has(id));
  li.appendChild(sbChevron(hasKids, expandedPaths.has(path)));
  li.appendChild(sbTypeIcon(!!meta.component));

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = meta.name;
  name.title = meta.name;
  li.appendChild(name);

  const del = document.createElement("button");
  del.className = "del";
  del.title = "Delete";
  del.textContent = "×";
  li.appendChild(del);
  sidebarListEl.appendChild(li);

  // Children are rendered only when this exact path is expanded (lazy), which
  // is what makes recursive references safe.
  if (hasKids && expandedPaths.has(path)) {
    for (const cid of meta.subdiagrams) {
      const cm = sidebarById.get(cid);
      if (cm) appendSidebarItem(cm, path + "/" + cid, depth + 1);
    }
  }
}

// Flush a pending debounced save so we don't lose the last edit when
// navigating away from the current diagram.
async function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!diagram) return;
  await doSave();
}

async function doSave() {
  if (!diagram) return;
  const id = diagram.id;
  try {
    const { etag } = await api("PUT", `/api/diagrams/${id}`, {
      name: diagram.name,
      nodes: diagram.nodes,
      edges: diagram.edges,
      edgeStyle: diagram.edgeStyle || "",
      viewport: diagram.viewport,
    }, { ifMatch: currentEtag, wantEtag: true });
    if (diagram && diagram.id === id) currentEtag = etag;
    setStatus("saved");
  } catch (e) {
    if (e.status === 412) {
      await handleConflict();
    } else {
      setStatus("save failed");
      console.error(e);
    }
  }
}

// Triggered on HTTP 412: someone else (another tab or session) saved this
// diagram since we loaded it. Offer to reload, dropping the unsaved local
// changes — we don't have a UI for three-way merge yet.
async function handleConflict() {
  const reload = confirm(
    "This diagram was changed elsewhere.\n\n" +
    "OK = discard local changes and reload latest\n" +
    "Cancel = keep editing (next save may overwrite the other change)"
  );
  if (reload) {
    const id = diagram && diagram.id;
    if (id) await loadDiagram(id, { push: false });
  } else {
    // Force-overwrite mode: drop the etag so the next save bypasses the check.
    currentEtag = null;
    setStatus("conflict — saved on next change will overwrite");
  }
}

async function loadDiagram(id, opts = {}) {
  await flushSave();
  // Root navigation (sidebar, new, import, popstate) clears the drill-down
  // trail; only enter/crumb navigation keeps it (they manage it themselves).
  if (!opts.keepBreadcrumb) breadcrumb = [];
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

  const { data: d, etag } = await api("GET", `/api/diagrams/${id}`, null, { wantEtag: true });
  diagram = d;
  sanitizeViewport(diagram);
  currentEtag = etag;
  renderBreadcrumb();
  recordNav(id);
  document.title = `${diagram.name} — diagramer`;
  // Re-render the sidebar so it reveals the active drill path (VS Code style).
  // Uses the cached metas to avoid a fetch; boot's refreshSidebar fills them.
  if (sidebarById.size) renderSidebar([...sidebarById.values()], id);
  if (opts.replace) {
    history.replaceState({ id }, "", `/d/${id}`);
  } else if (opts.push !== false) {
    history.pushState({ id }, "", `/d/${id}`);
  }
  render();
  loadSubdiagramPorts(); // async; re-renders containers with their ports
}

// ---------- subdiagrams ----------

// Fetches every referenced subdiagram in the current diagram and caches both
// its interface ports (for the container's port discs) and a small geometric
// preview (for the in-container minimap), then re-renders. Fresh each load so
// edits to a subdiagram show on return.
async function loadSubdiagramPorts() {
  const ids = [
    ...new Set(diagram.nodes.filter((n) => n.data.subdiagramId).map((n) => n.data.subdiagramId)),
  ];
  subPorts = new Map();
  subPreview = new Map();
  await Promise.all(
    ids.map(async (sid) => {
      try {
        const sd = await api("GET", `/api/diagrams/${sid}`);
        subPorts.set(
          sid,
          sd.nodes
            .filter((n) => n.data.port)
            .map((n) => ({ id: n.id, role: n.data.port, label: n.data.label || "" })),
        );
        subPreview.set(sid, buildPreview(sd));
      } catch {
        /* missing subdiagram → no ports/preview */
      }
    }),
  );
  render();
}

// Distills a diagram into a tiny geometric preview: node rects (+ optional
// fill) and edge center-lines, plus the overall bbox, for the in-container map.
function buildPreview(d) {
  const rects = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const centers = new Map();
  for (const n of d.nodes) {
    const { w, h } = nodeSize(n);
    rects.push({ x: n.position.x, y: n.position.y, w, h, fill: n.data.fill || "" });
    centers.set(n.id, { x: n.position.x + w / 2, y: n.position.y + h / 2 });
    minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w); maxY = Math.max(maxY, n.position.y + h);
  }
  const lines = [];
  for (const e of d.edges) {
    const a = centers.get(e.source), b = centers.get(e.target);
    if (a && b) lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  if (!rects.length) return { rects, lines, bbox: null };
  return { rects, lines, bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

// Adds a new interface node of the given role to a container's subdiagram, so
// a fresh port appears on the container. Single source of truth: the inside is
// where the interface lives, the "+" just scaffolds it. Auto-named; rename by
// drilling in.
async function addPortToContainer(node, role) {
  const subId = node && node.data.subdiagramId;
  if (!subId) return;
  try {
    const sd = await api("GET", `/api/diagrams/${subId}`);
    const count = sd.nodes.filter((n) => n.data.port === role).length;
    const base = role === "in" ? "input" : role === "out" ? "output" : "dep";
    // Lay the interface node out on the matching side of the inside.
    let pos;
    if (role === "in") pos = { x: -240, y: count * 80 };
    else if (role === "out") pos = { x: 320, y: count * 80 };
    else pos = { x: count * 200, y: -160 };
    sd.nodes.push({
      id: uid(),
      position: pos,
      data: { label: `${base} ${count + 1}`, port: role },
    });
    await api("PUT", `/api/diagrams/${subId}`, {
      name: sd.name,
      nodes: sd.nodes,
      edges: sd.edges,
      viewport: sd.viewport,
    });
    await loadSubdiagramPorts();
    setStatus(`${base} port added`);
  } catch (e) {
    setStatus("add port failed");
    console.error(e);
  }
}

// Renders the title as a clickable breadcrumb of ancestors + current diagram.
function renderBreadcrumb() {
  diagramNameEl.innerHTML = "";
  for (const crumb of breadcrumb) {
    const c = document.createElement("span");
    c.className = "crumb";
    c.dataset.id = crumb.id;
    c.textContent = crumb.name;
    diagramNameEl.appendChild(c);
    const sep = document.createElement("span");
    sep.className = "crumb-sep";
    sep.textContent = "›";
    diagramNameEl.appendChild(sep);
  }
  const cur = document.createElement("span");
  cur.className = "crumb current";
  cur.textContent = diagram ? diagram.name : "";
  diagramNameEl.appendChild(cur);
}

// Navigate into a container node's referenced diagram, pushing the current
// diagram onto the breadcrumb trail.
async function enterSubdiagram(node) {
  const subId = node && node.data.subdiagramId;
  if (!subId) return;
  breadcrumb.push({ id: diagram.id, name: diagram.name });
  try {
    await loadDiagram(subId, { push: true, keepBreadcrumb: true });
  } catch (e) {
    breadcrumb.pop();
    setStatus("subdiagram missing");
    console.error(e);
  }
}

// Create a fresh empty diagram, link it to the node as its subdiagram, then
// drill into it.
async function createSubdiagram(nodeId) {
  const node = diagram.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  try {
    const name = (node.data.label || "Container") + " — inside";
    const created = await api("POST", "/api/diagrams", { name, component: true });
    pushHistory();
    node.data.subdiagramId = created.id;
    save();
    await refreshSidebar();
    breadcrumb.push({ id: diagram.id, name: diagram.name });
    await loadDiagram(created.id, { push: true, keepBreadcrumb: true });
    setStatus("subdiagram created");
  } catch (e) {
    setStatus("subdiagram failed");
    console.error(e);
  }
}

// Clicking an ancestor crumb walks back up the drill path. The full containment
// tree lives in the sidebar (which reveals the active path as you navigate).
diagramNameEl.addEventListener("click", (evt) => {
  const c = evt.target.closest(".crumb:not(.current)");
  if (!c) return;
  const id = c.dataset.id;
  const idx = breadcrumb.findIndex((b) => b.id === id);
  const prevBreadcrumb = breadcrumb;
  if (idx >= 0) breadcrumb = breadcrumb.slice(0, idx);
  loadDiagram(id, { push: true, keepBreadcrumb: true }).catch((e) => {
    breadcrumb = prevBreadcrumb; // ancestor gone → restore, don't leak
    setStatus("couldn't open diagram");
    console.error(e);
  });
});

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
  saveTimer = setTimeout(() => {
    saveTimer = null;
    doSave();
  }, 200);
}

function center(node) {
  const { w, h } = nodeSize(node);
  return { x: node.position.x + w / 2, y: node.position.y + h / 2 };
}

// Returns the midpoint of the node's side that faces `target` (a {x,y} point)
// along with which side it is. Picking sides by comparing dx/w vs dy/h
// projects each box onto its diagonal so connections always meet a side
// cleanly. The `side` is what the bezier control points use to decide
// whether to push the curve out horizontally or vertically.
function sideAnchor(node, target) {
  const { w, h } = nodeSize(node);
  const c = { x: node.position.x + w / 2, y: node.position.y + h / 2 };
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  if (Math.abs(dx) * h >= Math.abs(dy) * w) {
    return dx >= 0
      ? { x: node.position.x + w, y: c.y, side: "right" }
      : { x: node.position.x, y: c.y, side: "left" };
  }
  return dy >= 0
    ? { x: c.x, y: node.position.y + h, side: "bottom" }
    : { x: c.x, y: node.position.y, side: "top" };
}

// Resolves both endpoints of an edge: a port-bound end anchors at that port's
// disc; otherwise it meets the node's nearest side, aimed at the other end.
function anchorsFor(e, a, b) {
  const ta = e.sourcePort ? portAnchor(a, e.sourcePort) : null;
  const tb = e.targetPort ? portAnchor(b, e.targetPort) : null;
  return {
    pa: ta || sideAnchor(a, tb || center(b)),
    pb: tb || sideAnchor(b, ta || center(a)),
  };
}

// Builds an SVG cubic bezier path string between two anchors. Control points
// extend perpendicular to the side each anchor lives on, with an offset that
// scales with the distance between the two anchors (clamped to a sane range).
function bezierPath(pa, pb) {
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const off = Math.max(40, Math.min(dist * 0.5, 200));
  const ca = controlPoint(pa, off);
  const cb = controlPoint(pb, off);
  return `M ${pa.x},${pa.y} C ${ca.x},${ca.y} ${cb.x},${cb.y} ${pb.x},${pb.y}`;
}

function controlPoint(anchor, offset) {
  switch (anchor.side) {
    case "right":  return { x: anchor.x + offset, y: anchor.y };
    case "left":   return { x: anchor.x - offset, y: anchor.y };
    case "bottom": return { x: anchor.x, y: anchor.y + offset };
    case "top":    return { x: anchor.x, y: anchor.y - offset };
    default:       return { x: anchor.x, y: anchor.y };
  }
}

// ---------- edges ----------

function edgeMidpoint(pa, pb) {
  return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
}

// World position of the draggable curvature handle for the given edge.
// Without curvature it lives on the straight anchor midpoint; with curvature
// it's offset by (ox, oy).
function edgeHandlePos(edge, pa, pb, curv = edge.curvature) {
  const mid = edgeMidpoint(pa, pb);
  if (curv) {
    return { x: mid.x + curv.ox, y: mid.y + curv.oy };
  }
  return mid;
}

// SVG path d-string for one edge. With curvature: quadratic bezier with the
// single control point chosen so the curve passes exactly through the handle
// at t=0.5. Without curvature: the original cubic with control points pushed
// perpendicular to each anchor's side (the look we had before A* routing).
// Orthogonal (90°) routing for "synthetic" edge style: leave perpendicular to
// each anchor's side via a short stub, then connect with axis-aligned segments.
function orthogonalPath(pa, pb, off = 0) {
  const S = 24; // stub length so edges exit/enter cleanly perpendicular
  const dir = (s) =>
    s === "right" ? [1, 0] : s === "left" ? [-1, 0] :
    s === "bottom" ? [0, 1] : s === "top" ? [0, -1] : [0, 0];
  const [ax, ay] = dir(pa.side), [bx, by] = dir(pb.side);
  const a1 = { x: pa.x + ax * S, y: pa.y + ay * S };
  const b1 = { x: pb.x + bx * S, y: pb.y + by * S };
  const pts = [pa, a1];
  const aHoriz = ay === 0, bHoriz = by === 0;
  // `off` fans parallel edges apart perpendicular to the run. With off=0 the
  // base route is the natural single-jog "Z"; with off it routes via an
  // offset cross-run so same-pair parallels (often at equal height) separate.
  if (aHoriz && bHoriz) {
    if (off === 0) {
      const mx = (a1.x + b1.x) / 2;
      pts.push({ x: mx, y: a1.y }, { x: mx, y: b1.y });
    } else {
      const my = (a1.y + b1.y) / 2 + off;
      pts.push({ x: a1.x, y: my }, { x: b1.x, y: my });
    }
  } else if (!aHoriz && !bHoriz) {
    if (off === 0) {
      const my = (a1.y + b1.y) / 2;
      pts.push({ x: a1.x, y: my }, { x: b1.x, y: my });
    } else {
      const mx = (a1.x + b1.x) / 2 + off;
      pts.push({ x: mx, y: a1.y }, { x: mx, y: b1.y });
    }
  } else if (aHoriz) {
    pts.push({ x: b1.x, y: a1.y });
  } else {
    pts.push({ x: a1.x, y: b1.y });
  }
  pts.push(b1, pb);
  return "M " + pts.map((p) => `${p.x},${p.y}`).join(" L ");
}

function edgePath(edge, pa, pb, curv = edge.curvature, parOff = 0) {
  if (diagram.edgeStyle === "synthetic") return orthogonalPath(pa, pb, parOff);
  if (curv) {
    const mid = edgeMidpoint(pa, pb);
    const hx = mid.x + curv.ox;
    const hy = mid.y + curv.oy;
    // Quadratic B(t) = (1-t)²·P0 + 2(1-t)t·C + t²·P2. At t=0.5:
    //   B(0.5) = (P0 + 2C + P2) / 4 = H   →   C = 2H − (P0+P2)/2
    const cx = 2 * hx - (pa.x + pb.x) / 2;
    const cy = 2 * hy - (pa.y + pb.y) / 2;
    return `M ${pa.x},${pa.y} Q ${cx},${cy} ${pb.x},${pb.y}`;
  }
  return bezierPath(pa, pb);
}

function render() {
  edgesLayer.innerHTML = "";
  nodesLayer.innerHTML = "";
  edgeLabelsLayer.innerHTML = "";

  // Fan out edges that share a node pair so their paths and labels don't stack
  // on the same straight line. Edges the user has bent (explicit curvature) keep
  // their own shape and are excluded from the auto-spread.
  const parIdx = new Map(), parN = new Map();
  {
    const groups = new Map();
    for (const e of diagram.edges) {
      if (e.curvature) continue;
      const key = [e.source, e.target].sort().join("|");
      (groups.get(key) || groups.set(key, []).get(key)).push(e.id);
    }
    for (const ids of groups.values())
      ids.forEach((id, i) => { parIdx.set(id, i); parN.set(id, ids.length); });
  }

  for (const e of diagram.edges) {
    const a = diagram.nodes.find((n) => n.id === e.source);
    const b = diagram.nodes.find((n) => n.id === e.target);
    if (!a || !b) continue;
    const { pa, pb } = anchorsFor(e, a, b);
    const synthetic = diagram.edgeStyle === "synthetic";
    let curv = e.curvature;
    let parOff = 0; // perpendicular separation for parallel edges (synthetic)
    const n = parN.get(e.id) || 1;
    if (n > 1) {
      const i = parIdx.get(e.id);
      if (synthetic) {
        parOff = (i - (n - 1) / 2) * 22; // fan the orthogonal mid-runs apart
      } else if (!curv) {
        const dx = pb.x - pa.x, dy = pb.y - pa.y;
        const len = Math.hypot(dx, dy) || 1;
        const off = (i - (n - 1) / 2) * 36;
        curv = { ox: (-dy / len) * off, oy: (dx / len) * off };
      }
    }
    const d = edgePath(e, pa, pb, curv, parOff);
    const isSel = e.id === selectedEdgeId;
    const eg = svg("g", {
      class: "edge-group" + (isSel ? " selected" : ""),
      "data-id": e.id,
    });
    // Invisible thick hit area to make edges easy to click.
    eg.appendChild(svg("path", { class: "edge-hit", d }));
    // When the target end is bound to a port, the port disc is the terminator,
    // so skip the arrowhead (it would crowd the disc and the port label).
    const targetIsPort = e.targetPort && portAnchor(b, e.targetPort);
    const edgeAttrs = { class: "edge", d };
    if (!targetIsPort) {
      edgeAttrs["marker-end"] = isSel ? "url(#arrow-selected)" : "url(#arrow)";
    }
    eg.appendChild(svg("path", edgeAttrs));
    // The curvature handle is meaningless for orthogonal edges (the route is
    // computed), so it's only shown in organic mode.
    if (isSel && !synthetic) {
      const h = edgeHandlePos(e, pa, pb, curv);
      eg.appendChild(svg("circle", {
        class: "edge-handle",
        "data-id": e.id,
        cx: h.x, cy: h.y, r: 6,
      }));
    }
    // Edge label sits on the handle position (midpoint by default, curvature
    // offset when the user has dragged the handle).
    // Labels live in a layer above the nodes so a label that overlaps a node
    // (long text, tight gap) stays readable instead of being painted under it.
    if (e.label && !(editing && editing.kind === "edge" && editing.id === e.id)) {
      const h = synthetic ? edgeMidpoint(pa, pb) : edgeHandlePos(e, pa, pb, curv);
      if (synthetic && parOff) {
        // Follow the fanned mid-run so parallel labels don't stack.
        if (pa.side === "left" || pa.side === "right") h.y += parOff;
        else h.x += parOff;
      }
      const midX = h.x;
      const midY = h.y;
      const tw = _measureCtx.measureText(e.label).width + 10;
      const th = 16;
      const lg = svg("g", { class: "edge-label-group" + (isSel ? " selected" : "") });
      lg.appendChild(svg("rect", {
        class: "edge-label-bg",
        x: midX - tw / 2, y: midY - th / 2,
        width: tw, height: th, rx: 3,
      }));
      const lt = svg("text", {
        class: "edge-label",
        x: midX, y: midY + 4, "text-anchor": "middle",
      });
      lt.textContent = e.label;
      lg.appendChild(lt);
      edgeLabelsLayer.appendChild(lg);
    }
    edgesLayer.appendChild(eg);
  }

  for (const n of diagram.nodes) {
    const g = svg("g", {
      class: "node" +
        (selectedIds.has(n.id) ? " selected" : "") +
        (n.id === connectSource ? " connect-source" : "") +
        (n.data.subdiagramId ? " container" : ""),
      "data-id": n.id,
      transform: `translate(${n.position.x},${n.position.y})`,
    });
    // Per-node colors ride on inherited CSS custom properties so the default
    // hover/selected stroke rules still win when those states are active. The
    // color presets are all dark fills, so a custom fill also forces light
    // label text — otherwise the theme's dark text is unreadable on it.
    if (n.data.fill) {
      g.style.setProperty("--node-fill", n.data.fill);
      g.style.setProperty("--node-text", "#f3f4f6");
    }
    if (n.data.stroke) g.style.setProperty("--node-stroke", n.data.stroke);
    const { w, h } = nodeSize(n);
    const iw = iconWidth(n.kind);
    drawShape(g, nodeShape(n), w, h);
    // Containers show a scaled minimap of their inside, with the label as a
    // bottom caption (the body is the thumbnail).
    if (n.data.subdiagramId) drawSubPreview(g, n, w, h);
    if (iw > 0) {
      const hasLabel = (n.data.label || "") !== "";
      const iconX = hasLabel ? (NODE_PAD_X - 2) : (w - ICON_SIZE) / 2;
      const iconG = svg("g", {
        class: "node-icon",
        transform: `translate(${iconX},${(h - ICON_SIZE) / 2})`,
      });
      KINDS[n.kind].icon(iconG);
      g.appendChild(iconG);
    }
    // n8n-style "+" handle to start a plain (non-port) connection; visible on
    // hover/select via CSS. On containers the right side holds output ports, so
    // move it just below the bottom-right corner to avoid clashing with them.
    const isContainer = !!n.data.subdiagramId;
    const hRectX = isContainer ? w - 16 : w + 6;
    const hRectY = isContainer ? h + 6 : h / 2 - 8;
    const handle = svg("g", { class: "conn-handle", "data-id": n.id });
    handle.appendChild(svg("circle", {
      cx: hRectX + 8, cy: hRectY + 8, r: 8,
    }));
    const ht = svg("text", {
      x: hRectX + 8, y: hRectY + 12.5, "text-anchor": "middle",
    });
    ht.textContent = "+";
    handle.appendChild(ht);
    g.appendChild(handle);

    // Centre the label in the area to the right of the icon (if any). For
    // triangles the visual centroid is at h/3 or 2h/3, not h/2, so labels
    // there sit where the eye expects them.
    const textCx = iw > 0 ? (NODE_PAD_X + iw + w) / 2 : w / 2;
    const shape = nodeShape(n);
    let textCy = h / 2;
    if (shape === "tri-up")        textCy = h * 2 / 3;
    else if (shape === "tri-down") textCy = h / 3;
    // Containers caption their thumbnail at the bottom instead of centering.
    if (n.data.subdiagramId) textCy = h - 11;
    const t = svg("text", {
      x: n.data.subdiagramId ? w / 2 : textCx,
      y: textCy + 4,
      "text-anchor": "middle",
      class: n.data.subdiagramId ? "container-label" : "",
    });
    t.textContent = n.data.label || "";
    g.appendChild(t);

    // Container badge: a small "stacked layers" glyph in the top-right corner
    // signalling the node has a navigable subdiagram inside.
    if (n.data.subdiagramId) {
      const bx = w - 16;
      const badge = svg("g", { class: "subdiagram-badge" });
      badge.appendChild(svg("rect", { x: bx + 3, y: 6, width: 8, height: 6, rx: 1 }));
      badge.appendChild(svg("rect", { x: bx, y: 9, width: 8, height: 6, rx: 1 }));
      g.appendChild(badge);
      // Interface ports + the inline "+" add bolitas.
      drawContainerPorts(g, n);
    }

    // Interface-role badge: marks this node as part of its diagram's interface
    // (in/out/dep), which surfaces as a port on any container referencing it.
    if (n.data.port) {
      const roleBadge = svg("g", { class: "port-badge port-" + n.data.port });
      roleBadge.appendChild(svg("rect", { x: 4, y: 4, width: 22, height: 13, rx: 3 }));
      const rt = svg("text", { x: 15, y: 14, "text-anchor": "middle" });
      rt.textContent = n.data.port;
      roleBadge.appendChild(rt);
      g.appendChild(roleBadge);
    }
    nodesLayer.appendChild(g);
  }

  if (editing) positionEditor();

  deleteBtn.disabled = selectedIds.size === 0 && selectedEdgeId === null;
  syncEdgeStyleBtn();
  connectBtn.classList.toggle("active", connecting);
  canvas.classList.toggle("connecting", connecting);
  applyViewport();
  syncPendingEdge();
  syncLasso();
  drawAlignGuides();
  renderMinimap();
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

// Draws (or removes) the ghost bezier shown while dragging from a "+" handle.
function syncPendingEdge() {
  let path = edgesLayer.querySelector(".pending-edge");
  if (!pendingEdge) {
    if (path) path.remove();
    return;
  }
  const src = diagram.nodes.find((n) => n.id === pendingEdge.sourceId);
  if (!src) return;
  // Anchor at the originating port when dragging from one, else the side.
  const a = (pendingEdge.sourcePort && portAnchor(src, pendingEdge.sourcePort))
    || sideAnchor(src, pendingEdge.cursor);
  // Give the cursor a synthetic anchor with the opposite side of the source
  // so the ghost curves naturally instead of looping back on itself.
  const cursorAnchor = {
    x: pendingEdge.cursor.x,
    y: pendingEdge.cursor.y,
    side: oppositeSide(a.side),
  };
  const d = bezierPath(a, cursorAnchor);
  if (!path) {
    path = svg("path", { class: "pending-edge", "marker-end": "url(#arrow)" });
    edgesLayer.appendChild(path);
  }
  path.setAttribute("d", d);
}

function oppositeSide(side) {
  return { right: "left", left: "right", top: "bottom", bottom: "top" }[side] || "left";
}

function applyViewport() {
  const { x, y, zoom } = diagram.viewport;
  viewportLayer.setAttribute("transform", `translate(${x},${y}) scale(${zoom})`);
  if (editing) positionEditor();
  updateMinimapViewport();
}

function svg(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// ---------- minimap ----------

let minimapPanning = false;
// Bbox of the diagram content, cached on render so pan/zoom (which fire a lot)
// don't re-walk every node just to update the viewport indicator.
let _minimapContentBBox = null;

// The model-space rectangle currently visible in the main canvas.
function visibleModelRect() {
  const rect = canvas.getBoundingClientRect();
  const { x, y, zoom } = diagram.viewport;
  return { x: -x / zoom, y: -y / zoom, w: rect.width / zoom, h: rect.height / zoom };
}

// Rebuilds the minimap's simplified content: one rect per node (honouring a
// custom fill) and a straight line per edge. Cheap stand-ins — no icons,
// labels or beziers.
function renderMinimap() {
  if (!diagram) return;
  minimapContent.innerHTML = "";
  for (const e of diagram.edges) {
    const a = diagram.nodes.find((n) => n.id === e.source);
    const b = diagram.nodes.find((n) => n.id === e.target);
    if (!a || !b) continue;
    const ca = center(a);
    const cb = center(b);
    minimapContent.appendChild(svg("line", {
      class: "minimap-edge", x1: ca.x, y1: ca.y, x2: cb.x, y2: cb.y,
    }));
  }
  for (const n of diagram.nodes) {
    const { w, h } = nodeSize(n);
    const r = svg("rect", {
      class: "minimap-node",
      x: n.position.x, y: n.position.y, width: w, height: h, rx: 3,
    });
    if (n.data.fill) r.setAttribute("fill", n.data.fill);
    minimapContent.appendChild(r);
  }
  _minimapContentBBox = nodesBBox();
  updateMinimapViewport();
}

// Fits the minimap's viewBox to the union of the content and the visible rect
// (so the indicator never falls outside), then positions the indicator.
function updateMinimapViewport() {
  if (!diagram || !_minimapContentBBox) return;
  const c = _minimapContentBBox;
  const v = visibleModelRect();
  const minX = Math.min(c.x, v.x);
  const minY = Math.min(c.y, v.y);
  const maxX = Math.max(c.x + c.w, v.x + v.w);
  const maxY = Math.max(c.y + c.h, v.y + v.h);
  const PAD = 20;
  const vbX = minX - PAD;
  const vbY = minY - PAD;
  const vbW = maxX - minX + PAD * 2;
  const vbH = maxY - minY + PAD * 2;
  minimapSvg.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);
  minimapVp.setAttribute("x", v.x);
  minimapVp.setAttribute("y", v.y);
  minimapVp.setAttribute("width", v.w);
  minimapVp.setAttribute("height", v.h);
}

// Recenters the main viewport on the model point under the cursor. getScreenCTM
// already folds in the minimap's viewBox + preserveAspectRatio letterboxing.
function minimapPanTo(evt) {
  const ctm = minimapSvg.getScreenCTM();
  if (!ctm) return;
  const pt = minimapSvg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const p = pt.matrixTransform(ctm.inverse());
  const rect = canvas.getBoundingClientRect();
  const zoom = diagram.viewport.zoom || 1;
  diagram.viewport.x = rect.width / 2 - p.x * zoom;
  diagram.viewport.y = rect.height / 2 - p.y * zoom;
  applyViewport();
}

minimapSvg.addEventListener("mousedown", (evt) => {
  evt.preventDefault();
  evt.stopPropagation();
  minimapPanning = true;
  minimapPanTo(evt);
});
window.addEventListener("mousemove", (evt) => {
  if (minimapPanning) minimapPanTo(evt);
});
window.addEventListener("mouseup", () => {
  if (minimapPanning) {
    minimapPanning = false;
    save();
  }
});

// ---------- theme ----------

const THEME_KEY = "diagramer-theme";
// Shown in dark mode (click → go light); a moon is shown in light mode.
const SUN_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
  '<circle cx="12" cy="12" r="4"></circle>' +
  '<path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>' +
  "</svg>";
const MOON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path>' +
  "</svg>";

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function syncThemeButton() {
  const t = currentTheme();
  themeToggleBtn.innerHTML = t === "dark" ? SUN_SVG : MOON_SVG;
  themeToggleBtn.title = t === "dark" ? "Switch to light theme" : "Switch to dark theme";
}

themeToggleBtn.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (e) {
    /* private mode — theme just won't persist */
  }
  syncThemeButton();
});

syncThemeButton();

function clientToModel(evt) {
  const rect = canvas.getBoundingClientRect();
  const sx = evt.clientX - rect.left;
  const sy = evt.clientY - rect.top;
  const { x, y, zoom } = diagram.viewport;
  return { x: (sx - x) / zoom, y: (sy - y) / zoom };
}

function addBoxAt(modelX, modelY, kind) {
  // Stencils (kinds with an icon) pre-fill the prompt with their type name;
  // geometric primitives leave it blank so creating shapes-only nodes is
  // friction-free. Empty result is allowed — the node renders without text.
  const k = kind && KINDS[kind];
  const suggestion = (k && k.icon) ? k.label : "";
  const label = prompt("Text (leave empty for no label):", suggestion);
  if (label === null) return;
  pushHistory();
  const node = {
    id: uid(),
    position: { x: modelX - NODE_MIN_W / 2, y: modelY - NODE_H / 2 },
    data: { label: label.trim() },
  };
  if (kind && kind !== "rect") node.kind = kind;
  diagram.nodes.push(node);
  save();
  render();
  return node.id;
}

function addAtViewportCenter(kind) {
  const rect = canvas.getBoundingClientRect();
  const { x: vx, y: vy, zoom } = diagram.viewport;
  const mx = (rect.width / 2 - vx) / zoom + (Math.random() - 0.5) * 80;
  const my = (rect.height / 2 - vy) / zoom + (Math.random() - 0.5) * 80;
  addBoxAt(mx, my, kind);
}

// Adds a container box in one step: a fresh empty subdiagram is created and
// linked, and the box stays in the current diagram (badge shown) so you can
// see it land. Double-click it (or use the context menu) to edit its inside.
// With no coords, drops it at the viewport center.
async function addContainer(modelX, modelY) {
  const label = prompt("Container label:", "Container");
  if (label === null) return;
  if (modelX === undefined) {
    const rect = canvas.getBoundingClientRect();
    const { x: vx, y: vy, zoom } = diagram.viewport;
    modelX = (rect.width / 2 - vx) / zoom;
    modelY = (rect.height / 2 - vy) / zoom;
  }
  const name = (label.trim() || "Container") + " — inside";
  try {
    const created = await api("POST", "/api/diagrams", { name, component: true });
    const id = uid();
    pushHistory();
    diagram.nodes.push({
      id,
      position: { x: modelX - NODE_MIN_W / 2, y: modelY - NODE_H / 2 },
      data: { label: label.trim(), subdiagramId: created.id },
    });
    save();
    await refreshSidebar();
    render();
    setStatus("container added — double-click to edit inside");
    return id;
  } catch (e) {
    setStatus("container failed");
    console.error(e);
  }
}

// Places an existing diagram into the current one as a container node that
// references it — used by drag-and-drop from the sidebar. Recursion is allowed,
// so a diagram may even reference itself.
async function addContainerRef(subId, name, modelX, modelY) {
  if (!diagram || !subId) return;
  const id = uid();
  pushHistory();
  diagram.nodes.push({
    id,
    position: { x: modelX - NODE_MIN_W / 2, y: modelY - NODE_H / 2 },
    data: { label: name || "Subdiagram", subdiagramId: subId },
  });
  render();
  loadSubdiagramPorts();
  save();
  await flushSave();
  await refreshSidebar();
  setStatus("subdiagram placed");
  return id;
}

function kindMenuItems(onPick) {
  return Object.keys(KINDS).map((kind) => ({
    label: KINDS[kind].label,
    action: () => onPick(kind),
  }));
}

// The shared "things you can add" list, used by both the + Add toolbar button
// and the empty-canvas context menu so they stay in sync: every node kind plus
// a one-step container.
function addMenuItems(onPickKind, onPickContainer, onPickPort) {
  const items = kindMenuItems(onPickKind);
  items.push({ separator: true });
  items.push({ label: "Container (subdiagram)", action: onPickContainer });
  // Interface ports: useful inside a subdiagram to declare what it receives
  // (in), returns (out) or relies on (dep). They surface on any container.
  items.push({
    label: "Interface port ▸",
    submenu: () => [
      { label: "Input", action: () => onPickPort("in") },
      { label: "Output", action: () => onPickPort("out") },
      { label: "Dependency", action: () => onPickPort("dep") },
    ],
  });
  return items;
}

// Creates a node already tagged with an interface role (so it shows as a port
// on any container referencing this diagram).
function addPortNode(role, modelX, modelY) {
  if (modelX === undefined) {
    const rect = canvas.getBoundingClientRect();
    const { x: vx, y: vy, zoom } = diagram.viewport;
    modelX = (rect.width / 2 - vx) / zoom;
    modelY = (rect.height / 2 - vy) / zoom;
  }
  const labels = { in: "input", out: "output", dep: "dependency" };
  const id = uid();
  pushHistory();
  diagram.nodes.push({
    id,
    position: { x: modelX - NODE_MIN_W / 2, y: modelY - NODE_H / 2 },
    data: { label: labels[role], port: role },
  });
  save();
  render();
  return id;
}

addBtn.addEventListener("click", () => {
  const rect = addBtn.getBoundingClientRect();
  showContextMenu(
    rect.left,
    rect.bottom + 2,
    addMenuItems(addAtViewportCenter, () => addContainer(), (role) => addPortNode(role)),
  );
});

connectBtn.addEventListener("click", () => {
  connecting = !connecting;
  connectSource = null;
  selectedIds.clear();
  render();
});

deleteBtn.addEventListener("click", deleteSelected);
navBackBtn.addEventListener("click", navBack);
navFwdBtn.addEventListener("click", navForward);
fitViewBtn.addEventListener("click", fitView);

edgeStyleBtn.addEventListener("click", () => {
  if (!diagram) return;
  diagram.edgeStyle = diagram.edgeStyle === "synthetic" ? "organic" : "synthetic";
  save();
  render();
});

function syncEdgeStyleBtn() {
  const synthetic = !!diagram && diagram.edgeStyle === "synthetic";
  edgeStyleBtn.textContent = synthetic ? "Edges: orthogonal" : "Edges: organic";
  edgeStyleBtn.classList.toggle("active", synthetic);
}

// Clones the selected nodes (offset a little) plus any edges wholly inside the
// selection, remapped to the clones, then selects the copies. A container's
// subdiagram link is copied by reference (consistent with the model).
function duplicateSelection() {
  if (selectedIds.size === 0) return;
  pushHistory();
  const OFF = 24;
  const idMap = new Map();
  const clones = [];
  for (const n of diagram.nodes) {
    if (!selectedIds.has(n.id)) continue;
    const nid = uid();
    idMap.set(n.id, nid);
    clones.push({
      id: nid,
      kind: n.kind,
      position: { x: n.position.x + OFF, y: n.position.y + OFF },
      data: { ...n.data },
    });
  }
  for (const c of clones) diagram.nodes.push(c);
  for (const e of diagram.edges) {
    if (idMap.has(e.source) && idMap.has(e.target)) {
      const ne = { id: uid(), source: idMap.get(e.source), target: idMap.get(e.target) };
      if (e.label) ne.label = e.label;
      if (e.sourcePort) ne.sourcePort = e.sourcePort;
      if (e.targetPort) ne.targetPort = e.targetPort;
      if (e.curvature) ne.curvature = { ...e.curvature };
      diagram.edges.push(ne);
    }
  }
  selectedIds = new Set(idMap.values());
  selectedEdgeId = null;
  save();
  render();
}

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
    const { w, h } = nodeSize(node);
    editorEl.style.left = (canvasRect.left + node.position.x * zoom + vx) + "px";
    editorEl.style.top = (canvasRect.top + node.position.y * zoom + vy) + "px";
    editorEl.style.width = (w * zoom) + "px";
    editorEl.style.height = (h * zoom) + "px";
    editorEl.style.fontSize = (13 * zoom) + "px";
    return;
  }

  if (editing.kind === "port") {
    const node = diagram.nodes.find((n) => n.id === editing.containerId);
    const pa = node && portAnchor(node, editing.portId);
    if (!pa) return;
    const W = 100, H = 22;
    const sx = canvasRect.left + pa.x * zoom + vx;
    const sy = canvasRect.top + pa.y * zoom + vy;
    let left, top;
    if (pa.side === "left") { left = sx - W - 8; top = sy - H / 2; }
    else if (pa.side === "right") { left = sx + 8; top = sy - H / 2; }
    else { left = sx - W / 2; top = sy - H - 8; }
    editorEl.style.left = left + "px";
    editorEl.style.top = top + "px";
    editorEl.style.width = W + "px";
    editorEl.style.height = H + "px";
    editorEl.style.fontSize = "12px";
    return;
  }

  // Edge: position over the handle (or the anchor midpoint when straight).
  const edge = diagram.edges.find((e) => e.id === editing.id);
  if (!edge) return;
  const a = diagram.nodes.find((n) => n.id === edge.source);
  const b = diagram.nodes.find((n) => n.id === edge.target);
  if (!a || !b) return;
  const { pa, pb } = anchorsFor(edge, a, b);
  const handle = edgeHandlePos(edge, pa, pb);
  const midX = handle.x;
  const midY = handle.y;
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

// Inline-edits a container port's name from outside; writes through to the
// interface node inside the subdiagram (the single source of truth).
function startEditPort(containerId, portId) {
  const node = diagram.nodes.find((n) => n.id === containerId);
  const ports = node && subPorts.get(node.data.subdiagramId);
  const port = ports && ports.find((p) => p.id === portId);
  if (!port) return;
  selectedIds.clear();
  selectedEdgeId = null;
  editing = { kind: "port", containerId, portId };
  editorEl.value = port.label || "";
  dragging = null;
  editorEl.hidden = false;
  positionEditor();
  requestAnimationFrame(() => { editorEl.focus(); editorEl.select(); });
  render();
}

async function setPortLabel(containerId, portId, label) {
  const node = diagram.nodes.find((n) => n.id === containerId);
  if (!node || !node.data.subdiagramId) return;
  try {
    const sd = await api("GET", `/api/diagrams/${node.data.subdiagramId}`);
    const inner = sd.nodes.find((n) => n.id === portId);
    if (!inner || (inner.data.label || "") === label) return;
    inner.data.label = label;
    await api("PUT", `/api/diagrams/${node.data.subdiagramId}`, {
      name: sd.name, nodes: sd.nodes, edges: sd.edges, viewport: sd.viewport,
    });
    await loadSubdiagramPorts();
    setStatus("port renamed");
  } catch (e) {
    setStatus("rename failed");
    console.error(e);
  }
}

function commitEdit(value) {
  if (!editing) return;
  const v = (value || "").trim();
  let changed = false;
  if (editing.kind === "port") {
    const { containerId, portId } = editing;
    editing = null;
    editorEl.hidden = true;
    setPortLabel(containerId, portId, v); // async; refreshes on its own
    return;
  }
  if (editing.kind === "node") {
    const node = diagram.nodes.find((n) => n.id === editing.id);
    // Empty input is allowed — node renders with no label.
    if (node && node.data.label !== v) {
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

  // Clicking a container's "+" affordance adds an interface port.
  const addPortEl = evt.target.closest(".add-port");
  if (addPortEl) {
    evt.stopPropagation();
    const node = diagram.nodes.find((n) => n.id === addPortEl.dataset.id);
    if (node) addPortToContainer(node, addPortEl.dataset.role);
    return;
  }

  // A port disc: double-click renames it (writes through to the inner node),
  // single drag starts an edge anchored at that port.
  const portEl = evt.target.closest(".port");
  if (portEl) {
    evt.stopPropagation();
    const containerEl = portEl.closest(".node");
    if (evt.detail >= 2) {
      startEditPort(containerEl.dataset.id, portEl.dataset.portId);
      return;
    }
    pendingEdge = {
      sourceId: containerEl.dataset.id,
      sourcePort: portEl.dataset.portId,
      cursor: clientToModel(evt),
    };
    syncPendingEdge();
    return;
  }

  // n8n-style: clicking the "+" handle starts a pending edge from that node.
  const handleEl = evt.target.closest(".conn-handle");
  if (handleEl) {
    evt.stopPropagation();
    pendingEdge = { sourceId: handleEl.dataset.id, cursor: clientToModel(evt) };
    syncPendingEdge();
    return;
  }

  // Mousedown on the curvature handle of a selected edge starts a drag that
  // moves its single control point.
  const edgeHandleEl = evt.target.closest(".edge-handle");
  if (edgeHandleEl) {
    evt.stopPropagation();
    edgeDrag = { edgeId: edgeHandleEl.dataset.id, snapshot: snapshot() };
    return;
  }

  const nodeEl = evt.target.closest(".node");
  const edgeEl = evt.target.closest(".edge-group");

  // Double-click on a node or edge enters in-place edit. Detected via
  // evt.detail because we re-render on every click, which destroys the
  // target the browser uses to correlate native `dblclick` events.
  if (nodeEl && evt.detail >= 2) {
    const node = diagram.nodes.find((n) => n.id === nodeEl.dataset.id);
    if (node && node.data.subdiagramId) {
      enterSubdiagram(node);
    } else {
      startEdit("node", nodeEl.dataset.id);
    }
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

// While dragging, snap the moving selection into alignment with static nodes
// (left/center/right, top/center/bottom), Figma-style. Mutates the moving
// nodes' positions by a small delta and records guide lines for render().
function snapDraggingToGuides() {
  alignGuides = [];
  if (!dragging) return;
  const movingIds = new Set(dragging.offsets.keys());
  const moving = diagram.nodes.filter((n) => movingIds.has(n.id));
  if (moving.length === 0) return;

  let mMinX = Infinity, mMinY = Infinity, mMaxX = -Infinity, mMaxY = -Infinity;
  for (const n of moving) {
    const { w, h } = nodeSize(n);
    mMinX = Math.min(mMinX, n.position.x);
    mMinY = Math.min(mMinY, n.position.y);
    mMaxX = Math.max(mMaxX, n.position.x + w);
    mMaxY = Math.max(mMaxY, n.position.y + h);
  }
  const mCx = (mMinX + mMaxX) / 2, mCy = (mMinY + mMaxY) / 2;
  const thr = SNAP_PX / (diagram.viewport.zoom || 1);

  // Candidate alignment lines from every static node: vertical lines carry the
  // node's y-extent (for drawing), horizontal lines carry its x-extent.
  const vCand = [], hCand = [];
  for (const n of diagram.nodes) {
    if (movingIds.has(n.id)) continue;
    const { w, h } = nodeSize(n);
    const l = n.position.x, r = l + w, t = n.position.y, b = t + h;
    for (const x of [l, l + w / 2, r]) vCand.push({ c: x, lo: t, hi: b });
    for (const y of [t, t + h / 2, b]) hCand.push({ c: y, lo: l, hi: r });
  }

  let bestV = null;
  for (const mx of [mMinX, mCx, mMaxX]) {
    for (const cand of vCand) {
      const d = Math.abs(mx - cand.c);
      if (d <= thr && (!bestV || d < bestV.d)) bestV = { d, delta: cand.c - mx, ...cand };
    }
  }
  let bestH = null;
  for (const my of [mMinY, mCy, mMaxY]) {
    for (const cand of hCand) {
      const d = Math.abs(my - cand.c);
      if (d <= thr && (!bestH || d < bestH.d)) bestH = { d, delta: cand.c - my, ...cand };
    }
  }

  const dx = bestV ? bestV.delta : 0;
  const dy = bestH ? bestH.delta : 0;
  if (dx || dy) for (const n of moving) { n.position.x += dx; n.position.y += dy; }

  if (bestV) {
    alignGuides.push({ x1: bestV.c, y1: Math.min(mMinY + dy, bestV.lo), x2: bestV.c, y2: Math.max(mMaxY + dy, bestV.hi) });
  }
  if (bestH) {
    alignGuides.push({ x1: Math.min(mMinX + dx, bestH.lo), y1: bestH.c, x2: Math.max(mMaxX + dx, bestH.hi), y2: bestH.c });
  }
}

function drawAlignGuides() {
  guidesLayer.innerHTML = "";
  for (const g of alignGuides) {
    guidesLayer.appendChild(svg("line", {
      class: "align-guide", x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2,
    }));
  }
}

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
  if (edgeDrag) {
    const edge = diagram.edges.find((e) => e.id === edgeDrag.edgeId);
    if (!edge) return;
    const a = diagram.nodes.find((n) => n.id === edge.source);
    const b = diagram.nodes.find((n) => n.id === edge.target);
    if (!a || !b) return;
    const { pa, pb } = anchorsFor(edge, a, b);
    const mid = edgeMidpoint(pa, pb);
    const p = clientToModel(evt);
    edge.curvature = { ox: p.x - mid.x, oy: p.y - mid.y };
    edgeDrag.moved = true;
    render();
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
  snapDraggingToGuides();
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
    // Dropping on a port binds that endpoint to it; otherwise the node as a whole.
    const portEl = evt.target.closest && evt.target.closest(".port");
    const targetNode = portEl ? portEl.closest(".node") : (evt.target.closest && evt.target.closest(".node"));
    if (targetNode) {
      const targetId = targetNode.dataset.id;
      const targetPort = portEl ? portEl.dataset.portId : undefined;
      const sp = pendingEdge.sourcePort;
      if (targetId !== pendingEdge.sourceId) {
        if (edgeExistsExact(pendingEdge.sourceId, targetId, sp, targetPort)) {
          setStatus("already connected");
        } else {
          pushHistory();
          const edge = { id: uid(), source: pendingEdge.sourceId, target: targetId };
          if (sp) edge.sourcePort = sp;
          if (targetPort) edge.targetPort = targetPort;
          diagram.edges.push(edge);
          save();
        }
      }
      pendingEdge = null;
      render();
      return;
    }
    // Dropped in empty space → offer to create a node, already wired to the
    // source, right where it was released.
    const pending = { sourceId: pendingEdge.sourceId, sourcePort: pendingEdge.sourcePort };
    const modelPos = clientToModel(evt);
    pendingEdge = null;
    render();
    showContextMenu(evt.clientX, evt.clientY, connectCreateMenu(pending, modelPos));
    return;
  }
  if (edgeDrag) {
    if (edgeDrag.moved) {
      pushHistory(edgeDrag.snapshot);
      save();
    }
    edgeDrag = null;
    return;
  }
  if (lasso) {
    const box = lassoBBox();
    // A tiny drag (≤3 model px in either axis) is treated as a plain click
    // on empty: keep the deselection that the mousedown already applied.
    if (box.w > 3 || box.h > 3) {
      const next = lasso.additive ? new Set(lasso.baseSelection) : new Set();
      for (const n of diagram.nodes) {
        const { w: nw, h: nh } = nodeSize(n);
        const nb = { x: n.position.x, y: n.position.y, w: nw, h: nh };
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
  if (alignGuides.length) {
    alignGuides = [];
    render();
  }
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
  if (mod && key === "a") {
    evt.preventDefault();
    selectedIds = new Set(diagram.nodes.map((n) => n.id));
    selectedEdgeId = null;
    render();
    return;
  }
  if (mod && key === "d") {
    evt.preventDefault();
    duplicateSelection();
    return;
  }

  // Alt+←/→ walk the navigation history; F fits everything in view.
  if (evt.altKey && evt.key === "ArrowLeft") {
    evt.preventDefault();
    navBack();
    return;
  }
  if (evt.altKey && evt.key === "ArrowRight") {
    evt.preventDefault();
    navForward();
    return;
  }
  if (!mod && !evt.altKey && key === "f") {
    evt.preventDefault();
    fitView();
    return;
  }

  // Arrow keys nudge the selected nodes (Shift = 10px steps). A burst of
  // nudges collapses into a single undo step via a short debounce.
  if (!mod && !evt.altKey && selectedIds.size > 0 &&
      (evt.key === "ArrowUp" || evt.key === "ArrowDown" ||
       evt.key === "ArrowLeft" || evt.key === "ArrowRight")) {
    evt.preventDefault();
    const step = evt.shiftKey ? 10 : 1;
    const dx = evt.key === "ArrowLeft" ? -step : evt.key === "ArrowRight" ? step : 0;
    const dy = evt.key === "ArrowUp" ? -step : evt.key === "ArrowDown" ? step : 0;
    if (nudgeHistoryTimer === null) pushHistory();
    clearTimeout(nudgeHistoryTimer);
    nudgeHistoryTimer = setTimeout(() => { nudgeHistoryTimer = null; }, 600);
    for (const id of selectedIds) {
      const n = diagram.nodes.find((x) => x.id === id);
      if (n) { n.position.x += dx; n.position.y += dy; }
    }
    save();
    render();
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
  if (!id) return; // section header / empty row

  // Chevron toggles this path's children (lazy, recursion-safe).
  const chev = evt.target.closest(".sb-chevron");
  if (chev && !chev.classList.contains("leaf")) {
    evt.stopPropagation();
    const path = li.dataset.path;
    if (expandedPaths.has(path)) expandedPaths.delete(path);
    else expandedPaths.add(path);
    renderSidebar([...sidebarById.values()], sidebarActiveId);
    return;
  }

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

  // Open the clicked diagram, adopting the tree path as the drill path so the
  // sidebar reveals/highlights this exact occurrence (VS Code style).
  const path = li.dataset.path;
  if (path === sidebarActivePath) return; // already here, on this path
  const ids = path.split("/");
  const prevBreadcrumb = breadcrumb;
  breadcrumb = ids.slice(0, -1).map((pid) => ({ id: pid, name: (sidebarById.get(pid) || {}).name || "…" }));
  try {
    await loadDiagram(ids[ids.length - 1], { push: true, keepBreadcrumb: true });
  } catch (e) {
    // The diagram was likely deleted elsewhere; restore state and resync the
    // sidebar so the stale entry disappears, instead of leaking a rejection.
    breadcrumb = prevBreadcrumb;
    setStatus("couldn't open diagram");
    console.error(e);
    await refreshSidebar();
  }
});

// Double-click a name to rename in place.
sidebarListEl.addEventListener("dblclick", (evt) => {
  const nameEl = evt.target.closest(".name");
  if (!nameEl) return;
  const li = nameEl.parentElement;
  startRename(li, nameEl);
});

// Right-click a sidebar item to convert between a top-level diagram and a
// reusable subdiagram (library component).
sidebarListEl.addEventListener("contextmenu", (evt) => {
  const li = evt.target.closest("li.diagram-item");
  if (!li) return;
  evt.preventDefault();
  const id = li.dataset.id;
  const meta = sidebarById.get(id);
  if (!meta) return;
  const items = meta.component
    ? [{ label: "Convert to diagram", action: () => setDiagramComponent(id, false) }]
    : [{ label: "Convert to subdiagram", action: () => setDiagramComponent(id, true) }];
  items.push({ separator: true });
  items.push({ label: "Delete", action: () => deleteDiagramById(id, meta.name) });
  showContextMenu(evt.clientX, evt.clientY, items);
});

// Drag a sidebar item onto the canvas to drop it in as a container node.
const DND_TYPE = "application/x-diagramer-id";
sidebarListEl.addEventListener("dragstart", (evt) => {
  const li = evt.target.closest("li.diagram-item");
  if (!li) { evt.preventDefault(); return; }
  const id = li.dataset.id;
  const name = (sidebarById.get(id) || {}).name || "";
  evt.dataTransfer.setData(DND_TYPE, id);
  evt.dataTransfer.setData("text/plain", name);
  evt.dataTransfer.effectAllowed = "copy";
  li.classList.add("dragging");
});
sidebarListEl.addEventListener("dragend", (evt) => {
  const li = evt.target.closest("li.diagram-item");
  if (li) li.classList.remove("dragging");
  canvas.classList.remove("drop-target");
});

canvas.addEventListener("dragover", (evt) => {
  if (![...evt.dataTransfer.types].includes(DND_TYPE)) return;
  evt.preventDefault();
  evt.dataTransfer.dropEffect = "copy";
  canvas.classList.add("drop-target");
});
canvas.addEventListener("dragleave", (evt) => {
  if (!canvas.contains(evt.relatedTarget)) canvas.classList.remove("drop-target");
});
canvas.addEventListener("drop", (evt) => {
  const id = evt.dataTransfer.getData(DND_TYPE);
  if (!id) return;
  evt.preventDefault();
  canvas.classList.remove("drop-target");
  const name = evt.dataTransfer.getData("text/plain") || (sidebarById.get(id) || {}).name || "Subdiagram";
  const { x, y } = clientToModel(evt);
  addContainerRef(id, name, x, y);
});

async function setDiagramComponent(id, component) {
  try {
    await api("PATCH", `/api/diagrams/${id}`, { component });
    await refreshSidebar();
    setStatus(component ? "moved to subdiagrams" : "moved to diagrams");
  } catch (e) {
    setStatus("convert failed");
    console.error(e);
  }
}

async function deleteDiagramById(id, name) {
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    await api("DELETE", `/api/diagrams/${id}`);
  } catch (e) {
    setStatus("delete failed");
    console.error(e);
    return;
  }
  if (diagram && diagram.id === id) {
    const list = (await api("GET", "/api/diagrams")) || [];
    let next = list[0] || (await api("POST", "/api/diagrams", { name: "Untitled" }));
    renderSidebar(list.length ? list : [next], next.id);
    await loadDiagram(next.id, { push: true });
  } else {
    await refreshSidebar();
  }
}

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
        const { etag } = await api(
          "PATCH",
          `/api/diagrams/${id}`,
          { name: newName },
          { wantEtag: true }
        );
        if (diagram && diagram.id === id) {
          diagram.name = newName;
          renderBreadcrumb();
          document.title = `${newName} — diagramer`;
          // Rename bumps UpdatedAt server-side; refresh our cached ETag so
          // the next content save doesn't 412.
          currentEtag = etag;
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

// ---------- tidy up (auto-layout) ----------

// Re-positions every node into clean columns derived from the edge graph.
// Algorithm: Kahn-ish BFS from sources to assign each node a "level"
// (longest path from any source). Nodes in cycles or fully disconnected
// fall back to level 0. Levels become columns left-to-right, with nodes
// inside each column stacked vertically and centred.
function tidyUp() {
  if (!diagram || diagram.nodes.length === 0) return;

  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const inAdj = new Map();
  const outAdj = new Map();
  const deg = new Map();
  for (const n of diagram.nodes) {
    inAdj.set(n.id, []);
    outAdj.set(n.id, []);
    deg.set(n.id, 0);
  }
  for (const e of diagram.edges) {
    if (byId.has(e.source) && byId.has(e.target)) {
      outAdj.get(e.source).push(e.target);
      inAdj.get(e.target).push(e.source);
      deg.set(e.source, deg.get(e.source) + 1);
      deg.set(e.target, deg.get(e.target) + 1);
    }
  }

  // Longest-path levels over connected nodes; orphans (no edges) are excluded
  // and parked in a row below so they don't crowd column 0.
  const level = new Map();
  const queue = [];
  for (const n of diagram.nodes) {
    if (deg.get(n.id) > 0 && inAdj.get(n.id).length === 0) {
      level.set(n.id, 0);
      queue.push(n.id);
    }
  }
  while (queue.length) {
    const id = queue.shift();
    const next = level.get(id) + 1;
    for (const tgt of outAdj.get(id)) {
      if (!level.has(tgt) || level.get(tgt) < next) {
        level.set(tgt, next);
        queue.push(tgt);
      }
    }
  }
  // Connected nodes left unleveled (pure cycles) → level 0.
  for (const n of diagram.nodes) {
    if (deg.get(n.id) > 0 && !level.has(n.id)) level.set(n.id, 0);
  }

  const cols = new Map();
  const orphans = [];
  let maxLevel = 0;
  for (const n of diagram.nodes) {
    if (deg.get(n.id) === 0) {
      orphans.push(n);
      continue;
    }
    const lvl = level.get(n.id);
    if (!cols.has(lvl)) cols.set(lvl, []);
    cols.get(lvl).push(n);
    if (lvl > maxLevel) maxLevel = lvl;
  }

  // Crossing reduction: alternate median sweeps reorder each column by the
  // median rank of its neighbors in the adjacent column (Sugiyama-style).
  const posInCol = new Map();
  for (let lvl = 0; lvl <= maxLevel; lvl++) {
    const col = cols.get(lvl) || [];
    col.forEach((n, p) => posInCol.set(n.id, p));
  }
  const median = (neigh) => {
    const ps = neigh.map((id) => posInCol.get(id)).filter((p) => p !== undefined);
    if (ps.length === 0) return -1;
    ps.sort((a, b) => a - b);
    const m = ps.length;
    return m % 2 ? ps[(m - 1) / 2] : (ps[m / 2 - 1] + ps[m / 2]) / 2;
  };
  const reorder = (lvl, useIn) => {
    const col = cols.get(lvl);
    if (!col) return;
    const key = new Map();
    for (const n of col) {
      let med = median(useIn ? inAdj.get(n.id) : outAdj.get(n.id));
      if (med < 0) med = posInCol.get(n.id); // no neighbors → keep spot
      key.set(n.id, med);
    }
    col.sort((a, b) => key.get(a.id) - key.get(b.id));
    col.forEach((n, p) => posInCol.set(n.id, p));
  };
  for (let s = 0; s < 4; s++) {
    if (s % 2 === 0) {
      for (let lvl = 1; lvl <= maxLevel; lvl++) reorder(lvl, true);
    } else {
      for (let lvl = maxLevel - 1; lvl >= 0; lvl--) reorder(lvl, false);
    }
  }

  // Label-aware spacing: a forward edge's label sits between its columns, so
  // widen that gap to fit the widest label crossing it.
  const labelGap = new Map();
  for (const e of diagram.edges) {
    const ls = level.get(e.source);
    const lt = level.get(e.target);
    if (ls !== undefined && lt === ls + 1 && e.label) {
      const w = _measureCtx.measureText(e.label).width + 24;
      if (w > (labelGap.get(ls) || 0)) labelGap.set(ls, w);
    }
  }

  pushHistory();
  const GAP_X = 80;
  const GAP_Y = 30;
  let cursorX = 0;
  let maxBottom = -Infinity;
  for (let lvl = 0; lvl <= maxLevel; lvl++) {
    const colNodes = cols.get(lvl);
    if (!colNodes || colNodes.length === 0) continue;
    const sizes = colNodes.map((n) => nodeSize(n));
    const colW = Math.max(...sizes.map((s) => s.w));
    const totalH =
      sizes.reduce((sum, s) => sum + s.h, 0) + GAP_Y * (colNodes.length - 1);
    let cursorY = -totalH / 2;
    for (let i = 0; i < colNodes.length; i++) {
      const n = colNodes[i];
      const s = sizes[i];
      n.position.x = cursorX + (colW - s.w) / 2;
      n.position.y = cursorY;
      cursorY += s.h + GAP_Y;
      if (n.position.y + s.h > maxBottom) maxBottom = n.position.y + s.h;
    }
    cursorX += colW + Math.max(GAP_X, labelGap.get(lvl) || 0);
  }

  if (orphans.length) {
    const orphanY = maxBottom === -Infinity ? 0 : maxBottom + GAP_Y * 2;
    let x = 0;
    for (const n of orphans) {
      n.position.x = x;
      n.position.y = orphanY;
      x += nodeSize(n).w + GAP_X;
    }
  }

  save();
  render();
  setStatus("tidied");
}

tidyBtn.addEventListener("click", tidyUp);

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
    if (it.swatch) {
      const sw = document.createElement("span");
      sw.className = "ctx-swatch";
      sw.style.background = it.swatch;
      btn.prepend(sw);
    }
    btn.addEventListener("click", () => {
      // Items with a submenu replace the current menu in place; everything
      // else closes the menu then runs its action.
      if (it.submenu) {
        const r = ctxMenuEl.getBoundingClientRect();
        showContextMenu(r.left, r.top, it.submenu());
        return;
      }
      hideContextMenu();
      if (it.action) it.action();
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
    const rights = nodes.map((n) => n.position.x + nodeSize(n).w);
    let target;
    if (mode === "min") target = Math.min(...lefts);
    else if (mode === "max") target = Math.max(...rights);
    else target = (Math.min(...lefts) + Math.max(...rights)) / 2;
    for (const n of nodes) {
      const w = nodeSize(n).w;
      if (mode === "min") n.position.x = target;
      else if (mode === "max") n.position.x = target - w;
      else n.position.x = target - w / 2;
    }
  } else {
    const tops = nodes.map((n) => n.position.y);
    const bottoms = nodes.map((n) => n.position.y + nodeSize(n).h);
    let target;
    if (mode === "min") target = Math.min(...tops);
    else if (mode === "max") target = Math.max(...bottoms);
    else target = (Math.min(...tops) + Math.max(...bottoms)) / 2;
    for (const n of nodes) {
      const h = nodeSize(n).h;
      if (mode === "min") n.position.y = target;
      else if (mode === "max") n.position.y = target - h;
      else n.position.y = target - h / 2;
    }
  }
  save();
  render();
}

function emptyMenuItems(modelPos) {
  // Same add options as the + Add button, flattened (no "Add ▸" submenu), but
  // dropping nodes at the cursor instead of the viewport center.
  return [
    ...addMenuItems(
      (kind) => addBoxAt(modelPos.x, modelPos.y, kind),
      () => addContainer(modelPos.x, modelPos.y),
      (role) => addPortNode(role, modelPos.x, modelPos.y),
    ),
    { separator: true },
    { label: "Tidy up", action: tidyUp },
  ];
}

// Connects a pending edge's source (honoring its port) to a just-created node.
function connectPendingTo(pending, targetId) {
  if (!pending || !targetId || targetId === pending.sourceId) return;
  const sp = pending.sourcePort;
  if (edgeExistsExact(pending.sourceId, targetId, sp, undefined)) {
    setStatus("already connected");
    return;
  }
  pushHistory();
  const edge = { id: uid(), source: pending.sourceId, target: targetId };
  if (sp) edge.sourcePort = sp;
  diagram.edges.push(edge);
  save();
  render();
}

// Menu shown when a connection is dropped on empty canvas: pick what to create
// and it lands at the cursor already wired to the dragged-from source.
function connectCreateMenu(pending, modelPos) {
  return addMenuItems(
    (kind) => {
      const id = addBoxAt(modelPos.x, modelPos.y, kind);
      if (id) connectPendingTo(pending, id);
    },
    async () => {
      const id = await addContainer(modelPos.x, modelPos.y);
      if (id) connectPendingTo(pending, id);
    },
    (role) => {
      const id = addPortNode(role, modelPos.x, modelPos.y);
      if (id) connectPendingTo(pending, id);
    },
  );
}

// Dark-theme palette: muted fill + a brighter coordinated stroke. "Default"
// clears both back to the CSS fallback.
const COLOR_PRESETS = [
  { name: "Default", fill: null,      stroke: null,      swatch: "#1f2937" },
  { name: "Blue",    fill: "#13315c", stroke: "#3b82f6", swatch: "#3b82f6" },
  { name: "Green",   fill: "#14432a", stroke: "#22c55e", swatch: "#22c55e" },
  { name: "Amber",   fill: "#422006", stroke: "#f59e0b", swatch: "#f59e0b" },
  { name: "Red",     fill: "#450a0a", stroke: "#ef4444", swatch: "#ef4444" },
  { name: "Purple",  fill: "#3b0764", stroke: "#a855f7", swatch: "#a855f7" },
  { name: "Teal",    fill: "#0f3d3e", stroke: "#14b8a6", swatch: "#14b8a6" },
];

function setNodeColor(ids, preset) {
  const targets = [...ids]
    .map((id) => diagram.nodes.find((n) => n.id === id))
    .filter(Boolean);
  if (targets.length === 0) return;
  pushHistory();
  for (const n of targets) {
    if (preset.fill) n.data.fill = preset.fill;
    else delete n.data.fill;
    if (preset.stroke) n.data.stroke = preset.stroke;
    else delete n.data.stroke;
  }
  save();
  render();
}

function colorMenuItems(ids) {
  return COLOR_PRESETS.map((p) => ({
    label: p.name,
    swatch: p.swatch,
    action: () => setNodeColor(ids, p),
  }));
}

function singleNodeMenuItems(id) {
  const node = diagram.nodes.find((n) => n.id === id);
  const sub = node && node.data.subdiagramId
    ? { label: "Open subdiagram", action: () => enterSubdiagram(node) }
    : { label: "Create subdiagram", action: () => createSubdiagram(id) };
  return [
    { label: "Edit text", action: () => startEdit("node", id) },
    {
      label: "Change type ▸",
      submenu: () => kindMenuItems((kind) => changeNodeKind(id, kind)),
    },
    { label: "Color ▸", submenu: () => colorMenuItems(new Set([id])) },
    { label: "Interface ▸", submenu: () => interfaceMenuItems(id) },
    { separator: true },
    sub,
    { separator: true },
    { label: "Delete", action: () => deleteSelected() },
  ];
}

// Marks a node as part of its diagram's interface (so it becomes a port on any
// container referencing this diagram), or clears the role.
function interfaceMenuItems(id) {
  const node = diagram.nodes.find((n) => n.id === id);
  const cur = node ? node.data.port || "" : "";
  const item = (role, label) => ({
    label: (cur === role ? "✓ " : "") + label,
    action: () => setNodePort(id, role),
  });
  return [
    item("in", "Input (left)"),
    item("out", "Output (right)"),
    item("dep", "Dependency (top)"),
    { separator: true },
    item("", "None"),
  ];
}

function setNodePort(id, role) {
  const node = diagram.nodes.find((n) => n.id === id);
  if (!node) return;
  if ((node.data.port || "") === role) return;
  pushHistory();
  if (role) node.data.port = role;
  else delete node.data.port;
  save();
  render();
  setStatus(role ? `marked as ${role}` : "interface role cleared");
}

function changeNodeKind(id, kind) {
  const node = diagram.nodes.find((n) => n.id === id);
  if (!node) return;
  const cur = node.kind || "box";
  if (cur === kind) return;
  pushHistory();
  if (kind && kind !== "box") node.kind = kind;
  else delete node.kind;
  save();
  render();
}

function singleEdgeMenuItems(id) {
  const edge = diagram.edges.find((e) => e.id === id);
  const items = [{ label: "Edit label", action: () => startEdit("edge", id) }];
  if (edge && edge.curvature) {
    items.push({ label: "Reset curvature", action: () => resetEdgeCurvature(id) });
  }
  items.push({ separator: true });
  items.push({ label: "Delete", action: () => deleteSelected() });
  return items;
}

function resetEdgeCurvature(id) {
  const edge = diagram.edges.find((e) => e.id === id);
  if (!edge || !edge.curvature) return;
  pushHistory();
  delete edge.curvature;
  save();
  render();
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
    { label: "Color ▸", submenu: () => colorMenuItems(new Set(selectedIds)) },
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
    if (n.data.fill !== undefined && typeof n.data.fill !== "string") return false;
    if (n.data.stroke !== undefined && typeof n.data.stroke !== "string") return false;
    if (n.data.port !== undefined && typeof n.data.port !== "string") return false;
  }
  for (const e of raw.edges) {
    if (typeof e.id !== "string" || typeof e.source !== "string" || typeof e.target !== "string") return false;
    if (e.label !== undefined && typeof e.label !== "string") return false;
    if (e.sourcePort !== undefined && typeof e.sourcePort !== "string") return false;
    if (e.targetPort !== undefined && typeof e.targetPort !== "string") return false;
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
  // Drop edges whose endpoints aren't in the file: the server rejects unknown
  // references, so one stray edge would otherwise fail the whole import.
  const nodeIds = new Set(raw.nodes.map((n) => n.id));
  const edges = raw.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  try {
    const created = await api("POST", "/api/diagrams", { name });
    await api("PUT", `/api/diagrams/${created.id}`, {
      name,
      nodes: raw.nodes,
      edges,
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

// Zoom/pan so the whole diagram fits the canvas — the "see everything" view.
// Coerce a persisted viewport into sane bounds. A hand-edited or corrupt file
// can carry zoom=0 / NaN / missing fields, which would propagate NaN/Infinity
// into every model↔screen conversion (the minimap divides by zoom). Heal at the
// load boundary so the rest of the code can trust the viewport.
function sanitizeViewport(d) {
  const v = (d.viewport = d.viewport || { x: 0, y: 0, zoom: 1 });
  v.zoom = Number.isFinite(v.zoom) && v.zoom > 0
    ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.zoom))
    : 1;
  if (!Number.isFinite(v.x)) v.x = 0;
  if (!Number.isFinite(v.y)) v.y = 0;
}

function fitView() {
  if (!diagram) return;
  const b = nodesBBox();
  const rect = canvas.getBoundingClientRect();
  const zoom = Math.max(
    ZOOM_MIN,
    Math.min(ZOOM_MAX, Math.min(rect.width / b.w, rect.height / b.h)),
  );
  diagram.viewport.zoom = zoom;
  diagram.viewport.x = rect.width / 2 - (b.x + b.w / 2) * zoom;
  diagram.viewport.y = rect.height / 2 - (b.y + b.h / 2) * zoom;
  applyViewport();
  save();
}

function nodesBBox() {
  if (diagram.nodes.length === 0) {
    return { x: -200, y: -100, w: 400, h: 200 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of diagram.nodes) {
    const { w, h } = nodeSize(n);
    if (n.position.x < minX) minX = n.position.x;
    if (n.position.y < minY) minY = n.position.y;
    if (n.position.x + w > maxX) maxX = n.position.x + w;
    if (n.position.y + h > maxY) maxY = n.position.y + h;
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
  // The standalone SVG's root is the <svg> itself, so carrying data-theme here
  // makes the :root[data-theme="light"] overrides apply in the exported file.
  cloned.setAttribute("data-theme", currentTheme());
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
    // Match the in-app background of the active theme.
    const bg =
      getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() ||
      "#0b0b0d";
    ctx.fillStyle = bg;
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
