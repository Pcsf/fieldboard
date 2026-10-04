import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const bundle = await Bun.build({ entrypoints: ["src/app.ts"], target: "browser", format: "iife", minify: true, sourcemap: "none", splitting: false });
if (!bundle.success || bundle.outputs.length !== 1) throw new Error(`Bundle failed: ${bundle.logs.join("\n")}`);
const js = (await bundle.outputs[0]!.text()).replace(/<\/script/gi, "<\\/script");
const css = await Bun.file("src/styles.css").text();
const shell = await Bun.file("src/shell.html").text();
const hash = createHash("sha256").update(js).digest("base64");
const html = shell.replace("__SCRIPT_HASH__", hash).replace("__CSS__", () => css).replace("__JS__", () => js);
if (/__(?:CSS|JS|SCRIPT_HASH)__/.test(html)) throw new Error("Unresolved build placeholder");
await mkdir("dist", { recursive: true });
await Bun.write("dist/fieldboard.html", html);
console.log(`Built dist/fieldboard.html (${new TextEncoder().encode(html).length.toLocaleString()} bytes). External runtime dependencies: zero.`);
