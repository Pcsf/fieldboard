import { expect, test } from "bun:test";
import { visualOrder, adjacentColumn, neighbor } from "../src/keyboard";

const columns = [{ id: "a", position: 0 }, { id: "b", position: 1 }, { id: "c", position: 2 }];
const cards = [
  { id: "a2", columnId: "a", position: 1 }, { id: "a1", columnId: "a", position: 0 },
  { id: "b1", columnId: "b", position: 0 },
  { id: "c1", columnId: "c", position: 0 }, { id: "c2", columnId: "c", position: 1 },
];

test("visualOrder: columns left to right by position, cards within a column top to bottom by position", () => {
  expect(visualOrder(columns, cards)).toEqual(["a1", "a2", "b1", "c1", "c2"]);
});

test("visualOrder: an empty board has no order", () => {
  expect(visualOrder([], [])).toEqual([]);
});

test("adjacentColumn: steps to the next or previous column by position and clamps at either end", () => {
  expect(adjacentColumn(columns, "a", 1)).toBe("b");
  expect(adjacentColumn(columns, "b", 1)).toBe("c");
  expect(adjacentColumn(columns, "c", 1)).toBeNull();
  expect(adjacentColumn(columns, "a", -1)).toBeNull();
  expect(adjacentColumn(columns, "unknown", 1)).toBeNull();
});

test("neighbor: starts at the first or last item when nothing is focused, then steps and clamps", () => {
  const order = ["a1", "a2", "b1"];
  expect(neighbor(order, null, 1)).toBe("a1");
  expect(neighbor(order, null, -1)).toBe("b1");
  expect(neighbor(order, "a1", 1)).toBe("a2");
  expect(neighbor(order, "b1", 1)).toBe("b1");
  expect(neighbor(order, "a1", -1)).toBe("a1");
  expect(neighbor([], "a1", 1)).toBeNull();
});

test("neighbor: a focused card no longer in the order restarts from the first or last item", () => {
  expect(neighbor(["a1", "a2"], "gone", 1)).toBe("a1");
  expect(neighbor(["a1", "a2"], "gone", -1)).toBe("a2");
});
