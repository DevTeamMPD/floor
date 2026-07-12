export default function DocsPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold mb-2">คู่มือการใช้งาน</h1>
      <p className="text-slate-500 mb-8">ระบบจัดการงานติดตั้งพื้น — คู่มือฉบับย่อสำหรับทีม</p>

      <Section id="overview" title="ภาพรวมระบบ">
        <p>
          ระบบนี้ใช้ติดตามงานติดตั้งพื้นตั้งแต่รับออเดอร์จนถึงปิดงานและรับประเมิน
          ทุกงานจะผ่าน <strong>7 สเตจ</strong> ตามลำดับ โดยทีมสามารถดูสถานะ
          อัปเดตความคืบหน้า และปิดงานได้จากระบบนี้ทั้งหมด
        </p>
      </Section>

      <Section id="stages" title="7 สเตจของงาน">
        <div className="space-y-2">
          {[
            ["1", "📥", "รับออเดอร์", "ออเดอร์เข้ามาจากช่องทางต่าง ๆ (Shopee, Lazada, Manual ฯลฯ)"],
            ["2", "📞", "ติดต่อลูกค้า", "โทรหาลูกค้าเพื่อนัดหมาย ตรวจสอบที่อยู่ และรายละเอียดงาน"],
            ["3", "📅", "ยืนยันนัดหมาย", "ยืนยันวันนัดหมายกับลูกค้า และบันทึกในระบบ"],
            ["4", "🔧", "เตรียมงาน", "เตรียมวัสดุ เครื่องมือ และทีมช่างให้พร้อม"],
            ["5", "🚧", "ระหว่างติดตั้ง", "ทีมช่างกำลังดำเนินการติดตั้งในสถานที่ลูกค้า"],
            ["6", "🔍", "ตรวจสอบงาน", "ตรวจสอบคุณภาพและความเรียบร้อยก่อนส่งมอบ"],
            ["7", "✅", "เสร็จสิ้น", "ปิดงานแล้ว — รอรับคะแนนประเมินจากลูกค้า"],
          ].map(([num, icon, name, desc]) => (
            <div key={num} className="flex gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-500 shrink-0">
                {num}
              </div>
              <div>
                <div className="font-medium text-sm">{icon} {name}</div>
                <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="pipeline" title="Pipeline — บอร์ดงาน">
        <p>
          หน้า <strong>Pipeline</strong> แสดงงานทั้งหมดในรูปแบบ Kanban Board
          แบ่งเป็นคอลัมน์ตามสเตจ คลิกการ์ดงานเพื่อดูรายละเอียด อัปเดตสถานะ
          หรือเลื่อนสเตจ
        </p>
        <ul className="mt-3 space-y-1.5 text-sm">
          <Li>ค้นหาและกรองงานด้วยแถบค้นหาด้านบน</Li>
          <Li>คลิก <Chip>+ สร้างงานใหม่</Chip> เพื่อเปิดฟอร์มสร้างออเดอร์</Li>
          <Li>คลิกการ์ดงานเพื่อเปิด Drawer รายละเอียด</Li>
          <Li>ใน Drawer แท็บ <Chip>สเตจ</Chip> กดปุ่ม <Chip>เลื่อนสเตจ →</Chip> เพื่ออัปเดตความคืบหน้า</Li>
        </ul>
      </Section>

      <Section id="close" title="การปิดงาน">
        <p>
          เมื่องานถึงสเตจ 6 (ตรวจสอบงาน) สามารถปิดงานได้จาก Drawer
          แท็บ <strong>ปิดงาน</strong>
        </p>
        <ul className="mt-3 space-y-1.5 text-sm">
          <Li>คลิก <Chip>ปิดงาน</Chip> — ระบบจะตั้งค่างานเป็นสเตจ 7 โดยอัตโนมัติ</Li>
          <Li>ระบบสร้าง <strong>ลิงก์ประเมิน</strong> (Eval Token) ให้อัตโนมัติ</Li>
          <Li>ลิงก์จะถูกคัดลอกไปยัง Clipboard — ส่งให้ลูกค้าทาง LINE หรือ SMS</Li>
          <Li>ลูกค้าให้คะแนน 1–5 ดาวผ่านหน้า <strong>/eval</strong> (ไม่ต้อง login)</Li>
          <Li>คะแนนจะแสดงใน Overview และหน้างานทั้งหมด</Li>
        </ul>
      </Section>

      <Section id="queue" title="คิวงาน">
        <p>
          หน้า <strong>คิวงาน</strong> แสดงงาน Active (สเตจ 2–6) จัดกลุ่มตามความเร่งด่วน:
        </p>
        <ul className="mt-3 space-y-1.5 text-sm">
          <Li><Chip warn>เกินกำหนด</Chip> — งานที่ due date ผ่านไปแล้วและยังไม่เสร็จ</Li>
          <Li><Chip>วันนี้</Chip> — งานที่ครบกำหนดวันนี้</Li>
          <Li><Chip>กำลังมา</Chip> — งานที่ยังไม่ถึง due date หรือยังไม่ได้กำหนด</Li>
        </ul>
      </Section>

      <Section id="service" title="บริการ — SKU Watch">
        <p>
          หน้า <strong>บริการ</strong> แสดงรายการ SKU สินค้าที่อยู่ในระบบ watch list
          พร้อมจำนวนงานที่เกี่ยวข้อง ใช้ตรวจสอบว่าสินค้าแต่ละรุ่นมีงานค้างเท่าไหร่
        </p>
      </Section>

      <Section id="documents" title="เอกสาร">
        <p>
          หน้า <strong>เอกสาร</strong> รวบรวมงานทั้งหมดในรูปแบบเอกสาร:
        </p>
        <ul className="mt-3 space-y-1.5 text-sm">
          <Li><strong>ใบสั่งงาน</strong> — สำหรับงาน Active (สเตจ 1–6)</Li>
          <Li><strong>ใบส่งงาน</strong> — สำหรับงานที่เสร็จสิ้น (สเตจ 7)</Li>
          <Li>คลิก <Chip>ดูเอกสาร</Chip> และกด 🖨️ พิมพ์ เพื่อพิมพ์เอกสาร</Li>
        </ul>
      </Section>

      <Section id="faq" title="คำถามที่พบบ่อย">
        <div className="space-y-4">
          <Faq q="จะสร้างงานใหม่ได้อย่างไร?">
            ไปที่หน้า <strong>Pipeline</strong> แล้วกดปุ่ม <Chip>+ สร้างงานใหม่</Chip>
            กรอกข้อมูลลูกค้า สินค้า และช่องทาง จากนั้นกด <Chip>สร้าง</Chip>
          </Faq>
          <Faq q="ลิงก์ประเมินหายไป ส่งใหม่ได้ไหม?">
            ยังไม่มีฟีเจอร์ส่งลิงก์ใหม่โดยตรง แนะนำให้ติดต่อ Dev Team เพื่อดึง eval_token จากฐานข้อมูล
            แล้วสร้าง URL ในรูปแบบ <code className="bg-slate-100 px-1 rounded text-xs">/eval?token=TOKEN</code>
          </Faq>
          <Faq q="งานอยู่ที่สเตจไหนดูได้จากที่ไหน?">
            ดูได้จาก Pipeline Board (มุมมอง Kanban), หน้างานทั้งหมด (ตาราง), และ Overview (สรุปตัวเลข)
          </Faq>
          <Faq q="ข้อมูลในระบบ sync มาจากไหน?">
            งานสามารถสร้างได้ด้วยตนเองผ่านระบบ (Manual) หรือ import ผ่าน JST/Shopee/Lazada ตามที่ตั้งค่าไว้ใน order_source
          </Faq>
        </div>
      </Section>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-10">
      <h2 className="text-base font-semibold text-slate-800 mb-3 pb-2 border-b border-slate-100">
        {title}
      </h2>
      <div className="text-sm text-slate-600 leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-slate-300 mt-0.5">•</span>
      <span>{children}</span>
    </li>
  );
}

function Chip({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
      warn ? "bg-red-100 text-red-700" : "bg-blue-50 text-blue-700 border border-blue-100"
    }`}>
      {children}
    </span>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
      <div className="font-medium text-slate-800 mb-1.5">Q: {q}</div>
      <div className="text-slate-600">{children}</div>
    </div>
  );
}
