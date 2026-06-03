import { test, expect } from "@playwright/test";
import { createDiagram, mkNode, openDiagram } from "./helpers";

test("distribute evens the gaps between 3+ selected nodes", async ({ page, request }) => {
  // Same-size rects at unequal horizontal gaps.
  const id = await createDiagram(
    request,
    "dist",
    [mkNode("a", "rect", "A", 0, 0), mkNode("b", "rect", "B", 160, 0), mkNode("c", "rect", "C", 400, 0)],
    [],
  );
  await openDiagram(page, id);

  await page.locator('#nodes .node[data-id="a"]').click();
  await page.keyboard.press("Control+a");
  await page.locator('#nodes .node[data-id="b"]').click({ button: "right" });
  await page.locator('#ctx-menu button', { hasText: "Distribute · horizontally" }).click();
  await page.waitForTimeout(300);

  const d = await (await request.get(`/api/diagrams/${id}`)).json();
  const byId: Record<string, any> = {};
  for (const n of d.nodes) byId[n.id] = n;
  // All three are equal-width rects, so equal gaps means equal x-deltas.
  const dx1 = byId.b.position.x - byId.a.position.x;
  const dx2 = byId.c.position.x - byId.b.position.x;
  expect(Math.abs(dx1 - dx2)).toBeLessThan(0.5);
  // Outermost nodes stay put.
  expect(byId.a.position.x).toBe(0);
  expect(byId.c.position.x).toBe(400);
});
