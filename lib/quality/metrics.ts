export type QualityNcr = {
  id: string; job_no: string | null; title: string; type: string; status: string; severity: string;
  due_at: string | null; product_sku: string | null; created_at: string; updated_at: string; closed_at: string | null;
};

export type QualityCase = {
  id: string; case_no: string; job_no: string; source: string; category: string; priority: string; status: string;
  summary: string; assigned_team: string | null; due_at: string; opened_at: string; resolved_at: string | null;
  closed_at: string | null; linked_ncr_id: string | null;
};

export type QualityAction = {
  id: string; case_id: string; title: string; status: string; due_at: string | null; completed_at: string | null;
  acceptance_criteria: string | null; outcome: string | null;
};

export type QualityEvaluation = {
  id: string; job_no: string; satisfaction_score: number | null; call_date: string | null; created_at: string; updated_at: string;
};

export type QualityJob = { job_no: string; customer: string | null; team: string | null };

export type QualityDataset = {
  ncrs: QualityNcr[]; cases: QualityCase[]; actions: QualityAction[]; evaluations: QualityEvaluation[]; jobs: QualityJob[];
};

export type QualityMetrics = ReturnType<typeof calculateQualityMetrics>;

export function isClosedNcr(status: string) { return status === "closed"; }
export function isClosedCase(status: string) { return ["resolved", "closed"].includes(status); }

function hoursBetween(from: string, to: string) {
  return Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000);
}

function monthKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function calculateQualityMetrics(data: QualityDataset, now = new Date()) {
  const nowMs = now.getTime();
  const openNcrs = data.ncrs.filter((item) => !isClosedNcr(item.status));
  const overdueNcrs = openNcrs.filter((item) => item.due_at && new Date(item.due_at).getTime() < nowMs);
  const openCases = data.cases.filter((item) => !isClosedCase(item.status));
  const overdueCases = openCases.filter((item) => new Date(item.due_at).getTime() < nowMs);
  const pendingActions = data.actions.filter((item) => ["open", "in_progress"].includes(item.status));
  const overdueActions = pendingActions.filter((item) => item.due_at && new Date(item.due_at).getTime() < nowMs);
  const completedNcrs = data.ncrs.filter((item) => ["verified", "closed"].includes(item.status));
  const effectivenessRate = data.ncrs.length ? Math.round((completedNcrs.length / data.ncrs.length) * 100) : 0;
  const resolvedCases = data.cases.filter((item) => item.resolved_at || item.closed_at);
  const recoveryHours = resolvedCases.map((item) => hoursBetween(item.opened_at, item.resolved_at || item.closed_at!));
  const averageRecoveryHours = recoveryHours.length ? recoveryHours.reduce((sum, value) => sum + value, 0) / recoveryHours.length : 0;
  const scored = data.evaluations.filter((item) => item.satisfaction_score !== null);
  const csatAverage = scored.length ? scored.reduce((sum, item) => sum + Number(item.satisfaction_score), 0) / scored.length : 0;

  const bySeverity = Object.fromEntries(["critical", "high", "medium", "low"].map((key) => [key, data.ncrs.filter((item) => item.severity === key).length]));
  const byType = Object.entries(data.ncrs.reduce<Record<string, number>>((acc, item) => { acc[item.type] = (acc[item.type] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]);
  const jobs = new Map(data.jobs.map((item) => [item.job_no, item]));
  const byTeam = Object.entries(data.ncrs.reduce<Record<string, number>>((acc, item) => { const key = jobs.get(item.job_no || "")?.team || "ไม่ระบุทีม"; acc[key] = (acc[key] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]);
  const bySku = Object.entries(data.ncrs.reduce<Record<string, number>>((acc, item) => { const key = item.product_sku || "ไม่ระบุ SKU"; acc[key] = (acc[key] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]);

  const cutoff90 = nowMs - 90 * 86_400_000;
  const recurrenceGroups = Object.entries(data.ncrs.filter((item) => new Date(item.created_at).getTime() >= cutoff90).reduce<Record<string, QualityNcr[]>>((acc, item) => {
    const key = `${item.type}|${item.product_sku || "ไม่ระบุ SKU"}`;
    (acc[key] ||= []).push(item); return acc;
  }, {})).filter(([, items]) => items.length >= 2).map(([key, items]) => ({ key, type: key.split("|")[0], sku: key.split("|")[1], count: items.length, items })).sort((a, b) => b.count - a.count);

  const csatTrend = Object.entries(scored.reduce<Record<string, number[]>>((acc, item) => { const key = monthKey(item.call_date || item.updated_at || item.created_at); (acc[key] ||= []).push(Number(item.satisfaction_score)); return acc; }, {})).sort(([a], [b]) => a.localeCompare(b)).map(([month, values]) => ({ month, average: values.reduce((sum, value) => sum + value, 0) / values.length, count: values.length }));

  return { openNcrs, overdueNcrs, openCases, overdueCases, pendingActions, overdueActions, effectivenessRate, averageRecoveryHours, csatAverage, scoredCount: scored.length, bySeverity, byType, byTeam, bySku, recurrenceGroups, csatTrend };
}

export function filterQualityDataset(data: QualityDataset, from: Date | null, to: Date | null): QualityDataset {
  const within = (value: string) => (!from || new Date(value) >= from) && (!to || new Date(value) <= to);
  const ncrs = data.ncrs.filter((item) => within(item.created_at));
  const cases = data.cases.filter((item) => within(item.opened_at));
  const caseIds = new Set(cases.map((item) => item.id));
  return { ncrs, cases, actions: data.actions.filter((item) => caseIds.has(item.case_id)), evaluations: data.evaluations.filter((item) => within(item.call_date || item.created_at)), jobs: data.jobs };
}
