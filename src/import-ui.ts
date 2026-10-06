import { parseTrelloBoard, parseGithubIssues, parseCsvBoard, applyImport, type ImportedProject } from "./import";
import type { PlanningHooks } from "./planning-ui";

// A backup restore already caps at 50 MiB (src/app.ts); an imported Trello/GitHub export or CSV
// is comparatively tiny, so a tighter cap catches an unrelated huge file picked by mistake.
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export function mountImportDialog(root: HTMLElement, hooks: PlanningHooks, onImported: (projectId: string) => void) {
  root.innerHTML = `<p>Each import creates a new project named after the source, entirely in this browser. A file that can't be read is refused and nothing is written.</p>
  <label class="form-field"><span>Trello board (.json)</span><input type="file" id="import-trello" accept="application/json,.json" aria-label="Import Trello board JSON"></label>
  <label class="form-field"><span>GitHub Issues (.json, from "gh issue list --json number,title,body,labels,state,assignees,url")</span><input type="file" id="import-github" accept="application/json,.json" aria-label="Import GitHub Issues JSON"></label>
  <label class="form-field"><span>CSV (title, description, column, labels, priority, due, estimate)</span><input type="file" id="import-csv" accept="text/csv,.csv" aria-label="Import CSV"></label>
  <p class="field-error" id="import-error" role="alert"></p>`;
  const errorEl = root.querySelector<HTMLElement>("#import-error")!;

  async function run(input: HTMLInputElement, parse: (text: string) => ImportedProject) {
    const file = input.files?.[0]; if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error(`That file is larger than the ${MAX_IMPORT_BYTES / (1024 * 1024)} MiB import limit.`);
      const imported = parse(await file.text());
      let projectId: string | undefined;
      if (!hooks.stage(w => { projectId = applyImport(w, imported).id; })) throw new Error("The import could not be saved. Check the storage status and try again.");
      errorEl.textContent = "";
      if (projectId) onImported(projectId);
    } catch (error) {
      errorEl.textContent = error instanceof Error ? error.message : String(error);
    } finally { input.value = ""; }
  }
  root.querySelector<HTMLInputElement>("#import-trello")!.onchange = e => void run(e.target as HTMLInputElement, text => parseTrelloBoard(JSON.parse(text)));
  root.querySelector<HTMLInputElement>("#import-github")!.onchange = e => void run(e.target as HTMLInputElement, text => parseGithubIssues(JSON.parse(text)));
  root.querySelector<HTMLInputElement>("#import-csv")!.onchange = e => void run(e.target as HTMLInputElement, parseCsvBoard);
}
