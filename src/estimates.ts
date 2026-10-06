import type { Card } from "./model";

export const estimateUnits = ["points", "hours"] as const;
export type EstimateUnit = typeof estimateUnits[number];

export function unitLabel(unit: EstimateUnit): string { return unit === "hours" ? "h" : "pts"; }
export function unitName(unit: EstimateUnit): string { return unit === "hours" ? "hours" : "points"; }

// Trims a fixed-2 string down to the shortest form that round-trips (13 not 13.00, 7.5 not 7.50).
function formatAmount(n: number): string {
  const trimmed = n.toFixed(2).replace(/\.?0+$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}

// Non-archived, non-null estimates only; returns null rather than 0 so a caller can distinguish
// "nothing here carries an estimate" from "the cards here estimate to zero".
export function sumEstimates(cards: Pick<Card, "estimate" | "archived">[]): number | null {
  const values = cards.filter(c => !c.archived && c.estimate !== null).map(c => c.estimate as number);
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0);
}

export function formatEstimateSum(sum: number, unit: EstimateUnit): string {
  return `Σ ${formatAmount(sum)} ${unitLabel(unit)}`;
}
