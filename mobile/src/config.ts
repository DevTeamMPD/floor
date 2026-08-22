function required(name: string, value: string | undefined) {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export const config = {
  supabaseUrl: required("EXPO_PUBLIC_SUPABASE_URL", process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabasePublishableKey: required(
    "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
  floorNowApiUrl: process.env.EXPO_PUBLIC_FLOORNOW_API_URL ?? "https://floor-delta.vercel.app",
  customerTrackingBaseUrl:
    process.env.EXPO_PUBLIC_CUSTOMER_TRACKING_BASE_URL ?? "https://floor-delta.vercel.app/track",
};
