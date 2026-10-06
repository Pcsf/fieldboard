import { test, expect } from "bun:test";

function parseTokens(block: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens[m[1]!] = m[2]!.trim();
  return tokens;
}
function block(css: string, selector: RegExp): string {
  const m = selector.exec(css); if (!m) throw new Error(`Token block not found: ${selector}`);
  const start = m.index + m[0].length; let depth = 1; let i = start;
  while (depth > 0) { if (css[i] === "{") depth++; else if (css[i] === "}") depth--; i++; }
  return css.slice(start, i - 1);
}
function luminance(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map(c => c + c).join("");
  h = h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
}
function contrast(fg: string, bg: string): number {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1! + 0.05) / (l2! + 0.05);
}

// Text-on-background pairs this app relies on to keep status meaning readable: overdue, due soon,
// priority levels, done dot, error banner, planning warnings, label chips, plus the core surfaces
// and identity colours that carry text. Each must clear WCAG AA (>=4.5:1); done-dot is a colour
// swatch rather than text and only needs the non-text minimum (>=3:1).
//
// Covers every text-bearing token against the background it actually renders on (not just a
// hand-picked subset): the sidebar/column/dialog-scoped tokens below (eyebrow, kbd-text, empty-text,
// footer-text, meta-text, add-card-text, add-card-top-text, label-text, preview-label,
// subtask-done-text) were found failing in light mode by the accessibility audit (claim R52) and
// fixed in src/styles.css; this table is what keeps them from regressing silently.
const textPairs: [string, string][] = [
  ["text", "bg"], ["muted", "bg"], ["accent", "bg"], ["on-accent", "accent"], ["danger", "surface"],
  ["status-ok", "bg"], ["status-error", "bg"], ["status-saving", "bg"], ["breadcrumb-strong", "bg"],
  ["count-text", "count-bg"], ["count-text", "column-count-bg"], ["column-icon", "column-bg"],
  ["priority-urgent", "card-bg"], ["priority-high", "card-bg"], ["priority-medium", "card-bg"], ["priority-low", "card-bg"],
  ["due-overdue-text", "due-overdue-bg"], ["due-soon-text", "due-soon-bg"],
  ["chip-text", "chip-bg"], ["error-text", "error-bg"], ["planning-warning-text", "planning-warning-bg"],
  ["selected-text", "selected-bg"], ["avatar-text", "avatar-bg"], ["avatar-chip-text", "avatar-chip-bg"],
  ["brand-text", "sidebar-bg"], ["text", "caution-bg"], ["accent", "card-bg"], ["quote-text", "dialog-bg"],
  ["blocked-text", "blocked-bg"], ["muted", "selected-bg"], ["muted", "sidebar-bg"], ["muted", "dialog-bg"],
  ["eyebrow", "bg"], ["kbd-text", "bg"], ["empty-text", "column-bg"], ["footer-text", "bg"],
  ["meta-text", "card-bg"], ["add-card-text", "column-bg"], ["add-card-top-text", "column-bg"],
  ["label-text", "dialog-bg"], ["preview-label", "dialog-bg"], ["subtask-done-text", "dialog-bg"],
];
const nonTextPairs: [string, string][] = [["done-dot", "column-bg"]];

test("theme tokens: light and dark token tables both clear WCAG AA for every defined status/text pair", async () => {
  const css = await Bun.file("src/styles.css").text();
  const light = parseTokens(block(css, /:root\{/));
  const darkExplicit = parseTokens(block(css, /:root\[data-theme="dark"\]\{/));
  const darkSystem = parseTokens(block(css, /:root:not\(\[data-theme="light"\]\)\{/));
  expect(Object.keys(light).length).toBeGreaterThan(50);
  // The system-dark block (prefers-color-scheme, no override) must match the explicit dark override exactly.
  expect(darkSystem).toEqual(darkExplicit);
  for (const [name, tokens] of [["light", light], ["dark", darkExplicit]] as const) {
    for (const [fg, bg] of textPairs) {
      const ratio = contrast(tokens[fg]!, tokens[bg]!);
      expect(ratio, `${name}: --${fg} on --${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const [fg, bg] of nonTextPairs) {
      const ratio = contrast(tokens[fg]!, tokens[bg]!);
      expect(ratio, `${name}: --${fg} on --${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
  }
});

test("theme tokens: dark values actually differ from light for the status-bearing tokens", async () => {
  const css = await Bun.file("src/styles.css").text();
  const light = parseTokens(block(css, /:root\{/));
  const dark = parseTokens(block(css, /:root\[data-theme="dark"\]\{/));
  for (const name of ["bg", "text", "card-bg", "due-overdue-bg", "due-soon-bg", "planning-warning-bg", "chip-bg", "error-bg"]) {
    expect(dark[name], name).not.toBe(light[name]);
  }
});
