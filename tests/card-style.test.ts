import { expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, editCard, validateWorkspace, type Attachment } from "../src/model";
import { cardColors } from "../src/card-style";

function fixture() {
  const w = createWorkspace(); const p = createProject(w, "Design");
  const c = createCard(w, w.columns[0]!.id, "Card", "bottom");
  return { w, p, c };
}
const png = (id: string): Attachment => ({ id, name: `${id}.png`, type: "image/png", data: "data:image/png;base64,aGk=" });
const svg = (id: string): Attachment => ({ id, name: `${id}.svg`, type: "image/svg+xml", data: "data:image/svg+xml;base64,aGk=" });

test("a card colour must come from the fixed palette", () => {
  const { w, c } = fixture();
  editCard(w, c.id, { color: cardColors[0]!.id });
  expect(() => validateWorkspace(w)).not.toThrow();
  const bogus = createCard(w, w.columns[0]!.id, "Bogus", "bottom");
  editCard(w, bogus.id, { color: "neon-pink" });
  expect(() => validateWorkspace(w)).toThrow();
});

test("a cover must reference an image attachment on the same card", () => {
  const { w, c } = fixture();
  editCard(w, c.id, { attachments: [png("a1")] });
  editCard(w, c.id, { cover: "a1" });
  expect(() => validateWorkspace(w)).not.toThrow();
  // Referencing another card's attachment, or one that doesn't exist, is rejected.
  const other = createCard(w, w.columns[0]!.id, "Other", "bottom");
  editCard(w, other.id, { cover: "a1" });
  expect(() => validateWorkspace(w)).toThrow();
});

test("a cover must be an image attachment -- a non-thumbnail type (e.g. SVG) is refused even though it is a real attachment on the card", () => {
  const { w, c } = fixture();
  editCard(w, c.id, { attachments: [svg("s1")] });
  editCard(w, c.id, { cover: "s1" });
  expect(() => validateWorkspace(w)).toThrow();
});

test("removing the cover's attachment clears the cover (model-level: editCard replicates what the UI's remove handler does)", () => {
  const { w, c } = fixture();
  editCard(w, c.id, { attachments: [png("a1"), png("a2")] });
  editCard(w, c.id, { cover: "a1" });
  // Simulate the attachments-ui.ts remove handler: drop the attachment and clear cover in one edit.
  const current = w.cards.find(x => x.id === c.id)!;
  editCard(w, c.id, { attachments: current.attachments.filter(a => a.id !== "a1"), cover: undefined });
  const after = validateWorkspace(w).cards.find(x => x.id === c.id)!;
  expect(after.cover).toBeUndefined();
  expect(after.attachments.map(a => a.id)).toEqual(["a2"]);
});

test("cover and colour round-trip through JSON backup/restore and are absent on a fresh or old card", () => {
  const { w, c } = fixture();
  editCard(w, c.id, { attachments: [png("a1")], cover: "a1", color: "amber" });
  const restored = validateWorkspace(JSON.parse(JSON.stringify(w)));
  const card = restored.cards.find(x => x.id === c.id)!;
  expect(card.cover).toBe("a1"); expect(card.color).toBe("amber");
  const plain = createWorkspace(); createProject(plain, "Fresh");
  const plainCard = createCard(plain, plain.columns[0]!.id, "Plain", "bottom");
  expect(plainCard.cover).toBeUndefined(); expect(plainCard.color).toBeUndefined();
});
