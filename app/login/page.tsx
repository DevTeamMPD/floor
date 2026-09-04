"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { pinLoginEmail } from "@/lib/pin-auth";

export default function LoginPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "pin" | "activate">("login");
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [pinUsername, setPinUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLocalPreview, setIsLocalPreview] = useState(false);

  useEffect(() => {
    setIsLocalPreview(["localhost", "127.0.0.1"].includes(window.location.hostname));
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
    if (mode === "login" || mode === "pin") {
      const isLocalWarehouseDemo = mode === "pin" && ["localhost", "127.0.0.1"].includes(window.location.hostname) && pinUsername.trim().toLowerCase() === "warehouse-demo" && password === "123456";
      if (isLocalWarehouseDemo) {
        document.cookie = "floor_local_warehouse_pin=1; path=/; SameSite=Lax";
        router.replace("/warehouse?demo=1");
        router.refresh();
        setBusy(false);
        return;
      }
      const signInEmail = mode === "pin" ? pinLoginEmail(pinUsername) : email.trim();
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email: signInEmail, password });
      if (signInError) setError(mode === "pin" ? "ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง" : "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
      else {
        if (mode === "login") {
          const { error: activationError } = await supabase.rpc("activate_floor_staff_account");
          if (activationError) {
            await supabase.auth.signOut();
            setError(activationError.message.includes("active HR employee") ? "ไม่พบบัญชีพนักงาน Active/Probation ที่เชื่อมกับอีเมลนี้ กรุณาติดต่อผู้ดูแลระบบ" : "บัญชีนี้ยังไม่พร้อมใช้งาน LENDI Engineering");
            setBusy(false);
            return;
          }
        }
        const { data: profile } = await supabase.from("floor_staff_profiles").select("is_active,access_scope").eq("id", signInData.user.id).maybeSingle();
        if (!profile?.is_active) {
          await supabase.auth.signOut();
          setError("บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ");
          setBusy(false);
          return;
        }
        const next = new URLSearchParams(window.location.search).get("next");
        router.replace(profile.access_scope === "warehouse_prep_only" ? "/warehouse" : next?.startsWith("/") ? next : "/");
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

  return <main className="grid min-h-screen place-items-center bg-gradient-to-br from-[#1f242a] via-[#0f385d] to-[#06315c] px-4 py-10">
    <div className="w-full max-w-md rounded-[28px] border border-white/70 bg-white p-6 shadow-2xl shadow-black/35 sm:p-8">
      <div className="border-b border-slate-200 pb-5 text-center"><img src="/lendi-engineering-logo.png" alt="LENDI Engineering" className="mx-auto h-32 w-52 object-contain mix-blend-multiply" /><h1 className="mt-2 text-2xl font-bold tracking-tight text-[#303237]">LENDI Engineering</h1><p className="mt-2 text-sm font-semibold text-[#064B8E]">Your Trusted Partner in Technical Solutions.</p><p className="mt-1 text-xs text-slate-500">พันธมิตรที่ได้รับความไว้วางใจในทุกโซลูชันเทคนิค</p></div>

      <div className="mt-6 grid grid-cols-3 rounded-xl bg-slate-100 p-1">
        <button onClick={() => setMode("login")} className={`rounded-lg px-3 py-2 text-sm font-medium ${mode === "login" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>เข้าสู่ระบบ</button>
        <button onClick={() => { setMode("pin"); setPassword(""); }} className={`rounded-lg px-3 py-2 text-sm font-medium ${mode === "pin" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>คลัง / PIN</button>
        <button onClick={() => setMode("activate")} className={`rounded-lg px-3 py-2 text-sm font-medium ${mode === "activate" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{needsBootstrap ? "ตั้งค่า Admin" : "เปิดใช้ครั้งแรก"}</button>
      </div>

      <form onSubmit={submit} className="mt-5 space-y-4">
        {mode === "pin" && isLocalPreview ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><div className="font-semibold">บัญชี Demo ทีมคลัง</div><div className="mt-1">ชื่อผู้ใช้: <code>warehouse-demo</code> · PIN: <code>123456</code></div></div> : null}
        {mode === "activate" ? <div>
          <label className="text-sm font-medium text-slate-700">ชื่อพนักงาน</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500" placeholder="ชื่อที่แสดงในระบบ" />
        </div> : null}
        {mode === "pin" ? <div>
          <label className="text-sm font-medium text-slate-700">ชื่อผู้ใช้ทีมคลัง</label>
          <input value={pinUsername} onChange={(e) => setPinUsername(e.target.value.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 32))} required autoComplete="username" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500" placeholder="เช่น warehouse01" />
        </div> : <div>
          <label className="text-sm font-medium text-slate-700">อีเมล</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500" placeholder="name@company.com" />
        </div>}
        <div>
          <label className="text-sm font-medium text-slate-700">{mode === "pin" ? "PIN 6 หลัก" : "รหัสผ่าน"}</label>
          <input type="password" inputMode={mode === "pin" ? "numeric" : undefined} value={password} onChange={(e) => setPassword(mode === "pin" ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value)} required minLength={mode === "pin" ? 6 : 8} maxLength={mode === "pin" ? 6 : undefined} autoComplete={mode === "activate" ? "new-password" : "current-password"} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500" placeholder={mode === "pin" ? "••••••" : "อย่างน้อย 8 ตัวอักษร"} />
        </div>
        {error ? <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        {message ? <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}
        <button disabled={busy} className="w-full rounded-xl bg-[#064B8E] px-4 py-3 font-semibold text-white hover:bg-[#003967] disabled:opacity-50">{busy ? "กำลังดำเนินการ…" : mode === "login" ? "เข้าสู่ระบบ LENDI" : mode === "pin" ? "เข้าหน้าเตรียมสินค้า" : needsBootstrap ? "สร้างบัญชี Admin คนแรก" : "เปิดใช้บัญชีที่ได้รับเชิญ"}</button>
      </form>
      <p className="mt-5 text-center text-xs leading-relaxed text-slate-400">พนักงาน Active/Probation ที่มีบัญชีเชื่อมกับ HR Master เข้าใช้งานได้ทันที ส่วนปุ่มดำเนินงานจะเปิดตามหน้าที่รับผิดชอบ</p>
    </div>
  </main>;
}
