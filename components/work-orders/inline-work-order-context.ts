"use client";

import { createContext } from "react";

// Lets the central work-order page render inside the head-technician workspace
// while retaining its normal route behaviour when opened directly.
export interface InlineWorkOrderContextValue {
  jobNo: string;
  onChanged?: () => void;
}

export const InlineWorkOrderJobContext = createContext<InlineWorkOrderContextValue | null>(null);
