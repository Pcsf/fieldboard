import { editCard, type Workspace, type Card } from "./model";
import { programs, maturities, defaultEffort, defaultPlanning, estimateModule, estimateProject, sprintLoads, projectCards, recordCalibration, validateEffort, validatePlanning, effectiveCatalog, catalogEffort, addCategory, editCategory, deleteCategory, addSubcategory, editSubcategory, deleteSubcategory, labAccess, type Effort, type Planning, type Range, type Category } from "./planning";
import { escapeHTML as esc } from "./markdown";

export interface PlanningHooks {
  state(): Workspace;
  stage(fn: (w: Workspace) => unknown): boolean;
  retain(key: string, value: string): boolean;
  draft(key: string): string | undefined;
  clear(key: string, value: string): Promise<void>;
  error(key: string, message: string): void;
}
const formatNumber = (n: number) => new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(Number(n.toPrecision(12)));
export const formatRange = (r: Range) => r[0] === r[1] ? formatNumber(r[0]) : `${formatNumber(r[0])}–${formatNumber(r[1])}`;
const select = (path: string, label: string, value: string, values: { id: string; name: string }[], disabled = false) => `<label class="form-field"><span>${esc(label)}</span><select data-field="${path}" aria-label="${esc(label)}" ${disabled ? "disabled" : ""}>${values.map(v => `<option value="${esc(v.id)}" ${v.id === value ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label>`;
const numeric = (path: string, label: string, value: number | null, min = 0, max = 1e6, optional = false) => `<label class="form-field"><span>${esc(label)}</span><input data-field="${path}" aria-label="${esc(label)}" type="number" min="${min}" max="${max}" step="any" ${optional ? "" : "required"} value="${value ?? ""}"></label>`;
const text = (path: string, label: string, value: string) => `<label class="form-field"><span>${esc(label)}</span><textarea data-field="${path}" aria-label="${esc(label)}">${esc(value)}</textarea></label>`;
const rangeFields = (path: string, label: string, r: Range) => `<div class="planning-grid">${numeric(`${path}.0`, `${label} minimum IED`, r[0])}${numeric(`${path}.1`, `${label} maximum IED`, r[1])}</div>`;
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
function setPath(object: object, path: string, value: unknown) {
  const keys = path.split("."); let target = object as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[keys.at(-1)!] = value;
}
function bindForm<T extends object>(root: HTMLElement, initial: T, prefix: string, hooks: PlanningHooks, validate: (data: T) => void, commit: (w: Workspace, data: T) => void, update: () => void, transform?: (data: T, path: string) => void) {
  const fields = [...root.querySelectorAll<Field>("[data-field]")];
  const showError = (message: string) => { root.querySelector<HTMLElement>(".planning-error")!.textContent = message; hooks.error(prefix, message); };
  const collect = () => {
    const data = structuredClone(initial);
    for (const field of fields) {
      const number = field instanceof HTMLInputElement && field.type === "number";
      if (number && !field.checkValidity()) throw new Error(`Check ${field.getAttribute("aria-label")}: a finite value within the displayed limits is required.`);
      setPath(data, field.dataset.field!, number ? field.value === "" ? null : Number(field.value) : field.value);
    }
    return data;
  };
  for (const field of fields) {
    const key = `${prefix}:${field.dataset.field}`; const draft = hooks.draft(key);
    if (draft !== undefined) field.value = draft;
    field.addEventListener("input", () => { if (!hooks.retain(key, field.value)) showError("Draft storage failed. Keep this tab open and copy or download drafts."); });
    const event = field instanceof HTMLTextAreaElement ? "input" : "change";
    field.addEventListener(event, () => {
      if (!hooks.retain(key, field.value)) return;
      try {
        const data = collect(); transform?.(data, field.dataset.field!); validate(data);
        if (!hooks.stage(w => commit(w, data))) { showError("Planning edit was not accepted. See the storage error and retain your drafts."); return; }
        showError("");
        for (const f of fields) void hooks.clear(`${prefix}:${f.dataset.field}`, f.value);
        update();
      } catch (error) { showError(error instanceof Error ? error.message : String(error)); }
    });
  }
  try { validate(collect()); } catch (error) { showError(String(error)); }
}

export function effortBadge(c: Card): string {
  if (!c.effort) return "";
  const result = estimateModule(c.effort);
  const label = result.architectureGap ? "Architecture gap" : result.ied[1] === 0 ? "IED not sized" : `${formatRange(result.ied)} IED`;
  return `<span class="ied-badge${result.architectureGap ? " planning-warning" : ""}" aria-hidden="true">${label}${c.effort.sprint ? ` · Sprint ${c.effort.sprint}` : ""}</span>`;
}
export function mountEffort(root: HTMLElement, cardId: string, hooks: PlanningHooks) {
  const card = hooks.state().cards.find(c => c.id === cardId)!;
  if (!card.effort) {
    root.innerHTML = '<h3>Effort estimation</h3><p>Estimate work in Ideal Engineering Days (IED), separate from the legacy unitless estimate. 1 IED = 6–7 uninterrupted engineering hours.</p><button type="button">Start IED estimate</button>';
    root.querySelector("button")!.onclick = () => { if (hooks.stage(w => editCard(w, cardId, { effort: defaultEffort() }))) mountEffort(root, cardId, hooks); };
    return;
  }
  const e = card.effort;
  const catalog = effectiveCatalog(hooks.state());
  const categoryId = e.category && e.category !== "custom" ? e.category : "custom";
  const selectedCategory = catalog.find(c => c.id === categoryId);
  const categoryOptions = [{ id: "custom", name: "Custom task" }, ...catalog.map(c => ({ id: c.id, name: `${c.name} (${c.kind})` }))];
  const subcategoryOptions = selectedCategory ? selectedCategory.subcategories.map(s => ({ id: s.id, name: s.name })) : [{ id: "custom", name: "—" }];
  const subcategoryId = selectedCategory ? (e.subcategory && selectedCategory.subcategories.some(s => s.id === e.subcategory) ? e.subcategory : selectedCategory.subcategories[0]!.id) : "custom";
  root.innerHTML = `<h3>Effort estimation · IED</h3><p>1 IED = 6–7 uninterrupted engineering hours. Choose a category and subcategory to fill the IED fields below, or choose Custom task to enter them directly. All fields stay editable after filling.</p>
  <div id="effort-form">${select("category", "Category", categoryId, categoryOptions)}
  ${select("subcategory", "Subcategory", subcategoryId, subcategoryOptions, !selectedCategory)}
  ${text("scope", "Requested scope", e.scope)}
  ${rangeFields("rtl", "RTL", e.rtl)}${rangeFields("verification", "Verification", e.verification)}${rangeFields("other", "Unsplit work", e.other)}<p class="muted">Unsplit work is for lab, debug and custom tasks with no RTL/verification split. Editing any of these fields switches the category to Custom task.</p>
  <div class="planning-grid">${numeric("factors.spec", "Spec factor", e.factors.spec, .01, 10)}${numeric("factors.clock", "Clock / CDC factor", e.factors.clock, .01, 10)}${numeric("factors.utilization", "Timing / utilization factor", e.factors.utilization, .01, 10)}${numeric("factors.reuse", "Reuse factor", e.factors.reuse, .01, 10)}${numeric("factors.verification", "Verification factor", e.factors.verification, .01, 10)}${numeric("factors.lab", "Lab access factor", e.factors.lab ?? 1, .01, 10)}${numeric("sprint", "Sprint number", e.sprint, 1, 10000, true)}</div>
  <details><summary>Factor guidance</summary><ul><li>Spec: frozen 1; minor gaps 1.25; concept 1.6–2.</li><li>Clocks: single 1; 2–3 related 1.15; ≥3 asynchronous 1.35–1.6.</li><li>Timing: nominal 1; tight / 65–80% utilization 1.25; high-frequency / &gt;80% 1.6–2.2.</li><li>Reuse: clean sheet 1; verified in-house IP 0.3–0.5; untrusted legacy 1.3–1.5.</li><li>Verification only: sanity 0.8; full directed 1; constrained-random + coverage 1.5–1.8.</li><li>Lab access: ${labAccess.map(l => `${l.name.toLowerCase()} ${l.factor}`).join("; ")}.</li></ul><p>Factors above the guidance need justification. Effective combined multiplier above 4 blocks a calendar quote; resolve the architecture first.</p></details>
  ${text("assumptions", "Estimate assumptions", e.assumptions)}<p class="planning-error" role="alert"></p></div>
  <div id="effort-result" aria-live="polite"></div>
  <h3>Calibration log</h3><p>Log completed work in IED, not elapsed days. Each observation freezes the current scope, category, subcategory and factors. Repeated observations are revisions, not additive time entries. Review your tables after about 10 completed tasks.</p>
  <form id="calibration-form"><div class="planning-grid">${numeric("actual", "Actual IED", null)}${text("learning", "Missed factor / learning", "")}</div><button type="submit">Log calibration</button><p class="planning-error" role="alert"></p></form><div id="calibration-history"></div>`;
  const form = root.querySelector<HTMLElement>("#effort-form")!;
  const subcategoryField = () => form.querySelector<HTMLSelectElement>('[data-field="subcategory"]')!;
  const fillRanges = (data: Effort) => { for (const key of ["rtl", "verification", "other"] as const) for (const index of [0, 1]) form.querySelector<HTMLInputElement>(`[data-field="${key}.${index}"]`)!.value = String(data[key][index]); };
  const clearCategory = (data: Effort) => {
    data.baseline = "custom"; data.category = undefined; data.subcategory = undefined; data.subcategoryFactor = undefined;
    form.querySelector<HTMLSelectElement>('[data-field="category"]')!.value = "custom";
    subcategoryField().innerHTML = '<option value="custom">—</option>'; subcategoryField().disabled = true; subcategoryField().value = "custom";
  };
  const update = () => {
    const current = hooks.state().cards.find(c => c.id === cardId)!; const r = estimateModule(current.effort!);
    root.querySelector("#effort-result")!.innerHTML = r.architectureGap ? `<p class="planning-warning">Architecture gap: effective multiplier ${r.multiplier.toFixed(2)} exceeds 4. Do not quote hours or dates.</p>` : `<p><strong>${formatRange(r.ied)} IED</strong> · effective multiplier ${r.multiplier.toFixed(2)}${r.ied[1] === 0 ? " · Not sized yet" : ""}</p><small>(RTL + verification × verification factor + unsplit work) × spec × clock × utilization × reuse × lab access</small>`;
    root.querySelector("#calibration-history")!.innerHTML = (current.calibrations ?? []).map(c => `<p>${esc(c.timestamp.slice(0, 10))}: estimated ${formatRange(c.estimate.ied)} IED; actual ${c.actualIED.toFixed(2)} IED. ${esc(c.missedFactor)}</p>`).join("") || '<p class="muted">No observations yet.</p>';
  };
  bindForm(form, e, `effort:${cardId}`, hooks, validateEffort, (w, data) => editCard(w, cardId, { effort: data }), update, (data, path) => {
    const current = effectiveCatalog(hooks.state());
    if (path === "category") {
      if (data.category === "custom") clearCategory(data);
      else {
        const cat = current.find(c => c.id === data.category);
        if (!cat) { clearCategory(data); return; }
        subcategoryField().disabled = false;
        subcategoryField().innerHTML = cat.subcategories.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
        const sub = cat.subcategories[0]!; subcategoryField().value = sub.id;
        Object.assign(data, catalogEffort(current, cat.id, sub.id)); fillRanges(data);
      }
    } else if (path === "subcategory") {
      const cat = current.find(c => c.id === data.category);
      if (cat) { Object.assign(data, catalogEffort(current, cat.id, data.subcategory as string)); fillRanges(data); }
    } else if (/^(rtl|verification|other)\./.test(path)) {
      clearCategory(data);
    }
  });
  const calibration = root.querySelector<HTMLFormElement>("#calibration-form")!;
  const actual = calibration.querySelector<HTMLInputElement>('[data-field="actual"]')!;
  const learning = calibration.querySelector<HTMLTextAreaElement>('[data-field="learning"]')!;
  for (const [field, name] of [[actual, "actual"], [learning, "learning"]] as const) {
    const key = `calibration:${cardId}:${name}`; field.value = hooks.draft(key) ?? "";
    field.oninput = () => { hooks.retain(key, field.value); };
  }
  calibration.onsubmit = async event => {
    event.preventDefault();
    const a = actual.value, l = learning.value;
    if (form.querySelector(".planning-error")!.textContent) return;
    if (!a || !actual.checkValidity() || !hooks.retain(`calibration:${cardId}:actual`, a) || !hooks.retain(`calibration:${cardId}:learning`, l)) return;
    if (hooks.stage(w => recordCalibration(w, cardId, Number(a), l))) {
      await hooks.clear(`calibration:${cardId}:actual`, a); await hooks.clear(`calibration:${cardId}:learning`, l);
      if (actual.value === a) actual.value = ""; if (learning.value === l) learning.value = ""; calibration.querySelector(".planning-error")!.textContent = ""; update();
    } else calibration.querySelector(".planning-error")!.textContent = "Calibration was not recorded. Size the work, resolve any architecture gap, and check storage errors.";
  };
  update();
}

function mountCatalog(root: HTMLElement, hooks: PlanningHooks, refresh: () => void) {
  const catalog = effectiveCatalog(hooks.state());
  root.innerHTML = `<h3>IED catalog</h3><p>A category sets the base RTL/verification IED, or an unsplit range for lab and debug work; a subcategory's factor scales that base for the specific case. Edits apply to this workspace only; the built-in defaults are never changed in place.</p>
  <div class="catalog-list">${catalog.map(c => `<section class="catalog-category" data-category="${esc(c.id)}">
    <div class="catalog-head">
      <input class="cat-name" aria-label="Category name: ${esc(c.name)}" value="${esc(c.name)}">
      <span class="catalog-kind">${c.kind === "lab" ? "Lab" : "Design"}</span>
      <span class="catalog-base">${c.other
        ? `<label>Min <input class="cat-other-0" type="number" min="0" step="any" aria-label="${esc(c.name)} minimum IED" value="${c.other[0]}"></label><label>Max <input class="cat-other-1" type="number" min="0" step="any" aria-label="${esc(c.name)} maximum IED" value="${c.other[1]}"></label> IED`
        : `<label>RTL <input class="cat-rtl" type="number" min="0" step="any" aria-label="${esc(c.name)} RTL IED" value="${c.rtl}"></label><label>Verif <input class="cat-verification" type="number" min="0" step="any" aria-label="${esc(c.name)} verification IED" value="${c.verification}"></label> IED`}</span>
      <button type="button" class="danger cat-delete" aria-label="Delete category ${esc(c.name)}">Delete</button>
    </div>
    <div class="catalog-subs">${c.subcategories.map(s => `<div data-subcategory="${esc(s.id)}" class="catalog-sub">
      <input class="sub-name" title="${esc(s.name)}" aria-label="Subcategory name: ${esc(s.name)}" value="${esc(s.name)}">
      <label class="catalog-factor">× <input class="sub-factor" type="number" min="0.01" max="10" step="any" aria-label="Subcategory factor: ${esc(s.name)}" value="${s.factor}"></label>
      <button type="button" class="danger sub-delete" aria-label="Delete subcategory ${esc(s.name)}">×</button></div>`).join("")}
      <form class="sub-add catalog-sub"><input class="new-sub-name" placeholder="New subcategory" aria-label="New subcategory name for ${esc(c.name)}" required><label class="catalog-factor">× <input class="new-sub-factor" type="number" min="0.01" max="10" step="any" value="1" aria-label="New subcategory factor for ${esc(c.name)}"></label><button type="submit">Add</button></form>
    </div>
  </section>`).join("")}</div>
  <form id="category-add-form" class="catalog-add">
    <input id="cat-add-name" placeholder="New category name" aria-label="New category name" required>
    <select id="cat-add-kind" aria-label="New category kind"><option value="design">Design</option><option value="lab">Lab</option></select>
    <select id="cat-add-shape" aria-label="New category shape"><option value="split">Split RTL / verification</option><option value="unsplit">Unsplit range</option></select>
    <span class="catalog-base" data-shape="split"><label>RTL <input id="cat-add-rtl" type="number" min="0" step="any" value="0" aria-label="New category RTL IED (split shape)"></label><label>Verif <input id="cat-add-verification" type="number" min="0" step="any" value="0" aria-label="New category verification IED (split shape)"></label></span>
    <span class="catalog-base" data-shape="unsplit" hidden><label>Min <input id="cat-add-min" type="number" min="0" step="any" value="0" aria-label="New category minimum IED (unsplit shape)"></label><label>Max <input id="cat-add-max" type="number" min="0" step="any" value="0" aria-label="New category maximum IED (unsplit shape)"></label></span>
    <button type="submit">Add category</button>
  </form><p class="muted">A new category starts with one "Default" subcategory at factor 1.</p>`;
  const shape = root.querySelector<HTMLSelectElement>("#cat-add-shape")!;
  shape.onchange = () => root.querySelectorAll<HTMLElement>("#category-add-form [data-shape]").forEach(el => el.hidden = el.dataset.shape !== shape.value);
  for (const row of root.querySelectorAll<HTMLElement>("[data-category]")) {
    const categoryId = row.dataset.category!;
    row.querySelector<HTMLInputElement>(".cat-name")!.onchange = e => { if (hooks.stage(w => editCategory(w, categoryId, { name: (e.target as HTMLInputElement).value }))) refresh(); };
    const other0 = row.querySelector<HTMLInputElement>(".cat-other-0"), other1 = row.querySelector<HTMLInputElement>(".cat-other-1");
    if (other0 && other1) { const commit = () => { if (hooks.stage(w => editCategory(w, categoryId, { other: [Number(other0.value), Number(other1.value)] }))) refresh(); }; other0.onchange = commit; other1.onchange = commit; }
    const rtl = row.querySelector<HTMLInputElement>(".cat-rtl"), verification = row.querySelector<HTMLInputElement>(".cat-verification");
    if (rtl && verification) { const commit = () => { if (hooks.stage(w => editCategory(w, categoryId, { rtl: Number(rtl.value), verification: Number(verification.value) }))) refresh(); }; rtl.onchange = commit; verification.onchange = commit; }
    row.querySelector<HTMLButtonElement>(".cat-delete")!.onclick = () => {
      const name = row.querySelector<HTMLInputElement>(".cat-name")!.value;
      if (confirm(`Delete category "${name}"? Cards using it must be reassigned first.`) && hooks.stage(w => deleteCategory(w, categoryId))) refresh();
    };
    for (const subRow of row.querySelectorAll<HTMLElement>("[data-subcategory]")) {
      const subcategoryId = subRow.dataset.subcategory!;
      subRow.querySelector<HTMLInputElement>(".sub-name")!.onchange = e => { if (hooks.stage(w => editSubcategory(w, categoryId, subcategoryId, { name: (e.target as HTMLInputElement).value }))) refresh(); };
      subRow.querySelector<HTMLInputElement>(".sub-factor")!.onchange = e => { if (hooks.stage(w => editSubcategory(w, categoryId, subcategoryId, { factor: Number((e.target as HTMLInputElement).value) }))) refresh(); };
      subRow.querySelector<HTMLButtonElement>(".sub-delete")!.onclick = () => { if (hooks.stage(w => deleteSubcategory(w, categoryId, subcategoryId))) refresh(); };
    }
    row.querySelector<HTMLFormElement>(".sub-add")!.onsubmit = e => {
      e.preventDefault(); const form = e.target as HTMLFormElement;
      const name = form.querySelector<HTMLInputElement>(".new-sub-name")!.value;
      const factor = Number(form.querySelector<HTMLInputElement>(".new-sub-factor")!.value);
      if (hooks.stage(w => addSubcategory(w, categoryId, name, factor))) refresh();
    };
  }
  root.querySelector<HTMLFormElement>("#category-add-form")!.onsubmit = e => {
    e.preventDefault();
    const name = root.querySelector<HTMLInputElement>("#cat-add-name")!.value;
    const kind = root.querySelector<HTMLSelectElement>("#cat-add-kind")!.value as "design" | "lab";
    const shape = root.querySelector<HTMLSelectElement>("#cat-add-shape")!.value;
    const base = shape === "unsplit"
      ? { other: [Number(root.querySelector<HTMLInputElement>("#cat-add-min")!.value), Number(root.querySelector<HTMLInputElement>("#cat-add-max")!.value)] as Range }
      : { rtl: Number(root.querySelector<HTMLInputElement>("#cat-add-rtl")!.value), verification: Number(root.querySelector<HTMLInputElement>("#cat-add-verification")!.value) };
    if (hooks.stage(w => { const cat = addCategory(w, name, kind, base); addSubcategory(w, cat.id, "Default", 1); })) refresh();
  };
}

export function mountPlanning(root: HTMLElement, projectId: string, hooks: PlanningHooks) {
  const project = hooks.state().projects.find(p => p.id === projectId)!;
  if (!project.planning) {
    root.innerHTML = '<p>Size the whole program first, then estimate each card as one module or work package. Existing unitless estimates are not converted.</p><p>Defaults: 25% contingency, build 2–4 IED, initial timing 3–8 IED, bring-up 4–10 IED, documentation 10% of adjusted RTL; 0.65 focus, 0.85 availability, 1 FTE, team efficiency 1, two-week sprints. Review these assumptions before quoting.</p><button type="button">Enable project planning</button>';
    root.querySelector("button")!.onclick = () => { if (hooks.stage(w => { w.projects.find(p => p.id === projectId)!.planning = defaultPlanning(); })) mountPlanning(root, projectId, hooks); };
    return;
  }
  const p = project.planning;
  root.innerHTML = `<p>All project cards count, including archived and completed cards, regardless of filters. Each card is one work package; subtasks are not added again. Calendar output is a capacity scenario, not a dependency-aware delivery commitment.</p>
  <div id="project-planning-form"><div class="planning-grid">${select("program", "Program type", p.program, programs)}${select("maturity", "Top-level spec maturity", p.maturity, maturities)}</div>
  <details><summary>Scoping questions before quoting</summary><ol><li>How many clock domains; which are asynchronous?</li><li>Is a bit-accurate reference available or separately budgeted?</li><li>What is the verification bar?</li><li>Is the device familiar, new, or EOL-migrating?</li><li>Who owns the spec and is it frozen?</li><li>Is hardware available and is the lab shared?</li></ol><p>Whole-program bands include 25% contingency. Formal verification, compliance and multi-site deployment need separate programs. Integration is additive to element work, not a whole-program band.</p></details>
  <div class="planning-grid">${numeric("contingency", "Contingency fraction", p.contingency, 0, 1)}${numeric("documentation", "Documentation (register manual, block diagrams) · fraction of RTL", p.documentation, 0, 1)}</div>
  <small>Defined scope: 0.20–0.30 contingency. Concept stage: 0.30–0.50. Documentation nominal: 0.10 of adjusted RTL.</small>
  <details><summary>Platform overhead ranges</summary>${rangeFields("build", "Build system / CI automation", p.build)}${rangeFields("timing", "Initial timing closure pass", p.timing)}${rangeFields("bringup", "Hardware bring-up spike (ILA/SignalTap, probing, lab)", p.bringup)}<p>Bring-up nominal is the full 4–10 IED range. Zero an overhead only when explicitly out of scope or already estimated on a card, and explain why below; zero it when bring-up itself is estimated as lab-category cards instead, to avoid paying for it twice.</p></details>
  <h3>Staffing & capacity</h3><div class="planning-grid">${numeric("focus", "Focus efficiency", p.focus, .01, 1)}${numeric("availability", "Availability", p.availability, .01, 1)}${numeric("fte", "Allocated FTE", p.fte, .01, 1000)}${numeric("team", "Team efficiency", p.team, .01, 1)}${numeric("sprintWeeks", "Sprint length (weeks)", p.sprintWeeks, .1, 52)}</div>
  <p class="muted">Nominal focus 0.60–0.70; availability 0.85 (0.75 in Q3/Q4). Team efficiency: dedicated senior 1; 0.5 FTE split 0.8; two × 0.5 FTE 0.75; two × 1 FTE 0.85–0.90. FTE and team efficiency are separate inputs.</p>
  <h3>Sprint capacity mode</h3><div class="planning-grid">${select("capacityMode", "Capacity mode", p.capacityMode ?? "derived", [{ id: "derived", name: "Derived from staffing" }, { id: "direct", name: "Direct" }])}${numeric("directCapacity", "Direct capacity (IED per sprint)", p.directCapacity ?? null, 0, 1e6, true)}</div>
  <p class="muted">Direct mode replaces the staffing formula with the IED per sprint typed here; it also sets the milestone overview's daily capacity. Per-sprint overrides for holidays or lab weeks are set from the Sprints view, because sprints carry no dates here.</p>
  ${text("assumptions", "Project planning assumptions", p.assumptions)}<p class="planning-error" role="alert"></p></div>
  <div id="planning-results" aria-live="polite"></div>
  <div id="catalog-editor"></div>`;
  mountCatalog(root.querySelector<HTMLElement>("#catalog-editor")!, hooks, () => mountPlanning(root, projectId, hooks));
  const update = () => {
    const w = hooks.state(), current = w.projects.find(p => p.id === projectId)!.planning!;
    const r = estimateProject(w, projectId), loads = sprintLoads(w, projectId), cards = projectCards(w, projectId);
    const warning: string[] = [];
    if (r.unestimated) warning.push(`${r.unestimated} card(s) not sized. Legacy estimates have no IED meaning.`);
    if (!r.cardCount) warning.push("No work packages yet.");
    if (r.architectureGaps) warning.push(`${r.architectureGaps} architecture gap(s): combined multiplier above 4.`);
    if (!r.band) warning.push("Spec undefined: run the architecture first.");
    if (r.bandMismatch) warning.push("Detailed estimate lies outside the factor-of-two sanity envelope. Reconcile scope and assumptions.");
    if (current.maturity === "concept" && current.contingency < .3) warning.push("Concept scope normally needs 30–50% contingency.");
    if (current.bringup[0] > 4 || current.bringup[1] < 10) warning.push("Bring-up does not include the full 4–10 IED range. Document the exclusion or separate card budget.");
    if (!current.assumptions.trim()) warning.push("Record scope assumptions before sharing a quote.");
    const rows = [["Module effort", r.modules], ["Contingency (modules only)", r.contingency], ["Documentation (adjusted RTL)", r.documentation], ["All platform overheads (includes documentation)", r.overheads], [r.weeks ? "Total program effort" : "Known-scope subtotal (not a quote)", r.total], ["Unfinished modules (full estimate, not effort-to-complete)", r.remaining]] as const;
    const calibrated = cards.filter(c => c.calibrations?.length);
    root.querySelector("#planning-results")!.innerHTML = `<h3>Planning summary</h3>${warning.map(s => `<p class="planning-warning">${esc(s)}</p>`).join("")}
    <p>Top-level ${current.program === "integration" ? "additional integration" : "program"} band: <strong>${r.band ? `${formatRange(r.band)} IED` : "Do not quote"}</strong>. Maturity applies here only; detailed estimates use each card’s own factors.</p>
    ${r.bandWeeks ? `<p>Coarse scoping only: ${formatRange(r.bandWeeks)} ${current.program === "integration" ? "additional " : ""}calendar weeks at current capacity. This band does not establish detailed scope completeness.</p>` : ""}
    <table class="planning-table"><thead><tr><th>Component</th><th>IED</th></tr></thead><tbody>${rows.map(([label, value]) => `<tr><td>${label}</td><td>${formatRange(value)}</td></tr>`).join("")}</tbody></table>
    <p>${r.weeks ? `<strong>${formatRange(r.weeks)} calendar weeks</strong>${r.workingDays ? ` · ${formatRange(r.workingDays)} effort-equivalent working days` : ""} · ${formatRange(r.sprints!)} sprints (rounded up)` : '<strong>Calendar quote withheld</strong>: resolve missing estimates or architecture first.'}</p>
    <p><strong>${formatNumber(r.capacity)} IED / sprint</strong> ${current.capacityMode === "direct" ? "entered directly; calendar weeks = IED / (IED per sprint) × sprint weeks. Focus, availability, FTE and team efficiency are not used." : "= 5 × sprint weeks × focus × availability × FTE × team efficiency."}</p>
    <small>Total = modules × (1 + contingency) + overheads. Weeks = IED / weekly capacity (5 × focus × availability × FTE × team when derived from staffing). Ranges are planning bounds, not statistical confidence intervals.</small>
    <h3>Sprint allocation</h3><p>Loads include module contingency. ${formatRange(r.unallocated)} IED remains unallocated, including all platform overheads. Reserve explicit time for bring-up; do not hide it in the last sprint. Split oversized work into cards with independent estimates.</p>
    <table class="planning-table"><thead><tr><th>Sprint</th><th>Cards</th><th>Load IED</th><th>Capacity check</th></tr></thead><tbody>${loads.map(s => `<tr><td>${s.sprint}</td><td>${s.cards}</td><td>${s.architectureGap || s.unestimated ? "Not quotable" : formatRange(s.ied)}</td><td>${s.architectureGap ? "Architecture gap" : s.unestimated ? "Not sized" : s.overloaded ? "Over capacity" : "Within capacity"}</td></tr>`).join("") || '<tr><td colspan="4">Assign sprint numbers in card estimates.</td></tr>'}</tbody></table>
    <h3>Calibration · ${calibrated.length} task(s)</h3><p>Review baseline tables after about 10 tasks. Latest observation per task is shown; card history retains earlier observations. These measurements do not automatically change factors.</p>
    <table class="planning-table"><thead><tr><th>Task</th><th>Estimated IED</th><th>Actual IED</th><th>Learning</th></tr></thead><tbody>${calibrated.map(c => { const log = c.calibrations!.at(-1)!; return `<tr><td>${esc(c.title)}</td><td>${formatRange(log.estimate.ied)}</td><td>${log.actualIED.toFixed(2)}</td><td>${esc(log.missedFactor)}</td></tr>`; }).join("") || '<tr><td colspan="4">No calibration observations yet.</td></tr>'}</tbody></table>`;
  };
  bindForm<Planning>(root.querySelector<HTMLElement>("#project-planning-form")!, p, `planning:${projectId}`, hooks, validatePlanning, (w, data) => { w.projects.find(p => p.id === projectId)!.planning = data; }, update);
  update();
}
