import { expect, test } from "bun:test";
import {
  createWorkspace, createProject, createCard, editCard, setBoardSwimlane, moveCardInLane,
  validateWorkspace, resolveLabels, type Workspace,
} from "../src/model";
import { lanesFor, cardLaneIds, laneCards } from "../src/swimlanes";

function fixture() {
  const w = createWorkspace(); const p = createProject(w, "Release");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const columns = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  const [backlog, todo] = columns;
  const alice = w.members[0]!;
  const bob = { id: "bob", name: "Bob", color: "#334455" }; w.members.push(bob);
  return { w, p, board, backlog: backlog!, todo: todo!, alice, bob };
}

test("Swimlanes: setBoardSwimlane accepts every kind and validateWorkspace rejects an invalid one", () => {
  const { w, board } = fixture();
  for (const kind of ["none", "assignee", "priority", "label", "epic"] as const) {
    setBoardSwimlane(w, board.id, kind);
    expect(validateWorkspace(w)).toEqual(w);
  }
  (w.boards.find(b => b.id === board.id) as any).swimlane = "bogus";
  expect(() => validateWorkspace(w)).toThrow();
});

test("Swimlanes: cardLaneIds puts an unattributed card in the None lane and a multi-value card in every matching lane", () => {
  const { w, backlog, alice, bob } = fixture();
  const card = createCard(w, backlog.id, "Card", "bottom");
  expect(cardLaneIds(w.cards[0]!, "assignee")).toEqual(["none"]);
  expect(cardLaneIds(w.cards[0]!, "label")).toEqual(["none"]);
  expect(cardLaneIds(w.cards[0]!, "epic")).toEqual(["none"]);
  expect(cardLaneIds(w.cards[0]!, "priority")).toEqual(["none"]);
  editCard(w, card.id, { assignees: [alice.id, bob.id] });
  expect(cardLaneIds(w.cards.find(c => c.id === card.id)!, "assignee").sort()).toEqual([alice.id, bob.id].sort());
});

test("Swimlanes: lanesFor lists every member/label/epic plus a trailing None lane, and priority lanes cover all five priorities", () => {
  const { w, backlog, alice, bob } = fixture();
  const epic = createCard(w, backlog.id, "Epic", "bottom");
  const kid = createCard(w, backlog.id, "Kid", "bottom"); editCard(w, kid.id, { parentId: epic.id });
  const assigneeLanes = lanesFor("assignee", w.cards, { members: w.members, labels: [] });
  expect(assigneeLanes.map(l => l.id)).toEqual([alice.id, bob.id, "none"]);
  const priorityLanes = lanesFor("priority", w.cards, { members: [], labels: [] });
  expect(priorityLanes.map(l => l.id)).toEqual(["none", "low", "medium", "high", "urgent"]);
  const epicLanes = lanesFor("epic", w.cards, { members: [], labels: [] });
  expect(epicLanes.map(l => l.id)).toEqual([epic.id, "none"]);
  expect(lanesFor("none", w.cards, { members: [], labels: [] })).toEqual([]);
});

test("Swimlanes: laneCards keeps the column's card order within a lane-column cell", () => {
  const { w, backlog, alice } = fixture();
  const a = createCard(w, backlog.id, "A", "bottom"); editCard(w, a.id, { assignees: [alice.id] });
  const b = createCard(w, backlog.id, "B", "top"); editCard(w, b.id, { assignees: [alice.id] });
  const c = createCard(w, backlog.id, "C", "bottom");
  const lane = laneCards(w.cards, backlog.id, alice.id, "assignee");
  expect(lane.map(x => x.title)).toEqual(["B", "A"]);
  expect(laneCards(w.cards, backlog.id, "none", "assignee").map(x => x.title)).toEqual([c.title]);
});

test("Swimlanes: moveCardInLane moves the card and the attribute in one mutation", () => {
  const { w, backlog, todo, alice, bob } = fixture();
  const card = createCard(w, backlog.id, "Card", "bottom"); editCard(w, card.id, { assignees: [alice.id] });
  const before = w.activities.length;
  moveCardInLane(w, card.id, todo.id, 0, "assignee", alice.id, bob.id);
  const updated = w.cards.find(c => c.id === card.id)!;
  expect(updated.columnId).toBe(todo.id);
  expect(updated.assignees).toEqual([bob.id]);
  expect(w.activities.length).toBe(before + 1);
});

test("Swimlanes: assignee lane move only touches the dragged membership, keeping other assignees", () => {
  const { w, backlog, alice, bob } = fixture();
  const card = createCard(w, backlog.id, "Card", "bottom"); editCard(w, card.id, { assignees: [alice.id, bob.id] });
  const carol = { id: "carol", name: "Carol", color: "#112233" }; w.members.push(carol);
  moveCardInLane(w, card.id, backlog.id, 0, "assignee", alice.id, carol.id);
  expect(w.cards.find(c => c.id === card.id)!.assignees.sort()).toEqual([bob.id, carol.id].sort());
});

test("Swimlanes: assignee None lane clears the dragged membership (None -> none)", () => {
  const { w, backlog, alice } = fixture();
  const card = createCard(w, backlog.id, "Card", "bottom"); editCard(w, card.id, { assignees: [alice.id] });
  moveCardInLane(w, card.id, backlog.id, 0, "assignee", alice.id, "none");
  expect(w.cards.find(c => c.id === card.id)!.assignees).toEqual([]);
});

test("Swimlanes: priority lane sets the priority directly", () => {
  const { w, backlog } = fixture();
  const card = createCard(w, backlog.id, "Card", "bottom");
  moveCardInLane(w, card.id, backlog.id, 0, "priority", "none", "urgent");
  expect(w.cards.find(c => c.id === card.id)!.priority).toBe("urgent");
});

test("Swimlanes: label lane gains the target label and loses the source lane's label; None lane just removes it", () => {
  const { w, p, backlog } = fixture();
  const project = w.projects.find(x => x.id === p.id)!;
  const [bug, release] = resolveLabels(project, ["Bug", "Release"]);
  const card = createCard(w, backlog.id, "Card", "bottom"); editCard(w, card.id, { labels: [bug!] });
  moveCardInLane(w, card.id, backlog.id, 0, "label", bug!, release!);
  expect(w.cards.find(c => c.id === card.id)!.labels).toEqual([release!]);
  moveCardInLane(w, card.id, backlog.id, 0, "label", release!, "none");
  expect(w.cards.find(c => c.id === card.id)!.labels).toEqual([]);
});

test("Swimlanes: epic lane sets and clears parentId, and a rejected cyclic move leaves the workspace unchanged", () => {
  const { w, backlog } = fixture();
  const epic = createCard(w, backlog.id, "Epic", "bottom");
  const kid = createCard(w, backlog.id, "Kid", "bottom");
  moveCardInLane(w, kid.id, backlog.id, 0, "epic", "none", epic.id);
  expect(w.cards.find(c => c.id === kid.id)!.parentId).toBe(epic.id);
  moveCardInLane(w, kid.id, backlog.id, 0, "epic", epic.id, "none");
  expect(w.cards.find(c => c.id === kid.id)!.parentId).toBeUndefined();
  // Simulate the session.change() pattern: mutate a clone, and a cycle must fail validation so the
  // real state (here, w) is never touched -- "a rejected move leaves the card unchanged".
  moveCardInLane(w, kid.id, backlog.id, 0, "epic", "none", epic.id);
  const clone: Workspace = structuredClone(w);
  moveCardInLane(clone, epic.id, backlog.id, 0, "epic", "none", kid.id);
  expect(() => validateWorkspace(clone, false)).toThrow();
  expect(w.cards.find(c => c.id === epic.id)!.parentId).toBeUndefined();
});
