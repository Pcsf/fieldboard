export function escapeHTML(text: string): string { return text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!); }
// A small, allowlisted Markdown renderer, not an HTML parser. Raw HTML is always text.
// Images are intentionally not rendered or fetched, including data and remote URLs.
function inline(source: string): string {
  const tokens: string[] = [];
  const token = (html: string) => `\u0000${tokens.push(html) - 1}\u0000`;
  let text = escapeHTML(source.replace(/\u0000/g, "").replace(/!\[([^\]]*)\]\([^)]*\)/g, "[image: $1]"));
  text = text.replace(/`([^`]+)`/g, (_, body: string) => token(`<code>${body}</code>`));
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, url: string) => token(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`));
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return text.replace(/\u0000(\d+)\u0000/g, (_, n: string) => tokens[Number(n)] ?? "");
}
export function markdown(source: string): string {
  const out: string[] = []; let fenced = false; let list = false;
  for (const line of source.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("```")) { if (list) { out.push("</ul>"); list = false; } out.push(fenced ? "</code></pre>" : "<pre><code>"); fenced = !fenced; continue; }
    if (fenced) { out.push(`${escapeHTML(line)}\n`); continue; }
    if (/^[-*] /.test(line)) { if (!list) out.push("<ul>"); list = true; out.push(`<li>${inline(line.slice(2))}</li>`); continue; }
    if (list) { out.push("</ul>"); list = false; }
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    if (heading) { const level = heading[1]!.length; out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`); }
    else if (line.startsWith("> ")) out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push("</ul>"); if (fenced) out.push("</code></pre>");
  return out.join("");
}
