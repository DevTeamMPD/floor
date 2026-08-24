"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "activate">("login");
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("get_floor_staff_bootstrap_status").then(({ data }) => {
      const bootstrap = Boolean((data as { needsBootstrap?: boolean } | null)?.needsBootstrap);
      setNeedsBootstrap(bootstrap);
      if (bootstrap) setMode("activate");
    });
  }, [supabase]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    if (mode === "login") {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) setError("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
      else {
        const { error: activationError } = await supabase.rpc("activate_floor_staff_account");
        if (activationError) {
          await supabase.auth.signOut();
          setError(activationError.message.includes("active HR employee") ? "ไม่พบบัญชีพนักงาน Active/Probation ที่เชื่อมกับอีเมลนี้ กรุณาติดต่อผู้ดูแลระบบ" : "บัญชีนี้ยังไม่พร้อมใช้งาน FloorNow");
          setBusy(false);
          return;
        }
        const next = new URLSearchParams(window.location.search).get("next");
        router.replace(next?.startsWith("/") ? next : "/");
        router.refresh();
      }
    } else {
      if (password.length < 8) {
        setError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
        setBusy(false);
        return;
      }
      const callback = `${window.location.origin}/auth/callback`;
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: fullName.trim() }, emailRedirectTo: callback },
      });
      if (signUpError) setError(signUpError.message.includes("invited") ? "อีเมลนี้ยังไม่ได้รับเชิญจากผู้ดูแลระบบ" : signUpError.message);
      else if (data.session) {
        const { error: activationError } = await supabase.rpc("activate_floor_staff_account");
        if (activationError) {
          await supabase.auth.signOut();
          setError(activationError.message.includes("active HR employee") ? "ไม่พบบัญชีพนักงาน Active/Probation ที่เชื่อมกับอีเมลนี้ กรุณาติดต่อผู้ดูแลระบบ" : activationError.message);
          setBusy(false);
          return;
        }
        router.replace("/");
        router.refresh();
      } else {
        setMessage("สร้างบัญชีแล้ว กรุณาเปิดอีเมลยืนยันก่อนเข้าสู่ระบบ");
        setMode("login");
      }
    }
    setBusy(false);
  }

  return <main className="min-h-screen bg-slate-950 px-4 py-10 grid place-items-center">
    <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">MPD Group</div>
      <h1 className="mt-2 text-2xl font-bold text-slate-950">FloorNow</h1>
      <p className="mt-1 text-sm text-slate-500">ศูนย์กลางข้อมูลงานติดตั้งสำหรับพนักงานทุกฝ่าย</p>

      <div className="mt-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
        <button onClick={() => setMode("login")} className={`rounded-lg px-3 py-2 text-sm font-medium ${mode === "login" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>เข้าสู่ระบบ</button>
        <button onClick={() => setMode("activate")} className={`rounded-lg px-3 py-2 text-sm font-medium ${mode === "activate" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{needsBootstrap ? "ตั้งค่า Admin" : "เปิดใช้ครั้งแรก"}</button>
      </div>

      <form onSubmit={submit} className="mt-5 space-y-4">
        {mode === "activate" ? <div>
          <label className="text-sm font-medium text-slate-700">ชื่อพนักงาน</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500" placeholder="ชื่อที่แสดงในระบบ" />
        </div> : null}
        <div>
          <label className="text-sm font-medium text-slate-700">อีเมล</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500" placeholder="name@company.com" />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700">รหัสผ่าน</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500" placeholder="อย่างน้อย 8 ตัวอักษร" />
        </div>
        {error ? <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        {message ? <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}
        <button disabled={busy} className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? "กำลังดำเนินการ…" : mode === "login" ? "เข้าสู่ FloorNow" : needsBootstrap ? "สร้างบัญชี Admin คนแรก" : "เปิดใช้บัญชีที่ได้รับเชิญ"}</button>
      </form>
      <p className="mt-5 text-center text-xs leading-relaxed text-slate-400">พนักงาน Active/Probation ที่มีบัญชีเชื่อมกับ HR Master เข้าใช้งานได้ทันที ส่วนปุ่มดำเนินงานจะเปิดตามหน้าที่รับผิดชอบ</p>
    </div>
  </main>;
}
