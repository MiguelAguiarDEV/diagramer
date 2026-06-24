import { test, expect } from "@playwright/test";
import { createDiagram } from "./helpers";

// Per-node fills (set by the colour menu, MCP, or imported JSON) used to force
// the label to a fixed near-white. That broke the moment anyone picked a light
// fill — white text on white box, invisible. The renderer now picks the label
// + icon colour based on the WCAG luminance of the fill, so contrast holds at
// both ends of the spectrum.

const DARK_FILL = "#0c0e13";  // very dark
const LIGHT_FILL = "#fffaf0"; // very light

// WCAG relative luminance — mirror of pickReadableInk's math so the test
// exercises the same threshold rather than a different proxy.
function luminance(hex: string): number {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`bad hex: ${hex}`);
  const h = m[1];
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * lin(parseInt(h.slice(0, 2), 16)) +
    0.7152 * lin(parseInt(h.slice(2, 4), 16)) +
    0.0722 * lin(parseInt(h.slice(4, 6), 16))
  );
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// `rgb(r, g, b)` → `#rrggbb` (browsers normalise computed fills to rgb()).
function rgbToHex(s: string): string {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(s);
  if (!m) return s;
  return "#" + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, "0")).join("");
}

test("label colour stays readable on dark and light per-node fills", async ({ page, request }) => {
  const id = await createDiagram(
    request,
    "contrast",
    [
      { id: "d", position: { x: 60, y: 60 }, data: { label: "Dark", fill: DARK_FILL } },
      { id: "l", position: { x: 260, y: 60 }, data: { label: "Light", fill: LIGHT_FILL } },
    ],
    [],
  );
  await page.goto(`/d/${id}`);
  await page.waitForSelector('#nodes .node[data-id="d"]');
  await page.waitForSelector('#nodes .node[data-id="l"]');

  const inks = await page.evaluate(() => {
    const read = (sel: string) =>
      getComputedStyle(
        document.querySelector(`#nodes .node[data-id="${sel}"] > text`)!,
      ).fill;
    return { d: read("d"), l: read("l") };
  });

  const darkInk = rgbToHex(inks.d);
  const lightInk = rgbToHex(inks.l);

  // WCAG AA for normal-size text is 4.5:1; "Large" is 3:1. Labels here are
  // 13px so AA applies. Demand the stricter bar — anything less means a real
  // user can't read the label.
  expect(contrast(darkInk, DARK_FILL)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(lightInk, LIGHT_FILL)).toBeGreaterThanOrEqual(4.5);

  // Sanity: each ink sits on the side of the contrast threshold we expect
  // (light ink on a dark fill, dark ink on a light fill).
  expect(luminance(darkInk)).toBeGreaterThan(luminance(DARK_FILL));
  expect(luminance(lightInk)).toBeLessThan(luminance(LIGHT_FILL));
});
