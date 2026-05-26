import { APIRequestContext, Page } from "@playwright/test";

export type Box = { x: number; y: number; w: number; h: number };

export type NodeGeom = {
  id: string;
  tx: number;
  ty: number;
  shape: Box; // bbox of the outline, in the node's local coords
  text: Box | null; // bbox of the label, local coords (null if no/empty label)
};

export type EdgeGeom = { id: string; d: string };

// Create a diagram via the REST API and return its id. Driving setup through
// the API (instead of clicking + typing into native prompts) keeps tests
// deterministic; the UI is then only responsible for rendering.
export async function createDiagram(
  request: APIRequestContext,
  name: string,
  nodes: any[],
  edges: any[],
  viewport = { x: 200, y: 150, zoom: 1 },
): Promise<string> {
  const res = await request.post(`/api/diagrams`, { data: { name } });
  const d = await res.json();
  await request.put(`/api/diagrams/${d.id}`, {
    data: { name, nodes, edges, viewport },
  });
  return d.id;
}

export function mkNode(
  id: string,
  kind: string,
  label: string,
  x: number,
  y: number,
) {
  const n: any = { id, position: { x, y }, data: { label } };
  if (kind && kind !== "rect") n.kind = kind;
  return n;
}

export function mkEdge(id: string, source: string, target: string, label = "") {
  const e: any = { id, source, target };
  if (label) e.label = label;
  return e;
}

export async function openDiagram(page: Page, id: string) {
  await page.goto(`/d/${id}`);
  await page.waitForSelector("#nodes .node", { timeout: 5000 });
  // Allow a frame for measureText-driven layout to settle.
  await page.waitForTimeout(100);
}

export async function readNodes(page: Page): Promise<NodeGeom[]> {
  return page.$$eval("#nodes .node", (els) =>
    els.map((g) => {
      const t = g.getAttribute("transform") || "";
      const m = t.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
      const tx = m ? parseFloat(m[1]) : 0;
      const ty = m ? parseFloat(m[2]) : 0;
      const shapeEl = g.querySelector(".node-shape") as SVGGraphicsElement;
      const sb = shapeEl.getBBox();
      const labelEl = g.querySelector(":scope > text") as SVGGraphicsElement | null;
      const hasText = !!(labelEl && labelEl.textContent);
      const tb = hasText ? labelEl!.getBBox() : null;
      return {
        id: g.getAttribute("data-id") as string,
        tx,
        ty,
        shape: { x: sb.x, y: sb.y, w: sb.width, h: sb.height },
        text: tb ? { x: tb.x, y: tb.y, w: tb.width, h: tb.height } : null,
      };
    }),
  );
}

export async function readEdges(page: Page): Promise<EdgeGeom[]> {
  return page.$$eval("#edges .edge-group", (els) =>
    els.map((g) => ({
      id: g.getAttribute("data-id") as string,
      d: (g.querySelector("path.edge") as SVGPathElement).getAttribute("d") || "",
    })),
  );
}

// Global (model-space) bounding box of a node: its local outline bbox shifted
// by the group's translate.
export function globalBox(n: NodeGeom): Box {
  return { x: n.tx + n.shape.x, y: n.ty + n.shape.y, w: n.shape.w, h: n.shape.h };
}

export function overlapArea(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ix * iy;
}

// True if `inner` fits inside `outer` within tolerance (both same coord space).
export function contains(outer: Box, inner: Box, tol = 1.5): boolean {
  return (
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.w <= outer.x + outer.w + tol &&
    inner.y + inner.h <= outer.y + outer.h + tol
  );
}

// Counts how many sampled points of edge paths land strictly inside some node
// box. Informational only — bezier edges can legitimately clip a box near
// their endpoints, and crossing unrelated nodes isn't forbidden after we
// dropped A* routing.
export async function countEdgeNodeCrossings(page: Page): Promise<number> {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll("#nodes .node")].map((g) => {
      const t = g.getAttribute("transform") || "";
      const m = t.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
      const tx = m ? parseFloat(m[1]) : 0;
      const ty = m ? parseFloat(m[2]) : 0;
      const sb = (g.querySelector(".node-shape") as SVGGraphicsElement).getBBox();
      return { x: tx + sb.x, y: ty + sb.y, w: sb.width, h: sb.height };
    });
    let count = 0;
    for (const eg of document.querySelectorAll("#edges .edge-group")) {
      const path = eg.querySelector("path.edge") as SVGPathElement;
      const len = path.getTotalLength();
      for (let i = 8; i < len - 8; i += 8) {
        const p = path.getPointAtLength(i);
        for (const n of nodes) {
          if (p.x > n.x + 3 && p.x < n.x + n.w - 3 && p.y > n.y + 3 && p.y < n.y + n.h - 3) {
            count++;
            break;
          }
        }
      }
    }
    return count;
  });
}
