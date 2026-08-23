import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

// ใช้ anon key สำหรับ .rpc() และ .storage เท่านั้น
// Auth ของ FloorNow mobile ใช้ device_token + PIN — ไม่ใช้ Supabase Auth session
export const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
