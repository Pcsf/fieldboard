import { priorities, type Card, type Label, type Member, type Swimlane } from "./model";

export interface Lane { id: string; label: string }
const NONE: Lane = { id: "none", label: "None" };

// A card without the lane's attribute lands in the None lane; a card with several assignees or labels
// appears once per matching lane, so dragging it out of one lane never touches its other memberships.
export function cardLaneIds(card: Card, swimlane: Swimlane): string[] {
  switch (swimlane) {
    case "none": return [];
    case "priority": return [card.priority];
    case "assignee": return card.assignees.length ? card.assignees : ["none"];
    case "label": return card.labels.length ? card.labels : ["none"];
    case "epic": return [card.parentId ?? "none"];
  }
}
export function lanesFor(swimlane: Swimlane, cards: Card[], ctx: { members: Member[]; labels: Label[] }): Lane[] {
  switch (swimlane) {
    case "none": return [];
    case "priority": return priorities.map(p => ({ id: p, label: p === "none" ? "No priority" : p[0]!.toUpperCase() + p.slice(1) }));
    case "assignee": return [...ctx.members.map(m => ({ id: m.id, label: m.name })), NONE];
    case "label": return [...ctx.labels.map(l => ({ id: l.id, label: l.name })), NONE];
    case "epic": {
      const parentIds = new Set(cards.map(c => c.parentId).filter((x): x is string => !!x));
      return [...cards.filter(c => parentIds.has(c.id)).map(c => ({ id: c.id, label: c.title })), NONE];
    }
  }
}
export function laneCards(cards: Card[], columnId: string, laneId: string, swimlane: Swimlane): Card[] {
  return cards.filter(c => c.columnId === columnId && cardLaneIds(c, swimlane).includes(laneId)).sort((a, b) => a.position - b.position);
}
