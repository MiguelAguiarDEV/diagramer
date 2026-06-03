import { test, expect } from "@playwright/test";
import { createDiagram, mkNode, mkEdge, openDiagram } from "./helpers";

// #34: the in-container minimap is illegible noise when the container is small
// on screen, so it's hidden below a readable threshold (and shown when large).
test("container minimap hides when too small on screen, shows when large", async ({
  page,
  request,
}) => {
  const subId = await createDiagram(
    request,
    "Inside",
    [mkNode("a", "rect", "A", 0, 0), mkNode("b", "rect", "B", 200, 0)],
    [mkEdge("e1", "a", "b")],
  );
  const mkParent = (zoom: number) =>
    createDiagram(
      request,
      `Parent z${zoom}`,
      [{ id: "box", kind: "rect", position: { x: 0, y: 0 }, data: { label: "M", subdiagramId: subId } }],
      [],
      { x: 300, y: 250, zoom },
    );

  // Zoomed out: container renders small → minimap hidden.
  const small = await mkParent(0.4);
  await openDiagram(page, small);
  await page.waitForSelector(".node.container");
  await page.waitForTimeout(150);
  expect(await page.locator(".node.container .sub-preview rect").count()).toBe(0);

  // At zoom 1: container is large enough → minimap shows.
  const big = await mkParent(1);
  await openDiagram(page, big);
  await page.waitForSelector(".node.container .sub-preview rect", { timeout: 5000 });
  expect(await page.locator(".node.container .sub-preview rect").count()).toBe(2);
});
