export default function Loading() {
  return <main className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-50 via-white to-blue-50 px-6 text-center">
    <div className="w-full max-w-sm animate-pulse rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-xl shadow-slate-200/60">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/lendi-engineering-logo.png" alt="LENDI Engineering" className="mx-auto h-36 w-36 object-contain" />
      <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900">LENDI Engineering</h1>
      <p className="mt-2 text-sm font-medium text-slate-600">Your Trusted Partner in Technical Solutions.</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">พันธมิตรที่ได้รับความไว้วางใจในทุกโซลูชันเทคนิค</p>
      <div className="mx-auto mt-6 h-1.5 w-44 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-2/3 animate-[pulse_1s_ease-in-out_infinite] rounded-full bg-blue-700" /></div>
      <p className="mt-3 text-xs text-slate-400">กำลังเตรียมระบบให้พร้อมใช้งาน…</p>
    </div>
  </main>;
}
