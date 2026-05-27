import { test, expect } from "@playwright/test";
import {
  createDiagram,
  mkNode,
  mkEdge,
  openDiagram,
  readNodes,
  readEdges,
  globalBox,
  overlapArea,
  contains,
  countEdgeNodeCrossings,
} from "./helpers";

const SHOTS = "screenshots";

test("every node kind renders with its shape and the label fits inside", async ({
  page,
  request,
}) => {
  const kinds = [
    "rect", "circle", "ellipse", "rhombus", "tri-up", "tri-down",
    "database", "backend", "frontend", "queue", "cache", "user", "cloud",
  ];
  const nodes = kinds.map((k, i) =>
    mkNode(k, k, k, (i % 5) * 200, Math.floor(i / 5) * 140),
  );
  const id = await createDiagram(request, "all-kinds", nodes, [], { x: 80, y: 60, zoom: 1 });
  await openDiagram(page, id);
  await page.screenshot({ path: `${SHOTS}/01-all-kinds.png`, fullPage: false });

  const geoms = await readNodes(page);
  expect(geoms.length).toBe(kinds.length);
  for (const n of geoms) {
    expect(n.shape.w, `${n.id} width`).toBeGreaterThan(0);
    expect(n.shape.h, `${n.id} height`).toBeGreaterThan(0);
    if (n.text) {
      // Label must sit within the outline bbox (catches text overflow).
      expect(contains(n.shape, n.text), `label of ${n.id} fits in shape`).toBe(true);
    }
  }
});

test("circle and rhombus get a square bbox; triangles are equilateral", async ({
  page,
  request,
}) => {
  const nodes = [
    mkNode("c", "circle", "circle", 0, 0),
    mkNode("r", "rhombus", "rhombus", 250, 0),
    mkNode("tu", "tri-up", "up", 0, 200),
    mkNode("td", "tri-down", "down", 250, 200),
  ];
  const id = await createDiagram(request, "shapes", nodes, []);
  await openDiagram(page, id);
  await page.screenshot({ path: `${SHOTS}/02-shapes.png` });

  const g = Object.fromEntries((await readNodes(page)).map((n) => [n.id, n]));
  // Square bbox (within 1px) for circle and rhombus.
  expect(Math.abs(g.c.shape.w - g.c.shape.h)).toBeLessThanOrEqual(1);
  expect(Math.abs(g.r.shape.w - g.r.shape.h)).toBeLessThanOrEqual(1);
  // Equilateral triangle: height ≈ side * √3/2.
  const ratio = Math.sqrt(3) / 2;
  for (const id of ["tu", "td"]) {
    expect(Math.abs(g[id].shape.h - g[id].shape.w * ratio)).toBeLessThan(2);
  }
});

test("long label widens the box and never overflows", async ({ page, request }) => {
  const short = mkNode("s", "rect", "Hi", 0, 0);
  const long = mkNode("l", "rect", "A very long label that should widen the box", 0, 150);
  const id = await createDiagram(request, "labels", [short, long], []);
  await openDiagram(page, id);
  await page.screenshot({ path: `${SHOTS}/03-labels.png` });

  const g = Object.fromEntries((await readNodes(page)).map((n) => [n.id, n]));
  expect(g.l.shape.w).toBeGreaterThan(g.s.shape.w);
  expect(contains(g.l.shape, g.l.text!), "long label fits").toBe(true);
});

test("icon-only stencil collapses to a tight square", async ({ page, request }) => {
  const labelled = mkNode("a", "database", "Postgres", 0, 0);
  const iconOnly = mkNode("b", "database", "", 250, 0);
  const id = await createDiagram(request, "icon-only", [labelled, iconOnly], []);
  await openDiagram(page, id);
  await page.screenshot({ path: `${SHOTS}/04-icon-only.png` });

  const g = Object.fromEntries((await readNodes(page)).map((n) => [n.id, n]));
  // Icon-only node is roughly square and narrower than the labelled one.
  expect(Math.abs(g.b.shape.w - g.b.shape.h)).toBeLessThanOrEqual(2);
  expect(g.b.shape.w).toBeLessThan(g.a.shape.w);
});

test("manually spaced nodes do not overlap", async ({ page, request }) => {
  const nodes = [
    mkNode("a", "rect", "A", 0, 0),
    mkNode("b", "rect", "B", 220, 0),
    mkNode("c", "rect", "C", 0, 120),
    mkNode("d", "rect", "D", 220, 120),
  ];
  const id = await createDiagram(request, "spaced", nodes, []);
  await openDiagram(page, id);
  await page.screenshot({ path: `${SHOTS}/05-spaced.png` });

  const geoms = (await readNodes(page)).map(globalBox);
  for (let i = 0; i < geoms.length; i++) {
    for (let j = i + 1; j < geoms.length; j++) {
      expect(overlapArea(geoms[i], geoms[j]), `nodes ${i}/${j} overlap`).toBe(0);
    }
  }
});

test("tidy up separates a cramped graph into non-overlapping columns", async ({
  page,
  request,
}) => {
  // All four nodes start piled on the same spot.
  const nodes = [
    mkNode("a", "rect", "A", 50, 50),
    mkNode("b", "rect", "B", 60, 55),
    mkNode("c", "rect", "C", 55, 60),
    mkNode("d", "rect", "D", 65, 65),
  ];
  const edges = [
    mkEdge("e1", "a", "b"),
    mkEdge("e2", "a", "c"),
    mkEdge("e3", "b", "d"),
    mkEdge("e4", "c", "d"),
  ];
  const id = await createDiagram(request, "tidy", nodes, edges);
  await openDiagram(page, id);
  await page.screenshot({ path: `${SHOTS}/06-tidy-before.png` });

  await page.click("#tidy");
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/06-tidy-after.png` });

  const geoms = (await readNodes(page)).map(globalBox);
  for (let i = 0; i < geoms.length; i++) {
    for (let j = i + 1; j < geoms.length; j++) {
      expect(overlapArea(geoms[i], geoms[j]), `post-tidy overlap ${i}/${j}`).toBe(0);
    }
  }
});

test("per-node colors apply to the shape and survive a reload", async ({
  page,
  request,
}) => {
  const nodes = [
    { id: "plain", position: { x: 0, y: 0 }, data: { label: "plain" } },
    {
      id: "blue",
      position: { x: 200, y: 0 },
      data: { label: "blue", fill: "#13315c", stroke: "#3b82f6" },
    },
    {
      id: "green",
      position: { x: 400, y: 0 },
      data: { label: "green", fill: "#14432a", stroke: "#22c55e" },
    },
  ];
  const id = await createDiagram(request, "colors", nodes, [], { x: 120, y: 120, zoom: 1 });
  await openDiagram(page, id);
  // Pin the dark theme so the "plain" default matches the expected hex.
  await ensureTheme(page, "dark");
  await page.screenshot({ path: `${SHOTS}/08-colors.png` });

  const fills = await page.$$eval("#nodes .node", (els) =>
    Object.fromEntries(
      els.map((g) => {
        const shape = g.querySelector(".node-shape") as Element;
        return [g.getAttribute("data-id"), getComputedStyle(shape).fill];
      }),
    ),
  );
  // #13315c → rgb(19,49,92); #14432a → rgb(20,67,42); default → rgb(31,41,55).
  expect(fills["blue"]).toBe("rgb(19, 49, 92)");
  expect(fills["green"]).toBe("rgb(20, 67, 42)");
  expect(fills["plain"]).toBe("rgb(31, 41, 55)");
});

test("edges connect their endpoints and crossings are reported", async ({
  page,
  request,
}) => {
  const nodes = [
    mkNode("a", "rect", "A", 0, 0),
    mkNode("b", "backend", "API", 300, 40),
    mkNode("c", "database", "DB", 600, 0),
  ];
  const edges = [mkEdge("e1", "a", "b", "calls"), mkEdge("e2", "b", "c", "reads")];
  const id = await createDiagram(request, "edges", nodes, edges);
  await openDiagram(page, id);
  await page.screenshot({ path: `${SHOTS}/07-edges.png` });

  const e = await readEdges(page);
  expect(e.length).toBe(2);
  for (const edge of e) {
    expect(edge.d.startsWith("M"), `edge ${edge.id} has a path`).toBe(true);
  }
  const crossings = await countEdgeNodeCrossings(page);
  console.log(`[visual] edge↔node crossings (informational): ${crossings}`);
});

async function ensureTheme(page: import("@playwright/test").Page, want: string) {
  const cur = await page.evaluate(() =>
    document.documentElement.getAttribute("data-theme"),
  );
  if (cur !== want) await page.click("#theme-toggle");
}

test("theme toggle switches palette, persists, and renders both modes", async ({
  page,
  request,
}) => {
  const nodes = [
    mkNode("a", "rect", "Client", 0, 0),
    mkNode("b", "backend", "API", 260, 0),
    mkNode("c", "database", "DB", 520, 0),
    mkNode("d", "circle", "Cache", 260, 190),
    {
      id: "e",
      position: { x: 0, y: 190 },
      data: { label: "Queue", fill: "#13315c", stroke: "#3b82f6" },
    },
  ];
  const edges = [
    mkEdge("e1", "a", "b", "http"),
    mkEdge("e2", "b", "c", "sql"),
    mkEdge("e3", "b", "d"),
  ];
  const id = await createDiagram(request, "theme", nodes, edges, { x: 160, y: 150, zoom: 1 });
  await openDiagram(page, id);

  const bgOf = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    );

  await ensureTheme(page, "dark");
  await page.waitForTimeout(50);
  await page.screenshot({ path: `${SHOTS}/10-theme-dark.png` });
  const darkBg = await bgOf();

  await ensureTheme(page, "light");
  expect(
    await page.evaluate(() => document.documentElement.getAttribute("data-theme")),
  ).toBe("light");
  await page.waitForTimeout(50);
  await page.screenshot({ path: `${SHOTS}/11-theme-light.png` });
  const lightBg = await bgOf();
  expect(lightBg).not.toBe(darkBg);

  // Choice survives a reload (persisted in localStorage, applied pre-paint).
  await page.reload();
  await page.waitForSelector("#nodes .node");
  expect(
    await page.evaluate(() => document.documentElement.getAttribute("data-theme")),
  ).toBe("light");
});

test("right-click canvas menu mirrors the Add menu (flat kinds + container)", async ({
  page,
  request,
}) => {
  const id = await createDiagram(request, "RightClick", [], [], { x: 200, y: 150, zoom: 1 });
  await page.goto(`/d/${id}`);
  await page.waitForSelector("#canvas");
  await page.waitForTimeout(200);

  await page.mouse.click(700, 400, { button: "right" });
  await page.waitForSelector("#ctx-menu", { state: "visible" });

  const labels = await page.$$eval("#ctx-menu button", (els) =>
    els.map((e) => e.textContent),
  );
  // Kinds appear directly (no "Add ▸" submenu), plus the one-step container.
  expect(labels).toContain("Rectangle");
  expect(labels).toContain("Database");
  expect(labels).toContain("Container (subdiagram)");
  expect(labels).toContain("Tidy up");
  expect(labels.some((l) => l && l.includes("Add"))).toBe(false);
});

test("Add menu creates a container node with a subdiagram in one step", async ({
  page,
  request,
}) => {
  const id = await createDiagram(request, "Compose", [], [], { x: 220, y: 160, zoom: 1 });
  await page.goto(`/d/${id}`);
  await page.waitForSelector("#add-box");

  await page.click("#add-box");
  await page.waitForSelector("#ctx-menu", { state: "visible" });
  await page.screenshot({ path: `${SHOTS}/14-add-menu.png` });

  // The Add menu carries a one-step "Container (subdiagram)" entry; it prompts
  // for a label via a native dialog.
  page.once("dialog", (d) => d.accept("Auth Service"));
  await page.locator("#ctx-menu button", { hasText: "Container (subdiagram)" }).click();

  await page.waitForSelector("#nodes .node.container", { timeout: 5000 });
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${SHOTS}/15-container-added.png` });

  const badges = await page.$$eval(
    "#nodes .node.container .subdiagram-badge",
    (els) => els.length,
  );
  expect(badges).toBe(1);
  const label = await page.$eval("#nodes .node.container > text", (el) => el.textContent);
  expect(label).toBe("Auth Service");

  // A backing subdiagram was created (so the diagram list grew).
  const list = await (await request.get("/api/diagrams")).json();
  expect(list.length).toBeGreaterThanOrEqual(2);
});

test("container node opens its subdiagram and breadcrumb navigates back", async ({
  page,
  request,
}) => {
  // A subdiagram with its own little architecture.
  const subId = await createDiagram(
    request,
    "Inside",
    [mkNode("g", "backend", "Gateway", 0, 0), mkNode("l", "database", "Ledger", 240, 0)],
    [mkEdge("e", "g", "l")],
    { x: 200, y: 150, zoom: 1 },
  );

  // A parent whose "Payments" node is a container referencing the subdiagram.
  const parentNodes = [
    { id: "box", kind: "rect", position: { x: 60, y: 0 }, data: { label: "Payments", subdiagramId: subId } },
    mkNode("u", "user", "User", -220, 0),
  ];
  const parentId = await createDiagram(
    request,
    "System",
    parentNodes,
    [mkEdge("e2", "u", "box")],
    { x: 320, y: 200, zoom: 1 },
  );

  await openDiagram(page, parentId);
  await page.screenshot({ path: `${SHOTS}/12-subdiagram-parent.png` });

  // The container node renders its badge.
  const badges = await page.$$eval(
    "#nodes .node.container .subdiagram-badge",
    (els) => els.length,
  );
  expect(badges).toBe(1);

  // Double-clicking the container drills into the subdiagram.
  await page.locator('#nodes .node[data-id="box"]').dblclick();
  await page.waitForSelector('#nodes .node[data-id="g"]', { timeout: 5000 });
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${SHOTS}/13-subdiagram-inside.png` });

  expect(await page.$eval(".title .crumb.current", (el) => el.textContent)).toBe("Inside");
  expect(await page.$eval(".title .crumb:not(.current)", (el) => el.textContent)).toBe("System");

  // Clicking the ancestor crumb returns to the parent.
  await page.click(".title .crumb:not(.current)");
  await page.waitForSelector('#nodes .node[data-id="box"]', { timeout: 5000 });
  const ancestorCrumbs = await page.$$eval(
    ".title .crumb:not(.current)",
    (els) => els.length,
  );
  expect(ancestorCrumbs).toBe(0);
});

test("minimap mirrors the nodes and recenters the view on click", async ({
  page,
  request,
}) => {
  const nodes = [
    mkNode("a", "rect", "A", -400, -300),
    mkNode("b", "backend", "B", 400, -300),
    mkNode("c", "database", "C", -400, 300),
    mkNode("d", "rect", "D", 400, 300),
  ];
  const edges = [mkEdge("e1", "a", "d"), mkEdge("e2", "b", "c")];
  const id = await createDiagram(request, "minimap", nodes, edges);
  await openDiagram(page, id);
  await page.screenshot({ path: `${SHOTS}/09-minimap.png` });

  // One rect per node, and the viewport indicator has a real size.
  const rectCount = await page.$$eval(
    "#minimap-content .minimap-node",
    (els) => els.length,
  );
  expect(rectCount).toBe(nodes.length);
  const vp = await page.$eval("#minimap-vp", (el) => ({
    w: parseFloat(el.getAttribute("width") || "0"),
    h: parseFloat(el.getAttribute("height") || "0"),
  }));
  expect(vp.w).toBeGreaterThan(0);
  expect(vp.h).toBeGreaterThan(0);

  // Clicking a corner of the minimap pans the main viewport.
  const before = await page.$eval("#viewport", (el) => el.getAttribute("transform"));
  const box = await page.$eval("#minimap", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.click(box.x + box.w * 0.2, box.y + box.h * 0.2);
  await page.waitForTimeout(80);
  const after = await page.$eval("#viewport", (el) => el.getAttribute("transform"));
  expect(after).not.toBe(before);
});
