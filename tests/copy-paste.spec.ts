import { test, expect } from "@playwright/test";
import { createDiagram, mkNode, mkEdge, openDiagram } from "./helpers";

test("copy in one diagram, paste into another", async ({ page, request }) => {
  const src = await createDiagram(request, "src",
    [mkNode("a", "rect", "A", 0, 0), mkNode("b", "rect", "B", 200, 0)],
    [mkEdge("e1", "a", "b", "link")]);
  const dst = await createDiagram(request, "dst", [mkNode("x", "rect", "X", 0, 0)], []);

  await openDiagram(page, src);
  await page.locator('#nodes .node[data-id="a"]').click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+c");
  await page.waitForTimeout(100);

  // Navigate via the sidebar (SPA — keeps the in-memory clipboard, unlike a
  // full page reload) and paste.
  await page.locator(`#diagram-list li[data-id="${dst}"]`).first().click();
  await page.waitForSelector('#nodes .node[data-id="x"]');
  await page.keyboard.press("Control+v");
  await page.waitForTimeout(300);

  await expect(page.locator("#nodes .node")).toHaveCount(3); // X + pasted A,B
  const d = await (await request.get(`/api/diagrams/${dst}`)).json();
  expect(d.nodes.length).toBe(3);
  expect(d.edges.length).toBe(1); // the internal A→B edge came along
  const labels = d.nodes.map((n: any) => n.data.label).sort();
  expect(labels).toEqual(["A", "B", "X"]);
});
