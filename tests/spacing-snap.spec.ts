import { test, expect } from "@playwright/test";
import { createDiagram, mkNode, openDiagram } from "./helpers";

test("dragging a node near the middle of two snaps to equal spacing", async ({
  page,
  request,
}) => {
  // A (left) and C (right) on the same row; M starts off to the side.
  const id = await createDiagram(
    request,
    "spacing",
    [
      mkNode("a", "rect", "A", 0, 0),
      mkNode("c", "rect", "C", 400, 0),
      mkNode("m", "rect", "M", 150, 250),
    ],
    [],
  );
  await openDiagram(page, id);

  const m = page.locator('#nodes .node[data-id="m"]');
  const box = (await m.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Drag M up into the A–C row, a few px off the exact centered X so the snap
  // has to pull it in. A.right≈80, C.left=400 → free=320, M width≈80 →
  // centered M.x = 80 + (320-80)/2 = 200. Land near 203 then expect snap to 200.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // move to model y≈0 (up 250) and x so M.x ≈ 203 (right by 53 from 150).
  await page.mouse.move(cx + 53, cy - 250, { steps: 12 });

  // Spacing guides appear mid-drag.
  await expect(page.locator(".spacing-guide")).toHaveCount(2);

  await page.mouse.up();
  await page.waitForTimeout(300);
  const d = await (await request.get(`/api/diagrams/${id}`)).json();
  const mm = d.nodes.find((n: any) => n.id === "m");
  // Equal gaps: A.right(≈80) → M.left == M.right → C.left(400).
  expect(Math.round(mm.position.x)).toBe(200);
});
