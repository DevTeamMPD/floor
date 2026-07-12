"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const SECTIONS = [
  { key: "overall", label: "ความพึงพอใจโดยรวม" },
  { key: "quality", label: "คุณภาพงาน" },
  { key: "punctual", label: "ตรงต่อเวลา" },
  { key: "clean", label: "ความสะอาดเรียบร้อย" },
  { key: "courtesy", label: "มารยาทช่าง" },
];

const ISSUE_TYPES = [
  "สินค้าชำรุด", "ติดตั้งไม่ตรงสเปก", "ช้ากว่ากำหนด",
  "ทิ้งขยะไม่เก็บ", "พฤติกรรมไม่เหมาะสม", "อื่นๆ",
];

function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={`text-2xl transition-transform hover:scale-110 ${
            s <= value ? "text-yellow-400" : "text-slate-200"
          }`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function EvalForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("t");
  const supabase = createClient();

  const [state, setState] = useState<"loading" | "ready" | "done" | "invalid">("loading");
  const [job, setJob] = useState<{ id: string; customer: string; product: string } | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [issueType, setIssueType] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setState("invalid"); return; }
    supabase
      .from("job_evals")
      .select("install_job_id, submitted_at, install_jobs(customer_name, product_name)")
      .eq("token", token)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { setState("invalid"); return; }
        if (data.submitted_at) { setState("done"); return; }
        setJob({
          id: String(data.install_job_id),
          customer: (data as any).install_jobs?.customer_name ?? "",
          product: (data as any).install_jobs?.product_name ?? "",
        });
        setState("ready");
      });
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !job) return;
    setSubmitting(true);
    const overall = scores["overall"] ?? 0;
    await supabase
      .from("job_evals")
      .update({
        score_overall: overall,
        score_quality: scores["quality"],
        score_punctual: scores["punctual"],
        score_clean: scores["clean"],
        score_courtesy: scores["courtesy"],
        issue_type: issueType || null,
        comment: comment || null,
        submitted_at: new Date().toISOString(),
      })
      .eq("token", token)
      .is("submitted_at", null);
    await supabase
      .from("install_jobs")
      .update({ eval_score: overall })
      .eq("id", job.id);
    setState("done");
  }

  if (state === "loading") return <div className="min-h-screen flex items-center justify-center"><div className="text-slate-400">โหลดข้อมูล…</div></div>;
  if (state === "invalid") return <div className="min-h-screen flex items-center justify-center"><div className="text-center"><div className="text-5xl mb-4">❌</div><p className="text-slate-600">ลิงก์ไม่ถูกต้องหรือหมดอายุการใช้งานแล้ว</p></div></div>;
  if (state === "done") return <div className="min-h-screen flex items-center justify-center"><div className="text-center"><div className="text-6xl mb-4">✅</div><h2 className="text-xl font-semibold mb-2">ขอบคุณมากครับ!</h2><p className="text-slate-500">บันทึกคะแนนของคุณเรียบร้อยแล้ว</p></div></div>;

  const overallScore = scores["overall"] ?? 0;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-6">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🌟</div>
          <h1 className="text-xl font-semibold">ประเมินผลงานติดตั้ง</h1>
          <p className="text-slate-500 text-sm mt-1">{job?.customer} — {job?.product}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          {SECTIONS.map((sec) => (
            <div key={sec.key}>
              <label className="block text-sm font-medium mb-1">{sec.label}</label>
              <Stars value={scores[sec.key] ?? 0} onChange={(v) => setScores((s) => ({ ...s, [sec.key]: v }))} />
            </div>
          ))}
          {overallScore > 0 && overallScore <= 3 && (
            <div>
              <label className="block text-sm font-medium mb-1">ปัญหาที่พบ</label>
              <select
                value={issueType}
                onChange={(e) => setIssueType(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">— เลือกปัญหา —</option>
                {ISSUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">ความคิดเห็นเพิ่มเติม <span className="text-slate-400 font-normal">(ไม่บังคับ)</span></label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !scores["overall"]}
            className="w-full bg-blue-600 text-white rounded-lg py-3 font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? "กำลังส่ง…" : "ส่งคะแนน"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function EvalPage() {
  return <Suspense><EvalForm /></Suspense>;
}
