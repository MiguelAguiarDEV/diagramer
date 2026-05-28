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
