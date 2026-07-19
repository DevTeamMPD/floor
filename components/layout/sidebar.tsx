"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/pipeline",        icon: "📌", label: "Pipeline" },
  { href: "/jobs",            icon: "💼", label: "งานทั้งหมด" },
  { href: "/queue",           icon: "🕑", label: "คิวงาน" },
  { href: "/service",         icon: "🛠", label: "บริการ" },
  { href: "/inventory",       icon: "📦", label: "คลังวัสดุ" },
  { href: "/waste-cost",      icon: "♻️", label: "ต้นทุนเศษ" },
  { href: "/remnants",        icon: "✂️", label: "เศษวัสดุ" },
  { href: "/bom",             icon: "📐", label: "BOQ / BOM" },
  { href: "/purchase-orders", icon: "🛒", label: "ใบสั่งซื้อ" },
  { href: "/appointments",    icon: "📅", label: "นัดหมาย" },
  { href: "/documents",       icon: "📄", label: "เอกสาร" },
  { href: "/ncr",             icon: "🔴", label: "NCR" },
  { href: "/docs",            icon: "📖", label: "คู่มือ" },
];

// 5 most-used items for mobile bottom nav
const BOTTOM_NAV = [
  { href: "/pipeline",     icon: "📌", label: "Pipeline" },
  { href: "/queue",        icon: "🕑", label: "คิวงาน" },
  { href: "/appointments", icon: "📅", label: "นัดหมาย" },
  { href: "/documents",    icon: "📄", label: "เอกสาร" },
];

export default function Sidebar() {
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      {/* ── DESKTOP: Fixed left sidebar ──────────────────────────────── */}
      <aside
        className="hidden md:flex fixed left-0 top-0 h-screen w-[252px] flex-col"
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

      {/* ── MOBILE: Top header bar ────────────────────────────────────── */}
      <header
        className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14"
        style={{ background: "#0B1120" }}
      >
        <span className="text-white font-bold text-base tracking-tight">🏛 MPD Workspace</span>
        <button
          onClick={() => setMenuOpen(true)}
          className="text-white p-2 rounded-lg hover:bg-white/10 active:bg-white/20 transition-colors"
          aria-label="เมนู"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </header>

      {/* ── MOBILE: Slide-out full menu overlay ──────────────────────── */}
      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 flex"
          onClick={() => setMenuOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative z-10 flex flex-col h-full w-72 shadow-2xl"
            style={{ background: "#0B1120" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-4">
              <div>
                <div className="text-white font-bold text-lg tracking-tight">🏛 MPD Workspace</div>
                <div className="text-slate-400 text-xs mt-0.5">ระบบติดตามงานติดตั้ง</div>
              </div>
              <button
                onClick={() => setMenuOpen(false)}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                aria-label="ปิด"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto pb-4">
              {NAV.map((n) => {
                const active = path === n.href || path.startsWith(n.href + "/");
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${
                      active
                        ? "bg-blue-600 text-white font-medium"
                        : "text-slate-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <span className="text-lg">{n.icon}</span>
                    <span>{n.label}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="px-4 py-4 border-t border-white/10">
              <div className="text-slate-500 text-xs">บริษัท มีภูมิดี จำกัด</div>
            </div>
          </div>
        </div>
      )}

      {/* ── MOBILE: Bottom navigation bar ────────────────────────────── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex border-t border-slate-200 bg-white"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {BOTTOM_NAV.map((n) => {
          const active = path === n.href || path.startsWith(n.href + "/");
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs transition-colors ${
                active ? "text-blue-600" : "text-slate-500"
              }`}
            >
              <span className="text-xl leading-none">{n.icon}</span>
              <span className="font-medium">{n.label}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setMenuOpen(true)}
          className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs text-slate-500"
        >
          <span className="text-xl leading-none">☰</span>
          <span className="font-medium">เพิ่มเติม</span>
        </button>
      </nav>
    </>
  );
}
