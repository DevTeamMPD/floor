import { redirect } from "next/navigation";
import { ROLE_HOME } from "@/lib/staff";
import { getCurrentStaff } from "@/lib/staff-server";

export default async function Home() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  redirect(ROLE_HOME[staff.role]);
}
