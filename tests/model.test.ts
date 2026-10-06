import { describe, expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, editCard, moveCard, archiveCard, deleteCard, addColumn, updateColumn, reorderColumn, deleteColumn, undoWorkspace, matches, encodeFilters, decodeFilters, validateWorkspace, migrateWorkspace, type Filters } from "../src/model";
import { markdown } from "../src/markdown";

function fixture() {
  const w = createWorkspace();
  const p = createProject(w, "Release");
  const columns = w.columns.filter(c => c.boardId === w.boards.find(b => b.projectId === p.id)!.id);
  return { w, p, columns, first: columns[0]!, done: columns[4]! };
}

test("project: creates board with the five ordered default columns", () => {
  const { w, columns } = fixture();
  expect(columns.map(c => c.name)).toEqual(["Backlog", "To Do", "In Progress", "Review", "Done"]);
  expect(columns.map(c => c.position)).toEqual([0, 1, 2, 3, 4]);
  expect(columns[4]!.done).toBe(true);
  expect(validateWorkspace(JSON.parse(JSON.stringify(w)))).toEqual(w);
});

test("columns: add, rename, reorder and delete only with explicit destination", () => {
  const { w, first, done } = fixture();
  const c = createCard(w, first.id, "Keep me", "bottom");
  const extra = addColumn(w, first.boardId, "Waiting");
  updateColumn(w, extra.id, { name: "Ready", done: false });
  reorderColumn(w, extra.id, 0);
  expect(w.columns.find(c => c.id === extra.id)!.position).toBe(0);
  expect(() => deleteColumn(w, first.id)).toThrow();
  deleteColumn(w, first.id, done.id);
  expect(w.cards.find(x => x.id === c.id)!.columnId).toBe(done.id);
  expect(w.cards.find(x => x.id === c.id)!.completedAt).not.toBeNull();
  expect(validateWorkspace(w)).toEqual(w);
});

test("lifecycle: every create, edit, move, archive, restore and delete appends activity", () => {
  const { w, first, done } = fixture();
  const c = createCard(w, first.id, "Ship", "top");
  editCard(w, c.id, { title: "Ship safely", description: "**Ready**", priority: "urgent", dueDate: "2026-01-03", estimate: 3,
    subtasks: [{ id: "sub", title: "Test", done: true, position: 0 }],
    comments: [{ id: "comment", author: w.members[0]!.id, body: "Good", timestamp: new Date().toISOString() }] });
  moveCard(w, c.id, done.id, 0);
  archiveCard(w, c.id, true);
  archiveCard(w, c.id, false);
  deleteCard(w, c.id);
  expect(w.cards).toHaveLength(0);
  expect(w.activities.map(a => a.action)).toEqual(["create", "edit", "move", "archive", "restore", "delete"]);
  expect(w.activities.every(a => a.cardId === c.id && a.actor && a.timestamp)).toBe(true);
  expect(w.activities[5]!.before?.title).toBe("Ship safely");
  expect(validateWorkspace(w)).toEqual(w);
});

test("completion: entering, leaving and changing done flags maintains timestamps", () => {
  const { w, first, done } = fixture();
  const c = createCard(w, first.id, "Work", "bottom");
  expect(c.completedAt).toBeNull();
  moveCard(w, c.id, done.id, 0);
  expect(c.completedAt).toBeTruthy();
  moveCard(w, c.id, first.id, 0);
  expect(c.completedAt).toBeNull();
  updateColumn(w, first.id, { done: true });
  expect(c.completedAt).toBeTruthy();
  updateColumn(w, first.id, { done: false });
  expect(c.completedAt).toBeNull();
});

test("order: top, bottom, within-column and cross-column moves keep unique contiguous positions", () => {
  const { w, first, done } = fixture();
  const a = createCard(w, first.id, "A", "bottom");
  const b = createCard(w, first.id, "B", "top");
  const c = createCard(w, first.id, "C", "bottom");
  moveCard(w, c.id, first.id, 0);
  expect(w.cards.filter(c => c.columnId === first.id).sort((a,b) => a.position-b.position).map(c => c.title)).toEqual(["C", "B", "A"]);
  moveCard(w, b.id, done.id, 0);
  expect(w.cards.find(c => c.id === a.id)!.position).toBe(1);
  expect(validateWorkspace(w)).toEqual(w);
});

test("undo: restores edits, moves and deletes while preserving append-only audit", () => {
  const { w, first, done } = fixture();
  const c = createCard(w, first.id, "Original", "bottom");
  for (const mutate of [(x: typeof w) => editCard(x,c.id,{title:"Edited"}), (x: typeof w) => moveCard(x,c.id,done.id,0), (x: typeof w) => deleteCard(x,c.id)]) {
    const before = structuredClone(w);
    mutate(w);
    const activities = structuredClone(w.activities);
    undoWorkspace(w, before);
    expect(w.cards).toEqual(before.cards);
    expect(w.activities.slice(0,activities.length)).toEqual(activities);
    expect(w.activities.at(-1)!.action).toBe("undo");
  }
});

test("undo preserves identities referenced by append-only audit history", () => {
  const {w,first}=fixture();const card=createCard(w,first.id,"Existing","bottom");const beforeMember=structuredClone(w);
  w.members.push({id:"bob",name:"Bob",color:"#667b68"});w.settings.actorId="bob";
  editCard(w,card.id,{title:"Edited by Bob"});undoWorkspace(w,beforeMember);
  expect(()=>validateWorkspace(w)).not.toThrow();expect(w.members.some(m=>m.id==="bob")).toBe(true);
  expect(w.activities.some(a=>a.actor==="bob")).toBe(true);
});

test("filters: AND semantics, description search, due states and fragment roundtrip", () => {
  const { w, first, p } = fixture();
  p.labels.push({id:"bug",name:"Bug",color:"#ff0000"});
  const c = createCard(w, first.id, "Ship", "bottom");
  editCard(w,c.id,{description:"Special text",labels:["bug"],assignees:[w.members[0]!.id],priority:"high",dueDate:"2026-01-02"});
  const f: Filters = { q:"special",label:"bug",assignee:w.members[0]!.id,priority:"high",due:"overdue",project:p.id,milestone:"",blocked:"",epic:"",board:"",view:"",sort:"",group:"",focus:"" };
  expect(matches(c,f,new Date("2026-01-04T12:00:00"))).toBe(true);
  expect(matches(c,{...f,priority:"urgent"},new Date("2026-01-04"))).toBe(false);
  expect(matches(c,{...f,due:"none"})).toBe(false);
  expect(matches(c,{...f,due:"week"},new Date("2026-01-01T12:00:00"))).toBe(true);
  expect(decodeFilters(encodeFilters(f))).toEqual(f);
});

describe("backup", () => {
  test("lossless roundtrip includes all entities and activity", () => {
    const { w, first } = fixture();
    createCard(w,first.id,"Roundtrip","bottom");
    expect(validateWorkspace(JSON.parse(JSON.stringify(w)))).toEqual(w);
  });
  test("rejects invalid fields, relationships, duplicate IDs, dates, schema and future versions", () => {
    const { w, first } = fixture(); createCard(w,first.id,"Valid","bottom");
    const bads: ((x: any)=>void)[] = [x=>x.schemaVersion=999, x=>x.cards[0].columnId="missing", x=>x.cards.push(x.cards[0]), x=>x.cards[0].priority="super", x=>x.cards[0].dueDate="2026-99-99", x=>x.cards[0].labels=["foreign"], x=>x.cards[0].assignees=["unknown"], x=>x.projects[0].labels[0]={id:"bad",name:"bad",color:"url(https://evil)"}, x=>x.cards[0].title=42, x=>delete x.activities, x=>x.cards[0].position=-1, x=>x.cards[0].startDate="2026-99-99", x=>{x.cards[0].startDate="2026-01-05";x.cards[0].dueDate="2026-01-01";}];
    for (const bad of bads) { const x=structuredClone(w); bad(x); expect(()=>validateWorkspace(x)).toThrow(); }
  });
  test("migration preserves populated v1 data", () => {
    const { w, first } = fixture(); createCard(w,first.id,"Legacy","bottom");
    const legacy: any=structuredClone(w); legacy.schemaVersion=1; delete legacy.cards[0].completedAt;
    const next=migrateWorkspace(legacy);
    expect(next.schemaVersion).toBe(2); expect(next.cards[0]!.title).toBe("Legacy");
    expect(next.activities).toEqual(w.activities); expect(next.cards[0]!.completedAt).toBeNull();
  });
});

test("Markdown: formats safe text while refusing HTML, script links and remote images", () => {
  const result=markdown('# Heading\n**Bold** and *italic* with `code`\n- item\n[ok](https://example.com)\n<script>alert(1)</script>\n![tracking](https://evil.test/pixel)\n[bad](javascript:alert(1))\n<img src=x onerror=alert(1)>');
  expect(result).toContain("<h1>Heading</h1>"); expect(result).toContain("<strong>Bold</strong>");
  expect(result).toContain("<code>code</code>"); expect(result).toContain("<li>item</li>");
  expect(result).not.toMatch(/<script|<img|href="javascript:|<[^>]+onerror=/);
  expect(result).toContain('rel="noopener noreferrer"');
});

test("calendar-invalid dates are rejected as invalid workspace data, not as a runtime RangeError", () => {
  const w = createWorkspace(); const p = createProject(w, "Dates");
  const col = w.columns.find(c => c.boardId === w.boards.find(b => b.projectId === p.id)!.id)!;
  const c = createCard(w, col.id, "Card", "bottom");
  const bad = structuredClone(w); bad.cards.find(x => x.id === c.id)!.dueDate = "2026-13-40";
  expect(() => validateWorkspace(bad)).toThrow(/^Invalid workspace: invalid date$/);
  const badMilestone = structuredClone(w); (badMilestone.projects[0] as any).milestones = [{ id: "m", name: "M", date: "2026-02-31", description: "" }];
  expect(() => validateWorkspace(badMilestone)).toThrow(/^Invalid workspace/);
});

test("startDate: optional, additive, and must not fall after dueDate when both are set", () => {
  const w = createWorkspace(); const p = createProject(w, "Timeline");
  const col = w.columns.find(c => c.boardId === w.boards.find(b => b.projectId === p.id)!.id)!;
  const c = createCard(w, col.id, "Card", "bottom");
  expect(c.startDate).toBeUndefined();
  expect(() => validateWorkspace(JSON.parse(JSON.stringify(w)))).not.toThrow(); // absent on old/plain cards
  editCard(w, c.id, { startDate: "2026-03-09", dueDate: "2026-03-11" });
  expect(w.cards.find(x => x.id === c.id)!.startDate).toBe("2026-03-09");
  expect(() => validateWorkspace(JSON.parse(JSON.stringify(w)))).not.toThrow();
  const invalid = structuredClone(w); invalid.cards.find(x => x.id === c.id)!.startDate = "2026-03-12"; // after dueDate
  expect(() => validateWorkspace(invalid)).toThrow(/start date after due date/);
  editCard(w, c.id, { dueDate: null }); // clearing the due date leaves a lone start date valid
  expect(() => validateWorkspace(JSON.parse(JSON.stringify(w)))).not.toThrow();
});
