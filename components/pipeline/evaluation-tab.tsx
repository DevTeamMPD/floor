"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import type { InstallJob } from "@/lib/types";

interface EvaluationQuestion {
  id: string;
  question_text: string;
  order_index: number;
}

interface JobEvaluation {
  id: string;
  job_no: string;
  cs_name: string;
  call_date: string;
  satisfaction_score: number;
  issues_text: string;
  needs_followup: boolean;
  answers: Record<string, string>;
}

export default function EvaluationTab({ job }: { job: InstallJob }) {
  const supabase = createClient();
  const [questions, setQuestions] = useState<EvaluationQuestion[]>([]);
  const [evaluation, setEvaluation] = useState<JobEvaluation | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [score, setScore] = useState<number>(0);
  const [csName, setCsName] = useState("");
  const [callDate, setCallDate] = useState("");
  const [issuesText, setIssuesText] = useState("");
  const [needsFollowup, setNeedsFollowup] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [{ data: qs }, { data: ev }] = await Promise.all([
        supabase
          .from("evaluation_questions")
          .select("id, question_text, order_index")
          .eq("is_active", true)
          .order("order_index"),
        supabase
          .from("job_evaluations")
          .select("*")
          .eq("job_no", job.job_no)
          .maybeSingle(),
      ]);
      if (qs) setQuestions(qs);
      if (ev) {
        setEvaluation(ev);
        setScore(ev.satisfaction_score ?? 0);
        setCsName(ev.cs_name ?? "");
        setCallDate(ev.call_date ?? "");
        setIssuesText(ev.issues_text ?? "");
        setNeedsFollowup(ev.needs_followup ?? false);
        setAnswers(ev.answers ?? {});
      }
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.job_no]);

  async function save() {
    setSaving(true);
    try {
      const payload = {
        job_no: job.job_no,
        cs_name: csName,
        call_date: callDate || null,
        satisfaction_score: score,
        issues_text: issuesText,
        needs_followup: needsFollowup,
        answers,
        updated_at: new Date().toISOString(),
      };
      if (evaluation?.id) {
        const { error } = await supabase
          .from("job_evaluations")
          .update(payload)
          .eq("id", evaluation.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("job_evaluations")
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        setEvaluation(data);
      }
      toast.success("บันทึกการประเมินแล้ว");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "เกิดข้อผิดพลาด";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <div className="text-sm text-gray-400 py-4 text-center">
        กำลังโหลด...
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">📞 ประเมินความพึงพอใจ</h3>
        {evaluation && (
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
            บันทึกแล้ว
          </span>
        )}
      </div>

      {/* Score */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">
          คะแนนความพึงพอใจ
        </label>
        <div className="flex gap-2 items-center">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setScore(n)}
              className={`w-10 h-10 rounded-full text-lg font-bold transition-all border-2 ${
                score >= n
                  ? "bg-yellow-400 border-yellow-500 text-white"
                  : "bg-gray-100 border-gray-200 text-gray-400 hover:bg-yellow-100"
              }`}
            >
              ★
            </button>
          ))}
          <span className="text-sm text-gray-500 ml-1">
            {score > 0 ? `${score}/5` : "ยังไม่ให้คะแนน"}
          </span>
        </div>
      </div>

      {/* CS Name */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">ชื่อ CS ที่โทร</label>
        <input
          type="text"
          value={csName}
          onChange={(e) => setCsName(e.target.value)}
          placeholder="ชื่อพนักงาน CS"
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Call Date */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">วันที่โทร</label>
        <input
          type="date"
          value={callDate}
          onChange={(e) => setCallDate(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Issues */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">ปัญหาที่พบ</label>
        <textarea
          value={issuesText}
          onChange={(e) => setIssuesText(e.target.value)}
          rows={3}
          placeholder="บันทึกปัญหาหรือข้อเสนอแนะ (ถ้ามี)"
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      {/* Needs Followup */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={needsFollowup}
          onChange={(e) => setNeedsFollowup(e.target.checked)}
          className="w-4 h-4 rounded accent-blue-600"
        />
        <span className="text-sm font-medium text-gray-700">
          ต้องติดตามผล (Follow-up)
        </span>
      </label>

      {/* Dynamic Questions */}
      {questions.length > 0 && (
        <div className="space-y-3 pt-2 border-t">
          <p className="text-sm font-medium text-gray-700">คำถามเพิ่มเติม</p>
          {questions.map((q) => (
            <div key={q.id} className="space-y-1">
              <label className="text-sm text-gray-600">{q.question_text}</label>
              <input
                type="text"
                value={answers[q.id] ?? ""}
                onChange={(e) =>
                  setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                }
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
        </div>
      )}

      <button
        onClick={save}
        disabled={saving || score === 0}
        className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {saving ? "กำลังบันทึก..." : "💾 บันทึกการประเมิน"}
      </button>
      {score === 0 && (
        <p className="text-xs text-gray-400 text-center">
          กรุณาให้คะแนนก่อนบันทึก
        </p>
      )}
    </div>
  );
}
