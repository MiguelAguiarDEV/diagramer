import { test, expect } from "@playwright/test";
import { createDiagram, mkNode, mkEdge, openDiagram } from "./helpers";

// #30: orthogonal ("synthetic") edge routing toggled per diagram.
test("toggling edge style switches to orthogonal routing and persists", async ({
  page,
  request,
}) => {
  const id = await createDiagram(
    request,
    "edges",
    [mkNode("a", "rect", "A", 0, 0), mkNode("b", "rect", "B", 320, 160)],
    [mkEdge("e1", "a", "b", "flow")],
  );
  await openDiagram(page, id);

  const edgePath = page.locator('#edges .edge-group[data-id="e1"] path.edge');
  const organicD = (await edgePath.getAttribute("d"))!;
  expect(organicD).toContain("C"); // cubic bezier in organic mode

  // Toggle to orthogonal.
  await expect(page.locator("#edge-style")).toHaveText("Edges: organic");
  await page.click("#edge-style");
  await expect(page.locator("#edge-style")).toHaveText("Edges: orthogonal");

  const synthD = (await edgePath.getAttribute("d"))!;
  expect(synthD).not.toContain("C"); // no bezier
  expect(synthD).toContain("L");     // straight orthogonal segments

  // Persists across reload.
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForSelector("#nodes .node");
  await expect(page.locator("#edge-style")).toHaveText("Edges: orthogonal");
  const reloadedD = (await page.locator('#edges .edge-group[data-id="e1"] path.edge').getAttribute("d"))!;
  expect(reloadedD).toContain("L");
  expect(reloadedD).not.toContain("C");

  // The persisted model carries the flag.
  const d = await (await request.get(`/api/diagrams/${id}`)).json();
  expect(d.edgeStyle).toBe("synthetic");
});

// Stress: orthogonal routing must survive self-loops, parallel edges and cycles
// without throwing, and toggling while an edge is selected must not break.
test("orthogonal routing handles self-loops, parallels and cycles", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const id = await createDiagram(
    request,
    "synthetic-stress",
    [mkNode("a", "rect", "A", 0, 0), mkNode("b", "rect", "B", 300, 0)],
    [
      mkEdge("self", "a", "a", "loop"),
      mkEdge("p1", "a", "b", "one"),
      mkEdge("p2", "a", "b", "two"), // parallel
      mkEdge("cyc", "b", "a"),       // back-edge (cycle)
    ],
  );
  await openDiagram(page, id);
  await page.click("#edge-style"); // → orthogonal
  await page.waitForTimeout(100);
  await expect(page.locator("#edges .edge-group")).toHaveCount(4);

  // No curvature handles in synthetic mode, even after selecting everything.
  await page.keyboard.press("Control+a").catch(() => {});
  await page.waitForTimeout(50);
  await expect(page.locator(".edge-handle")).toHaveCount(0);

  // Toggle back to organic and tidy — still no errors.
  await page.click("#edge-style");
  await page.click("#tidy");
  await page.waitForTimeout(100);
  await expect(page.locator("#edges .edge-group")).toHaveCount(4);
  expect(errors, errors.join("\n")).toEqual([]);
});
