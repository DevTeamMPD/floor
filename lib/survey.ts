// ค่าคงที่ + ชนิดข้อมูลสำรวจหน้างาน — ใช้ร่วมระหว่างแท็บ "สำรวจ" ในไปป์ไลน์ และหน้า share/queue
// สำคัญ: id ต้องตรงกับที่ job-drawer ใช้ เพื่อให้ survey_data อ่านข้ามกันได้

export const CUT_TYPES = [
  { id: "corner_moulding", label: "มุมบัว / ประตูเลื่อน" },
  { id: "pillar_corner", label: "มุมเสา" },
  { id: "curved_wall", label: "กำแพงโค้ง" },
  { id: "fixed_furniture", label: "เฟอร์นิเจอร์ติดตาย" },
  { id: "straight_wall", label: "แนวกำแพงตรง" },
];

export const WELD_TYPES = [
  { id: "cold", label: "เชื่อมเย็น (น้ำยาประสาน)" },
  { id: "hot", label: "เชื่อมร้อน (เส้นเชื่อม + ไดร์ลมร้อน)" },
  { id: "both", label: "ทั้งสองแบบ" },
];

export const FINISH_TYPES = [
  { id: "wall_moulding", label: "บัวผนัง" },
  { id: "floor_moulding", label: "บัวพื้น / ตัวจบ" },
  { id: "ramp_trim", label: "ตัวจบลาดเฉียงกันน้ำ" },
];

export const FLOOR_CONDITIONS = [
  { id: "dry", label: "แห้งสะอาด" },
  { id: "damp", label: "มีความชื้น" },
  { id: "prep", label: "ต้องเตรียมพื้น" },
];

export interface SurveyData {
  cutTypes: string[];
  weldType: string;
  finishTypes: string[];
  floorCondition: string;
  wetZone: boolean;
  areaSqm: string;
  notes: string;
  photos?: string[];
  savedAt?: string;
}

export const EMPTY_SURVEY: SurveyData = {
  cutTypes: [],
  weldType: "",
  finishTypes: [],
  floorCondition: "",
  wetZone: false,
  areaSqm: "",
  notes: "",
  photos: [],
};

// มีการกรอกสำรวจอย่างน้อยบางส่วนไหม
export function surveyHasData(s: SurveyData): boolean {
  return !!(s.savedAt || s.areaSqm || s.floorCondition || s.weldType ||
    s.cutTypes.length || s.finishTypes.length || s.wetZone || s.notes || (s.photos?.length ?? 0) > 0);
}
