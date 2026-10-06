import { expect, test } from "bun:test";
import { ATTACHMENT_MAX_BYTES, dataUrlByteLength, isThumbnailType, validateAttachment, attachmentBlob } from "../src/attachments";
import { createWorkspace, createProject, createCard, editCard, validateWorkspace, id } from "../src/model";

function pngDataUrl(bytes: number): string {
  // Not a real PNG; the model only cares that it is a well-formed data URL within the size cap.
  const base64 = Buffer.alloc(Math.ceil(bytes / 3) * 3).fill(1).toString("base64");
  return `data:image/png;base64,${base64}`;
}

test("isThumbnailType: PNG/JPEG/GIF/WebP get thumbnails, SVG and everything else does not", () => {
  expect(isThumbnailType("image/png")).toBe(true);
  expect(isThumbnailType("image/jpeg")).toBe(true);
  expect(isThumbnailType("image/gif")).toBe(true);
  expect(isThumbnailType("image/webp")).toBe(true);
  expect(isThumbnailType("image/svg+xml")).toBe(false);
  expect(isThumbnailType("application/pdf")).toBe(false);
  expect(isThumbnailType("text/html")).toBe(false);
});

test("dataUrlByteLength: matches the original byte length through base64 padding", () => {
  expect(dataUrlByteLength("data:text/plain;base64,QQ==")).toBe(1);
  expect(dataUrlByteLength("data:text/plain;base64,QUI=")).toBe(2);
  expect(dataUrlByteLength("data:text/plain;base64,QUJD")).toBe(3);
});

test("validateAttachment: refuses a non-data-URL, an empty field and an oversized payload", () => {
  expect(() => validateAttachment({ id: id(), name: "a.png", type: "image/png", data: "not-a-data-url" })).toThrow();
  expect(() => validateAttachment({ id: id(), name: "", type: "image/png", data: pngDataUrl(100) })).toThrow();
  expect(() => validateAttachment({ id: id(), name: "big.png", type: "image/png", data: pngDataUrl(ATTACHMENT_MAX_BYTES + 1024) })).toThrow(/limit/);
  expect(() => validateAttachment({ id: id(), name: "ok.png", type: "image/png", data: pngDataUrl(1024) })).not.toThrow();
});

test("attachmentBlob: always downloads as application/octet-stream regardless of the stored type", () => {
  const blob = attachmentBlob({ data: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" });
  expect(blob.type).toBe("application/octet-stream");
});

test("model: adding and removing an attachment is a card mutation (Activity + undo) and round-trips through validateWorkspace", () => {
  const w = createWorkspace();
  const p = createProject(w, "Release");
  const column = w.columns.find(c => c.boardId === w.boards.find(b => b.projectId === p.id)!.id)!;
  const card = createCard(w, column.id, "Ship", "top");
  const before = w.activities.length;
  const attachment = { id: id(), name: "diagram.png", type: "image/png", data: pngDataUrl(2048) };
  editCard(w, card.id, { attachments: [attachment] });
  expect(w.activities.length).toBe(before + 1);
  expect(w.cards.find(c => c.id === card.id)!.attachments).toEqual([attachment]);
  expect(validateWorkspace(JSON.parse(JSON.stringify(w)))).toEqual(w);
  editCard(w, card.id, { attachments: [] });
  expect(w.activities.length).toBe(before + 2);
  expect(w.cards.find(c => c.id === card.id)!.attachments).toEqual([]);
  expect(validateWorkspace(JSON.parse(JSON.stringify(w)))).toEqual(w);
});

test("model: an oversized attachment is refused by validateWorkspace and nothing is written", () => {
  const w = createWorkspace();
  const p = createProject(w, "Release");
  const column = w.columns.find(c => c.boardId === w.boards.find(b => b.projectId === p.id)!.id)!;
  const card = createCard(w, column.id, "Ship", "top");
  editCard(w, card.id, { attachments: [{ id: id(), name: "huge.png", type: "image/png", data: pngDataUrl(ATTACHMENT_MAX_BYTES * 2) }] });
  // editCard mutates its given workspace directly; the Session layer is what clones, runs the
  // mutation on the clone and only commits if this structural check passes (see src/storage.ts).
  expect(() => validateWorkspace(JSON.parse(JSON.stringify(w)))).toThrow(/limit/);
});

test("backup round trip: an attachment's data URL survives JSON serialization byte-for-byte", () => {
  const w = createWorkspace();
  const p = createProject(w, "Release");
  const column = w.columns.find(c => c.boardId === w.boards.find(b => b.projectId === p.id)!.id)!;
  const card = createCard(w, column.id, "Ship", "top");
  const data = pngDataUrl(4096);
  editCard(w, card.id, { attachments: [{ id: id(), name: "shot.png", type: "image/png", data }] });
  const restored = JSON.parse(JSON.stringify(w));
  expect(restored.cards.find((c: { id: string }) => c.id === card.id).attachments[0].data).toBe(data);
  expect(validateWorkspace(restored)).toEqual(w);
});
