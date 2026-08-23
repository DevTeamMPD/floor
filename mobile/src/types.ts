export type JobStatus = "travelling" | "arrived" | "installing" | "completed" | "cancelled";

export interface TrackingSessionSummary {
  id: string;
  status: JobStatus;
  customerToken: string;
  sharingStartedAt: string;
  latestCapturedAt: string | null;
}

export interface MobileAssignment {
  assignmentId: string;
  appointmentId: string;
  isLead: boolean;
  acknowledgedAt: string | null;
  slotStart: string;
  slotEnd: string;
  appointmentStatus: string;
  teamName: string | null;
  notes: string | null;
  requirement: string | null;
  jobNo: string | null;
  source: string | null;
  billNo: string | null;
  customerName: string | null;
  customerPhone: string | null;
  address: string | null;
  locationUrl: string | null;
  productName: string | null;
  sitePhotos: unknown;
  rawPayload: unknown;
  pickPlan: unknown;
  plannedSheetCount: number | null;
  pickedSheetCount: number | null;
  trackingSession: TrackingSessionSummary | null;
}

export interface MobileWorkspace {
  device: { id: string; platform: "android" | "ios"; backgroundPermission: string };
  technician: {
    id: string;
    name: string;
    teamId: string | null;
    teamName: string | null;
    isTeamLead: boolean;
  };
  assignments: MobileAssignment[];
}

export interface ActiveTrackingSession {
  sessionId: string;
  assignmentId: string;
  customerToken: string;
  destinationLatitude: number;
  destinationLongitude: number;
  lastEtaAt?: string;
}
