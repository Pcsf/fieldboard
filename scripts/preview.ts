export {};
const file = Bun.file("dist/fieldboard.html");
if (!await file.exists()) throw new Error("Run bun run build first.");
const server = Bun.serve({ hostname: "127.0.0.1", port: 3000, fetch: () => new Response(file, { headers: { "content-type": "text/html; charset=utf-8" } }) });
console.log(`Optional preview: ${server.url}. End users open dist/fieldboard.html directly; this server is not required.`);
