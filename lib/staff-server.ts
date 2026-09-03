import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { StaffProfile } from "@/lib/staff";

export const getCurrentStaff = cache(async (): Promise<StaffProfile | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("floor_staff_profiles")
    .select("id,email,full_name,role,is_active,access_scope,pin_username")
    .eq("id", user.id)
    .maybeSingle();
  if (!data?.is_active) return null;
  return data as StaffProfile;
});
