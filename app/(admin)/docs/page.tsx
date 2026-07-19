"use client";
import { useState } from "react";
import Link from "next/link";

const SECTIONS = [
  { id: "overview",    icon: "🏛",  title: "ภาพรวมระบบ" },
  { id: "pipeline",    icon: "📌", title: "Pipeline — ติดตามงาน" },
  { id: "waste-cost",  icon: "♻️", title: "ต้นทุนเศษ" },
  { id: "remnants",    icon: "✂️", title: "เศษวัสดุ" },
  { id: "inventory",   icon: "📦", title: "คลังวัสดุ" },
  { id: "boq",         icon: "📐", title: "BOQ / BOM" },
  { id: "tips",        icon: "💡", title: "เคล็ดลับ & FAQ" },
];

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="flex-none w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center mt-0.5">{n}</div>
      <div className="text-gray-700 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 border-l-4 border-amber-400 px-4 py-3 rounded-r-lg text-sm text-amber-800">
      <span className="font-semibold">⚠️ หมายเหตุ: </span>{children}
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-green-50 border-l-4 border-green-400 px-4 py-3 rounded-r-lg text-sm text-green-800">
      <span className="font-semibold">💡 เคล็ดลับ: </span>{children}
    </div>
  );
}

function SectionCard({ id, icon, title, children }: { id: string; icon: string; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div id={id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-2xl">{icon}</span>
        <span className="font-bold text-gray-900 text-lg flex-1">{title}</span>
        <span className="text-gray-400 text-sm">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-6 pb-6 space-y-4 border-t border-gray-100 pt-4">{children}</div>}
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5 sticky top-0 z-10 shadow-sm">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <span className="text-2xl">📖</span>
          <div>
            <h1 className="text-xl font-bold text-gray-900">คู่มือการใช้งาน</h1>
            <p className="text-xs text-gray-500">Floor Management System — MPD Group</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

        {/* Table of contents */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">สารบัญ</p>
          <div className="grid grid-cols-2 gap-y-2 gap-x-4">
            {SECTIONS.map(s => (
              <a key={s.id} href={`#${s.id}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                <span>{s.icon}</span><span>{s.title}</span>
              </a>
            ))}
          </div>
        </div>

        {/* ─── 1. Overview ─── */}
        <SectionCard id="overview" icon="🏛" title="ภาพรวมระบบ">
          <p className="text-sm text-gray-600 leading-relaxed">
            <strong>MPD Floor Management System</strong> คือระบบบริหารจัดการงานติดตั้งพื้น สำหรับทีม Sales, PM, และช่างติดตั้ง
            ครอบคลุมตั้งแต่รับงาน → จัดคิว → ส่งของ → ติดตั้ง → ปิดงาน
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { icon: "📌", label: "Pipeline", desc: "ติดตามสถานะงาน" },
              { icon: "♻️", label: "ต้นทุนเศษ", desc: "วิเคราะห์วัสดุที่เสีย" },
              { icon: "✂️", label: "เศษวัสดุ", desc: "จัดการสต็อกเศษ" },
              { icon: "📦", label: "คลังวัสดุ", desc: "เช็กสต็อก" },
              { icon: "📐", label: "BOQ/BOM", desc: "คำนวณวัสดุ" },
              { icon: "📅", label: "นัดหมาย", desc: "จัดตารางเวลา" },
            ].map(item => (
              <div key={item.label} className="bg-gray-50 rounded-lg px-3 py-3">
                <div className="text-lg">{item.icon}</div>
                <div className="font-semibold text-gray-800 text-sm mt-1">{item.label}</div>
                <div className="text-xs text-gray-500">{item.desc}</div>
              </div>
            ))}
          </div>
          <Note>ระบบนี้ออกแบบสำหรับ Chrome / Edge บน Desktop เป็นหลัก หากใช้มือถือบางฟีเจอร์อาจแสดงผลต่างกัน</Note>
        </SectionCard>

        {/* ─── 2. Pipeline ─── */}
        <SectionCard id="pipeline" icon="📌" title="Pipeline — ติดตามงาน">
          <p className="text-sm text-gray-600">Board แสดงงานทั้งหมดแยกตาม Stage (ขั้นตอน) — ลาก Card ข้าม Stage ได้เลย</p>
          <div className="space-y-3">
            <Step n={1}>เปิดเมนู <strong>Pipeline</strong> ในแถบซ้าย</Step>
            <Step n={2}>คลิก Card งานเพื่อดูรายละเอียด หรือกด <strong>+ สร้างงาน</strong> ที่มุมขวาบน</Step>
            <Step n={3}>กรอกข้อมูล: เลขบิล, ชื่อลูกค้า, ประเภทงาน, ที่อยู่</Step>
            <Step n={4}>ลาก Card ไปยัง Stage ถัดไปเมื่องานคืบหน้า</Step>
            <Step n={5}>คลิก Card → Tab <strong>ปิดงาน</strong> เพื่อบันทึก Handover Data (จำนวนม้วน, ขนาดพื้นที่ ฯลฯ)</Step>
          </div>
          <Tip>การกรอก Handover Data ที่ Tab ปิดงาน จะ sync ข้อมูลให้หน้า ต้นทุนเศษ โดยอัตโนมัติ — ไม่ต้องกรอกซ้ำ</Tip>
          <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm">
            <p className="font-semibold text-gray-700 mb-2">Stage ในระบบ</p>
            <div className="flex flex-wrap gap-2">
              {["📥 รับงาน", "📋 รอวัสดุ", "🚚 จัดส่ง", "🔨 กำลังติดตั้ง", "✅ เสร็จสิ้น", "❌ ยกเลิก"].map(s => (
                <span key={s} className="bg-white border border-gray-200 rounded-full px-3 py-1 text-xs">{s}</span>
              ))}
            </div>
          </div>
        </SectionCard>

        {/* ─── 3. Waste Cost ─── */}
        <SectionCard id="waste-cost" icon="♻️" title="ต้นทุนเศษ (Waste Cost)">
          <p className="text-sm text-gray-600">คำนวณพื้นที่จริงที่ปูได้, วัสดุที่เสีย, และต้นทุนรวมต่องาน</p>

          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-700">ขั้นตอนการใช้งาน</p>
            <Step n={1}>เปิดเมนู <strong>ต้นทุนเศษ</strong></Step>
            <Step n={2}>พิมพ์ <strong>เลขบิล</strong> ในช่องค้นหา → ระบบดึงข้อมูล Handover จากงานนั้น</Step>
            <Step n={3}>กด <strong>+ เพิ่ม Zone</strong> เพื่อเพิ่มพื้นที่ย่อย (เช่น ห้องนอน, ห้องนั่งเล่น)</Step>
            <Step n={4}>กรอกชื่อ Zone, ความกว้าง, ความยาว (หน่วย ซม.)</Step>
            <Step n={5}>คลิกไอคอน <strong>ตาราง (🔲)</strong> เพื่อเปิด Grid Editor ของ Zone นั้น</Step>
          </div>

          <div className="bg-blue-50 rounded-lg px-4 py-4 space-y-3 border border-blue-100">
            <p className="text-sm font-bold text-blue-900">🔲 Grid Editor — วิธีใช้</p>
            <div className="space-y-2">
              <Step n={1}>เลือกขนาดช่อง: <strong>25 / 50 / 100 ซม.</strong> (ค่าเริ่มต้น 50 ซม.)</Step>
              <Step n={2}>
                <div>
                  <strong>คลิกช่องสีเทา</strong> เพื่อตั้งขนาดเฉพาะช่องนั้น (กว้าง × ยาว ซม.)<br/>
                  <span className="text-xs text-gray-500 mt-0.5 block">ช่องที่ตั้งขนาดแล้วจะเปลี่ยนเป็น สีฟ้า และแสดง W×L</span>
                </div>
              </Step>
              <Step n={3}>
                <div>
                  <strong>คลิกช่องสีส้ม (ขวาง)</strong> เพื่อยกเลิกการขวาง<br/>
                  <strong>ปุ่ม 🚫 ขวาง</strong> ใน panel → ทำเครื่องหมายว่าช่องนั้นไม่มีพื้นที่ปู (เสา, ผนัง ฯลฯ)
                </div>
              </Step>
              <Step n={4}>กด <strong>💾 บันทึก</strong> — ระบบจะคำนวณพื้นที่สุทธิใหม่ทันที</Step>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <div className="bg-white rounded p-2 text-center text-xs border border-gray-200">
                <div className="w-5 h-5 bg-gray-200 rounded mx-auto mb-1"/>
                <span className="text-gray-600">ช่องปกติ</span>
              </div>
              <div className="bg-white rounded p-2 text-center text-xs border border-blue-200">
                <div className="w-5 h-5 bg-blue-100 border border-blue-300 rounded mx-auto mb-1 flex items-center justify-center text-blue-600" style={{fontSize:8}}>50<br/>50</div>
                <span className="text-blue-600">กำหนดขนาดแล้ว</span>
              </div>
              <div className="bg-white rounded p-2 text-center text-xs border border-orange-200">
                <div className="w-5 h-5 bg-orange-400 rounded mx-auto mb-1 flex items-center justify-center text-white font-bold" style={{fontSize:10}}>×</div>
                <span className="text-orange-600">ขวาง / ไม่ปู</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-700">สูตรคำนวณ</p>
            <div className="bg-gray-50 rounded-lg px-4 py-3 font-mono text-xs text-gray-700 space-y-1">
              <div>พื้นที่ Zone = กว้าง × ยาว</div>
              <div>พื้นที่สุทธิ = ผลรวม (W × L) ของทุกช่องที่ไม่ขวาง</div>
              <div>เศษวัสดุ = ม้วนที่ใช้ × ขนาดม้วน − พื้นที่สุทธิรวม</div>
              <div>ต้นทุนเศษ = เศษวัสดุ (ตร.ม.) × ราคาต่อ ตร.ม.</div>
            </div>
          </div>

          <Tip>หากพื้นที่ zone มีเสากลาง ให้ตีช่องที่เสาอยู่เป็น 🚫 ขวาง เพื่อหักออกจากพื้นที่คำนวณ</Tip>
          <Note>การบันทึก Grid จะบันทึกลง Supabase ทันที ไม่จำเป็นต้องกด Save หลักของหน้า</Note>
        </SectionCard>

        {/* ─── 4. Remnants ─── */}
        <SectionCard id="remnants" icon="✂️" title="เศษวัสดุ (Remnant Stock)">
          <p className="text-sm text-gray-600">จัดการสต็อกเศษพื้นที่เหลือจากงาน เพื่อนำไปใช้ในงานอื่นที่เหมาะสม</p>
          <div className="space-y-3">
            <Step n={1}>เปิดเมนู <strong>เศษวัสดุ</strong></Step>
            <Step n={2}>กด <strong>+ รับเศษ</strong> → กรอก กว้าง (cm), ยาว (cm), ประเภท (16B/16W/6B/6W), งานต้นทาง</Step>
            <Step n={3}>เศษที่รับเข้าจะแสดงใน Dashboard แยกตาม width bin (30–140 ซม.)</Step>
            <Step n={4}>เมื่อนำเศษไปใช้งาน → กด <strong>ใช้แล้ว</strong> เพื่ออัปเดตสถานะ</Step>
          </div>
          <div className="bg-gray-50 rounded-lg px-4 py-3 space-y-2">
            <p className="text-sm font-semibold text-gray-700">Width Bin คืออะไร?</p>
            <p className="text-xs text-gray-600">ระบบจัดกลุ่มเศษตามความกว้าง (cm) เพื่อให้ค้นหาง่ายว่ามีเศษขนาดใดบ้างที่จะใช้แทนม้วนเต็มได้</p>
            <div className="flex flex-wrap gap-1">
              {[30,40,50,60,70,80,90,100,110,120,130,140].map(w => (
                <span key={w} className="bg-white border border-gray-300 text-xs rounded px-2 py-0.5">{w}+</span>
              ))}
            </div>
          </div>
          <Tip>ในหน้า ต้นทุนเศษ มีกล่อง <strong>💡 เศษที่ใช้แทนได้</strong> แสดงเศษที่กว้างพอสำหรับแต่ละ Zone โดยอัตโนมัติ</Tip>
        </SectionCard>

        {/* ─── 5. Inventory ─── */}
        <SectionCard id="inventory" icon="📦" title="คลังวัสดุ">
          <p className="text-sm text-gray-600">ดูสต็อกวัสดุคงเหลือ, บันทึกการเบิก/รับของ</p>
          <div className="space-y-3">
            <Step n={1}>เปิดเมนู <strong>คลังวัสดุ</strong></Step>
            <Step n={2}>ค้นหาสินค้าด้วย SKU หรือชื่อ</Step>
            <Step n={3}>กด <strong>เบิกออก</strong> → ระบุจำนวนและงานที่เบิกเพื่อ</Step>
            <Step n={4}>กด <strong>รับเข้า</strong> → ระบุจำนวนที่รับเพิ่ม</Step>
          </div>
          <Note>การเบิกออกแต่ละครั้งจะบันทึกเป็น Movement History — ดูประวัติได้ที่แต่ละ SKU</Note>
        </SectionCard>

        {/* ─── 6. BOQ ─── */}
        <SectionCard id="boq" icon="📐" title="BOQ / BOM">
          <p className="text-sm text-gray-600">คำนวณปริมาณวัสดุที่ต้องใช้ตาม spec ของงาน</p>
          <div className="space-y-3">
            <Step n={1}>เปิดเมนู <strong>BOQ / BOM</strong></Step>
            <Step n={2}>เลือกงานหรือสร้าง BOQ ใหม่</Step>
            <Step n={3}>ระบุพื้นที่แต่ละ Zone และประเภทวัสดุ</Step>
            <Step n={4}>ระบบคำนวณจำนวนม้วน, กาว, และวัสดุเสริมอื่นๆ โดยอัตโนมัติ</Step>
          </div>
        </SectionCard>

        {/* ─── 7. Tips & FAQ ─── */}
        <SectionCard id="tips" icon="💡" title="เคล็ดลับ & FAQ">
          <div className="space-y-4">
            {[
              {
                q: "ข้อมูลใน ต้นทุนเศษ ไม่แสดงทั้งที่ปิดงานแล้ว?",
                a: "ตรวจสอบว่ากรอก Handover Data ครบใน Tab ปิดงานของ Card หรือยัง โดยเฉพาะจำนวนม้วนและขนาดพื้นที่"
              },
              {
                q: "พื้นที่สุทธิคำนวณแล้วมากกว่าพื้นที่ Zone?",
                a: "เกิดจาก cell_cm ทำให้จำนวนช่อง × ขนาดช่อง > พื้นที่จริง ให้ตั้งขนาดช่อง (W×L) ในแต่ละช่องให้ตรงกับพื้นที่จริง"
              },
              {
                q: "จะ Reset กริดทั้งหมดทำอย่างไร?",
                a: "กดปุ่ม 🗑 ล้างทั้งหมด ใต้กริด — ช่องทั้งหมดจะกลับเป็นค่าเริ่มต้น"
              },
              {
                q: "เศษที่ Reserve ไปแล้วจะหายไปจากหน้า Remnants หรือเปล่า?",
                a: "ยังแสดงอยู่ แต่ status เปลี่ยนเป็น 'reserved' พร้อมชื่องานที่จอง กด ใช้แล้ว เมื่อใช้งานจริง"
              },
              {
                q: "เพิ่ม Zone ใน ต้นทุนเศษ ไม่ได้?",
                a: "ตรวจสอบว่าเลือกเลขบิลแล้ว และ user มีสิทธิ์เขียนใน Supabase (ตรวจสอบกับ Admin)"
              },
            ].map(({ q, a }) => (
              <div key={q} className="border-b border-gray-100 pb-4 last:border-0 last:pb-0">
                <p className="text-sm font-semibold text-gray-800 mb-1">❓ {q}</p>
                <p className="text-sm text-gray-600">→ {a}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 pb-8">
          <p>MPD Floor Management System — อัปเดตล่าสุด กรกฎาคม 2569</p>
          <p className="mt-1">พบปัญหา? แจ้งทีม Dev ได้เลย</p>
        </div>

      </div>
    </div>
  );
}
