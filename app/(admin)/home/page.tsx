import Link from "next/link";
import { getCurrentStaff } from "@/lib/staff-server";

const ACTIONS = [
  { href: "/operations", icon: "📥", title: "งานที่ต้องตัดสินใจ", desc: "ตรวจข้อมูล ยืนยันคิว จ่ายช่าง และปล่อยใบงาน" },
  { href: "/warehouse", icon: "📦", title: "เตรียมสินค้าที่คลัง", desc: "รับใบสั่งงาน บันทึกจำนวนหยิบจริงและรูปหลักฐาน" },
  { href: "/sales-queue", icon: "🗓️", title: "จองคิวฝ่ายขาย", desc: "ดูคิวและสร้างงานขายตรง" },
  { href: "/appointments", icon: "📅", title: "ปฏิทินทีม", desc: "ดูคิวทั้งหมดและจัดทีมช่าง" },
  { href: "/cs-tracking", icon: "📞", title: "CS รอติดตาม", desc: "ติดตามลูกค้าหลังติดตั้ง" },
  { href: "/exec", icon: "📈", title: "ภาพรวมผู้บริหาร", desc: "ดูผลงานและงานติดขัด" },
  { href: "/staff", icon: "👥", title: "บัญชีพนักงาน", desc: "เชิญพนักงานและกำหนดบทบาท" },
];

export default async function HomePage() {
  const staff = await getCurrentStaff();
  return <div className="mx-auto max-w-6xl">
    <div className="rounded-3xl bg-gradient-to-br from-slate-950 to-blue-950 p-6 text-white sm:p-8">
      <div className="text-sm text-blue-200">สวัสดี {staff?.full_name}</div>
      <h1 className="mt-2 text-2xl font-bold sm:text-3xl">FloorNow Operations</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">เลือกงานที่ต้องทำ ระบบจะแสดงเฉพาะขั้นตอนและข้อมูลของบทบาทนั้น</p>
    </div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {ACTIONS.map((item) => <Link key={item.href} href={item.href} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
        <div className="text-2xl">{item.icon}</div><h2 className="mt-3 font-semibold text-slate-950">{item.title}</h2><p className="mt-1 text-sm leading-relaxed text-slate-500">{item.desc}</p>
      </Link>)}
    </div>
  </div>;
}
