import { test, expect } from "@playwright/test";
import { createDiagram, mkNode, openDiagram } from "./helpers";

// Figma-style magnetic alignment: dragging a node near another's edge should
// snap it into exact alignment and show a guide line while dragging.
test("dragging a node snaps to alignment with another and shows a guide", async ({
  page,
  request,
}) => {
  const id = await createDiagram(
    request,
    "align",
    [mkNode("a", "rect", "A", 0, 0), mkNode("b", "rect", "B", 300, 40)],
    [],
  );
  await openDiagram(page, id);

  const b = page.locator('#nodes .node[data-id="b"]');
  const box = (await b.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Grab B and drag it up ~38px: its top (model y=40) lands ~2px from A's top
  // (y=0), inside the snap threshold.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 38, { steps: 12 });

  // A guide line is visible mid-drag.
  await expect(page.locator(".align-guide")).toHaveCount(1);

  await page.mouse.up();
  // Guide clears on drop.
  await expect(page.locator(".align-guide")).toHaveCount(0);

  // B snapped to A's top exactly (y === 0); x unchanged.
  await page.waitForTimeout(300); // save debounce
  const d = await (await request.get(`/api/diagrams/${id}`)).json();
  const nb = d.nodes.find((n: any) => n.id === "b");
  expect(nb.position.y).toBe(0);
  expect(nb.position.x).toBe(300);
});
