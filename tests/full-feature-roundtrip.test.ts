import { expect, test } from "bun:test";
import { buildA11yFixture } from "./a11y-fixture";
import { migrateWorkspace, editCard, updateColumn, type Workspace } from "../src/model";
import { setSprintMeta, closeSprint } from "../src/planning";
import { setAutoArchiveDays } from "../src/automation";
import { generateDueReminders } from "../src/notifications";

// One workspace carrying every optional field the release adds must survive the JSON backup path
// byte for byte, so no feature's data is silently dropped or reshaped by a restore.
function everything(): Workspace {
  const w = buildA11yFixture(new Date("2026-10-06T12:00:00Z"));
  const project = w.projects[0]!; const board = w.boards.find(b => b.projectId === project.id)!;
  const cols = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  const card = w.cards[0]!;
  w.settings.estimateUnit = "hours"; w.settings.theme = "dark";
  updateColumn(w, cols[1]!.id, { wipLimit: 3, agingDays: 5 });
  setAutoArchiveDays(w, board.id, 14);
  editCard(w, card.id, { recurrence: { frequency: "weekly", columnId: cols[0]!.id, next: "2026-10-12" }, timeEntries: [{ id: "t1", start: "2026-10-01T09:00:00.000Z", end: "2026-10-01T10:30:00.000Z", note: "bench" }], color: "amber", watchers: [w.settings.actorId], estimate: 4 } as never);
  setSprintMeta(w, project.id, 1, { name: "Bring-up", startDate: "2026-09-28", endDate: "2026-10-09", scope: "first light" });
  closeSprint(w, project.id, 1, "carried over");
  generateDueReminders(w, new Date("2026-10-06T12:00:00Z"));
  return w;
}

test("a workspace using every release feature round-trips through JSON backup unchanged", () => {
  const w = everything();
  const json = JSON.stringify(w);
  for (const key of ["estimateUnit", "agingDays", "autoArchiveDays", "recurrence", "timeEntries", "\"color\"", "watchers", "sprints", "rules", "notifications", "attachments", "links"]) expect(json).toContain(key);
  const restored = migrateWorkspace(JSON.parse(json));
  expect(JSON.stringify(restored)).toBe(json);
});
