import Link from "next/link";
import { ACCESS_DENIED_TITLE } from "@/lib/page-access";
import { ROLE_LABELS, type StaffRole } from "@/lib/staff";

/**
 * หน้าที่คนถูกปฏิเสธจะเห็น — ต้องเป็นหน้าที่อ่านรู้เรื่อง ไม่ใช่จอขาว ไม่ใช่วงกลมหมุนค้าง
 * และต้องบอกด้วยว่า "ต้องเป็นตำแหน่งไหนถึงเข้าได้" เพื่อให้คนรู้ว่าจะไปขอสิทธิ์กับใคร
 */
export default function AccessDenied({
  pathname,
  role,
  allowedRoles,
}: {
  pathname: string;
  role: StaffRole;
  allowedRoles: StaffRole[];
}) {
  const allowedLabels = allowedRoles.map((item) => ROLE_LABELS[item]).join(" · ");
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <div className="text-5xl" aria-hidden>🔒</div>
      <h1 className="mt-4 text-xl font-bold text-slate-900">{ACCESS_DENIED_TITLE}</h1>
      <p className="mt-2 text-sm text-slate-600">
        บัญชีของคุณอยู่ในตำแหน่ง <span className="font-medium text-slate-900">{ROLE_LABELS[role]}</span>{" "}
        ซึ่งไม่ได้รับสิทธิ์เข้าหน้า <span className="font-mono text-slate-700">{pathname}</span>
      </p>
      {allowedRoles.length ? (
        <p className="mt-3 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
          หน้านี้เปิดให้ตำแหน่ง: <span className="font-medium">{allowedLabels}</span>
        </p>
      ) : null}
      <p className="mt-3 text-xs text-slate-500">
        ถ้าคุณต้องใช้หน้านี้ในการทำงาน กรุณาแจ้งผู้ดูแลระบบเพื่อปรับตำแหน่งของบัญชี
      </p>
      <Link
        href="/home"
        className="mt-6 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        กลับไปหน้าแรก
      </Link>
    </div>
  );
}
