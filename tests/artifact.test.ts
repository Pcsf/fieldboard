import { test, expect } from "bun:test";
import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

// C01: the build contract is exactly one standalone, offline HTML artifact.
test("build delivers one self-contained HTML file", async () => {
  const artifact = Bun.file("dist/fieldboard.html");
  expect(await artifact.exists()).toBe(true);
  const html = await artifact.text();
  expect(await readdir("dist")).toEqual(["fieldboard.html"]);
  expect(html).toContain("<!doctype html>");
  expect(html).toContain("Fieldboard");
  expect(html).not.toMatch(/<(?:script|img|iframe|link|source)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:|\/\/|file:|\.\.?\/)/i);
  // img is excluded below: the bundle legitimately contains a runtime-built `<img src="...">`
  // template for attachment thumbnails (src is always a locally stored data: URL, never a
  // remote one -- the line above still catches a literal remote scheme on any of these tags,
  // img included, and the CSP's `img-src data:` independently refuses a non-data: image load).
  expect(html).not.toMatch(/<(?:script|iframe|link|source|audio|video|embed|object)\b[^>]*\b(?:src|href|data)\s*=/i);
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join("\n");
  expect(css).not.toMatch(/@import\s|url\s*\(/i);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  expect(scripts).toHaveLength(1);
  expect(html).toContain(`script-src 'sha256-${createHash("sha256").update(scripts[0]![1]!).digest("base64")}'`);
  expect(html).not.toMatch(/@import\s|url\s*\(\s*["']?(?:https?:|\/\/|\.\.?\/)/i);
  expect(html).not.toMatch(/(?:from\s*|import\s*\()["'](?:\.\.?\/|https?:|node:|bun:)/);
  expect(html).not.toMatch(/\/workspace\/|\/home\/pi\/|node_modules\//);
});
