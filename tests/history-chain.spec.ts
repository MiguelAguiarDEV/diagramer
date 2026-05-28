import { test, expect } from "@playwright/test";
import { createDiagram, mkNode, openDiagram } from "./helpers";

test("undo unwinds duplicate then nudge in order", async ({ page, request }) => {
  const id = await createDiagram(request, "hist", [mkNode("a", "rect", "A", 100, 100)], []);
  await openDiagram(page, id);
  const count = async () => (await (await request.get(`/api/diagrams/${id}`)).json()).nodes.length;

  await page.locator('#nodes .node[data-id="a"]').click();
  await page.keyboard.press("Control+d"); // duplicate → 2 nodes (clone selected)
  await page.waitForTimeout(250);
  expect(await count()).toBe(2);

  await page.keyboard.press("ArrowRight"); // nudge the clone
  await page.waitForTimeout(700); // close nudge burst
  // Undo the nudge → still 2 nodes.
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(250);
  expect(await count()).toBe(2);
  // Undo the duplicate → back to 1 node.
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(250);
  expect(await count()).toBe(1);
});
