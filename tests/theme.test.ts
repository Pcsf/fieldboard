import { test, expect } from "bun:test";
import { createWorkspace, validateWorkspace, themes } from "../src/model";

test("theme: settings.theme is optional, accepts system/light/dark and round-trips", () => {
  const w = createWorkspace();
  expect(w.settings.theme).toBeUndefined();
  expect(validateWorkspace(JSON.parse(JSON.stringify(w)))).toEqual(w);
  for (const theme of themes) {
    w.settings.theme = theme;
    expect(validateWorkspace(JSON.parse(JSON.stringify(w)))).toEqual(w);
  }
});

test("theme: validation rejects any value outside system/light/dark", () => {
  const w = createWorkspace();
  (w.settings as any).theme = "blue";
  expect(() => validateWorkspace(w)).toThrow();
});

test("theme: a workspace saved before the field existed loads unchanged", () => {
  const w = createWorkspace();
  const { theme, ...withoutTheme } = w.settings as any;
  const old = { ...w, settings: withoutTheme };
  const loaded = validateWorkspace(JSON.parse(JSON.stringify(old)));
  expect(loaded.settings.theme).toBeUndefined();
  expect(loaded).toEqual(old);
});
