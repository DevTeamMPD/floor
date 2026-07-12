"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/pipeline",   icon: "📌", label: "Pipeline" },
  { href: "/jobs",       icon: "💼", label: "งานทั้งหมด" },
  { href: "/queue",     icon: "🕑", label: "คิวงาน" },
  { href: "/service",   icon: "🛠", label: "บริการ" },
  { href: "/inventory", icon: "📦", label: "คลังวัสดุ" },
  { href: "/bom",       icon: "📐", label: "BOQ / BOM" },
  { href: "/purchase-orders", icon: "🛒", label: "ใบสั่งซื้อ" },
  { href: "/documents", icon: "📄", label: "เอกสาร" },
  { href: "/docs",      icon: "📖", label: "คู่มือ" },
];

export default function Sidebar() {
  const path = usePathname();
  return (
    <aside
      className="fixed left-0 top-0 h-screen w-[252px] flex flex-col"
      style={{ background: "#0B1120" }}
    >
      <div className="px-5 pt-6 pb-4">
        <div className="text-white font-bold text-lg tracking-tight">🏛 MPD Workspace</div>
        <div className="text-slate-400 text-xs mt-0.5">ระบบติดตามงานติดตั้ง</div>
      </div>
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        {NAV.map((n) => {
          const active = path === n.href || path.startsWith(n.href + "/");
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active
                  ? "bg-blue-600 text-white font-medium"
                  : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <span>{n.icon}</span>
              <span>{n.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-4 border-t border-white/10">
        <div className="text-slate-500 text-xs">บริษัท มีภูมิดี จำกัด</div>
      </div>
    </aside>
  );
}
