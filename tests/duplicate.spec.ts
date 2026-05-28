import { test, expect } from "@playwright/test";
import { createDiagram, mkNode, mkEdge, openDiagram } from "./helpers";

test("Ctrl+A selects all, Ctrl+D duplicates the selection with internal edges", async ({
  page,
  request,
}) => {
  const id = await createDiagram(
    request,
    "dup",
    [mkNode("a", "rect", "A", 0, 0), mkNode("b", "rect", "B", 200, 0)],
    [mkEdge("e1", "a", "b", "link")],
  );
  await openDiagram(page, id);

  // Click a node so the canvas has focus, then select all + duplicate.
  await page.locator('#nodes .node[data-id="a"]').click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+d");
  await page.waitForTimeout(300);

  // Two original + two cloned nodes; one original + one cloned edge.
  await expect(page.locator("#nodes .node")).toHaveCount(4);
  await expect(page.locator("#edges .edge-group")).toHaveCount(2);

  const d = await (await request.get(`/api/diagrams/${id}`)).json();
  expect(d.nodes.length).toBe(4);
  expect(d.edges.length).toBe(2);
  // The clones are offset from the originals and carry the labels.
  const labels = d.nodes.map((n: any) => n.data.label).sort();
  expect(labels).toEqual(["A", "A", "B", "B"]);
  // Cloned edge connects two clone nodes (ids not present among originals).
  const origIds = new Set(["a", "b"]);
  const clonedEdge = d.edges.find((e: any) => !origIds.has(e.source) && !origIds.has(e.target));
  expect(clonedEdge).toBeTruthy();
  expect(clonedEdge.label).toBe("link");
});
