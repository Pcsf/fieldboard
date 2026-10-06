import { expect, test } from "bun:test";
import { exportCsv, exportMarkdown } from "../src/export";
import { parseCsvBoard } from "../src/import";
import { createWorkspace, createProject, createCard, editCard, resolveLabels, type Workspace } from "../src/model";

function fixtureBoard(): { w: Workspace; boardId: string } {
  const w = createWorkspace();
  const p = createProject(w, "Release");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const [backlog, todo] = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  const labels = resolveLabels(p, ["urgent", "report"]);
  createCard(w, backlog!.id, "Write report", "bottom", { description: "Quarterly report", priority: "high", dueDate: "2026-11-01", estimate: 3, labels });
  createCard(w, todo!.id, "Fix sensor drift", "bottom", {});
  createCard(w, backlog!.id, "Needs \"quoting\", and a comma", "bottom", { description: "line one\nline two" });
  return { w, boardId: board.id };
}

test("exportCsv: header matches the importer's columns exactly", () => {
  const { w, boardId } = fixtureBoard();
  const csv = exportCsv(w, boardId);
  expect(csv.split("\r\n")[0]).toBe("title,description,column,labels,priority,due,estimate");
});

test("exportCsv -> parseCsvBoard round trip preserves title, column, labels, priority, due and estimate", () => {
  const { w, boardId } = fixtureBoard();
  const csv = exportCsv(w, boardId);
  const imported = parseCsvBoard(csv);
  const report = imported.cards.find(c => c.title === "Write report")!;
  expect(report.column).toBe("Backlog");
  expect(report.labels.sort()).toEqual(["report", "urgent"]);
  expect(report.priority).toBe("high");
  expect(report.dueDate).toBe("2026-11-01");
  expect(report.estimate).toBe(3);
  const drift = imported.cards.find(c => c.title === "Fix sensor drift")!;
  expect(drift.column).toBe("To Do"); expect(drift.priority).toBe("none"); expect(drift.dueDate).toBeNull(); expect(drift.estimate).toBeNull();
  const quoted = imported.cards.find(c => c.title.startsWith("Needs"))!;
  expect(quoted.title).toBe('Needs "quoting", and a comma');
  expect(quoted.description).toBe("line one\nline two");
});

test("exportMarkdown: board name heading, one heading per column, one bullet per card", () => {
  const { w, boardId } = fixtureBoard();
  const board = w.boards.find(b => b.id === boardId)!;
  const md = exportMarkdown(w, boardId);
  expect(md).toContain(`# ${board.name}`);
  expect(md).toContain("## Backlog");
  expect(md).toContain("## To Do");
  expect(md).toContain("Write report");
  expect(md).toContain("high");
  expect(md).toContain("2026-11-01");
  expect(md).toContain("Fix sensor drift");
});

test("exportCsv: editing a card after export does not retroactively change the exported text", () => {
  const { w, boardId } = fixtureBoard();
  const csv = exportCsv(w, boardId);
  const card = w.cards.find(c => c.title === "Write report")!;
  editCard(w, card.id, { title: "Renamed" });
  expect(csv).toContain("Write report");
  expect(csv).not.toContain("Renamed");
});
