"use client";
export const dynamic = "force-dynamic";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "job-photos";

interface JobRow {
  job_no: string;
  customer_name: string | null;
  customer_phone: string | null;
  address: string | null;
  location_url: string | null;
  product_name: string | null;
  product_skus: string[] | null;
  appt_date: string | null;
  appt_shift: string | null;
  survey_data: string | null;
}

interface Survey {
  areaSqm?: string;
  floorCondition?: string;
  wetZone?: boolean;
  notes?: string;
  photos?: string[];
}

export default function DispatchPage() {
  const params = useParams();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const supabase = createClient();
  const [state, setState] = useState<"loading" | "ready" | "invalid">("loading");
  const [job, setJob] = useState<JobRow | null>(null);
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [tech, setTech] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    (async () => {
      if (!token) { setState("invalid"); return; }
      const { data: dn } = await supabase.from("dispatch_notes")
        .select("job_no, note").eq("share_token", token).maybeSingle();
      if (!dn) { setState("invalid"); return; }
      setNote(dn.note ?? "");
      const { data: j } = await supabase.from("install_jobs")
        .select("job_no, customer_name, customer_phone, address, location_url, product_name, product_skus, appt_date, appt_shift, survey_data")
        .eq("job_no", dn.job_no).maybeSingle();
      if (!j) { setState("invalid"); return; }
      setJob(j as JobRow);
      if (j.survey_data) { try { setSurvey(JSON.parse(j.survey_data)); } catch {} }
      const { data: appt } = await supabase.from("appointments")
        .select("tech_id, slot_start").eq("job_id", dn.job_no)
        .order("slot_start", { ascending: false }).limit(1);
      if (appt && appt[0]?.tech_id) {
        const { data: t } = await supabase.from("tech_teams").select("name").eq("id", appt[0].tech_id).maybeSingle();
        if (t?.name) setTech(t.name);
      }
      setState("ready");
    })();
  }, [token]);

  function photoUrl(path: string): string {
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  if (state === "loading") return <div className="min-h-screen flex items-center justify-center text-slate-400">กำลังโหลด…</div>;
  if (state === "invalid" || !job) return <div className="min-h-screen flex items-center justify-center text-slate-500">ไม่พบใบส่งงานนี้</div>;

  const apptText = job.appt_date
    ? new Date(job.appt_date).toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "ยังไม่ระบุ";

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-4 print:bg-white print:py-0">
      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow print:shadow-none p-6 space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">ใบส่งงานติดตั้ง</h1>
            <p className="text-xs text-slate-500">งาน #{job.job_no}</p>
          </div>
          <button onClick={() => window.print()} className="print:hidden bg-slate-800 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-700">🖨️ พิมพ์ / PDF</button>
        </div>

        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-1">ลูกค้า</h2>
          <table className="w-full text-sm">
            <tbody>
              <tr><td className="py-1 pr-4 text-slate-500 w-28">ชื่อ</td><td className="py-1 font-medium">{job.customer_name ?? "—"}</td></tr>
              <tr><td className="py-1 pr-4 text-slate-500">เบอร์โทร</td><td className="py-1 font-medium">{job.customer_phone ?? "—"}</td></tr>
              <tr><td className="py-1 pr-4 text-slate-500 align-top">ที่อยู่</td><td className="py-1 font-medium">{job.address ?? "—"}</td></tr>
              {job.location_url && <tr><td className="py-1 pr-4 text-slate-500">แผนที่</td><td className="py-1"><a className="text-blue-600 underline break-all" href={job.location_url} target="_blank" rel="noreferrer">{job.location_url}</a></td></tr>}
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-1">งาน</h2>
          <table className="w-full text-sm">
            <tbody>
              <tr><td className="py-1 pr-4 text-slate-500 w-28">สินค้า</td><td className="py-1 font-medium">{job.product_name ?? "—"}</td></tr>
              <tr><td className="py-1 pr-4 text-slate-500">SKU</td><td className="py-1 font-medium">{(job.product_skus ?? []).join(", ") || "—"}</td></tr>
              <tr><td className="py-1 pr-4 text-slate-500">วันนัดติดตั้ง</td><td className="py-1 font-medium">{apptText}{job.appt_shift ? ` (${job.appt_shift})` : ""}</td></tr>
              <tr><td className="py-1 pr-4 text-slate-500">ทีมช่าง</td><td className="py-1 font-medium">{tech ?? "—"}</td></tr>
            </tbody>
          </table>
        </section>

        {survey && (
          <section>
            <h2 className="text-sm font-semibold text-slate-700 mb-1">ผลสำรวจหน้างาน</h2>
            <table className="w-full text-sm">
              <tbody>
                <tr><td className="py-1 pr-4 text-slate-500 w-28">พื้นที่ (ตร.ม.)</td><td className="py-1 font-medium">{survey.areaSqm || "—"}</td></tr>
                <tr><td className="py-1 pr-4 text-slate-500">สภาพพื้น</td><td className="py-1 font-medium">{survey.floorCondition || "—"}{survey.wetZone ? " · มีโซนเปียก" : ""}</td></tr>
                {survey.notes && <tr><td className="py-1 pr-4 text-slate-500 align-top">หมายเหตุ</td><td className="py-1 font-medium whitespace-pre-wrap">{survey.notes}</td></tr>}
              </tbody>
            </table>
            {survey.photos && survey.photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                {survey.photos.map((p, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={photoUrl(p)} alt={`survey-${i}`} className="w-full h-24 object-cover rounded-lg border" />
                ))}
              </div>
            )}
          </section>
        )}

        {note && (
          <section>
            <h2 className="text-sm font-semibold text-slate-700 mb-1">คำสั่งพิเศษ</h2>
            <p className="text-sm whitespace-pre-wrap">{note}</p>
          </section>
        )}

        <p className="text-[11px] text-slate-400 border-t pt-3">ออกใบส่งงานจากระบบ MPD — สำหรับทีมช่างเท่านั้น</p>
      </div>
    </div>
  );
}
