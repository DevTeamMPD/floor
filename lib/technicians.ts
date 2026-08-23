export interface FloorTechnician {
  id: string;
  team_id: string | null;
  personal_token: string;
  name: string;
  phone: string | null;
  is_team_lead: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  pin_updated_at?: string | null;
}

export interface TechnicianAssignment {
  id: string;
  appointment_id: string;
  technician_id: string;
  is_lead: boolean;
  is_active: boolean;
  assigned_at: string;
  revoked_at: string | null;
  first_opened_at: string | null;
  last_opened_at: string | null;
  open_count: number;
  acknowledged_at: string | null;
}

export function assignmentEvidenceLabel(a: TechnicianAssignment) {
  if (a.acknowledged_at) return "รับทราบแล้ว";
  if (a.first_opened_at) return "เปิดแล้ว";
  return "ยังไม่เปิด";
}

export function personalWorkUrl(token: string) {
  if (typeof window === "undefined") return `/work/${token}`;
  return `${window.location.origin}/work/${token}`;
}
