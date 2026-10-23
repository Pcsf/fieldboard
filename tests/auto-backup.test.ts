import { expect, test } from "bun:test";
import { AutoBackup, backupFileName } from "../src/auto-backup";
import { createWorkspace, createProject, editCard, createCard, type Workspace } from "../src/model";

function populated(): Workspace { const w = createWorkspace(); createProject(w, "P"); createCard(w, w.columns[0]!.id, "One", "bottom"); return w; }
function harness(intervalMs = 1000) {
  let now = 1_000_000; const downloads: { name: string; text: string; at: number }[] = [];
  const timers: { at: number; fn: () => void }[] = [];
  const backup = new AutoBackup((name, text) => downloads.push({ name, text, at: now }), { intervalMs, now: () => now, setTimer: (fn, ms) => { timers.push({ at: now + ms, fn }); return timers.length; }, clearTimer: id => { const t = timers[id - 1]; if (t) t.fn = () => {}; } });
  const advance = (ms: number) => { now += ms; for (const t of timers.splice(0)) { if (t.at <= now) t.fn(); else timers.push(t); } };
  return { backup, downloads, advance, clock: () => now };
}

test("file name sorts by time and carries the date", () => {
  expect(backupFileName(new Date(2026, 9, 23, 9, 5, 7))).toBe("fieldboard-2026-10-23-0905.json");
});

test("disabled: nothing is downloaded however much changes", () => {
  const h = harness(); h.backup.note(populated()); h.advance(10_000); expect(h.downloads).toHaveLength(0); expect(h.backup.dirty).toBe(false);
});

test("enabled: the first change downloads at once, later changes wait for the interval and ship the latest state only", () => {
  const h = harness(1000); h.backup.enabled = true;
  const w1 = populated(); h.backup.note(w1);
  expect(h.downloads).toHaveLength(1); expect(h.backup.dirty).toBe(false); expect(h.backup.lastAt).toBe(h.clock());
  const w2 = structuredClone(w1); editCard(w2, w2.cards[0]!.id, { title: "Two" }); h.backup.note(w2);
  const w3 = structuredClone(w2); editCard(w3, w3.cards[0]!.id, { title: "Three" }); h.backup.note(w3);
  expect(h.downloads).toHaveLength(1); expect(h.backup.dirty).toBe(true);
  h.advance(999); expect(h.downloads).toHaveLength(1);
  h.advance(1); expect(h.downloads).toHaveLength(2); expect(JSON.parse(h.downloads[1]!.text).cards[0].title).toBe("Three"); expect(h.backup.dirty).toBe(false);
  h.backup.note(structuredClone(w3)); expect(h.backup.dirty).toBe(false); // same content: nothing pending
});

test("hidden tab and 'now' flush a pending change immediately; nothing pending means no download", () => {
  const h = harness(60_000); h.backup.enabled = true;
  const w1 = populated(); h.backup.note(w1); expect(h.downloads).toHaveLength(1);
  h.backup.flush(); expect(h.downloads).toHaveLength(1);
  const w2 = structuredClone(w1); editCard(w2, w2.cards[0]!.id, { title: "Two" }); h.backup.note(w2);
  h.backup.flush(); expect(h.downloads).toHaveLength(2); expect(h.backup.dirty).toBe(false);
  h.advance(120_000); expect(h.downloads).toHaveLength(2);
});
