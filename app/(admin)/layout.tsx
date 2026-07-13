import { Toaster } from "sonner";
import Sidebar from "@/components/layout/sidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      {/*
        Desktop: ml-[252px] to clear the fixed sidebar
        Mobile:  no left margin; pt-14 to clear the fixed top bar;
                 pb-20 to clear the fixed bottom nav
      */}
      <main className="flex-1 md:ml-[252px] pt-14 md:pt-0 pb-20 md:pb-0 p-4 md:p-6 min-w-0">
        {children}
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
