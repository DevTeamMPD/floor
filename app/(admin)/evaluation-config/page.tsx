"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

interface EvalQuestion {
  id: string;
  question_text: string;
  order_index: number;
  is_active: boolean;
}

export default function EvaluationConfigPage() {
  const supabase = createClient();
  const [questions, setQuestions] = useState<EvalQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [newQ, setNewQ] = useState("");
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("evaluation_questions")
      .select("*")
      .order("order_index");
    if (data) setQuestions(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addQuestion() {
    if (!newQ.trim()) return;
    setAdding(true);
    const maxOrder =
      questions.length > 0
        ? Math.max(...questions.map((q) => q.order_index)) + 1
        : 1;
    const { error } = await supabase.from("evaluation_questions").insert({
      question_text: newQ.trim(),
      order_index: maxOrder,
      is_active: true,
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("เพิ่มคำถามแล้ว");
      setNewQ("");
      await load();
    }
    setAdding(false);
  }

  async function toggleActive(q: EvalQuestion) {
    const { error } = await supabase
      .from("evaluation_questions")
      .update({ is_active: !q.is_active })
      .eq("id", q.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setQuestions((prev) =>
      prev.map((x) =>
        x.id === q.id ? { ...x, is_active: !q.is_active } : x
      )
    );
  }

  async function deleteQuestion(id: string) {
    if (!confirm("ลบคำถามนี้?")) return;
    const { error } = await supabase
      .from("evaluation_questions")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("ลบแล้ว");
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  }

  async function updateText(q: EvalQuestion, text: string) {
    if (text === q.question_text) return;
    const { error } = await supabase
      .from("evaluation_questions")
      .update({ question_text: text })
      .eq("id", q.id);
    if (error) toast.error(error.message);
    else toast.success("บันทึกแล้ว");
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          ⚙️ จัดการคำถามประเมิน
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          คำถามเหล่านี้จะปรากฏในแบบประเมินความพึงพอใจหลังจบงาน
        </p>
      </div>

      {/* Add new question */}
      <div className="bg-white border rounded-xl p-4 space-y-3">
        <h2 className="font-semibold text-gray-800">เพิ่มคำถามใหม่</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={newQ}
            onChange={(e) => setNewQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addQuestion()}
            placeholder="พิมพ์คำถาม แล้วกด Enter หรือคลิก + เพิ่ม"
            className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={addQuestion}
            disabled={adding || !newQ.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
          >
            {adding ? "..." : "+ เพิ่ม"}
          </button>
        </div>
      </div>

      {/* Question list */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">
            คำถามทั้งหมด ({questions.length})
          </h2>
          <p className="text-xs text-gray-400">
            คลิกข้อความเพื่อแก้ไข กดออกเพื่อบันทึก
          </p>
        </div>
        {loading ? (
          <div className="py-8 text-center text-gray-400 text-sm">
            กำลังโหลด...
          </div>
        ) : questions.length === 0 ? (
          <div className="py-8 text-center text-gray-400 text-sm">
            ยังไม่มีคำถาม — เพิ่มคำถามแรกด้านบน
          </div>
        ) : (
          <div className="divide-y">
            {questions.map((q, idx) => (
              <div
                key={q.id}
                className={`flex items-center gap-3 px-4 py-3 ${
                  !q.is_active ? "opacity-50 bg-gray-50" : ""
                }`}
              >
                <span className="text-xs text-gray-400 w-5 shrink-0">
                  {idx + 1}
                </span>
                <input
                  type="text"
                  defaultValue={q.question_text}
                  onBlur={(e) => updateText(q, e.target.value)}
                  className="flex-1 text-sm border-0 focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-1 py-0.5 min-w-0"
                />
                <button
                  onClick={() => toggleActive(q)}
                  className={`text-xs px-2 py-1 rounded-full border shrink-0 ${
                    q.is_active
                      ? "border-green-500 text-green-600 hover:bg-green-50"
                      : "border-gray-300 text-gray-400 hover:bg-gray-50"
                  }`}
                >
                  {q.is_active ? "เปิดใช้" : "ปิด"}
                </button>
                <button
                  onClick={() => deleteQuestion(q.id)}
                  className="text-red-400 hover:text-red-600 text-sm shrink-0"
                  title="ลบคำถาม"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 text-center">
        คำถามที่ปิดจะไม่ปรากฏในแบบประเมิน แต่ข้อมูลเก่ายังคงอยู่
      </p>
    </div>
  );
}
