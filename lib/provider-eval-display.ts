/**
 * P4-9 — แปลงแถวคะแนนที่เก็บไว้ (tech_team_eval_scores) เป็นข้อความไทยที่คนอ่านแล้วเข้าใจว่าทำไม
 *
 * เจตนา: เลขรวมโดด ๆ ที่ตรวจที่มาไม่ได้ แย่กว่าไม่มีเลข
 * หน้าจอจึงต้องกางให้เห็นเสมอว่าแต่ละด้านได้เท่าไร ยืนอยู่บนข้อมูลกี่งาน และค่ากลางที่ใช้คือเท่าไร
 * ไฟล์นี้ไม่คำนวณคะแนนใหม่ — คำนวณอยู่ที่ lib/provider-eval.ts ที่เดียว ที่นี่แค่จัดคำ
 */

import { EVAL_COMPONENT_LABELS, EVAL_COMPONENT_SAMPLE_LABELS, EVAL_WEIGHTS, type EvalComponentKey } from "@/lib/provider-eval";

/** แถวตามที่ฐานข้อมูลเก็บจริง (snake_case) — อ่านตรงจาก supabase ไม่ต้องแปลงชื่อก่อน */
export interface StoredTeamEvalRow {
  team_id: string;
  computed_at: string | null;
  method_version: string | null;
  eval_score: number | null;
  eval_avg: number | null;
  performance_score: number | null;
  direct_evidence: number | null;
  has_data: boolean | null;
  is_provisional: boolean | null;
  job_count: number | null;
  csat_score: number | null; csat_raw: number | null; csat_sample: number | null;
  ncr_score: number | null; ncr_raw: number | null; ncr_sample: number | null;
  ncr_weighted: number | null; ncr_count: number | null;
  ontime_score: number | null; ontime_raw: number | null; ontime_sample: number | null;
  ftp_score: number | null; ftp_raw: number | null; ftp_sample: number | null;
}

export interface EvalDisplayLine {
  key: EvalComponentKey;
  label: string;
  /** คะแนนหลังหด แสดงเป็นข้อความ */
  score: string;
  /** ค่าดิบของทีมเอง หรือคำว่ายังไม่มีข้อมูล */
  raw: string;
  /** จำนวนตัวอย่างพร้อมคำอธิบายว่านับจากอะไร */
  sample: string;
  /** น้ำหนักของด้านนี้ */
  weight: string;
}

function score(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Number(value).toFixed(1)}`;
}

function rawText(value: number | null | undefined): string {
  return value === null || value === undefined ? "ยังไม่มีข้อมูล ใช้ค่ากลาง" : `${Number(value).toFixed(1)}`;
}

function count(value: number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function evalDisplayLines(row: StoredTeamEvalRow): EvalDisplayLine[] {
  const map: Array<[EvalComponentKey, number | null, number | null, number | null]> = [
    ["csat", row.csat_score, row.csat_raw, row.csat_sample],
    ["ncr", row.ncr_score, row.ncr_raw, row.ncr_sample],
    ["onTime", row.ontime_score, row.ontime_raw, row.ontime_sample],
    ["firstTimePass", row.ftp_score, row.ftp_raw, row.ftp_sample],
  ];
  return map.map(([key, componentScore, raw, sample]) => ({
    key,
    label: EVAL_COMPONENT_LABELS[key],
    score: score(componentScore),
    raw: rawText(raw),
    sample: `${count(sample)} ${EVAL_COMPONENT_SAMPLE_LABELS[key]}`,
    weight: `${Math.round(EVAL_WEIGHTS[key] * 100)}%`,
  }));
}

/** บรรทัดสรุปบนสุด — ต้องบอกความจริงเมื่อยังไม่มีคะแนน ไม่ใช่โชว์ 0 */
export function evalHeadline(row: StoredTeamEvalRow | null | undefined): string {
  if (!row) return "ยังไม่ได้คำนวณคะแนน";
  if (!row.has_data || row.eval_score === null) return "ยังไม่มีข้อมูลพอให้คะแนน";
  const total = Number(row.eval_score).toFixed(1);
  if (row.is_provisional) return `${total} คะแนน (ยังไม่นิ่ง จึงยังไม่ประกาศดาว)`;
  return `${total} คะแนน · ★ ${Number(row.eval_avg ?? 0).toFixed(2)}`;
}

/** คำอธิบายบรรทัดที่สอง — ปริมาณหลักฐานที่คะแนนนี้ยืนอยู่ */
export function evalEvidenceNote(row: StoredTeamEvalRow | null | undefined): string {
  if (!row) return "รอบคำนวณถัดไปจะเติมให้เอง (คำนวณใหม่ทุกคืน)";
  const jobs = count(row.job_count);
  const evidence = count(row.direct_evidence);
  const performance = row.performance_score === null || row.performance_score === undefined
    ? null : Number(row.performance_score).toFixed(1);
  const base = `จากงาน ${jobs} ใบ · หลักฐานที่บันทึกไว้จริง ${evidence} จุด`;
  if (performance === null) return base;
  return `${base} · คะแนนจากผลงานก่อนถ่วงปริมาณงาน ${performance}`;
}

export function evalComputedAtLabel(row: StoredTeamEvalRow | null | undefined): string {
  if (!row?.computed_at) return "";
  const at = new Date(row.computed_at);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(at);
}
