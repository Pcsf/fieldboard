import { expect, test } from "bun:test";
import { fuzzyScore, rankItems, type PaletteItem } from "../src/palette";

test("fuzzyScore: prefix beats word-start beats subsequence, and an empty query matches everything equally", () => {
  const prefix = fuzzyScore("boa", "Board")!;
  const wordStart = fuzzyScore("boa", "Backlog board")!;
  const subsequence = fuzzyScore("boa", "Dashboard")!;
  const none = fuzzyScore("xyz", "Board");
  expect(prefix).toBeLessThan(wordStart);
  expect(wordStart).toBeLessThan(subsequence);
  expect(none).toBeNull();
  expect(fuzzyScore("", "anything")).toBe(0);
});

test("fuzzyScore: an exact match beats a plain prefix match", () => {
  expect(fuzzyScore("board", "Board")!).toBeLessThan(fuzzyScore("board", "Boards")!);
});

test("fuzzyScore: case-insensitive matching", () => {
  expect(fuzzyScore("BOARD", "board")).toBe(0);
});

test("fuzzyScore: a character out of order fails the subsequence test", () => {
  expect(fuzzyScore("ob", "Board")).toBeNull();
});

test("rankItems: sorts by rank tier, then alphabetically within a tier, and drops non-matches", () => {
  const items: PaletteItem[] = [
    { id: "1", kind: "action", label: "Dashboard" },
    { id: "2", kind: "action", label: "Board" },
    { id: "3", kind: "action", label: "Backlog board" },
    { id: "4", kind: "action", label: "Unrelated" },
  ];
  expect(rankItems(items, "boa").map(i => i.id)).toEqual(["2", "3", "1"]);
});

test("rankItems: an empty query returns every item, alphabetically", () => {
  const items: PaletteItem[] = [{ id: "1", kind: "action", label: "Zebra" }, { id: "2", kind: "action", label: "Apple" }];
  expect(rankItems(items, "").map(i => i.id)).toEqual(["2", "1"]);
});

test("rankItems: caps results at 50", () => {
  const items: PaletteItem[] = Array.from({ length: 80 }, (_, i) => ({ id: String(i), kind: "card" as const, label: `Card ${i}` }));
  expect(rankItems(items, "card").length).toBe(50);
});
