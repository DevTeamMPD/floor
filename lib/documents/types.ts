export type DocumentType = "work_order" | "boq" | "pick_confirmation" | "installation_report" | "customer_acceptance" | "remnant_report" | "handover" | "csat" | "ncr";
export type DocumentClass = "controlled_document" | "quality_record";

export type DocumentItem = {
  category: string;
  itemName: string;
  sku: string | null;
  specification: string | null;
  plannedQty: number;
  actualQty: number | null;
  unit: string;
  sourceType: string;
  note: string | null;
};

export type DocumentEvidence = {
  actorName: string | null;
  note: string | null;
  photoPaths: string[];
  occurredAt: string | null;
};

export type DocumentSourceSnapshot = {
  jobNo: string;
  sourceUpdatedAt: string;
  workOrder: {
    id: string;
    status: string;
    revision: number;
    note: string | null;
    confirmedAt: string | null;
  };
  job: {
    billNo: string | null;
    customerName: string | null;
    customerPhone: string | null;
    address: string | null;
    locationUrl: string | null;
    productName: string | null;
  };
  appointment: {
    startsAt: string | null;
    endsAt: string | null;
    teamName: string | null;
  };
  survey: {
    areaSqm: number | null;
    floorCondition: string | null;
    wetZone: string | null;
    notes: string | null;
    photoCount: number;
  };
  evidence: {
    warehouseCompletion: DocumentEvidence | null;
    fieldCompletion: DocumentEvidence | null;
    customerSigned: (DocumentEvidence & { customerName: string | null; signaturePath: string | null }) | null;
    remnantsSubmitted: DocumentEvidence | null;
    csClosed: DocumentEvidence | null;
  };
  remnant: {
    status: string;
    noRemnant: boolean;
    notes: string | null;
    submittedAt: string | null;
    pieces: Array<{ widthCm: number; lengthCm: number; qty: number; thickness: string; color: string; materialType: string; note: string | null; photoCount: number }>;
  } | null;
  evaluation: {
    id: string;
    csName: string | null;
    callDate: string | null;
    satisfactionScore: number | null;
    issuesText: string | null;
    needsFollowup: boolean;
    answers: Record<string, unknown>;
    updatedAt: string;
  } | null;
  ncrs: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    severity: string;
    dueAt: string | null;
    description: string | null;
    createdAt: string;
  }>;
  items: DocumentItem[];
};

export type RenderedDocument = {
  documentType: DocumentType;
  documentClass: DocumentClass;
  documentCode: string;
  sourceUpdatedAt: string;
  fileName: string;
  html: string;
};
