import { test, expect } from "@playwright/test";
import { createDiagram, mkNode, mkEdge, openDiagram } from "./helpers";

// Collects uncaught page errors so any scenario that throws fails loudly.
function watchErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

test("import tolerates a dangling edge instead of failing the whole file", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await page.waitForSelector("#import");

  const payload = JSON.stringify({
    name: "imported-dangling",
    nodes: [
      { id: "a", position: { x: 0, y: 0 }, data: { label: "A" } },
      { id: "b", position: { x: 200, y: 0 }, data: { label: "B" } },
    ],
    edges: [
      { id: "ok", source: "a", target: "b" },
      { id: "bad", source: "a", target: "ghost" }, // dangling
    ],
    viewport: { x: 100, y: 100, zoom: 1 },
  });

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.click("#import"),
  ]);
  await chooser.setFiles({
    name: "imported-dangling.json",
    mimeType: "application/json",
    buffer: Buffer.from(payload),
  });

  // Import should succeed (not "import failed") and render both nodes.
  await page.waitForSelector("#nodes .node");
  await expect(page.locator("#nodes .node")).toHaveCount(2);
  // Exactly the valid edge survives; the dangling one was dropped.
  await expect(page.locator("#edges .edge-group")).toHaveCount(1);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a corrupt viewport (zoom=0) renders without NaN/Infinity errors", async ({
  page,
  request,
}) => {
  const errors = watchErrors(page);
  const res = await request.post(`/api/diagrams`, { data: { name: "z0" } });
  const d = await res.json();
  await request.put(`/api/diagrams/${d.id}`, {
    data: {
      name: "z0",
      nodes: [{ id: "a", position: { x: 0, y: 0 }, data: { label: "A" } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 0 }, // corrupt: would divide-by-zero the minimap
    },
  });

  await page.goto(`/d/${d.id}`);
  await page.waitForSelector("#nodes .node");
  await expect(page.locator("#nodes .node")).toHaveCount(1);
  await page.keyboard.press("f"); // fit must work too
  await page.waitForTimeout(150);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("self-loops, cycles and huge labels render and tidy without throwing", async ({
  page,
  request,
}) => {
  const errors = watchErrors(page);
  const huge = "X".repeat(2000); // longer than the server's MaxLabelLen on purpose
  const nodes = [
    mkNode("a", "rect", "A", 50, 50),
    mkNode("b", "rect", "B", 80, 80),
    mkNode("c", "circle", huge.slice(0, 400), 120, 120),
  ];
  const edges = [
    mkEdge("self", "a", "a", "loop"), // self-loop
    mkEdge("e1", "a", "b"),
    mkEdge("e2", "b", "a"), // 2-cycle
    mkEdge("e3", "b", "c", huge.slice(0, 400)),
  ];
  const id = await createDiagram(request, "adversarial", nodes, edges);
  await openDiagram(page, id);

  await page.click("#tidy");
  await page.waitForTimeout(150);
  await page.keyboard.press("f");
  await page.waitForTimeout(100);

  // All three nodes still present and nothing threw.
  await expect(page.locator("#nodes .node")).toHaveCount(3);
  expect(errors, errors.join("\n")).toEqual([]);
});
