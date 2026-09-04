"use client";

import { useEffect, useState } from "react";
import { dismissErrorPopup, subscribeErrorPopup, type ErrorPopupState } from "@/lib/notify-error";

/**
 * Mounted once in app/(admin)/layout.tsx. Renders whatever notifyError(...)
 * (lib/notify-error.ts) last pushed -- every RPC/API error across the app
 * now surfaces here instead of a toast, per the 2026-09-04 decision to make
 * all error notifications a popup. Success messages still use sonner's
 * toast.success(...) unchanged.
 */
export default function ErrorPopupHost({ isAdmin }: { isAdmin: boolean }) {
  const [state, setState] = useState<ErrorPopupState | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => subscribeErrorPopup((next) => { setState(next); setShowDetail(false); }), []);

  if (!state) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="เกิดข้อผิดพลาด"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-5"
      onMouseDown={(event) => { if (event.target === event.currentTarget) dismissErrorPopup(); }}
    >
      <section className="w-full max-w-md rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <header className="flex items-start gap-3 border-b border-red-100 bg-red-50 px-5 py-4">
          <span className="text-2xl" aria-hidden>⚠️</span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700">{state.title}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-red-950">{state.message}</p>
          </div>
        </header>
        {isAdmin && state.detail ? (
          <div className="border-b border-slate-100 px-5 py-3">
            {showDetail ? (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{state.detail}</pre>
            ) : null}
            <button type="button" onClick={() => setShowDetail((value) => !value)} className="mt-2 text-xs font-medium text-slate-500 underline underline-offset-2">
              {showDetail ? "ซ่อนรายละเอียด" : "ดูรายละเอียด (สำหรับผู้ดูแลระบบ)"}
            </button>
          </div>
        ) : null}
        <footer className="flex justify-end gap-2 px-5 py-3">
          <button type="button" onClick={() => dismissErrorPopup()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">ปิด</button>
        </footer>
      </section>
    </div>
  );
}
