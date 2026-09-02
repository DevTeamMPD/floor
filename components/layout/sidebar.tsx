"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABELS, type StaffProfile, type StaffRole } from "@/lib/staff";

interface NavItem { href: string; icon: string; label: string; roles: StaffRole[] }

const CORE_NAV: NavItem[] = [
  { href: "/home", icon: "🏠", label: "หน้าแรก", roles: ["admin"] },
  { href: "/sales-queue", icon: "🗓️", label: "จองคิว", roles: ["admin", "sales"] },
  { href: "/tech-queue", icon: "👷", label: "คิวทีมช่าง", roles: ["admin", "sales"] },
  { href: "/operations", icon: "📥", label: "ต้องตัดสินใจ", roles: ["admin", "head_technician"] },
  { href: "/orders", icon: "📋", label: "ใบสั่งงาน", roles: ["admin", "sales", "head_technician", "warehouse"] },
  { href: "/warehouse", icon: "📦", label: "เตรียมสินค้า", roles: ["admin", "warehouse"] },
  { href: "/appointments", icon: "📅", label: "ปฏิทินทีม", roles: ["admin", "head_technician"] },
  { href: "/document-control", icon: "🗂️", label: "ศูนย์เอกสาร", roles: ["admin", "head_technician", "cs"] },
  { href: "/technicians", icon: "🔑", label: "ทีมช่าง / PIN", roles: ["admin", "head_technician"] },
  { href: "/remnants", icon: "✂️", label: "ตรวจรับเศษ", roles: ["admin", "warehouse"] },
  { href: "/cs-tracking", icon: "📞", label: "CS รอติดตาม", roles: ["admin", "cs"] },
  { href: "/csat-automation", icon: "✨", label: "CSAT อัตโนมัติ", roles: ["admin", "cs"] },
  { href: "/after-sales", icon: "🛟", label: "บริการหลังการขาย", roles: ["admin", "cs", "head_technician"] },
  { href: "/dashboard", icon: "⭐", label: "คุณภาพและความพึงพอใจ", roles: ["admin", "cs", "executive"] },
  { href: "/quality-review", icon: "📊", label: "ทบทวนคุณภาพ", roles: ["admin", "cs", "head_technician", "executive"] },
  { href: "/exec", icon: "📈", label: "ภาพรวมผู้บริหาร", roles: ["admin", "executive"] },
  { href: "/docs", icon: "📘", label: "คู่มือการทำงาน", roles: ["admin"] },
  { href: "/staff", icon: "👥", label: "บัญชีพนักงาน", roles: ["admin"] },
];

const EXPERIMENTAL_NAV: NavItem[] = [
  { href: "/pipeline", icon: "📌", label: "Pipeline แบบเดิม", roles: ["admin", "head_technician"] },
  { href: "/service", icon: "🛠", label: "บริการ / SKU", roles: ["admin"] },
  { href: "/inventory", icon: "📦", label: "คลังวัสดุ", roles: ["admin", "warehouse"] },
  { href: "/waste-cost", icon: "♻️", label: "ต้นทุนเศษ", roles: ["admin", "warehouse"] },
  { href: "/bom", icon: "📐", label: "BOQ / BOM", roles: ["admin", "warehouse"] },
  { href: "/purchase-orders", icon: "🛒", label: "ใบสั่งซื้อ", roles: ["admin", "warehouse"] },
  { href: "/documents", icon: "📄", label: "เอกสารแบบเดิม", roles: ["admin"] },
  { href: "/ncr", icon: "🔴", label: "NCR", roles: ["admin", "head_technician"] },
];

const MOBILE_NAV_BY_ROLE: Partial<Record<StaffRole, string[]>> = {
  sales: ["/sales-queue", "/orders", "/tech-queue", "/appointments"],
  head_technician: ["/operations", "/orders", "/appointments", "/tech-queue"],
  warehouse: ["/warehouse", "/orders", "/remnants", "/appointments"],
};
const DEFAULT_MOBILE_NAV = ["/home", "/operations", "/orders", "/appointments"];

function NavLink({ item, active, onClick }: { item: NavItem; active: boolean; onClick?: () => void }) {
  return <Link href={item.href} onClick={onClick} prefetch={false} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${active ? "bg-blue-600 font-medium text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}>
    <span>{item.icon}</span><span>{item.label}</span>
  </Link>;
}

export default function Sidebar({ staff }: { staff: StaffProfile }) {
  const path = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  // ทุกฝ่ายเห็นข้อมูลและหน้าปฏิบัติงานชุดเดียวกัน; ยกเว้นการจัดการบัญชีพนักงาน
  // ซึ่งเป็นการตั้งค่าระบบและยังต้องเป็น Admin-only.
  const canSee = useMemo(() => (item: NavItem) => item.href !== "/staff" || staff.role === "admin", [staff.role]);
  const core = useMemo(() => CORE_NAV.filter(canSee), [canSee]);
  const experimental = useMemo(() => EXPERIMENTAL_NAV.filter(canSee), [canSee]);
  const mobile = useMemo(() => {
    const destinations = MOBILE_NAV_BY_ROLE[staff.role] ?? DEFAULT_MOBILE_NAV;
    return destinations.map((href) => [...core, ...experimental].find((item) => item.href === href)).filter((item): item is NavItem => Boolean(item));
  }, [core, experimental, staff.role]);

  function active(item: NavItem) { return path === item.href || path.startsWith(item.href + "/"); }
  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const navigation = <>
    <nav className="space-y-1">{core.map((item) => <NavLink key={item.href} item={item} active={active(item)} onClick={() => setMenuOpen(false)} />)}</nav>
    {experimental.length ? <div className="mt-5 border-t border-white/10 pt-4">
      <button onClick={() => setToolsOpen((value) => !value)} className="flex min-h-11 w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium text-slate-400 hover:bg-white/5 hover:text-white"><span>เครื่องมือเสริม / ระบบเดิม</span><span>{toolsOpen ? "−" : "+"}</span></button>
      {toolsOpen ? <nav className="mt-1 space-y-1">{experimental.map((item) => <NavLink key={item.href} item={item} active={active(item)} onClick={() => setMenuOpen(false)} />)}</nav> : null}
    </div> : null}
  </>;

  const profile = <div className="border-t border-white/10 px-4 py-4">
    <div className="truncate text-sm font-medium text-white">{staff.full_name}</div>
    <div className="mt-0.5 text-xs text-slate-400">{ROLE_LABELS[staff.role]}</div>
    <button onClick={signOut} className="mt-3 text-xs text-slate-400 hover:text-white">ออกจากระบบ</button>
  </div>;

  return <>
    <aside className="fixed left-0 top-0 hidden h-screen w-[252px] flex-col bg-slate-950 md:flex">
      <div className="px-5 pb-4 pt-5"><div className="flex items-center gap-2"><img src="/lendi-engineering-logo.png" alt="LENDI Engineering" className="h-10 w-10 rounded-lg bg-white object-contain p-0.5" /><div><div className="text-base font-bold tracking-tight text-white">LENDI Engineering</div><div className="mt-0.5 text-[10px] text-slate-400">Technical Solutions</div></div></div></div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">{navigation}</div>{profile}
    </aside>
    <header className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-between bg-slate-950 px-4 md:hidden">
      <div className="flex items-center gap-2"><img src="/lendi-engineering-logo.png" alt="LENDI" className="h-8 w-8 rounded bg-white object-contain p-0.5" /><div><div className="font-bold text-white">LENDI Engineering</div><div className="text-[10px] text-slate-400">{ROLE_LABELS[staff.role]}</div></div></div>
      <button onClick={() => setMenuOpen(true)} aria-label="เมนู" className="rounded-lg p-2 text-white hover:bg-white/10">☰</button>
    </header>
    {menuOpen ? <div className="fixed inset-0 z-50 flex md:hidden" onClick={() => setMenuOpen(false)}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative z-10 flex h-full w-80 max-w-[88vw] flex-col bg-slate-950 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pb-4 pt-5"><div className="flex items-center gap-2"><img src="/lendi-engineering-logo.png" alt="LENDI" className="h-10 w-10 rounded-lg bg-white object-contain p-0.5" /><div><div className="text-lg font-bold text-white">LENDI Engineering</div><div className="text-xs text-slate-400">Your Trusted Partner in Technical Solutions.</div></div></div><button onClick={() => setMenuOpen(false)} className="p-2 text-slate-300">×</button></div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">{navigation}</div>{profile}
      </div>
    </div> : null}
    <nav aria-label="เมนูด่วนสำหรับมือถือ" className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-slate-200 bg-white shadow-[0_-4px_18px_rgba(15,23,42,0.08)] md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {mobile.map((item) => <Link key={item.href} href={item.href} prefetch={false} className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] ${active(item) ? "bg-blue-50 text-blue-700" : "text-slate-500"}`}><span className="text-lg leading-none">{item.icon}</span><span className="max-w-20 truncate font-medium">{item.label}</span></Link>)}
      <button onClick={() => setMenuOpen(true)} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-slate-500"><span className="text-lg leading-none">☰</span><span className="font-medium">เพิ่มเติม</span></button>
    </nav>
  </>;
}
