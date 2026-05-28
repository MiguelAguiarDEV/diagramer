import { test, expect } from "@playwright/test";
import { createDiagram, mkNode, mkEdge, openDiagram } from "./helpers";

// Verifies the claim in issue #31: does undo (Ctrl+Z) persist to disk? It
// should — undo() calls save(). Tidy moves nodes and saves; undo must revert
// the file, not just the in-memory view.
test("undo after tidy reverts the persisted positions", async ({ page, request }) => {
  const nodes = [
    mkNode("a", "rect", "A", 50, 50),
    mkNode("b", "rect", "B", 400, 50),
  ];
  const id = await createDiagram(request, "undo", nodes, [mkEdge("e1", "a", "b")]);
  await openDiagram(page, id);

  const diskA = async () => {
    const d = await (await request.get(`/api/diagrams/${id}`)).json();
    return d.nodes.find((n: any) => n.id === "a").position;
  };

  const orig = await diskA();
  expect(orig.x).toBe(50);

  await page.click("#tidy");
  await page.waitForTimeout(300); // let the 200ms save debounce flush
  const tidied = await diskA();
  expect(tidied.x).not.toBe(50); // tidy moved it on disk

  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  const reverted = await diskA();
  expect(reverted.x).toBe(50); // undo persisted the revert to disk
  expect(reverted.y).toBe(50);
});
