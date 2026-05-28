import { test, expect } from "@playwright/test";

// Simulates a stale index entry (file deleted but still listed) ahead of a
// healthy diagram: boot must skip the broken one and load the good one, not
// brick the app with "failed to load".
test("boot skips an unloadable (stale-index) diagram and loads a healthy one", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // A real, healthy diagram on the server.
  const real = await (await request.post(`/api/diagrams`, { data: { name: "Healthy" } })).json();
  await request.put(`/api/diagrams/${real.id}`, {
    data: {
      name: "Healthy",
      nodes: [{ id: "a", position: { x: 0, y: 0 }, data: { label: "Healthy node" } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });

  const ghostId = "00000000-0000-0000-0000-000000000000";
  // List: ghost first, healthy second.
  await page.route("**/api/diagrams", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: ghostId, name: "Ghost", updatedAt: new Date().toISOString(), nodeCount: 0, edgeCount: 0 },
        { id: real.id, name: "Healthy", updatedAt: new Date(Date.now() - 1000).toISOString(), nodeCount: 1, edgeCount: 0 },
      ]),
    });
  });
  // The ghost's file is gone → 404. Everything else passes through.
  await page.route(`**/api/diagrams/${ghostId}`, (route) => route.fulfill({ status: 404, body: "not found" }));

  await page.goto("/");
  // Must end up on the healthy diagram, not stuck.
  await page.waitForSelector("#nodes .node");
  await expect(page.locator("#nodes .node")).toHaveCount(1);
  await expect(page.locator("#nodes .node")).toContainText("Healthy node");
  expect(errors, errors.join("\n")).toEqual([]); // no uncaught errors
});
