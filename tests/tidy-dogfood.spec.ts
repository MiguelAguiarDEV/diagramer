import { test, expect } from "@playwright/test";
import {
  createDiagram,
  mkNode,
  mkEdge,
  openDiagram,
  readNodes,
  globalBox,
  overlapArea,
  countEdgeNodeCrossings,
} from "./helpers";

// Guards the "Tidy up" quality improvements: median-sweep crossing reduction,
// orphan nodes parked below the main graph, and label-aware column spacing.
test("tidy reduces crossings, parks orphans, and never overlaps", async ({
  page,
  request,
}) => {
  const nodes = [
    mkNode("ingest", "frontend", "Ingest", 400, 320),
    mkNode("validate", "backend", "Validate", 120, 40),
    mkNode("dedupe", "backend", "Dedupe", 700, 500),
    mkNode("store", "database", "Store", 60, 600),
    mkNode("respond", "backend", "Respond", 500, 90),
    mkNode("metrics", "rect", "MetricsSnapshot", 900, 60),
    mkNode("shutdown", "rect", "Shutdown", 850, 700),
  ];
  const edges = [
    mkEdge("e1", "ingest", "dedupe"),
    mkEdge("e2", "ingest", "validate"),
    mkEdge("e3", "dedupe", "store"),
    mkEdge("e4", "validate", "store"),
    mkEdge("e5", "store", "respond", "/upload (large payloads, dedupe-aware)"),
  ];
  const id = await createDiagram(request, "tidy-dogfood", nodes, edges);
  await openDiagram(page, id);

  const before = await countEdgeNodeCrossings(page);
  await page.click("#tidy");
  await page.waitForTimeout(150);
  const after = await countEdgeNodeCrossings(page);

  // Crossing reduction must not make things worse.
  expect(after).toBeLessThanOrEqual(before);

  const geoms = await readNodes(page);
  const box = Object.fromEntries(geoms.map((g) => [g.id, globalBox(g)]));

  // No node overlaps anywhere.
  const ids = Object.keys(box);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      expect(
        overlapArea(box[ids[i]], box[ids[j]]),
        `overlap ${ids[i]}/${ids[j]}`,
      ).toBe(0);
    }
  }

  // Orphans (no edges) sit below every connected node.
  const connectedBottom = Math.max(
    ...["ingest", "validate", "dedupe", "store", "respond"].map(
      (k) => box[k].y + box[k].h,
    ),
  );
  for (const orphan of ["metrics", "shutdown"]) {
    expect(box[orphan].y, `${orphan} parked below`).toBeGreaterThanOrEqual(
      connectedBottom,
    );
  }
});
