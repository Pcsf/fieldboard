// Shared fixture for the accessibility browser tests (tests/a11y-axe.test.ts, tests/a11y-keyboard.test.ts).
// Not a test file itself -- bun test only picks up *.test.ts, so this plain module is never run on its own.
//
// Builds one realistic workspace: cards carrying labels, assignees, attachments, links, time entries
// and an @mention; a board automation rule; a sprint; and an unread notification -- so axe and the
// keyboard walk exercise real content in every dialog, not an empty-state stand-in.
import { createWorkspace, createProject, createCard, editCard, resolveLabels, addMilestone, id as newId, validateWorkspace, type Workspace } from "../src/model";
import { addRule } from "../src/automation";
import { setCardSprint } from "../src/planning";

const isoDate = (now: Date, offsetDays: number) => { const d = new Date(now); d.setDate(d.getDate() + offsetDays); return d.toISOString().slice(0, 10); };

export function buildA11yFixture(now: Date = new Date()): Workspace {
  const w = createWorkspace();
  const me = w.settings.actorId;
  const ada = { id: newId(), name: "Ada Lovelace", color: "#8a5fd1" };
  w.members.push(ada);

  const project = createProject(w, "Launch readiness");
  const board = w.boards.find(b => b.projectId === project.id)!;
  const columns = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  const [backlog, todo, inProgress, , done] = columns;

  addMilestone(w, project.id, "Beta launch", isoDate(now, 20));
  const [designLabel, urgentLabel] = resolveLabels(project, ["Design", "Urgent fix"]);

  const designCard = createCard(w, backlog!.id, "Design the onboarding flow", "bottom", {
    priority: "high", assignees: [me, ada.id], labels: [designLabel!], dueDate: isoDate(now, 5),
  });
  editCard(w, designCard.id, {
    description: "Needs a second pair of eyes before it ships.",
    comments: [{ id: newId(), author: me, body: "Pinging @Ada Lovelace for a look.", timestamp: now.toISOString() }],
    links: [{ id: newId(), title: "Design doc", url: "https://example.com/design", kind: "url" }],
    attachments: [{ id: newId(), name: "notes.txt", type: "text/plain", data: "data:text/plain,Mockup%20notes" }],
    timeEntries: [{ id: newId(), start: new Date(now.getTime() - 3 * 3_600_000).toISOString(), end: new Date(now.getTime() - 1 * 3_600_000).toISOString(), note: "Wireframing" }],
  });

  const urgentCard = createCard(w, todo!.id, "Fix the checkout crash", "bottom", {
    priority: "urgent", assignees: [ada.id], labels: [urgentLabel!], dueDate: isoDate(now, -1),
  });
  editCard(w, urgentCard.id, { blocked: { reason: "Waiting on a vendor patch", since: now.toISOString() } });

  const inProgressCard = createCard(w, inProgress!.id, "Write the release notes", "bottom", { assignees: [me] });
  setCardSprint(w, inProgressCard.id, 1);

  createCard(w, done!.id, "Ship the landing page", "bottom", {});

  project.sprints = [{ number: 1, name: "Sprint 1", startDate: isoDate(now, -7), endDate: isoDate(now, 7) }];

  addRule(w, board.id, { kind: "enter-assign-member", enabled: true, columnId: inProgress!.id, memberId: ada.id });

  w.notifications = [{ id: newId(), memberId: me, kind: "mention", cardId: designCard.id, read: false, createdAt: now.toISOString() }];

  validateWorkspace(w); // fail fast here, not as a mysterious browser-side rejection
  return w;
}
