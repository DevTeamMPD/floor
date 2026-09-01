export type CsatDecision = {
  action: "pass" | "follow_up" | "open_case";
  priority: "urgent" | "high" | null;
  dueHours: number | null;
};

export function evaluateCsat(score: number | null): CsatDecision {
  if (score === 1) return { action: "open_case", priority: "urgent", dueHours: 4 };
  if (score === 2) return { action: "open_case", priority: "high", dueHours: 24 };
  if (score === 3) return { action: "follow_up", priority: null, dueHours: null };
  return { action: "pass", priority: null, dueHours: null };
}
