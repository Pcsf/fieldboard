import { exportCsv, exportMarkdown } from "./export";
import type { Workspace } from "./model";

function downloadText(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBoardCsv(w: Workspace, boardId: string, boardName: string) {
  downloadText(`${boardName || "board"}.csv`, exportCsv(w, boardId), "text/csv");
}
export function downloadBoardMarkdown(w: Workspace, boardId: string, boardName: string) {
  downloadText(`${boardName || "board"}.md`, exportMarkdown(w, boardId), "text/markdown");
}
