import { Toaster } from "sonner";
import Sidebar from "@/components/layout/sidebar";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/staff-server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  return (
    <div className="flex min-h-screen">
      <Sidebar staff={staff} />
      {/*
        Desktop: ml-[252px] to clear the fixed sidebar
        Mobile:  no left margin; pt-14 to clear the fixed top bar;
                 pb-20 to clear the fixed bottom nav
      */}
      <main className="min-w-0 flex-1 px-3 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-[4.25rem] sm:px-4 md:ml-[252px] md:p-6">
        {children}
      </main>
      <Toaster richColors position="top-center" />
    </div>
  );
}
