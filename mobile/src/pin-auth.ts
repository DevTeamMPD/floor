import * as Application from "expo-application";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { supabase } from "./supabase";

/** Hash PIN ก่อนส่งข้ามเครือข่าย — DB เก็บ hash เท่านั้น */
export async function hashPin(pin: string): Promise<string> {
  const input = `FN:${pin}`;
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface EnrollResult {
  deviceToken: string;
  deviceSecret: string;
}

/** ผูกเครื่องกับพนักงาน + ตั้ง PIN — เรียกครั้งแรกเท่านั้น */
export async function enrollWithPin(
  personalToken: string,
  pin: string,
): Promise<EnrollResult> {
  const pinHash = await hashPin(pin);
  const { data, error } = await supabase.rpc(
    "register_floor_technician_device_pin",
    {
      p_personal_token: personalToken,
      p_pin_hash: pinHash,
      p_platform: Platform.OS,
      p_device_name:
        Device.modelName ?? Device.deviceName ?? "ไม่ระบุอุปกรณ์",
      p_app_version: Application.nativeApplicationVersion ?? "dev",
    },
  );
  if (error) throw error;
  if (!data?.deviceToken || !data?.deviceSecret) {
    throw new Error("ผูกบัญชีไม่สำเร็จ — ไม่พบพนักงานหรือ token หมดอายุ");
  }
  return {
    deviceToken: data.deviceToken as string,
    deviceSecret: data.deviceSecret as string,
  };
}

/** ตรวจ PIN ทุกครั้งที่เปิดแอป */
export async function verifyPin(
  deviceToken: string,
  pin: string,
): Promise<void> {
  const pinHash = await hashPin(pin);
  const { data, error } = await supabase.rpc("verify_floor_device_pin", {
    p_device_token: deviceToken,
    p_pin_hash: pinHash,
  });
  if (error) throw error;
  if (!data) throw new Error("PIN ไม่ถูกต้อง");
}
