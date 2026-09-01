/**
 * P4-9 — งานเบื้องหลัง: อ่านตัวเลขดิบ -> คำนวณคะแนน -> เขียนผลกลับ
 *
 * แยกจาก route handler เพื่อให้ทดสอบได้โดยไม่ต้องมี Next.js runtime
 * (แพตเทิร์นเดียวกับ lib/stock-shortage-worker.ts และ lib/documents/generation-worker.ts)
 *
 * ไฟล์นี้ไม่มีคณิตศาสตร์การให้คะแนนเลยแม้แต่บรรทัดเดียว — ทั้งหมดอยู่ที่ lib/provider-eval.ts
 * หน้าที่ที่นี่คือการต่อท่อและรายงานผลรอบนั้นว่าเกิดอะไรขึ้นบ้าง
 *
 * รันซ้ำได้เสมอ: ทั้งกระบวนการเป็นการคำนวณใหม่จากศูนย์ทุกครั้ง ไม่มีการสะสมค่า
 * apply_tech_team_eval_scores เขียนแบบ upsert ทีมละแถว รันสิบรอบติดกันได้ผลเท่ารอบเดียว
 */

import {
  PROVIDER_EVAL_METHOD_VERSION,
  parseEvalInputs,
  scoreAllTeams,
  toApplyPayload,
  type TeamEvalScore,
} from "@/lib/provider-eval";

type RpcResult = { data: unknown; error: unknown };
export type ProviderEvalClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult> };

export const EVAL_INPUTS_RPC = "tech_team_eval_inputs";
export const APPLY_EVAL_SCORES_RPC = "apply_tech_team_eval_scores";

export interface ProviderEvalRunSummary {
  methodVersion: string;
  teamsRead: number;
  teamsScored: number;
  starsPublished: number;
  heldBack: number;
  /** ทีมที่ยังไม่มีข้อมูลสักด้าน — แสดงชื่อไว้ให้คนดูรู้ว่าเงียบเพราะอะไร */
  teamsWithoutData: string[];
}

function errorMessage(error: unknown, fallback: string): string {
  if (!error) return fallback;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

function countFromResult(value: unknown, key: string): number {
  if (!value || typeof value !== "object") return 0;
  const raw = (value as Record<string, unknown>)[key];
  const parsed = typeof raw === "number" ? raw : Number(raw ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function runProviderEvalRecompute(client: ProviderEvalClient): Promise<ProviderEvalRunSummary> {
  const { data: inputsData, error: inputsError } = await client.rpc(EVAL_INPUTS_RPC, {});
  if (inputsError) throw new Error(errorMessage(inputsError, "อ่านตัวเลขตั้งต้นของทีมช่างไม่สำเร็จ"));

  const inputs = parseEvalInputs(inputsData);
  const scores: TeamEvalScore[] = scoreAllTeams(inputs);

  if (scores.length === 0) {
    // ไม่มีทีมในระบบเลย = ไม่มีอะไรให้เขียน และไม่ใช่ความผิดพลาด
    return {
      methodVersion: PROVIDER_EVAL_METHOD_VERSION,
      teamsRead: 0, teamsScored: 0, starsPublished: 0, heldBack: 0, teamsWithoutData: [],
    };
  }

  const { data: applied, error: applyError } = await client.rpc(APPLY_EVAL_SCORES_RPC, {
    p_scores: toApplyPayload(scores),
  });
  if (applyError) throw new Error(errorMessage(applyError, "บันทึกคะแนนทีมช่างไม่สำเร็จ"));

  return {
    methodVersion: PROVIDER_EVAL_METHOD_VERSION,
    teamsRead: inputs.length,
    teamsScored: countFromResult(applied, "written") || scores.length,
    starsPublished: countFromResult(applied, "starsPublished"),
    heldBack: countFromResult(applied, "heldBack"),
    teamsWithoutData: scores.filter((score) => !score.hasData).map((score) => score.teamName),
  };
}
