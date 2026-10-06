import { expect, test } from "bun:test";
import { parseTrelloBoard, parseGithubIssues, parseCsvBoard, applyImport } from "../src/import";
import { createWorkspace, validateWorkspace, type Workspace } from "../src/model";

async function fixture(name: string): Promise<string> { return Bun.file(`tests/fixtures/${name}`).text(); }

test("parseTrelloBoard: lists become columns, cards carry description/labels/due, checklists become subtasks, closed cards archive", async () => {
  const json = JSON.parse(await fixture("trello-board.json"));
  const imported = parseTrelloBoard(json);
  expect(imported.name).toBe("Field Trial");
  expect(imported.columns).toEqual(["To Do", "Doing", "Done"]);
  const report = imported.cards.find(c => c.title === "Write report")!;
  expect(report.description).toBe("Quarterly report for the field trial.");
  expect(report.column).toBe("To Do");
  expect(report.labels).toEqual(["urgent"]);
  expect(report.dueDate).toBe("2026-11-01");
  expect(report.archived).toBe(false);
  expect(report.subtasks).toEqual([{ title: "Draft the summary", done: true }, { title: "Get sign-off", done: false }]);
  const drift = imported.cards.find(c => c.title === "Fix sensor drift")!;
  expect(drift.dueDate).toBeNull(); expect(drift.labels).toEqual([]); expect(drift.archived).toBe(false);
  const old = imported.cards.find(c => c.title === "Old calibration note")!;
  expect(old.archived).toBe(true); expect(old.column).toBe("Done");
});

test("parseTrelloBoard: refuses a JSON file with the wrong shape (no lists)", async () => {
  const malformed = JSON.parse(await fixture("trello-board-malformed.json"));
  expect(() => parseTrelloBoard(malformed)).toThrow();
});

test("parseGithubIssues: open issues route to To Do, closed to Done, each card gets an issue link", async () => {
  const json = JSON.parse(await fixture("github-issues.json"));
  const imported = parseGithubIssues(json);
  const crash = imported.cards.find(c => c.title === "Crash on launch")!;
  expect(crash.column).toBe("To Do");
  expect(crash.description).toContain("Steps to reproduce");
  expect(crash.labels).toEqual(["bug"]);
  expect(crash.link?.kind).toBe("issue");
  expect(crash.link?.repo).toBe("acme/widgets");
  expect(crash.link?.number).toBe(10);
  const dark = imported.cards.find(c => c.title === "Add dark mode")!;
  expect(dark.column).toBe("Done");
  expect(dark.archived).toBe(false);
});

test("parseGithubIssues: refuses a payload that is not an issues array", async () => {
  const malformed = JSON.parse(await fixture("github-issues-malformed.json"));
  expect(() => parseGithubIssues(malformed)).toThrow();
});

test("parseCsvBoard: header row drives columns, labels split on ';', priority/due/estimate parsed", async () => {
  const text = await fixture("import-board.csv");
  const imported = parseCsvBoard(text);
  expect(imported.columns).toEqual(["To Do", "Doing", "Done"]);
  const report = imported.cards.find(c => c.title === "Write report")!;
  expect(report.description).toBe("Quarterly report, final pass");
  expect(report.labels).toEqual(["urgent", "report"]);
  expect(report.priority).toBe("high");
  expect(report.dueDate).toBe("2026-11-01");
  expect(report.estimate).toBe(3);
  const drift = imported.cards.find(c => c.title === "Fix sensor drift")!;
  expect(drift.labels).toEqual([]); expect(drift.dueDate).toBeNull(); expect(drift.estimate).toBeNull();
  const ship = imported.cards.find(c => c.title === "Ship release")!;
  expect(ship.description).toBe('Final QA "sign-off" pass');
});

test("parseCsvBoard: refuses a CSV with no title column and writes nothing", async () => {
  const text = await fixture("import-board-no-title.csv");
  expect(() => parseCsvBoard(text)).toThrow(/title/i);
});

test("parseCsvBoard: an unknown column is ignored rather than rejected", () => {
  const imported = parseCsvBoard("title,wat\nOnly a title,ignored\n");
  expect(imported.cards).toEqual([{ title: "Only a title", description: "", column: "Backlog", labels: [], priority: "none", dueDate: null, estimate: null, archived: false, subtasks: [] }]);
});

test("applyImport: creates a new project named after the source, with the right columns and cards, as one undoable change", () => {
  const w: Workspace = createWorkspace();
  const before = w.cards.length;
  const imported = parseTrelloBoard(JSON.parse(`{"name":"Field Trial","lists":[{"id":"l1","name":"To Do"}],"cards":[{"id":"c1","name":"A card","idList":"l1","closed":false}]}`));
  const project = applyImport(w, imported);
  expect(w.projects.find(p => p.id === project.id)!.name).toBe("Field Trial");
  expect(w.cards.length).toBe(before + 1);
  expect(validateWorkspace(JSON.parse(JSON.stringify(w)))).toEqual(w);
});

test("applyImport: a malformed card deep in the batch rolls back the whole import (no partial writes)", () => {
  const w: Workspace = createWorkspace();
  const before = JSON.stringify(w);
  const imported = { name: "Bad import", columns: ["Backlog"], cards: [
    { title: "Good card", description: "", column: "Backlog", labels: [], priority: "none" as const, dueDate: null, estimate: null, archived: false, subtasks: [] },
    { title: "", description: "", column: "Backlog", labels: [], priority: "none" as const, dueDate: null, estimate: null, archived: false, subtasks: [] },
  ] };
  expect(() => applyImport(w, imported)).toThrow();
  expect(JSON.stringify(w)).toBe(before);
});

test("parseCsvBoard: the default column names come back in workflow order, whatever order the rows list them", () => {
  const imported = parseCsvBoard("title,column\nA,In Progress\nB,To Do\nC,Done\nD,Backlog\nE,Review\n");
  expect(imported.columns).toEqual(["Backlog", "To Do", "In Progress", "Review", "Done"]);
});

test("applyImport: the column named Done is the done column even when it is not last", () => {
  const w = createWorkspace();
  const project = applyImport(w, { name: "Order", columns: ["In Progress", "Done", "Backlog"], cards: [
    { title: "Shipped", description: "", column: "Done", labels: [], priority: "none", dueDate: null, estimate: null, subtasks: [], archived: false },
    { title: "Later", description: "", column: "Backlog", labels: [], priority: "none", dueDate: null, estimate: null, subtasks: [], archived: false },
  ] } as never);
  const board = w.boards.find(b => b.projectId === project.id)!;
  const doneColumns = w.columns.filter(c => c.boardId === board.id && c.done).map(c => c.name);
  expect(doneColumns).toEqual(["Done"]);
  expect(w.cards.find(c => c.title === "Shipped")!.completedAt).not.toBeNull();
  expect(w.cards.find(c => c.title === "Later")!.completedAt).toBeNull();
});
