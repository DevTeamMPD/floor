type LendiSkeletonProps = {
  label?: string;
  cards?: number;
  compact?: boolean;
};

/** Branded, accessible placeholder used while a page is fetching its first data set. */
export default function LendiSkeleton({ label = "กำลังโหลดข้อมูล…", cards = 4, compact = false }: LendiSkeletonProps) {
  return (
    <section aria-busy="true" aria-live="polite" className={`overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm ${compact ? "p-4" : "p-5 sm:p-6"}`}>
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-950 p-1.5">
          <img src="/lendi-engineering-logo.png" alt="" className="h-full w-full object-contain" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">LENDI Engineering</p>
          <p className="text-xs text-slate-500">{label}</p>
        </div>
      </div>
      <div className={`mt-5 grid gap-3 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
        {Array.from({ length: cards }).map((_, index) => (
          <div key={index} className="animate-pulse rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="h-3 w-2/5 rounded bg-slate-200" />
            <div className="mt-3 h-5 w-4/5 rounded bg-slate-200" />
            <div className="mt-2 h-3 w-3/5 rounded bg-slate-100" />
            <div className="mt-4 h-9 rounded-lg bg-blue-100/70" />
          </div>
        ))}
      </div>
    </section>
  );
}
