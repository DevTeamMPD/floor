type AccentKey =
  | "blue" | "indigo" | "amber" | "orange" | "purple" | "green" | "teal" | "pink" | "slate";

const ACCENTS: Record<AccentKey, { dot: string; soft: string; border: string; text: string; ring: string }> = {
  blue:   { dot: "bg-blue-500",   soft: "bg-blue-50",   border: "border-blue-200",   text: "text-blue-700",   ring: "hover:ring-blue-200" },
  indigo: { dot: "bg-indigo-500", soft: "bg-indigo-50", border: "border-indigo-200", text: "text-indigo-700", ring: "hover:ring-indigo-200" },
  amber:  { dot: "bg-amber-500",  soft: "bg-amber-50",  border: "border-amber-200",  text: "text-amber-700",  ring: "hover:ring-amber-200" },
  orange: { dot: "bg-orange-500", soft: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", ring: "hover:ring-orange-200" },
  purple: { dot: "bg-purple-500", soft: "bg-purple-50", border: "border-purple-200", text: "text-purple-700", ring: "hover:ring-purple-200" },
  green:  { dot: "bg-green-500",  soft: "bg-green-50",  border: "border-green-200",  text: "text-green-700",  ring: "hover:ring-green-200" },
  teal:   { dot: "bg-teal-500",   soft: "bg-teal-50",   border: "border-teal-200",   text: "text-teal-700",   ring: "hover:ring-teal-200" },
  pink:   { dot: "bg-pink-500",   soft: "bg-pink-50",   border: "border-pink-200",   text: "text-pink-700",   ring: "hover:ring-pink-200" },
  slate:  { dot: "bg-slate-500",  soft: "bg-slate-50",  border: "border-slate-200",  text: "text-slate-700",  ring: "hover:ring-slate-200" },
};

const DEPARTMENTS: { id: string; step: number; icon: string; name: string; accent: AccentKey }[] = [
  { id: "dept-sales",     step: 1, icon: "🧑‍💼", name: "ฝ่ายขาย",              accent: "blue" },
  { id: "dept-survey",    step: 2, icon: "📐",   name: "ทีมสำรวจหน้างาน",       accent: "indigo" },
  { id: "dept-warehouse", step: 3, icon: "📦",   name: "ฝ่ายคลัง/จัดซื้อ",       accent: "amber" },
  { id: "dept-install",   step: 4, icon: "👷",   name: "ทีมติดตั้งหน้างาน",      accent: "orange" },
  { id: "dept-qc",        step: 5, icon: "🔍",   name: "ฝ่าย QC",              accent: "purple" },
  { id: "dept-close",     step: 6, icon: "✅",   name: "ฝ่ายปิดงาน/แอดมิน",      accent: "green" },
  { id: "dept-waste",     step: 7, icon: "♻️",   name: "ฝ่ายคลัง/บัญชี",        accent: "teal" },
  { id: "dept-schedule",  step: 8, icon: "📅",   name: "ผู้ประสานงานคิวช่าง",    accent: "pink" },
  { id: "dept-customer",  step: 9, icon: "🙋",   name: "ลูกค้า",                accent: "slate" },
];

const STAGES: { num: string; icon: string; name: string; desc: string; linkId: string; accent: AccentKey }[] = [
  { num: "1", icon: "📥", name: "รับออเดอร์",     desc: "ออเดอร์เข้ามาจากช่องทางต่าง ๆ (Shopee, Lazada, Manual ฯลฯ)", linkId: "dept-sales",     accent: "blue" },
  { num: "2", icon: "📞", name: "ติดต่อลูกค้า",   desc: "โทรหาลูกค้าเพื่อนัดหมาย ตรวจสอบที่อยู่ และรายละเอียดงาน",     linkId: "dept-sales",     accent: "blue" },
  { num: "3", icon: "📅", name: "ยืนยันนัดหมาย",  desc: "ยืนยันวันนัดหมายกับลูกค้า และบันทึกในระบบ",                 linkId: "dept-sales",     accent: "blue" },
  { num: "4", icon: "🔧", name: "เตรียมงาน",      desc: "สำรวจหน้างาน เตรียมวัสดุ เครื่องมือ และทีมช่างให้พร้อม",     linkId: "dept-survey",    accent: "indigo" },
  { num: "5", icon: "🚧", name: "ระหว่างติดตั้ง", desc: "ทีมช่างกำลังดำเนินการติดตั้งในสถานที่ลูกค้า",               linkId: "dept-install",   accent: "orange" },
  { num: "6", icon: "🔍", name: "ตรวจสอบงาน",     desc: "ตรวจสอบคุณภาพและความเรียบร้อยก่อนส่งมอบ",                   linkId: "dept-qc",        accent: "purple" },
  { num: "7", icon: "✅", name: "เสร็จสิ้น",       desc: "ปิดงานแล้ว — รอรับคะแนนประเมินจากลูกค้า",                    linkId: "dept-close",     accent: "green" },
];

export default function DocsPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold mb-2">คู่มือการใช้งาน</h1>
      <p className="text-slate-500 mb-5">
        ระบบจัดการงานติดตั้งพื้น — คู่มือฉบับเต็มแยกตามฝ่ายงาน: ต้องทำอะไร และต้องมีข้อมูลอะไรบ้าง
      </p>

      {/* Quick jump nav */}
      <div className="flex flex-wrap gap-1.5 mb-10 p-3 bg-slate-50 border border-slate-100 rounded-xl">
        {DEPARTMENTS.map((d) => {
          const a = ACCENTS[d.accent];
          return (
            
              key={d.id}
              href={`#${d.id}`}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border ${a.soft} ${a.border} ${a.text} transition-transform hover:-translate-y-0.5`}
            >
              <span className={`w-4 h-4 rounded-full ${a.dot} text-white flex items-center justify-center text-[9px] font-bold shrink-0`}>
                {d.step}
              </span>
              {d.icon} {d.name}
            </a>
          );
        })}
      </div>

      <Section id="overview" title="ภาพรวมระบบ">
        <p>
          ระบบนี้ใช้ติดตามงานติดตั้งพื้นตั้งแต่รับออเดอร์จนถึงปิดงานและรับประเมิน
          ทุกงานจะผ่าน <strong>7 สเตจ</strong> ตามลำดับ โดยแต่ละสเตจมีฝ่ายงานที่รับผิดชอบชัดเจน
          และต้องกรอก/แนบข้อมูลเฉพาะของสเตจนั้นก่อนจะเลื่อนไปสเตจถัดไปได้
        </p>
        <p>
          นอกจาก Pipeline (บอร์ดงานหลัก) ระบบยังมีหน้าสนับสนุนงานเบื้องหลังอีก 5 หน้า ได้แก่
          คลังวัสดุ, BOQ/BOM, ใบสั่งซื้อ (PO), เศษวัสดุ และต้นทุนเศษ — ใช้โดยฝ่ายคลัง/จัดซื้อเป็นหลัก
        </p>
      </Section>

      <Section id="stages" title="7 สเตจของงาน">
        <div className="space-y-2">
          {STAGES.map((s) => {
            const a = ACCENTS[s.accent];
            return (
              
                key={s.num}
                href={`#${s.linkId}`}
                className={`flex gap-3 p-3 rounded-xl bg-white border ${a.border} border-l-4 hover:shadow-sm transition-shadow`}
              >
                <div className={`w-7 h-7 rounded-full ${a.dot} text-white flex items-center justify-center text-xs font-bold shrink-0`}>
                  {s.num}
                </div>
                <div>
                  <div className="font-medium text-sm text-slate-800">{s.icon} {s.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{s.desc}</div>
                </div>
              </a>
            );
          })}
        </div>
      </Section>

      <Section id="dept-sales" title="ฝ่ายขาย — รับออเดอร์ / ติดต่อลูกค้า (สเตจ 1–3)" step={1} icon="🧑‍💼" accent="blue">
        <p><strong>ต้องทำอะไร:</strong></p>
        <ul className="mt-1 space-y-1.5 text-sm">
          <Li>เปิดหน้า <Chip>Pipeline</Chip> แล้วกด <Chip>+ สร้างงาน</Chip> ทุกครั้งที่มีออเดอร์ใหม่เข้ามา</Li>
          <Li>โทรหาลูกค้าเพื่อยืนยันตัวตน ที่อยู่ และรายละเอียดงาน (สเตจ 2)</Li>
          <Li>นัดวันและกะเวลาเข้าไปสำรวจ/ติดตั้งกับลูกค้า แล้วบันทึกในแท็บ <Chip>ข้อมูล</Chip> ของการ์ดงาน (สเตจ 3)</Li>
          <Li>กด <Chip>เลื่อนสเตจ</Chip> ในแท็บ <Chip>สเตจ</Chip> เมื่อทำขั้นตอนของตัวเองเสร็จแล้ว</Li>
        </ul>
        <FieldsBox
          accent="blue"
          heading="ข้อมูลที่ต้องกรอกตอนสร้างออเดอร์"
          items={[
            { name: "เลขออเดอร์ (order_no)", note: "ระบบสุ่มให้อัตโนมัติ แก้เองได้" },
            { name: "แหล่งที่มา (order_source)", note: "manual / shopee / lazada / tiktok / jst / web" },
            { name: "SKU และชื่อสินค้า", note: "รุ่น/ลายพื้นที่ลูกค้าสั่ง" },
            { name: "วันที่สั่งซื้อ" },
            { name: "ชื่อลูกค้า และเบอร์โทร", note: "จำเป็น — ห้ามเว้นว่าง" },
            { name: "ที่อยู่ติดตั้ง", note: "จำเป็น" },
            { name: "Google Maps URL", note: "ลิงก์พิกัดหน้างาน ช่วยทีมช่างหาที่ง่ายขึ้น" },
            { name: "กะนัดหมาย / วันที่นัดหมาย", note: "เช้า / บ่าย / ทั้งวัน" },
          ]}
        />
      </Section>

      <Section id="dept-survey" title="ทีมสำรวจหน้างาน — เตรียมงาน (สเตจ 4)" step={2} icon="📐" accent="indigo">
        <p><strong>ต้องทำอะไร:</strong></p>
        <ul className="mt-1 space-y-1.5 text-sm">
          <Li>เข้าไปสำรวจหน้างานตามนัด วัดขนาดพื้นที่แต่ละโซน (ห้องนอน/ห้องนั่งเล่น/โถงทางเดิน/ห้องเลี้ยงสัตว์ ฯลฯ)</Li>
          <Li>บันทึกผลสำรวจในแท็บ <Chip>สำรวจ</Chip> ของการ์ดงาน เพื่อให้ฝ่ายคลังคำนวณวัสดุ (BOM) ได้ถูกต้อง</Li>
          <Li>ถ่ายรูปหน้างานเก็บไว้ในแท็บ <Chip>รูปภาพ</Chip></Li>
        </ul>
        <FieldsBox
          accent="indigo"
          heading="ข้อมูลที่ต้องบันทึกในแท็บสำรวจ"
          items={[
            { name: "ประเภทพื้นที่ + ขนาดแต่ละโซน", note: "กว้างสุด/ยาวสุด (เมตร) ต่อโซน" },
            { name: "ประเภทการตัด", note: "มุมบัว/ประตูเลื่อน, มุมเสา, กำแพงโค้ง, เฟอร์นิเจอร์ติดตาย, แนวกำแพงตรง" },
            { name: "ประเภทการเชื่อม", note: "เชื่อมเย็น (น้ำยาประสาน) / เชื่อมร้อน (เส้นเชื่อม+ไดร์ลมร้อน) / ทั้งสองแบบ" },
            { name: "งานจบขอบ (finish)", note: "บัวผนัง / บัวพื้น-ตัวจบ / ตัวจบลาดเฉียงกันน้ำ" },
            { name: "สภาพพื้น", note: "แห้งสะอาด / มีความชื้น / ต้องเตรียมพื้น" },
            { name: "มีโซนเปียกหรือไม่", note: "เช่น ห้องน้ำ ระเบียง" },
            { name: "พื้นที่ติดตั้งรวม (ตร.ม.)" },
            { name: "หมายเหตุเพิ่มเติม" },
          ]}
        />
      </Section>

      <Section id="dept-warehouse" title="ฝ่ายคลัง / จัดซื้อ — เตรียมวัสดุ (สเตจ 4)" step={3} icon="📦" accent="amber">
        <p><strong>ต้องทำอะไร:</strong></p>
        <ul className="mt-1 space-y-1.5 text-sm">
          <Li>ไปที่หน้า <Chip>BOQ / BOM</Chip> เพื่อคำนวณปริมาณวัสดุจากพื้นที่ที่ทีมสำรวจบันทึกไว้ (ปุ่ม <Chip>จำลอง</Chip>)</Li>
          <Li>เช็คสต็อกที่หน้า <Chip>คลังวัสดุ</Chip> ว่าของพอหรือไม่ ก่อนถึงวันติดตั้ง</Li>
          <Li>ถ้าของไม่พอ เปิดหน้า <Chip>ใบสั่งซื้อ (PO)</Chip> เพื่อสั่งซื้อเพิ่มจาก Supplier</Li>
          <Li>เมื่อของมาส่ง ให้กด <Chip>รับสินค้าเข้าคลัง</Chip> ใน PO เพื่ออัปเดตสต็อก</Li>
          <Li>เบิกวัสดุจ่ายให้ทีมช่างผ่านการ <Chip>จ่ายออก</Chip> ในหน้าคลังวัสดุ พร้อมอ้างอิงเลขงาน</Li>
        </ul>
        <FieldsBox
          accent="amber"
          heading="ข้อมูลที่ต้องมี — BOM"
          items={[
            { name: "รหัส SKU และชื่อ BOM", note: "เช่น SPC-OAK-120" },
            { name: "ประเภท BOM", note: "คิดจากพื้นที่ (ตร.ม.) หรือจากจำนวนชิ้น" },
            { name: "รายการวัสดุต่อหน่วย (BOM Items)", note: "วัสดุ + ปริมาณที่ใช้ต่อ 1 หน่วยพื้นที่/ชิ้น" },
          ]}
        />
        <FieldsBox
          accent="amber"
          heading="ข้อมูลที่ต้องมี — คลังวัสดุ / รับ-จ่าย-ปรับสต็อก"
          items={[
            { name: "ชื่อวัสดุ + หน่วย + ราคาต้นทุนต่อหน่วย (unit_cost)", note: "ต้องตั้งราคาให้ครบ โดยเฉพาะ RS-140/RS-110 มิเช่นนั้นหน้าต้นทุนเศษจะคำนวณไม่ได้" },
            { name: "จำนวนที่รับเข้า/จ่ายออก/ปรับ" },
            { name: "หมายเหตุ + เลขงานอ้างอิง (ref_job_no)", note: "ผูกการเบิกจ่ายกับงานที่ถูกต้อง" },
          ]}
        />
        <FieldsBox
          accent="amber"
          heading="ข้อมูลที่ต้องมี — ใบสั่งซื้อ (PO)"
          items={[
            { name: "Supplier", note: "ชื่อ, เงื่อนไขชำระเงิน เช่น NET30 — เพิ่มครั้งแรกที่ใช้งาน" },
            { name: "รายการวัสดุ + จำนวนที่สั่ง" },
            { name: "การรับสินค้าเข้าคลัง", note: "ยืนยันจำนวนที่ได้รับจริงตอนของมาส่ง" },
          ]}
        />
      </Section>

      <Section id="dept-install" title="ทีมติดตั้งหน้างาน — ระหว่างติดตั้ง (สเตจ 5)" step={4} icon="👷" accent="orange">
        <p><strong>ต้องทำอะไร:</strong></p>
        <ul className="mt-1 space-y-1.5 text-sm">
          <Li>ก่อนเริ่มงาน เปิดแท็บ <Chip>QC</Chip> แล้วติ๊กเช็คลิสต์ก่อนติดตั้ง 5 ข้อให้ครบ</Li>
          <Li>ถ่ายรูปหน้างานก่อน/ระหว่างติดตั้งเก็บไว้ในแท็บ <Chip>รูปภาพ</Chip></Li>
          <Li>ติดตั้งตามผลสำรวจ (ประเภทตัด/เชื่อม/จบขอบ) ที่บันทึกไว้ในแท็บสำรวจ</Li>
          <Li>เมื่อทำเสร็จ กด <Chip>เลื่อนสเตจ</Chip> ไปสเตจ 6 เพื่อส่งต่อฝ่าย QC</Li>
        </ul>
        <FieldsBox
          accent="orange"
          heading="เช็คลิสต์ก่อนติดตั้ง (5 ข้อ ต้องติ๊กครบ)"
          items={[
            { name: "1. จำนวนสินค้า/จำนวนแผ่นครบตามรายการ" },
            { name: "2. สี/รุ่น/ลวดลายตรงตามที่ลูกค้าสั่งซื้อ" },
            { name: "3. สินค้าไม่มีรอยชำรุด แตกหัก หรือเสียหายก่อนติดตั้ง" },
            { name: "4. พื้นที่หน้างานพร้อมสำหรับการติดตั้ง" },
            { name: "5. ลูกค้ารับทราบแนวทาง/รูปแบบการติดตั้ง" },
          ]}
        />
      </Section>

      <Section id="dept-qc" title="ฝ่าย QC — ตรวจสอบงาน (สเตจ 6)" step={5} icon="🔍" accent="purple">
        <p><strong>ต้องทำอะไร:</strong></p>
        <ul className="mt-1 space-y-1.5 text-sm">
          <Li>เปิดแท็บ <Chip>QC</Chip> ตรวจตามเช็คลิสต์คุณภาพ 15 ข้อ พร้อมค่ามาตรฐาน (spec) ที่กำหนดไว้ในแต่ละข้อ</Li>
          <Li>ระบุผลแต่ละข้อเป็น ผ่าน / ไม่ผ่าน / ไม่เกี่ยวข้อง (N/A)</Li>
          <Li>กรอกชื่อผู้ตรวจ และหมายเหตุจุดที่พบปัญหา (ถ้ามี)</Li>
          <Li>ถ้ามีข้อไม่ผ่าน ระบบจะเตือนในแท็บ <Chip>ปิดงาน</Chip> ให้พิจารณาแก้ไขก่อนปิดงาน</Li>
        </ul>
        <FieldsBox
          accent="purple"
          heading="ตัวอย่างหัวข้อตรวจ (จาก 15 ข้อ พร้อมค่ามาตรฐาน)"
          items={[
            { name: "ช่องว่างขอบแผ่นกับผนัง/บัว/เสา/เฟอร์นิเจอร์", note: "ไม่เกิน 1 มม." },
            { name: "รอยต่อชนก่อนเชื่อม", note: "ไม่เกิน 0.3 มม." },
            { name: "ความตรงของแนวตัด", note: "เบี่ยงไม่เกิน 1 มม./1 ม." },
            { name: "ความสมบูรณ์แนวเชื่อม", note: "เต็มแนว เรียบเสมอผิว" },
            { name: "เวลาบ่ม", note: "อย่างน้อย 24 ชม." },
            { name: "โซนเปียก — น้ำไม่ซึมใต้แผ่น", note: "ต้องผ่านการทดสอบ" },
            { name: "ผู้ตรวจ + หมายเหตุ QC", note: "จำเป็นต้องกรอกทุกครั้ง" },
          ]}
        />
      </Section>

      <Section id="dept-close" title="ฝ่ายปิดงาน / แอดมิน — ส่งมอบ-ปิดงาน (สเตจ 7)" step={6} icon="✅" accent="green">
        <p><strong>ต้องทำอะไร:</strong></p>
        <ul className="mt-1 space-y-1.5 text-sm">
          <Li>เปิดแท็บ <Chip>ปิดงาน</Chip> ติ๊กรายการส่งมอบให้ครบ 5 ข้อ</Li>
          <Li>กรอกพื้นที่ติดตั้งจริง และรายการวัสดุที่เบิกใช้จริง (ใช้เท่าไหร่ เหลือเท่าไหร่)</Li>
          <Li>กรอกรายการเศษ/วัสดุที่เหลือคืนแยกต่างหาก — ข้อมูลนี้จะไหลไปที่หน้า <Chip>เศษวัสดุ</Chip> และ <Chip>ต้นทุนเศษ</Chip> โดยอัตโนมัติ</Li>
          <Li>อัปโหลดรูปงานเสร็จในกล่อง <Chip>รูปงานเสร็จสิ้น</Chip></Li>
          <Li>กด <Chip>ปิดงาน</Chip> — ระบบจะตั้งสเตจเป็น 7 อัตโนมัติ พร้อมสร้างลิงก์ประเมินและคัดลอกไปยัง Clipboard ให้ทันที ส่งลิงก์ให้ลูกค้าทาง LINE/SMS ต่อ</Li>
        </ul>
        <FieldsBox
          accent="green"
          heading="ข้อมูลที่ต้องกรอกตอนปิดงาน"
          items={[
            { name: "เช็คลิสต์ส่งมอบ 5 ข้อ", note: "ติดตั้งครบพื้นที่, งานเรียบร้อยพร้อมใช้, เก็บความเรียบร้อยหน้างาน, แนะนำการดูแลรักษา, ลูกค้าตรวจรับงาน" },
            { name: "พื้นที่ติดตั้งจริง (ตร.ม.)" },
            { name: "รายการเบิกสินค้าที่ใช้จริง", note: "ความหนา (0.6/1.6), สี (Beige/Whitebuzz), ความกว้าง (110/140 ซม.), ความยาว (ซม.), จำนวนม้วน — ต่อรายการ" },
            { name: "รายการคืนสินค้า/เศษที่เหลือ", note: "กรอกด้วยฟิลด์ชุดเดียวกับรายการเบิก" },
            { name: "หมายเหตุการส่งมอบ" },
            { name: "รูปงานเสร็จสิ้น", note: "อย่างน้อย 1 รูป" },
          ]}
        />
      </Section>

      <Section id="dept-waste" title="ฝ่ายคลัง/บัญชี — เศษวัสดุ & ต้นทุนเศษ (หลังปิดงาน)" step={7} icon="♻️" accent="teal">
        <p><strong>ต้องทำอะไร:</strong></p>
        <ul className="mt-1 space-y-1.5 text-sm">
          <Li>เมื่อมีเศษแผ่นเหลือจากงานที่ปิดแล้ว ไปที่หน้า <Chip>เศษวัสดุ</Chip> แล้วกด <Chip>+ รับเศษใหม่</Chip> เพื่อบันทึกเข้าสต็อกเศษ</Li>
          <Li>ตรวจสอบสถานะเศษแต่ละชิ้น (พร้อมใช้ / จอง / ใช้แล้ว) และกรองตามหน้ากว้าง</Li>
          <Li>ตั้งราคาต้นทุนต่อหน่วย (unit_cost) ของ RS-140 และ RS-110 ในหน้า <Chip>คลังวัสดุ</Chip> ให้ครบ เพื่อให้หน้าต้นทุนเศษคำนวณมูลค่าได้</Li>
          <Li>เปิดหน้า <Chip>ต้นทุนเศษ</Chip> เพื่อดู Dashboard สรุปต้นทุนเศษต่องาน — ข้อมูลนี้ดึงมาจากแท็บปิดงานอัตโนมัติ ไม่ต้องกรอกซ้ำ</Li>
        </ul>
        <FieldsBox
          accent="teal"
          heading="ข้อมูลที่ต้องกรอก — รับเศษใหม่"
          items={[
            { name: "หน้ากว้าง (cm)", note: "เช่น 30 / 40 / 50 / 60 / 70 / 80 / 90 / 110 / 140" },
            { name: "ความยาวเศษ (cm)" },
            { name: "เลขงานอ้างอิง (job no.)", note: "เช่น INST-270084" },
            { name: "หมายเหตุสภาพเศษ", note: "เช่น มีรอยเล็กน้อยด้านหนึ่ง" },
          ]}
        />
      </Section>

      <Section id="dept-schedule" title="ผู้ประสานงานคิวช่าง — นัดหมาย & คิวงาน" step={8} icon="📅" accent="pink">
        <p><strong>ต้องทำอะไร:</strong></p>
        <ul className="mt-1 space-y-1.5 text-sm">
          <Li>เปิดหน้า <Chip>นัดหมาย</Chip> เพื่อดูตารางนัดทีมช่างรายสัปดาห์ และกด <Chip>+ นัดหมายใหม่</Chip> เมื่อมีงานต้องจัดคิว</Li>
          <Li>จัดการรายชื่อทีมช่างผ่านปุ่ม <Chip>👷 ทีมช่าง</Chip></Li>
          <Li>ใช้หน้า <Chip>คิวงาน</Chip> ทุกเช้าเพื่อไล่ดูงานที่ <Chip warn>เกินกำหนด</Chip>ก่อน ตามด้วยงาน <Chip>วันนี้</Chip> และ <Chip>กำลังมา</Chip></Li>
        </ul>
        <FieldsBox
          accent="pink"
          heading="ข้อมูลที่ต้องกรอก"
          items={[
            { name: "ชื่อทีม/ช่าง", note: "จำเป็น" },
            { name: "เบอร์โทรทีมช่าง" },
            { name: "วันนัด + กะ", note: "เช้า/บ่าย/ทั้งวัน" },
            { name: "หมายเหตุทีมช่าง" },
          ]}
        />
      </Section>

      <Section id="dept-customer" title="ลูกค้า — ให้คะแนนงาน" step={9} icon="🙋" accent="slate">
        <p>
          หลังปิดงาน ลูกค้าจะได้รับลิงก์หน้า <strong>/eval</strong> ทาง LINE หรือ SMS จากฝ่ายปิดงาน
          ลูกค้าเปิดลิงก์แล้วให้คะแนน 1–5 ดาวได้ทันที <strong>ไม่ต้อง login</strong> คะแนนจะไปแสดงที่หน้า
          Overview และหน้างานทั้งหมดโดยอัตโนมัติ
        </p>
      </Section>

      <Section id="pipeline" title="การใช้งานหน้า Pipeline — บอร์ดงาน">
        <p>
          หน้า <strong>Pipeline</strong> แสดงงานทั้งหมดในรูปแบบ Kanban Board
          แบ่งเป็นคอลัมน์ตามสเตจ คลิกการ์ดงานเพื่อดูรายละเอียด อัปเดตสถานะ
          หรือเลื่อนสเตจ การ์ดงานมีแท็บย่อย 6 แท็บ: <Chip>ข้อมูล</Chip> · <Chip>สเตจ</Chip> ·
          <Chip>สำรวจ</Chip> · <Chip>QC</Chip> · <Chip>รูปภาพ</Chip> · <Chip>ปิดงาน</Chip>
        </p>
        <ul className="mt-3 space-y-1.5 text-sm">
          <Li>ค้นหาและกรองงานด้วยแถบค้นหาด้านบน</Li>
          <Li>คลิก <Chip>+ สร้างงานใหม่</Chip> เพื่อเปิดฟอร์มสร้างออเดอร์</Li>
          <Li>คลิกการ์ดงานเพื่อเปิด Drawer รายละเอียด</Li>
          <Li>ในแท็บ <Chip>สเตจ</Chip> กดปุ่ม <Chip>เลื่อนสเตจ →</Chip> เพื่ออัปเดตความคืบหน้า</Li>
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
          <Faq q="ทำไมหน้าต้นทุนเศษถึงคำนวณมูลค่าไม่ได้?">
            เพราะยังไม่ได้ตั้งราคาต้นทุนต่อหน่วย (unit_cost) ของวัสดุ RS-140 / RS-110 — ไปตั้งค่าได้ที่หน้า <strong>คลังวัสดุ</strong>
          </Faq>
          <Faq q="รายการเบิก/คืนวัสดุตอนปิดงาน เอาไปทำอะไรต่อ?">
            รายการคืน/เศษที่เหลือจะถูกดึงไปคำนวณในหน้า <strong>เศษวัสดุ</strong> และ <strong>ต้นทุนเศษ</strong> โดยอัตโนมัติ ฝ่ายปิดงานจึงต้องกรอกให้ครบและถูกต้อง
          </Faq>
        </div>
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  children,
  step,
  icon,
  accent,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  step?: number;
  icon?: string;
  accent?: AccentKey;
}) {
  const a = accent ? ACCENTS[accent] : null;
  return (
    <section id={id} className="mb-10 scroll-mt-4">
      <div className="flex items-center gap-2.5 mb-3 pb-2 border-b border-slate-100">
        {step && a && (
          <span className={`w-7 h-7 rounded-full ${a.dot} text-white flex items-center justify-center text-xs font-bold shrink-0`}>
            {step}
          </span>
        )}
        <h2 className="text-base font-semibold text-slate-800">
          {icon && <span className="mr-1.5">{icon}</span>}
          {title}
        </h2>
      </div>
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

function FieldsBox({
  heading,
  items,
  accent = "blue",
}: {
  heading: string;
  items: { name: string; note?: string }[];
  accent?: AccentKey;
}) {
  const a = ACCENTS[accent];
  return (
    <div className={`mt-3 ${a.soft} border ${a.border} border-l-4 rounded-lg p-3`}>
      <p className={`text-xs font-semibold ${a.text} mb-2`}>📋 {heading}</p>
      <ul className="space-y-1.5 text-xs text-slate-700">
        {items.map((it) => (
          <li key={it.name} className="flex gap-1.5">
            <span className="font-medium text-slate-800 shrink-0">{it.name}</span>
            {it.note && <span className="text-slate-500">— {it.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
