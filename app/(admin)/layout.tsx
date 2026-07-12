import { Toaster } from "sonner";
import Sidebar from "@/components/layout/sidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="ml-[252px] flex-1 p-6">{children}</main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
