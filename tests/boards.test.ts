import { expect, test } from "bun:test";
import {
  createWorkspace, createProject, createCard, editCard, addBoard, renameBoard, deleteBoard, moveCardToBoard,
  saveCardTemplate, createCardFromTemplate, deleteCardTemplate, saveBoardTemplate, createBoardFromTemplate, deleteBoardTemplate,
  validateWorkspace, undoWorkspace, orderedCards,
} from "../src/model";
import { estimateProject, defaultPlanning, defaultEffort } from "../src/planning";

function fixture() {
  const w = createWorkspace(); const p = createProject(w, "Release");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const columns = w.columns.filter(c => c.boardId === board.id);
  return { w, p, board, columns, first: columns[0]!, done: columns[4]! };
}

test("Boards: addBoard creates a board with its own default columns, scoped to the project", () => {
  const { w, p, board } = fixture();
  const second = addBoard(w, p.id, "Backend");
  expect(second.projectId).toBe(p.id);
  expect(second.id).not.toBe(board.id);
  const cols = w.columns.filter(c => c.boardId === second.id);
  expect(cols.map(c => c.name)).toEqual(["Backlog", "To Do", "In Progress", "Review", "Done"]);
  expect(cols.find(c => c.done)!.name).toBe("Done");
  expect(() => addBoard(w, "nonexistent", "X")).toThrow();
  expect(validateWorkspace(w)).toEqual(w);
});

test("Boards: renameBoard requires a nonempty name and round-trips through validation", () => {
  const { w, board } = fixture();
  renameBoard(w, board.id, "  Delivery  ");
  expect(w.boards.find(b => b.id === board.id)!.name).toBe("Delivery");
  expect(() => renameBoard(w, board.id, "   ")).toThrow();
  expect(() => renameBoard(w, "nonexistent", "X")).toThrow();
  expect(validateWorkspace(w)).toEqual(w);
});

test("Boards: the last board of a project cannot be deleted", () => {
  const { w, board } = fixture();
  expect(() => deleteBoard(w, board.id)).toThrow();
});

test("Boards: deleting an empty second board needs no destination", () => {
  const { w, p, board } = fixture();
  const second = addBoard(w, p.id, "Backend");
  deleteBoard(w, second.id);
  expect(w.boards.some(b => b.id === second.id)).toBe(false);
  expect(w.columns.some(c => c.boardId === second.id)).toBe(false);
  expect(validateWorkspace(w)).toEqual(w);
});

test("Boards: deleting a populated board requires a destination; cards land in its first column through the mutation path", () => {
  const { w, p } = fixture();
  const second = addBoard(w, p.id, "Backend");
  expect(() => deleteBoard(w, second.id)).not.toThrow(); // second board is empty, no destination needed
  const third = addBoard(w, p.id, "Ops");
  const moved = createCard(w, w.columns.find(c => c.boardId === third.id)!.id, "Ops task", "bottom");
  const before = w.activities.length;
  deleteBoard(w, third.id, w.boards.find(b => b.projectId === p.id)!.id);
  const survivor = w.boards.find(b => b.projectId === p.id)!;
  const survivorFirstColumn = w.columns.filter(c => c.boardId === survivor.id).sort((a, b) => a.position - b.position)[0]!;
  const relocated = w.cards.find(c => c.id === moved.id)!;
  expect(relocated.columnId).toBe(survivorFirstColumn.id);
  expect(w.activities.length).toBeGreaterThan(before);
  expect(w.activities.some(a => a.cardId === moved.id && a.action === "move")).toBe(true);
  expect(validateWorkspace(w)).toEqual(w);
});

test("Boards: deleting a populated board without a destination is rejected", () => {
  const { w, p, first } = fixture();
  createCard(w, first.id, "Anchor", "bottom");
  const second = addBoard(w, p.id, "Backend");
  createCard(w, w.columns.find(c => c.boardId === second.id)!.id, "Stranded", "bottom");
  expect(() => deleteBoard(w, second.id)).toThrow();
});

test("Boards: moveCardToBoard lands on the destination's first column and follows its completedAt rule, undoable as one step", () => {
  const { w, p, first, done } = fixture();
  const card = createCard(w, first.id, "Work", "bottom");
  const second = addBoard(w, p.id, "Backend");
  const secondFirstColumn = w.columns.filter(c => c.boardId === second.id).sort((a, b) => a.position - b.position)[0]!;
  const before = structuredClone(w);
  moveCardToBoard(w, card.id, second.id);
  expect(w.cards.find(c => c.id === card.id)!.columnId).toBe(secondFirstColumn.id);
  expect(w.cards.find(c => c.id === card.id)!.completedAt).toBeNull(); // destination's first column is not a done column
  undoWorkspace(w, before);
  expect(w.cards.find(c => c.id === card.id)!.columnId).toBe(first.id);
  expect(validateWorkspace(w)).toEqual(w);
  // Moving a done card into a board whose first column is not done clears completedAt.
  const doneCard = createCard(w, done.id, "Shipped", "bottom");
  expect(w.cards.find(c => c.id === doneCard.id)!.completedAt).not.toBeNull();
  moveCardToBoard(w, doneCard.id, second.id);
  expect(w.cards.find(c => c.id === doneCard.id)!.completedAt).toBeNull();
  expect(() => moveCardToBoard(w, "nonexistent", second.id)).toThrow();
  expect(() => moveCardToBoard(w, card.id, "nonexistent")).toThrow();
  expect(validateWorkspace(w)).toEqual(w);
});

test("Boards: moveCardToBoard refuses a board belonging to a different project", () => {
  const { w, first } = fixture();
  const card = createCard(w, first.id, "Work", "bottom");
  const other = createProject(w, "Other");
  const otherBoard = w.boards.find(b => b.projectId === other.id)!;
  expect(() => moveCardToBoard(w, card.id, otherBoard.id)).toThrow();
});

test("Boards: project-level totals count cards on every board, not just the first", () => {
  const { w, p, first } = fixture();
  editCard(w, createCard(w, first.id, "Sized one", "bottom").id, { effort: { ...defaultEffort(), rtl: [2, 2] } });
  const second = addBoard(w, p.id, "Backend");
  const secondColumn = w.columns.find(c => c.boardId === second.id)!;
  editCard(w, createCard(w, secondColumn.id, "Sized two", "bottom").id, { effort: { ...defaultEffort(), rtl: [3, 3] } });
  const project = w.projects.find(x => x.id === p.id)!; project.planning = defaultPlanning();
  const onlyFirstBoard = estimateProject({ ...w, boards: w.boards.filter(b => b.id !== second.id) }, p.id);
  const bothBoards = estimateProject(w, p.id);
  expect(bothBoards.modules[0]).toBeGreaterThan(onlyFirstBoard.modules[0]); // the second board's card adds to the total
  expect(bothBoards.modules[0]).toBeCloseTo(onlyFirstBoard.modules[0] + 3, 5);
});

test("Templates: saveCardTemplate captures description, subtasks, label names and priority; createCardFromTemplate is one mutation", () => {
  const { w, p, first } = fixture();
  p.labels.push({ id: "bug", name: "Bug", color: "#ff0000" });
  const source = createCard(w, first.id, "Source", "bottom");
  editCard(w, source.id, { description: "Do the thing", priority: "high", labels: ["bug"], subtasks: [{ id: "s1", title: "Step one", done: false, position: 0 }, { id: "s2", title: "Step two", done: true, position: 1 }] });
  const template = saveCardTemplate(w, source.id, "Bug fix template");
  expect(template.description).toBe("Do the thing");
  expect(template.priority).toBe("high");
  expect(template.labelNames).toEqual(["Bug"]);
  expect(template.subtasks).toEqual([{ title: "Step one", position: 0 }, { title: "Step two", position: 1 }]);
  const before = w.activities.length;
  const created = createCardFromTemplate(w, first.id, template.id, "bottom");
  expect(w.activities.length).toBe(before + 1); // one mutation, one Activity entry
  expect(created.title).toBe("Bug fix template");
  expect(created.description).toBe("Do the thing");
  expect(created.priority).toBe("high");
  expect(created.subtasks.map(s => s.title)).toEqual(["Step one", "Step two"]);
  expect(created.subtasks.every(s => s.done === false)).toBe(true);
  const label = p.labels.find(l => l.name === "Bug")!;
  expect(created.labels).toEqual([label.id]);
  expect(validateWorkspace(w)).toEqual(w);
});

test("Templates: createCardFromTemplate creates a project label by name when it no longer exists, without duplicating an existing one", () => {
  const { w, first } = fixture();
  const source = createCard(w, first.id, "Source", "bottom");
  editCard(w, source.id, { labels: [] });
  const t = saveCardTemplate(w, source.id, "Blank template");
  expect(t.labelNames).toEqual([]);
  expect(() => createCardFromTemplate(w, first.id, "nonexistent")).toThrow();
  expect(() => createCardFromTemplate(w, "nonexistent", t.id)).toThrow();
});

test("Templates: deleteCardTemplate removes it; unknown id rejected", () => {
  const { w, first } = fixture();
  const source = createCard(w, first.id, "Source", "bottom");
  const t = saveCardTemplate(w, source.id, "T");
  deleteCardTemplate(w, t.id);
  expect(w.cardTemplates).toEqual([]);
  expect(() => deleteCardTemplate(w, t.id)).toThrow();
});

test("Templates: structural validation rejects a card template with a nonempty name requirement, bad priority or non-contiguous subtask positions", () => {
  const { w, first } = fixture();
  const source = createCard(w, first.id, "Source", "bottom");
  saveCardTemplate(w, source.id, "T");
  const badPriority = structuredClone(w); (badPriority.cardTemplates![0] as any).priority = "urgentish";
  expect(() => validateWorkspace(badPriority)).toThrow();
  const badName = structuredClone(w); badName.cardTemplates![0]!.name = "";
  expect(() => validateWorkspace(badName)).toThrow();
  const badPositions = structuredClone(w); badPositions.cardTemplates![0]!.subtasks = [{ title: "a", position: 0 }, { title: "b", position: 5 }];
  expect(() => validateWorkspace(badPositions)).toThrow();
});

test("Templates: saveBoardTemplate captures column names, done flags and WIP limits; createBoardFromTemplate reproduces them", () => {
  const { w, p, board, columns } = fixture();
  columns[0]!.wipLimit = 3;
  const bt = saveBoardTemplate(w, board.id, "Standard flow");
  expect(bt.columns).toEqual([
    { name: "Backlog", wipLimit: 3, done: false },
    { name: "To Do", wipLimit: null, done: false },
    { name: "In Progress", wipLimit: null, done: false },
    { name: "Review", wipLimit: null, done: false },
    { name: "Done", wipLimit: null, done: true },
  ]);
  const created = createBoardFromTemplate(w, p.id, bt.id, "From template");
  const createdColumns = w.columns.filter(c => c.boardId === created.id).sort((a, b) => a.position - b.position);
  expect(createdColumns.map(c => ({ name: c.name, wipLimit: c.wipLimit, done: c.done }))).toEqual(bt.columns);
  expect(() => createBoardFromTemplate(w, p.id, "nonexistent", "X")).toThrow();
  expect(validateWorkspace(w)).toEqual(w);
});

test("Templates: deleteBoardTemplate removes it; unknown id rejected", () => {
  const { w, board } = fixture();
  const bt = saveBoardTemplate(w, board.id, "T");
  deleteBoardTemplate(w, bt.id);
  expect(w.boardTemplates).toEqual([]);
  expect(() => deleteBoardTemplate(w, bt.id)).toThrow();
});

test("Templates: structural validation rejects an empty board template and a non-positive WIP limit", () => {
  const { w, board } = fixture();
  const bt = saveBoardTemplate(w, board.id, "T");
  const empty = structuredClone(w); empty.boardTemplates![0]!.columns = [];
  expect(() => validateWorkspace(empty)).toThrow();
  const badWip = structuredClone(w); badWip.boardTemplates![0]!.columns[0]!.wipLimit = 0;
  expect(() => validateWorkspace(badWip)).toThrow();
  expect(bt.id).toBeTruthy();
});

test("optional board/card templates leave old workspaces byte-for-byte unchanged", () => {
  const { w, first } = fixture();
  createCard(w, first.id, "Plain", "bottom");
  const text = JSON.stringify(w);
  expect(JSON.stringify(validateWorkspace(JSON.parse(text)))).toBe(text);
  expect(w.cardTemplates).toBeUndefined();
  expect(w.boardTemplates).toBeUndefined();
});

test("Bulk actions: one stage-style loop over editCard produces one Activity entry per card and stays undoable as a single step", () => {
  const { w, first } = fixture();
  const a = createCard(w, first.id, "A", "bottom");
  const b = createCard(w, first.id, "B", "bottom");
  const before = structuredClone(w); const activityCountBefore = w.activities.length;
  for (const cardId of [a.id, b.id]) editCard(w, cardId, { priority: "high" });
  expect(w.cards.find(c => c.id === a.id)!.priority).toBe("high");
  expect(w.cards.find(c => c.id === b.id)!.priority).toBe("high");
  expect(w.activities.length).toBe(activityCountBefore + 2); // one Activity entry per affected card
  undoWorkspace(w, before);
  expect(w.cards.find(c => c.id === a.id)!.priority).toBe("none");
  expect(w.cards.find(c => c.id === b.id)!.priority).toBe("none"); // a single undo (one call) reverses both
  expect(validateWorkspace(w)).toEqual(w);
});

test("My work: orderedCards stays board-scoped after a cross-board move", () => {
  const { w, p, first } = fixture();
  const card = createCard(w, first.id, "Move me", "bottom");
  const second = addBoard(w, p.id, "Backend");
  moveCardToBoard(w, card.id, second.id);
  expect(orderedCards(w, first.id)).toEqual([]);
  expect(orderedCards(w, w.columns.find(c => c.boardId === second.id)!.id).map(c => c.id)).toEqual([card.id]);
});
