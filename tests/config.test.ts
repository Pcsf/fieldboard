import { expect, test } from "bun:test";
test("development uses strict TypeScript without emitting adjacent runtime files", async () => {
  const file = Bun.file("tsconfig.json");
  expect(await file.exists()).toBe(true);
  const config = await file.json();
  expect(config.compilerOptions.strict).toBe(true);
  expect(config.compilerOptions.noUncheckedIndexedAccess).toBe(true);
  expect(config.compilerOptions.noEmit).toBe(true);
});

test("development dependencies are pinned rather than floating", async () => {
  const config = await Bun.file("package.json").json();
  for (const version of Object.values(config.devDependencies)) expect(version).toMatch(/^\d+\.\d+\.\d+$/);
});
