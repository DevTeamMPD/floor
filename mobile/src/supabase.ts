import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import { config } from "./config";
import { secureStorage } from "./secure-store";

export const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
