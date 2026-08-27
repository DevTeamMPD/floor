type Tone = "slate" | "blue" | "green" | "amber" | "red" | "orange" | "purple";

const TONE: Record<Tone, string> = {
  slate:  "bg-slate-100 text-slate-700",
  blue:   "bg-blue-100 text-blue-700",
  green:  "bg-emerald-100 text-emerald-700",
  amber:  "bg-amber-100 text-amber-700",
  red:    "bg-red-100 text-red-700",
  orange: "bg-orange-100 text-orange-700",
  purple: "bg-purple-100 text-purple-700",
};

/** ป้ายสถานะมาตรฐาน — ขนาดตัวอักษรขั้นต่ำ 12px (text-xs) เพื่อให้อ่านได้บนมือถือกลางแดด
 *  ห้ามเขียน pill เองในหน้าใหม่ ให้ใช้ตัวนี้ */
export function Badge({ tone = "slate", children, className = "" }: {
  tone?: Tone; children: React.ReactNode; className?: string;
}) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${TONE[tone]} ${className}`}>
      {children}
    </span>
  );
}
