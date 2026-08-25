import Link from "next/link";
import { getCurrentStaff } from "@/lib/staff-server";
import { ROLE_LABELS, type StaffRole } from "@/lib/staff";

const ACTIONS: Array<{ href: string; icon: string; title: string; desc: string; actors: StaffRole[]; adminOnly?: boolean }> = [
  { href: "/operations", icon: "📥", title: "งานที่ต้องตัดสินใจ", desc: "ทุกฝ่ายดูสถานะได้ · หัวหน้าช่างเป็นผู้ตัดสินใจและจ่ายงาน", actors: ["admin", "head_technician"] },
  { href: "/warehouse", icon: "📦", title: "เตรียมสินค้าที่คลัง", desc: "ทุกฝ่ายดูความพร้อมได้ · คลังรับงาน บันทึกจำนวนและรูปหลักฐาน", actors: ["admin", "warehouse"] },
  { href: "/sales-queue", icon: "🗓️", title: "จองคิวฝ่ายขาย", desc: "ทุกฝ่ายดูคิวได้ · ฝ่ายขายสร้างและแก้ไขตั๋วขายตรง", actors: ["admin", "sales"] },
  { href: "/appointments", icon: "📅", title: "ปฏิทินทีม", desc: "ดูคิวและผู้รับผิดชอบร่วมกัน · หัวหน้าช่างจัดทีม", actors: ["admin", "head_technician"] },
  { href: "/cs-tracking", icon: "📞", title: "CS รอติดตาม", desc: "ทุกฝ่ายดูผลได้ · CS บันทึกการติดตามและปิดงาน", actors: ["admin", "cs"] },
  { href: "/exec", icon: "📈", title: "ภาพรวมผู้บริหาร", desc: "ข้อมูลภาพรวมงานติดตั้งและจุดติดขัดของทุกฝ่าย", actors: ["admin", "executive"] },
  { href: "/staff", icon: "👥", title: "บัญชีพนักงาน", desc: "ตรวจการเชื่อม HR Master และกำหนดข้อยกเว้น", actors: ["admin"], adminOnly: true },
];

export default async function HomePage() {
  const staff = await getCurrentStaff();
  return <div className="mx-auto max-w-6xl">
    <div className="rounded-3xl bg-gradient-to-br from-slate-950 to-blue-950 p-6 text-white sm:p-8">
      <div className="text-sm text-blue-200">สวัสดี {staff?.full_name}</div>
      <h1 className="mt-2 text-2xl font-bold sm:text-3xl">FloorNow Operations</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">พนักงานทุกฝ่ายเห็นข้อมูลงานชุดเดียวกัน ส่วนปุ่มดำเนินงานเปิดตามหน้าที่เพื่อป้องกันการเปลี่ยนสถานะผิดฝ่าย</p>
    </div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {ACTIONS.filter((item) => !item.adminOnly || staff?.role === "admin").map((item) => <Link key={item.href} href={item.href} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
        <div className="text-2xl">{item.icon}</div><h2 className="mt-3 font-semibold text-slate-950">{item.title}</h2><p className="mt-1 text-sm leading-relaxed text-slate-500">{item.desc}</p>
        <div className="mt-3 text-[11px] font-medium text-blue-700">ผู้ดำเนินงาน: {item.actors.map((role) => ROLE_LABELS[role]).join(" · ")}</div>
      </Link>)}
    </div>
  </div>;
}
