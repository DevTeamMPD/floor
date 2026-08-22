import Image from "next/image";

interface BbpsWorkOrder {
  id?: string;
  seq?: number;
  start?: string | null;
  end?: string | null;
  install_start?: string | null;
  install_end?: string | null;
  location_address?: string | null;
  location_map_link?: string | null;
  task_details?: string | null;
  task_ball_pit?: string | null;
  task_workshop_set?: string | null;
  task_gym?: string | null;
  task_floor?: string | null;
  task_other?: string | null;
  manpower?: string | null;
  materials?: string | null;
  constraint_access_time?: string | null;
  constraint_logistics?: string | null;
  constraint_work_area?: string | null;
  constraint_obstacles?: string | null;
  constraint_ground?: string | null;
  constraint_utilities?: string | null;
  constraint_noise_dust?: string | null;
  constraint_weather?: string | null;
  constraint_site_authority?: string | null;
  acceptance_criteria?: string | null;
  acceptance_photos?: string | null;
  acceptance_quality_check?: string | null;
  acceptance_documents?: string | null;
  acceptance_signoff?: string | null;
  acceptance_followup?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  design_images?: string[] | null;
  site_photos?: string[] | null;
}

const TASKS: [keyof BbpsWorkOrder, string][] = [
  ["task_floor", "งานพื้น (Floor)"],
  ["task_details", "รายละเอียดงานรวม"],
  ["task_ball_pit", "บ้านบอล"],
  ["task_workshop_set", "Workshop set"],
  ["task_gym", "Gym"],
  ["task_other", "งานอื่น ๆ"],
];

const CONSTRAINTS: [keyof BbpsWorkOrder, string][] = [
  ["constraint_access_time", "เวลาเข้าไซต์"],
  ["constraint_logistics", "ทางเข้าและการขนของ"],
  ["constraint_work_area", "พื้นที่ทำงาน/พักวัสดุ"],
  ["constraint_obstacles", "สิ่งกีดขวาง"],
  ["constraint_ground", "สภาพพื้นเดิม"],
  ["constraint_utilities", "ระบบไฟฟ้า/น้ำ"],
  ["constraint_noise_dust", "ข้อจำกัดเสียง/ฝุ่น"],
  ["constraint_weather", "สภาพอากาศ"],
  ["constraint_site_authority", "ผู้อนุมัติพื้นที่"],
];

const ACCEPTANCE: [keyof BbpsWorkOrder, string][] = [
  ["acceptance_criteria", "เกณฑ์ตรวจรับรวม"],
  ["acceptance_photos", "ภาพที่ต้องถ่าย"],
  ["acceptance_quality_check", "รายการตรวจคุณภาพ"],
  ["acceptance_documents", "เอกสารที่ต้องส่งมอบ"],
  ["acceptance_signoff", "ผู้ตรวจรับ/ผู้เซ็น"],
  ["acceptance_followup", "เงื่อนไขแก้ไข/Punch list"],
];

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rowsOf(order: BbpsWorkOrder, fields: [keyof BbpsWorkOrder, string][]) {
  return fields.flatMap(([key, label]) => {
    const value = textValue(order[key]);
    return value ? [{ key, label, value }] : [];
  });
}

function fmtDate(date: string | null | undefined) {
  if (!date) return null;
  return new Date(`${date.slice(0, 10)}T00:00:00`).toLocaleDateString("th-TH", {
    day: "numeric", month: "long", year: "numeric",
  });
}

function workOrdersOf(rawPayload: unknown): BbpsWorkOrder[] {
  if (!rawPayload || typeof rawPayload !== "object") return [];
  const rows = (rawPayload as { workOrders?: unknown }).workOrders;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is BbpsWorkOrder => !!row && typeof row === "object");
}

function DetailRows({ rows }: { rows: { key: keyof BbpsWorkOrder; label: string; value: string }[] }) {
  if (!rows.length) return null;
  return <div className="grid gap-3 sm:grid-cols-2">
    {rows.map((row) => <div key={row.key}>
      <div className="text-xs text-slate-400">{row.label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{row.value}</div>
    </div>)}
  </div>;
}

export default function BbpsWorkOrderDetails({ rawPayload }: { rawPayload: unknown }) {
  const orders = workOrdersOf(rawPayload);
  if (!orders.length) return null;

  return <section className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 sm:p-5 md:col-span-2">
    <div className="mb-4 flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-indigo-950">📄 ใบสั่งงาน BBPS</h3>
      <span className="rounded-full bg-white px-2.5 py-1 text-xs text-indigo-700">{orders.length} ใบ</span>
    </div>

    <div className="space-y-4">
      {orders.map((order, index) => {
        const tasks = rowsOf(order, TASKS);
        const constraints = rowsOf(order, CONSTRAINTS);
        const acceptance = rowsOf(order, ACCEPTANCE);
        const photos = [
          ...((order.design_images ?? []).map((url) => ({ url, label: "ภาพ 3D ดีไซน์" }))),
          ...((order.site_photos ?? []).map((url) => ({ url, label: "ภาพหน้างาน" }))),
        ].filter((photo) => typeof photo.url === "string" && photo.url.startsWith("http"));
        const start = fmtDate(order.install_start || order.start);
        const end = fmtDate(order.install_end || order.end);

        return <article key={order.id || `${order.seq ?? index + 1}`} className="rounded-xl border border-indigo-200 bg-white p-4 sm:p-5">
          <h4 className="text-base font-semibold text-indigo-900">ใบสั่งงานครั้งที่ {order.seq ?? index + 1}</h4>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div><div className="text-xs text-slate-400">ระยะเวลาดำเนินงาน</div><div className="mt-1 text-sm font-medium text-slate-800">{start || "—"}{end && end !== start ? ` – ${end}` : ""}</div></div>
            <div><div className="text-xs text-slate-400">กำลังคน/ผู้รับผิดชอบ</div><div className="mt-1 whitespace-pre-wrap text-sm font-medium text-slate-800">{order.manpower || "—"}</div></div>
            <div className="sm:col-span-2"><div className="text-xs text-slate-400">สถานที่</div><div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{order.location_address || "—"}</div>{order.location_map_link && <a href={order.location_map_link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100">📍 เปิดแผนที่จากใบสั่งงาน</a>}</div>
            {(order.contact_name || order.contact_phone) && <div className="sm:col-span-2"><div className="text-xs text-slate-400">ผู้ติดต่อหน้าไซต์</div><div className="mt-1 text-sm text-slate-800">{order.contact_name || "—"}{order.contact_phone && <> · <a href={`tel:${order.contact_phone}`} className="text-blue-600 hover:underline">{order.contact_phone}</a></>}</div></div>}
          </div>

          {tasks.length > 0 && <div className="mt-5 border-t border-slate-100 pt-4"><h5 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">รายละเอียดงานที่ต้องทำ</h5><DetailRows rows={tasks} /></div>}
          {order.materials && <div className="mt-5 border-t border-slate-100 pt-4"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">วัสดุและอุปกรณ์</div><div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{order.materials}</div></div>}
          {constraints.length > 0 && <div className="mt-5 border-t border-slate-100 pt-4"><h5 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">ข้อจำกัดของสถานที่</h5><DetailRows rows={constraints} /></div>}
          {acceptance.length > 0 && <div className="mt-5 border-t border-slate-100 pt-4"><h5 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">เกณฑ์ตรวจรับงาน</h5><DetailRows rows={acceptance} /></div>}

          {photos.length > 0 && <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">ภาพแนบ ({photos.length} รูป)</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {photos.map((photo, photoIndex) => <a key={`${photo.url}-${photoIndex}`} href={photo.url} target="_blank" rel="noopener noreferrer" className="group relative aspect-video overflow-hidden rounded-xl border border-indigo-200 bg-slate-100">
                <Image src={photo.url} alt={`${photo.label} ${photoIndex + 1}`} fill unoptimized sizes="(max-width: 640px) 50vw, 240px" className="object-cover transition group-hover:scale-105" />
                <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">{photo.label}</span>
              </a>)}
            </div>
          </div>}
        </article>;
      })}
    </div>
  </section>;
}
