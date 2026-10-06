// A small RFC 4180-ish reader/writer: quoted fields, "" for an embedded quote, commas and
// newlines allowed inside quotes. Good enough for a spreadsheet export/import round trip --
// not a general CSV-dialect library.
export const BOARD_CSV_COLUMNS = ["title", "description", "column", "labels", "priority", "due", "estimate"] as const;

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, "\n");
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { pushField(); continue; }
    if (ch === "\n") { pushRow(); continue; }
    field += ch;
  }
  if (field.length || row.length) pushRow();
  if (rows.length && rows[rows.length - 1]!.length === 1 && rows[rows.length - 1]![0] === "") rows.pop();
  return rows;
}

export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0]!.map(h => h.trim());
  return rows.slice(1).filter(r => r.some(cell => cell !== "")).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function csvField(value: string): string {
  return /["\n,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(columns: readonly string[], rows: Record<string, string>[]): string {
  const lines = [columns.map(csvField).join(",")];
  for (const row of rows) lines.push(columns.map(c => csvField(row[c] ?? "")).join(","));
  return lines.join("\r\n") + "\r\n";
}
