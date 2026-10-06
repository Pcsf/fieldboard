import { expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, editCard, matches, emptyFilters, encodeFilters, decodeFilters, type Filters } from "../src/model";

function fixture() {
  const w = createWorkspace(); createProject(w, "Focus");
  const me = w.settings.actorId;
  const mine = createCard(w, w.columns[0]!.id, "Mine", "bottom"); editCard(w, mine.id, { assignees: [me] });
  const theirs = createCard(w, w.columns[0]!.id, "Theirs", "bottom");
  w.members.push({ id: "other", name: "Other", color: "#667b68" });
  editCard(w, theirs.id, { assignees: ["other"] });
  const unassigned = createCard(w, w.columns[0]!.id, "Unassigned", "bottom");
  return { w, me, mine, theirs, unassigned };
}

test("focus off: every non-archived card matches regardless of assignee", () => {
  const { w, me, mine, theirs, unassigned } = fixture();
  const f: Filters = { ...emptyFilters };
  for (const c of [mine, theirs, unassigned]) expect(matches(w.cards.find(x => x.id === c.id)!, f, new Date(), me)).toBe(true);
});

test("focus on: only cards assigned to the acting member match, in every view's filter", () => {
  const { w, me, mine, theirs, unassigned } = fixture();
  const f: Filters = { ...emptyFilters, focus: "mine" };
  expect(matches(w.cards.find(x => x.id === mine.id)!, f, new Date(), me)).toBe(true);
  expect(matches(w.cards.find(x => x.id === theirs.id)!, f, new Date(), me)).toBe(false);
  expect(matches(w.cards.find(x => x.id === unassigned.id)!, f, new Date(), me)).toBe(false);
});

test("focus on with no actorId supplied hides everything rather than guessing -- existing call sites that never pass one are unaffected because they never set focus", () => {
  const { w, mine } = fixture();
  const f: Filters = { ...emptyFilters, focus: "mine" };
  expect(matches(w.cards.find(x => x.id === mine.id)!, f)).toBe(false);
});

test("focus survives the URL fragment round trip like every other filter", () => {
  const f: Filters = { ...emptyFilters, focus: "mine", project: "p1" };
  expect(decodeFilters(encodeFilters(f))).toEqual(f);
});
