import type { Workspace } from "./model";

const pad = (n: number) => String(n).padStart(2, "0");
export function backupFileName(d = new Date()): string {
  return `fieldboard-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}
interface Clock { intervalMs?: number; now?: () => number; setTimer?: (fn: () => void, ms: number) => number; clearTimer?: (id: number) => void }

// The no-special-API tier, for browsers whose policy blocks the folder picker and for any browser
// that forgets site data between sessions: saves the acknowledged workspace as an ordinary download,
// throttled to one file per interval, plus right away when the tab is hidden. A browser set to ask
// where to save each download opens its own dialog per file, which nothing here can suppress, so
// the interval errs on the quiet side.
export class AutoBackup {
  enabled = false;
  lastAt: number | null = null;
  onChange: () => void = () => {};
  private pending: Workspace | null = null;
  private lastText: string | null = null;
  private timer: number | null = null;
  private readonly intervalMs: number; private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => number; private readonly clearTimer: (id: number) => void;
  constructor(private download: (name: string, text: string) => void, clock: Clock = {}) {
    this.intervalMs = clock.intervalMs ?? 15 * 60_000; this.now = clock.now ?? Date.now;
    this.setTimer = clock.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number); this.clearTimer = clock.clearTimer ?? (id => clearTimeout(id));
  }
  get dirty(): boolean { return this.pending !== null; }
  note(workspace: Workspace) {
    if (!this.enabled) return;
    const text = JSON.stringify({ ...workspace, revision: 0 });
    if (text === this.lastText) { this.pending = null; this.onChange(); return; }
    this.pending = workspace;
    const due = this.lastAt === null ? 0 : this.lastAt + this.intervalMs - this.now();
    if (due <= 0) this.flush();
    else if (this.timer === null) this.timer = this.setTimer(() => { this.timer = null; this.flush(); }, due);
    this.onChange();
  }
  flush() {
    if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; }
    const target = this.pending; if (!target) return;
    this.pending = null; this.lastText = JSON.stringify({ ...target, revision: 0 }); this.lastAt = this.now();
    this.download(backupFileName(new Date(this.lastAt)), JSON.stringify(target, null, 2));
    this.onChange();
  }
}
