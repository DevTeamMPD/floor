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
  pick_plan: string | null;
}

interface Survey {
  areaSqm?: string;
  floorCondition?: string;
  wetZone?: boolean;
  notes?: string;
  photos?: string[];
}

interface PickNewItem { width: string; length_cm: string; qty: string; note: string }
interface PickRemnant { mat_type: string; width_bin: string; length_cm: string; note: string }
interface PickPlan { newItems?: PickNewItem[]; remnants?: PickRemnant[]; note?: string }
interface ZoneRow { zone_name: string; width_cm: number; length_cm: number }

function stripLenForZone(dimA: number, dimB: number): { total140: number; total110: number } {
  function orient(stripLen: number, cover: number) {
    const nPairs = Math.floor(cover / 250);
    const rem = cover % 250;
    let n140 = nPairs, n110 = nPairs;
    if (rem > 0 && rem <= 110) n110 += 1;
    else if (rem > 110) { n140 += 1; n110 += 1; }
    return { total140: n140 * stripLen, total110: n110 * stripLen };
  }
  const a = orient(dimA, dimB), b = orient(dimB, dimA);
  return a.total140 + a.total110 <= b.total140 + b.total110 ? a : b;
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
  const [pick, setPick] = useState<PickPlan | null>(null);
  const [req, setReq] = useState<{ total140: number; total110: number } | null>(null);

  useEffect(() => {
    (async () => {
      if (!token) { setState("invalid"); return; }
      const { data: dn } = await supabase.from("dispatch_notes")
        .select("job_no, note").eq("share_token", token).maybeSingle();
      if (!dn) { setState("invalid"); return; }
      setNote(dn.note ?? "");
      const { data: j } = await supabase.from("install_jobs")
        .select("job_no, customer_name, customer_phone, address, location_url, product_name, product_skus, appt_date, appt_shift, survey_data, pick_plan")
        .eq("job_no", dn.job_no).maybeSingle();
      if (!j) { setState("invalid"); return; }
      setJob(j as JobRow);
      if (j.survey_data) { try { setSurvey(JSON.parse(j.survey_data)); } catch {} }
      if (j.pick_plan) { try { setPick(typeof j.pick_plan === "string" ? JSON.parse(j.pick_plan) : j.pick_plan); } catch {} }
      const { data: zs } = await supabase.from("install_job_zones")
        .select("zone_name, width_cm, length_cm").eq("job_no", dn.job_no);
      if (zs && zs.length) {
        const r = (zs as ZoneRow[]).reduce((acc, z) => {
          if (z.width_cm <= 0 || z.length_cm <= 0) return acc;
          const c = stripLenForZone(z.width_cm, z.length_cm);
          return { total140: acc.total140 + c.total140, total110: acc.total110 + c.total110 };
        }, { total140: 0, total110: 0 });
        setReq(r);
      }
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
              <div className="mt-2 space-y-3">
                {survey.photos.map((p, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={photoUrl(p)} alt={`survey-${i}`} className="w-full max-h-[70vh] object-contain rounded-lg border bg-slate-50 print:max-h-none print:h-auto print:break-after-page" />
                ))}
              </div>
            )}
          </section>
        )}

        {pick && ((pick.newItems && pick.newItems.length > 0) || (pick.remnants && pick.remnants.length > 0) || req) && (
          <section>
            <h2 className="text-sm font-semibold text-slate-700 mb-1">ใบสั่งงาน — ของที่ต้องหยิบ</h2>
            {req && (
              <p className="text-sm mb-2">📐 ความยาวแผ่นที่ห้องต้องใช้ (อ้างอิงโซน): หน้ากว้าง 140 = <b>{req.total140.toLocaleString()}</b> ซม. · หน้ากว้าง 110 = <b>{req.total110.toLocaleString()}</b> ซม.</p>
            )}
            {pick.newItems && pick.newItems.length > 0 && (
              <div className="mb-2">
                <p className="text-xs font-semibold text-slate-600 mb-1">🆕 ของใหม่ที่ต้องเบิก</p>
                <table className="w-full text-sm border-collapse">
                  <thead><tr className="text-left text-slate-500 border-b"><th className="py-1 pr-2">หน้ากว้าง</th><th className="py-1 pr-2">ยาว (ซม.)</th><th className="py-1 pr-2">จำนวน</th><th className="py-1">หมายเหตุ</th></tr></thead>
                  <tbody>
                    {pick.newItems.map((it, i) => (
                      <tr key={i} className="border-b last:border-0"><td className="py-1 pr-2">{it.width} ซม.</td><td className="py-1 pr-2">{it.length_cm || "—"}</td><td className="py-1 pr-2">{it.qty || "—"}</td><td className="py-1">{it.note || "—"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pick.remnants && pick.remnants.length > 0 && (
              <div className="mb-2">
                <p className="text-xs font-semibold text-slate-600 mb-1">♻️ เศษที่ให้หยิบไปใช้</p>
                <table className="w-full text-sm border-collapse">
                  <thead><tr className="text-left text-slate-500 border-b"><th className="py-1 pr-2">ชนิด</th><th className="py-1 pr-2">กว้าง</th><th className="py-1">ยาว (ซม.)</th></tr></thead>
                  <tbody>
                    {pick.remnants.map((it, i) => (
                      <tr key={i} className="border-b last:border-0"><td className="py-1 pr-2">{it.mat_type || "—"}</td><td className="py-1 pr-2">{it.width_bin || "—"}</td><td className="py-1">{it.length_cm || "—"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pick.note && <p className="text-sm whitespace-pre-wrap">📝 {pick.note}</p>}
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
