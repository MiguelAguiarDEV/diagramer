import { test } from "@playwright/test";
import { createDiagram, mkNode, mkEdge, openDiagram } from "./helpers";

const SHOTS = "screenshots";

async function ensureTheme(page: import("@playwright/test").Page, want: string) {
  const cur = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  if (cur !== want) await page.click("#theme-toggle");
  await page.waitForTimeout(120);
}

// A realistic web-app architecture used across several shots.
function archNodes() {
  return [
    mkNode("user", "user", "User", 0, 0),
    mkNode("web", "frontend", "Web App", 60, 200),
    mkNode("gw", "backend", "API Gateway", 380, 120),
    mkNode("auth", "backend", "Auth", 700, -40),
    mkNode("orders", "backend", "Orders", 700, 160),
    mkNode("pay", "backend", "Payments", 700, 360),
    { id: "pg", kind: "database", position: { x: 1040, y: 60 }, data: { label: "Postgres", fill: "#14432a", stroke: "#22c55e" } },
    { id: "redis", kind: "cache", position: { x: 1040, y: 260 }, data: { label: "Redis", fill: "#3b1d1d", stroke: "#ef4444" } },
    { id: "mq", kind: "queue", position: { x: 1040, y: 440 }, data: { label: "Events", fill: "#13315c", stroke: "#3b82f6" } },
  ];
}
function archEdges() {
  return [
    mkEdge("e1", "user", "web", "uses"),
    mkEdge("e2", "web", "gw", "REST"),
    mkEdge("e3", "gw", "auth"),
    mkEdge("e4", "gw", "orders"),
    mkEdge("e5", "gw", "pay"),
    mkEdge("e6", "auth", "pg"),
    mkEdge("e7", "orders", "pg", "read/write"),
    mkEdge("e8", "orders", "redis", "cache"),
    mkEdge("e9", "pay", "mq", "publish"),
  ];
}

test("demo: architecture, themes, routing, guides, container, menus", async ({ page, request }) => {
  // 1 + 2 — architecture, tidied, in both themes.
  const arch = await createDiagram(request, "E-commerce Architecture", archNodes(), archEdges());
  await openDiagram(page, arch);
  await ensureTheme(page, "dark");
  await page.click("#tidy");
  await page.waitForTimeout(150);
  await page.keyboard.press("f");
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/demo-01-architecture-dark.png` });

  await ensureTheme(page, "light");
  await page.keyboard.press("f");
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/demo-02-architecture-light.png` });

  // 3 — orthogonal (synthetic) routing.
  await ensureTheme(page, "dark");
  await page.click("#edge-style");
  await page.waitForTimeout(150);
  await page.keyboard.press("f");
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/demo-03-orthogonal-edges.png` });

  // 4 — parallel labeled edges fan out.
  const par = await createDiagram(request, "Parallel edges",
    [mkNode("a", "backend", "Service A", 80, 200), mkNode("b", "backend", "Service B", 620, 200)],
    [mkEdge("p1", "a", "b", "create order"), mkEdge("p2", "a", "b", "cancel order"), mkEdge("p3", "a", "b", "refund payment")]);
  await openDiagram(page, par);
  await ensureTheme(page, "dark");
  await page.keyboard.press("f");
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/demo-04-parallel-edges.png` });

  // 5 — a container node with an interface (ports) + minimap of its inside.
  const sub = await (await request.post(`/api/diagrams`, { data: { name: "Payments internals" } })).json();
  await request.put(`/api/diagrams/${sub.id}`, {
    data: {
      name: "Payments internals",
      nodes: [
        { id: "gw", position: { x: 0, y: 0 }, data: { label: "Gateway", port: "in" } },
        { id: "ldg", position: { x: 240, y: 0 }, data: { label: "Ledger" } },
        { id: "res", position: { x: 480, y: 0 }, data: { label: "Result", port: "out" } },
        { id: "db", kind: "database", position: { x: 240, y: 160 }, data: { label: "DB", port: "dep" } },
      ],
      edges: [{ id: "s1", source: "gw", target: "ldg" }, { id: "s2", source: "ldg", target: "res" }, { id: "s3", source: "ldg", target: "db" }],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  const parent = await createDiagram(request, "System",
    [mkNode("client", "user", "Client", 80, 160),
     { id: "pay", position: { x: 440, y: 120 }, data: { label: "Payments", subdiagramId: sub.id } }],
    [mkEdge("e1", "client", "pay")], { x: 120, y: 120, zoom: 1 });
  await openDiagram(page, parent);
  await ensureTheme(page, "dark");
  await page.waitForTimeout(300);
  await page.keyboard.press("f");
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/demo-05-container-subdiagram.png` });

  // 6 — alignment + equidistant-spacing guides mid-drag.
  const guides = await createDiagram(request, "Smart guides",
    [mkNode("a", "rect", "Alpha", 0, 0), mkNode("c", "rect", "Gamma", 420, 0), mkNode("m", "rect", "Beta", 150, 260)], []);
  await openDiagram(page, guides);
  await ensureTheme(page, "dark");
  const m = page.locator('#nodes .node[data-id="m"]');
  const box = (await m.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2 - 256, { steps: 10 });
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${SHOTS}/demo-06-smart-guides.png` });
  await page.mouse.up();

  // 7 — multi-select context menu (align / distribute / duplicate).
  const sel = await createDiagram(request, "Align & distribute",
    [mkNode("a", "rect", "One", 60, 80), mkNode("b", "rect", "Two", 360, 200), mkNode("c", "rect", "Three", 700, 120)], []);
  await openDiagram(page, sel);
  await ensureTheme(page, "dark");
  await page.locator('#nodes .node[data-id="a"]').click();
  await page.keyboard.press("Control+a");
  await page.locator('#nodes .node[data-id="b"]').click({ button: "right" });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/demo-07-context-menu.png` });
});
