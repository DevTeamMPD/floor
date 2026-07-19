"use client";
import { useState, useEffect, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { IP_STAGES } from "@/lib/types";
import { toast } from "sonner";

interface Job {
  job_no: string;
  customer_name: string | null;
  product_name: string | null;
  external_id: string | null;
  product_skus: string[] | null;
  closed_at: string | null;
  appt_date: string | null;
  customer_phone: string | null;
  stage: number;
}

interface Evaluation {
  id: string;
  job_no: string;
  score: number | null;
  cs_name: string | null;
  call_date: string | null;
  issues_text: string | null;
  needs_followup: boolean;
  answers: Record<string, string>;
}

interface Question {
  id: string;
  question_text: string;
  order_index: number;
}

interface JobRow extends Job {
  evaluation: Evaluation | null;
}

function StageBadge({ stage }: { stage: number }) {
  const s = IP_STAGES.find((x) => x.id === stage);
  if (!s) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.color}`}>
      {s.icon} {s.name}
    </span>
  );
}

function StarScore({ score }: { score: number | null }) {
  if (!score) return <span className="text-gray-300 text-xs">—</span>;
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`text-sm ${i <= score ? "text-yellow-400" : "text-gray-200"}`}>★</span>
      ))}
    </div>
  );
}

function EvalModal({ row, questions, onClose, onSaved }: {
  row: JobRow; questions: Question[]; onClose: () => void; onSaved: () => void;
}) {
  const supabase = createClient();
  const ev = row.evaluation;
  const [score, setScore]       = useState(ev?.score ?? 0);
  const [csName, setCsName]     = useState(ev?.cs_name ?? "");
  const [callDate, setCallDate] = useState(ev?.call_date ?? "");
  const [issues, setIssues]     = useState(ev?.issues_text ?? "");
  const [followup, setFollowup] = useState(ev?.needs_followup ?? false);
  const [answers, setAnswers]   = useState<Record<string, string>>(ev?.answers ?? {});
  const [saving, setSaving]     = useState(false);

  async function save() {
    if (!score) { toast.error("กรุณาให้คะแนนความพึงพอใจ"); return; }
    setSaving(true);
    try {
      const payload = {
        job_no: row.job_no, score,
        cs_name: csName.trim() || null,
        call_date: callDate || null,
        issues_text: issues.trim() || null,
        needs_followup: followup, answers,
        updated_at: new Date().toISOString(),
      };
      if (ev?.id) {
        const { error } = await supabase.from("job_evaluations").update(payload).eq("id", ev.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("job_evaluations").insert({ ...payload, created_at: new Date().toISOString() });
        if (error) throw error;
      }
      toast.success("บันทึกการประเมินแล้ว");
      onSaved(); onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "เกิดข้อผิดพลาด");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b">
          <div>
            <h2 className="font-bold text-gray-900">📞 บันทึกการประเมิน</h2>
            <p className="text-sm text-gray-500 mt-0.5">{row.job_no}{row.customer_name ? ` — ${row.customer_name}` : ""}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl ml-4">×</button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">คะแนนความพึงพอใจ <span className="text-red-500">*</span></p>
            <div className="flex gap-2 items-center">
              {[1,2,3,4,5].map((s) => (
                <button key={s} onClick={() => setScore(s)}
                  className={`text-3xl transition-transform hover:scale-110 ${s <= score ? "text-yellow-400" : "text-gray-200"}`}>★</button>
              ))}
              {score > 0 && <span className="ml-2 text-sm text-gray-500">{score}/5 ดาว</span>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">ชื่อ CS ที่โทร</label>
              <input type="text" value={csName} onChange={(e) => setCsName(e.target.value)} placeholder="ชื่อพนักงาน"
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">วันที่โทร</label>
              <input type="date" value={callDate} onChange={(e) => setCallDate(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          {questions.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">คำถามประเมิน</p>
              {questions.map((q) => (
                <div key={q.id}>
                  <label className="text-xs text-gray-600">{q.question_text}</label>
                  <input type="text" value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              ))}
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-gray-700">ปัญหาที่พบ / ข้อเสนอแนะ</label>
            <textarea value={issues} onChange={(e) => setIssues(e.target.value)} rows={3}
              placeholder="บันทึกปัญหาหรือข้อเสนอแนะ (ถ้ามี)"
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input type="checkbox" checked={followup} onChange={(e) => setFollowup(e.target.checked)} className="w-4 h-4 rounded text-blue-600" />
            <span className="text-sm text-gray-700">ต้องติดตามผล (Follow-up)</span>
          </label>
        </div>
        <div className="px-6 py-4 border-t flex gap-3">
          <button onClick={onClose} className="flex-1 border rounded-xl py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">ยกเลิก</button>
          <button onClick={save} disabled={saving}
            className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {saving ? "กำลังบันทึก..." : "💾 บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}

const FILTER_TABS = [
  { key: "all",      label: "ทั้งหมด" },
  { key: "pending",  label: "🔴 รอโทร" },
  { key: "done",     label: "✅ ประเมินแล้ว" },
  { key: "followup", label: "⚡ ต้องติดตาม" },
  { key: "overdue",  label: "🚨 เกินกำหนด" },
] as const;
type FilterKey = typeof FILTER_TABS[number]["key"];

function CsTrackingInner() {
  const supabase = createClient();
  const [rows, setRows]           = useState<JobRow[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState<FilterKey>("pending");
  const [search, setSearch]       = useState("");
  const [selected, setSelected]   = useState<JobRow | null>(null);

  async function load() {
    const [{ data: jobs, error: jobErr }, { data: evals }, { data: qs }] = await Promise.all([
      supabase
        .from("install_jobs")
        .select("job_no, customer_name, product_name, external_id, product_skus, closed_at, appt_date, customer_phone, stage")
        .eq("stage", 7)
        .order("closed_at", { ascending: false, nullsFirst: false }),
      supabase.from("job_evaluations").select("*"),
      supabase.from("evaluation_questions").select("id, question_text, order_index").eq("is_active", true).order("order_index"),
    ]);
    if (jobErr) toast.error(jobErr.message);
    if (jobs) {
      const evalMap = new Map<string, Evaluation>();
      (evals ?? []).forEach((e: Evaluation) => evalMap.set(e.job_no, e));
      setRows(jobs.map((j: Job) => ({ ...j, evaluation: evalMap.get(j.job_no) ?? null })));
    }
    if (qs) setQuestions(qs);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const total    = rows.length;
  const done     = rows.filter((r) => !!r.evaluation?.score).length;
  const pending  = total - done;
  const followup = rows.filter((r) => !!r.evaluation?.needs_followup).length;
  const overdue  = rows.filter((r) => {
    if (!!r.evaluation?.score) return false;
    if (!r.closed_at) return false;
    const days = Math.floor((Date.now() - new Date(r.closed_at).getTime()) / (1000 * 60 * 60 * 24));
    return days > 3;
  }).length;

  const visible = rows
    .filter((r) => {
      const isEvaluated = !!r.evaluation?.score;
      if (filter === "pending")  return !isEvaluated;
      if (filter === "done")     return isEvaluated;
      if (filter === "followup") return !!r.evaluation?.needs_followup;
      if (filter === "overdue") {
        if (isEvaluated || !r.closed_at) return false;
        const days = Math.floor((Date.now() - new Date(r.closed_at).getTime()) / (1000 * 60 * 60 * 24));
        return days > 3;
      }
      return true;
    })
    .filter((r) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        r.job_no.toLowerCase().includes(q) ||
        (r.customer_name ?? "").toLowerCase().includes(q) ||
        (r.product_name  ?? "").toLowerCase().includes(q) ||
        (r.external_id   ?? "").toLowerCase().includes(q)
      );
    });

  function fmtDate(d: string | null) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <div className="bg-white border-b px-6 py-4 shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-gray-900">📞 CS ติดตามความพึงพอใจ</h1>
            <p className="text-xs text-gray-500 mt-0.5">งานสถานะ ✅ เสร็จสิ้น — ทุกรายการต้องมีการโทรประเมิน</p>
          </div>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหา เลขงาน / ลูกค้า / สินค้า..."
            className="border rounded-xl px-4 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div className="grid grid-cols-5 gap-3 mt-4">
          {[
            { label: "งานเสร็จสิ้นทั้งหมด", value: total,    color: "text-gray-700",   bg: "bg-gray-100" },
            { label: "รอโทรประเมิน",          value: pending,  color: "text-red-600",   bg: "bg-red-50"   },
            { label: "ประเมินแล้ว",           value: done,     color: "text-green-600", bg: "bg-green-50" },
            { label: "ต้องติดตามผล",          value: followup, color: "text-amber-600", bg: "bg-amber-50"  },
            { label: "เกิน 3 วัน",              value: overdue,  color: "text-red-700",   bg: "bg-red-100"  },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl px-4 py-3 ${s.bg}`}>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-1 mt-4">
          {FILTER_TABS.map((t) => (
            <button key={t.key} onClick={() => setFilter(t.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filter === t.key ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}>{t.label}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">⏳ กำลังโหลด...</div>
      ) : visible.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-5xl mb-3">{filter === "pending" ? "🎉" : "🔍"}</div>
            <p className="text-gray-500 font-medium">
              {filter === "pending" ? "ไม่มีงานค้างโทร!" : "ไม่พบรายการ"}
            </p>
            {filter === "pending" && total === 0 && (
              <p className="text-xs text-gray-400 mt-2">ยังไม่มีงานที่เลื่อนไปสถานะ “เสร็จสิ้น” ใน Pipeline</p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-white border-b sticky top-0 z-10">
              <tr>
                {["เลขงาน", "ลูกค้า", "สินค้า", "วันเสร็จงาน", "เบอร์โทร", "CS", "วันที่โทร", "คะแนน", "สถานะ", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((row) => {
                const ev = row.evaluation;
                const evaluated = !!ev?.score;
                const daysOverdue = (!evaluated && row.closed_at)
                  ? Math.floor((Date.now() - new Date(row.closed_at).getTime()) / (1000 * 60 * 60 * 24))
                  : 0;
                return (
                  <tr key={row.job_no} className={`hover:bg-blue-50 transition-colors ${daysOverdue > 3 ? "bg-red-50/40" : ""}`}>
                    <td className="px-4 py-3 font-medium text-blue-700 whitespace-nowrap">{row.job_no}</td>
                    <td className="px-4 py-3 text-gray-800 max-w-[140px] truncate">{row.customer_name ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-[160px] truncate">{row.product_name ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {row.closed_at ? fmtDate(row.closed_at) : fmtDate(row.appt_date)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{row.customer_phone ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{ev?.cs_name ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(ev?.call_date ?? null)}</td>
                    <td className="px-4 py-3"><StarScore score={ev?.score ?? null} /></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {evaluated ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 whitespace-nowrap">✅ ประเมินแล้ว</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600 whitespace-nowrap">🔴 รอโทร</span>
                        )}
                        {!evaluated && daysOverdue > 3 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-600 text-white whitespace-nowrap">
                            🚨 เกิน {daysOverdue} วัน
                          </span>
                        )}
                        {ev?.needs_followup && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 whitespace-nowrap">⚡ ติดตาม</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => setSelected(row)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap">
                        {evaluated ? "✏️ แก้ไข" : "📞 โทรแล้ว"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <EvalModal row={selected} questions={questions} onClose={() => setSelected(null)} onSaved={load} />
      )}
    </div>
  );
}

export default function CsTrackingPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-400">กำลังโหลด...</div>}>
      <CsTrackingInner />
    </Suspense>
  );
}
