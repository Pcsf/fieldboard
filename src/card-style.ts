// A small, fixed palette rather than a free colour picker: each entry is a theme token
// (--card-color-<id> in src/styles.css), defined once in light :root and byte-identically in both
// dark blocks, so a stored colour never needs its own light/dark pair computed here.
export interface CardColorOption { id: string; name: string }
export const cardColors: CardColorOption[] = [
  { id: "sage", name: "Sage" },
  { id: "amber", name: "Amber" },
  { id: "rose", name: "Rose" },
  { id: "indigo", name: "Indigo" },
  { id: "slate", name: "Slate" },
];
export function validateCardColor(x: unknown): asserts x is string {
  if (typeof x !== "string" || !cardColors.some(c => c.id === x)) throw new Error("Unknown card colour");
}
