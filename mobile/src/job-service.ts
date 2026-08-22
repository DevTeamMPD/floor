import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { supabase } from "./supabase";

export function normalizeThaiPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("66")) return `+${digits}`;
  if (digits.startsWith("0")) return `+66${digits.slice(1)}`;
  return value.startsWith("+") ? value : `+${digits}`;
}

export function extractCoordinates(url: string | null) {
  if (!url) return null;
  const decoded = decodeURIComponent(url);
  const patterns = [
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query|destination)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
      return { latitude, longitude };
    }
  }
  return null;
}

export async function captureAndUploadStatusPhoto(assignmentId: string, status: string) {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error("ต้องอนุญาตกล้องเพื่อบันทึกภาพสถานะงาน");

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    quality: 0.72,
    exif: false,
  });
  if (result.canceled || !result.assets[0]) throw new Error("ยังไม่ได้ถ่ายภาพสถานะ");

  const asset = result.assets[0];
  const response = await fetch(asset.uri);
  const bytes = await response.arrayBuffer();
  const extension = asset.mimeType?.split("/")[1] ?? "jpg";
  const path = `tracking/${assignmentId}/${status}/${Date.now()}-${Platform.OS}.${extension}`;
  const { error } = await supabase.storage.from("job-photos").upload(path, bytes, {
    contentType: asset.mimeType ?? "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function uploadSignature(sessionId: string, dataUrl: string) {
  const response = await fetch(dataUrl);
  const bytes = await response.arrayBuffer();
  const path = `tracking/${sessionId}/signature/${Date.now()}.png`;
  const { error } = await supabase.storage.from("job-photos").upload(path, bytes, {
    contentType: "image/png",
    upsert: false,
  });
  if (error) throw error;
  return path;
}
