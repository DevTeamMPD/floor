"use client";

// Compatibility wrapper for pages that still use the original component name.
// Messages now persist in Supabase rather than in browser localStorage.
import TicketChat from "@/components/tickets/ticket-chat";

type Props = {
  jobNo: string;
  viewer: "technician" | "sales" | "warehouse";
  viewerName: string;
  requestActionLabel?: string;
  onRequestData?: (message: string) => Promise<void> | void;
};

export default function TicketChatMock(props: Props) {
  return <TicketChat {...props} />;
}
