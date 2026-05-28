import { test, expect } from "@playwright/test";

// Clicking a sidebar entry whose diagram was deleted elsewhere (stale list)
// must fail gracefully — a status message, not an uncaught promise rejection.
test("clicking a stale sidebar entry fails gracefully", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const real = await (await request.post(`/api/diagrams`, { data: { name: "Real" } })).json();
  await request.put(`/api/diagrams/${real.id}`, {
    data: { name: "Real", nodes: [{ id: "a", position: { x: 0, y: 0 }, data: { label: "Real" } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  });

  const ghostId = "11111111-1111-1111-1111-111111111111";
  await page.route("**/api/diagrams", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: real.id, name: "Real", updatedAt: new Date().toISOString(), nodeCount: 1, edgeCount: 0 },
        { id: ghostId, name: "Ghost", updatedAt: new Date(Date.now() - 1000).toISOString(), nodeCount: 0, edgeCount: 0 },
      ]),
    });
  });
  await page.route(`**/api/diagrams/${ghostId}`, (route) => route.fulfill({ status: 404, body: "not found" }));

  await page.goto("/");
  await page.waitForSelector("#nodes .node"); // booted on Real

  // Click the ghost entry in the sidebar.
  await page.locator(`li[data-id="${ghostId}"]`).first().click();
  await page.waitForTimeout(300);

  // No uncaught rejection; app still shows the real diagram.
  expect(errors, errors.join("\n")).toEqual([]);
  await expect(page.locator("#nodes .node")).toHaveCount(1);
});
