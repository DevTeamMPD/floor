import { Toaster } from "sonner";
import Sidebar from "@/components/layout/sidebar";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentStaff } from "@/lib/staff-server";
import NotificationCenter from "@/components/notifications/notification-center";
import ErrorPopupHost from "@/components/ui/error-popup";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const isLocalDemo = (await cookies()).get("floor_local_demo")?.value === "1";
  const isLocalWarehousePin = (await cookies()).get("floor_local_warehouse_pin")?.value === "1";
  const staff = await getCurrentStaff();
  if (!staff && !isLocalDemo) redirect("/login");
  const visibleStaff = staff ?? (isLocalWarehousePin
    ? { id: "local-warehouse-demo", email: "warehouse-demo@pin.floor.local", full_name: "คลังสินค้า Demo", role: "warehouse" as const, is_active: true, access_scope: "warehouse_prep_only" as const }
    : { id: "local-demo", email: "demo@local", full_name: "โหมดทดสอบ Local", role: "admin" as const, is_active: true });
  return (
    <div className="flex min-h-screen">
      <Sidebar staff={visibleStaff} />
      <NotificationCenter />
      {/*
        Desktop: ml-[252px] to clear the fixed sidebar
        Mobile:  no left margin; pt-14 to clear the fixed top bar;
                 pb-20 to clear the fixed bottom nav
      */}
      <main className="min-w-0 flex-1 px-3 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-[4.25rem] sm:px-4 md:ml-[252px] md:p-6">
        {children}
      </main>
      <Toaster richColors position="top-center" />
      <ErrorPopupHost isAdmin={visibleStaff.role === "admin"} />
    </div>
  );
}
