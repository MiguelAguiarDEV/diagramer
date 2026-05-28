import { test, expect } from "@playwright/test";
import { createDiagram, mkNode, openDiagram } from "./helpers";

test("arrow keys nudge selected nodes; shift = bigger step; undo coalesces", async ({
  page,
  request,
}) => {
  const id = await createDiagram(request, "nudge", [mkNode("a", "rect", "A", 100, 100)], []);
  await openDiagram(page, id);

  const pos = async () => {
    const d = await (await request.get(`/api/diagrams/${id}`)).json();
    return d.nodes.find((n: any) => n.id === "a").position;
  };

  // Select the node.
  await page.locator('#nodes .node[data-id="a"]').click();

  // Burst 1: 3 right (+3), 1 down (+1).
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(700); // close the coalesce window
  let p = await pos();
  expect(p.x).toBe(103);
  expect(p.y).toBe(101);

  // Burst 2 (separate undo step): Shift = 10px.
  await page.keyboard.press("Shift+ArrowLeft");
  await page.waitForTimeout(300);
  p = await pos();
  expect(p.x).toBe(93);

  // Undo reverts only burst 2 (back to 103), not burst 1.
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  p = await pos();
  expect(p.x).toBe(103);
  expect(p.y).toBe(101);
});
