import "./src/tracking-task";

import * as Application from "expo-application";
import * as Device from "expo-device";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import SignatureCanvas from "react-native-signature-canvas";
import { config } from "./src/config";
import {
  captureAndUploadStatusPhoto,
  extractCoordinates,
  uploadSignature,
} from "./src/job-service";
import { enrollWithPin, verifyPin } from "./src/pin-auth";
import {
  ACTIVE_SESSION_KEY,
  DEVICE_SECRET_KEY,
  DEVICE_TOKEN_KEY,
  secureStorage,
} from "./src/secure-store";
import { supabase } from "./src/supabase";
import { startBackgroundTracking, stopBackgroundTracking } from "./src/tracking-task";
import type { JobStatus, MobileAssignment, MobileWorkspace } from "./src/types";

const STATUS_LABELS: Record<JobStatus, string> = {
  travelling: "กำลังเดินทาง",
  arrived: "ถึงบ้านลูกค้าแล้ว",
  installing: "กำลังติดตั้ง",
  completed: "ติดตั้งเสร็จสมบูรณ์",
  cancelled: "ยกเลิกการแชร์",
};

interface WorkOrder {
  id?: string;
  seq?: number;
  task_floor?: string | null;
  task_details?: string | null;
  materials?: string | null;
  manpower?: string | null;
  constraint_logistics?: string | null;
  constraint_ground?: string | null;
  acceptance_criteria?: string | null;
  acceptance_photos?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  design_images?: string[] | null;
  site_photos?: string[] | null;
}

function workOrdersOf(payload: unknown): WorkOrder[] {
  if (!payload || typeof payload !== "object") return [];
  const rows = (payload as { workOrders?: unknown }).workOrders;
  return Array.isArray(rows) ? rows.filter((row): row is WorkOrder => Boolean(row && typeof row === "object")) : [];
}

function thaiDate(value: string) {
  return new Date(value).toLocaleDateString("th-TH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  });
}

function thaiTime(value: string) {
  return new Date(value).toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "เกิดข้อผิดพลาด กรุณาลองใหม่";
}

function Button({
  label,
  onPress,
  disabled = false,
  tone = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "success" | "danger";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === "secondary" && styles.buttonSecondary,
        tone === "success" && styles.buttonSuccess,
        tone === "danger" && styles.buttonDanger,
        (disabled || pressed) && styles.buttonDim,
      ]}
    >
      <Text style={[styles.buttonText, tone === "secondary" && styles.buttonTextSecondary]}>{label}</Text>
    </Pressable>
  );
}

// ── PinInput: กรอก PIN 6 หลักแบบ dot ─────────────────────────────────────────

function PinInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  const inputRef = useRef<TextInput>(null);
  return (
    <Pressable onPress={() => inputRef.current?.focus()} style={styles.pinRow} accessibilityRole="none">
      {Array.from({ length: 6 }, (_, i) => (
        <View key={i} style={[styles.pinCell, value.length === i && styles.pinCellActive]}>
          <Text style={styles.pinDot}>{value[i] ? "●" : ""}</Text>
        </View>
      ))}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        editable={!disabled}
        style={styles.pinHidden}
        caretHidden
      />
    </Pressable>
  );
}

// ── EnrollmentScreen: วาง URL → ตั้ง PIN ─────────────────────────────────────

function EnrollmentScreen({ onEnrolled }: { onEnrolled: (deviceToken: string, deviceSecret: string) => void }) {
  const [step, setStep] = useState<"link" | "pin" | "confirm">("link");
  const [tokenText, setTokenText] = useState("");
  const [personalToken, setPersonalToken] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);

  function validateLink() {
    const token = tokenText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0];
    if (!token) return Alert.alert("ลิงก์ไม่ถูกต้อง", "วางลิงก์หน้างานส่วนตัว /work/… หรือ UUID ที่หัวหน้าช่างส่งให้");
    setPersonalToken(token);
    setStep("pin");
  }

  function validatePin() {
    if (pin.length !== 6) return Alert.alert("กรุณากรอก PIN ให้ครบ 6 หลัก");
    setStep("confirm");
  }

  async function confirmEnroll() {
    if (confirmPin !== pin) {
      setConfirmPin("");
      return Alert.alert("PIN ไม่ตรงกัน", "กรุณากรอก PIN อีกครั้งให้ตรงกัน");
    }
    setBusy(true);
    try {
      const { deviceToken, deviceSecret } = await enrollWithPin(personalToken, pin);
      onEnrolled(deviceToken, deviceSecret);
    } catch (error) {
      Alert.alert("ผูกบัญชีไม่สำเร็จ", errorMessage(error));
      setConfirmPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.centered} keyboardShouldPersistTaps="handled">
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>FN</Text></View>
        <Text style={styles.title}>ผูกบัญชีกับพนักงาน</Text>

        {step === "link" && (
          <>
            <Text style={styles.subtitle}>ทำครั้งเดียวต่อเครื่อง จากนั้นระบบจะจำบัญชีนี้อย่างปลอดภัย</Text>
            <View style={styles.card}>
              <Text style={styles.label}>ลิงก์หน้างานส่วนตัว</Text>
              <TextInput
                value={tokenText}
                onChangeText={setTokenText}
                autoCapitalize="none"
                placeholder="วางลิงก์ /work/… ที่หัวหน้าช่างส่งให้"
                style={[styles.input, styles.multiline]}
                multiline
              />
              <Button label="ถัดไป: ตั้ง PIN" onPress={validateLink} disabled={!tokenText.trim()} />
            </View>
          </>
        )}

        {step === "pin" && (
          <>
            <Text style={styles.subtitle}>ตั้ง PIN 6 หลัก สำหรับเข้าแอปครั้งถัดไป</Text>
            <View style={styles.card}>
              <Text style={styles.label}>PIN 6 หลัก (ตัวเลขเท่านั้น)</Text>
              <PinInput value={pin} onChange={setPin} disabled={busy} />
              <Button label="ถัดไป: ยืนยัน PIN" onPress={validatePin} disabled={pin.length !== 6} />
              <Button label="‹ กลับ" tone="secondary" onPress={() => { setStep("link"); setPin(""); }} />
            </View>
          </>
        )}

        {step === "confirm" && (
          <>
            <Text style={styles.subtitle}>กรอก PIN อีกครั้งเพื่อยืนยัน</Text>
            <View style={styles.card}>
              <Text style={styles.label}>ยืนยัน PIN</Text>
              <PinInput value={confirmPin} onChange={setConfirmPin} disabled={busy} />
              <Button
                label={busy ? "กำลังผูกบัญชี…" : "ยืนยันและผูกเครื่อง"}
                onPress={confirmEnroll}
                disabled={busy || confirmPin.length !== 6}
              />
              <Button label="‹ กลับ" tone="secondary" onPress={() => { setStep("pin"); setConfirmPin(""); }} disabled={busy} />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── PinScreen: ใส่ PIN ทุกครั้งที่เปิดแอป ─────────────────────────────────────

function PinScreen({
  deviceToken,
  onVerified,
  onReset,
}: {
  deviceToken: string;
  onVerified: () => void;
  onReset: () => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);

  async function verify() {
    if (pin.length !== 6) return;
    setBusy(true);
    try {
      await verifyPin(deviceToken, pin);
      onVerified();
    } catch (error) {
      const msg = errorMessage(error);
      const next = attempts + 1;
      setAttempts(next);
      setPin("");
      if (msg.includes("ถูกรีเซ็ต")) {
        Alert.alert("บัญชีถูกรีเซ็ต", "หัวหน้าช่างได้รีเซ็ต PIN แล้ว กรุณาผูกเครื่องใหม่", [
          { text: "ผูกเครื่องใหม่", onPress: onReset },
        ]);
      } else {
        Alert.alert("PIN ไม่ถูกต้อง", next >= 5 ? `ลองแล้ว ${next} ครั้ง — ถ้าลืม PIN ติดต่อหัวหน้าช่างรีเซ็ต` : `กรุณาลองใหม่ (ครั้งที่ ${next})`);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (pin.length === 6 && !busy) void verify();
  }, [pin]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.centered}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>FN</Text></View>
        <Text style={styles.title}>FloorNow Worker</Text>
        <Text style={styles.subtitle}>ใส่ PIN 6 หลักเพื่อเข้าสู่ระบบ</Text>
        <View style={styles.card}>
          <PinInput value={pin} onChange={setPin} disabled={busy} />
          {busy && <ActivityIndicator style={{ marginTop: 8 }} />}
        </View>
        <Pressable onPress={onReset} style={{ marginTop: 16 }}>
          <Text style={styles.linkText}>ลืม PIN? ให้หัวหน้าช่างรีเซ็ต</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ── PermissionScreen ──────────────────────────────────────────────────────────

function PermissionScreen({ deviceToken, onReady }: { deviceToken: string; onReady: () => void }) {
  const [busy, setBusy] = useState(false);

  async function requestPermission() {
    setBusy(true);
    try {
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (!foreground.granted) throw new Error("ต้องอนุญาตตำแหน่งขณะใช้แอปก่อน");
      const background = await Location.requestBackgroundPermissionsAsync();
      const permission = background.granted ? "always" : "foreground";
      await supabase.rpc("update_floor_device_permission", {
        p_device_token: deviceToken,
        p_permission: permission,
        p_app_version: Application.nativeApplicationVersion ?? "dev",
      });
      if (!background.granted) throw new Error("กรุณาเลือกอนุญาตตำแหน่งแบบตลอดเวลาใน Settings");
      onReady();
    } catch (error) {
      Alert.alert("ยังเปิด Background GPS ไม่ครบ", errorMessage(error), [
        { text: "ภายหลัง", style: "cancel" },
        { text: "เปิด Settings", onPress: () => Linking.openSettings() },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.centered}>
        <Text style={styles.title}>อนุญาตตำแหน่งเบื้องหลัง</Text>
        <Text style={styles.subtitle}>ใช้เฉพาะตั้งแต่กดเริ่มเดินทางจนลูกค้าเซ็นรับงาน และหยุดอัตโนมัติเมื่อปิดงาน</Text>
        <View style={styles.card}>
          <Text style={styles.permissionItem}>1. อนุญาตตำแหน่งแบบแม่นยำ</Text>
          <Text style={styles.permissionItem}>2. เลือก "อนุญาตตลอดเวลา"</Text>
          <Text style={styles.permissionItem}>3. Android จะแสดง notification ระหว่างแชร์ตำแหน่ง</Text>
          <Button label={busy ? "กำลังตรวจสอบ…" : "เปิดใช้งาน Background GPS"} onPress={requestPermission} disabled={busy} />
        </View>
      </View>
    </SafeAreaView>
  );
}

// ── WorkOrderDetails ──────────────────────────────────────────────────────────

function WorkOrderDetails({ payload }: { payload: unknown }) {
  const orders = workOrdersOf(payload);
  if (!orders.length) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>ใบสั่งงาน BBPS</Text>
      {orders.map((order, index) => {
        const photos = [...(order.design_images ?? []), ...(order.site_photos ?? [])].filter(
          (url) => typeof url === "string" && url.startsWith("http"),
        );
        const fields = [
          ["งานพื้น", order.task_floor],
          ["รายละเอียดงาน", order.task_details],
          ["วัสดุและอุปกรณ์", order.materials],
          ["กำลังคน", order.manpower],
          ["การขนของ/ทางเข้า", order.constraint_logistics],
          ["สภาพพื้นเดิม", order.constraint_ground],
          ["เกณฑ์ตรวจรับ", order.acceptance_criteria],
          ["ภาพที่ต้องถ่าย", order.acceptance_photos],
          ["ผู้ติดต่อหน้าไซต์", [order.contact_name, order.contact_phone].filter(Boolean).join(" · ")],
        ].filter((field): field is [string, string] => typeof field[1] === "string" && Boolean(field[1].trim()));
        return (
          <View key={order.id ?? index} style={styles.workOrder}>
            <Text style={styles.workOrderTitle}>ใบสั่งงานครั้งที่ {order.seq ?? index + 1}</Text>
            {fields.map(([label, value]) => (
              <View key={label} style={styles.fact}>
                <Text style={styles.factLabel}>{label}</Text>
                <Text style={styles.factValue}>{value}</Text>
              </View>
            ))}
            {photos.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoStrip}>
                {photos.map((url) => <Image key={url} source={{ uri: url }} style={styles.photo} />)}
              </ScrollView>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// ── SignatureModal ─────────────────────────────────────────────────────────────

function SignatureModal({
  visible,
  busy,
  onClose,
  onSigned,
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onSigned: (name: string, dataUrl: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.modalHeader}>
          <Text style={styles.title}>ลูกค้าเซ็นรับงาน</Text>
          <Pressable onPress={onClose}><Text style={styles.close}>ปิด</Text></Pressable>
        </View>
        <View style={styles.signatureBody}>
          <Text style={styles.label}>ชื่อผู้รับงาน</Text>
          <TextInput value={name} onChangeText={setName} placeholder="ชื่อ–นามสกุล" style={styles.input} />
          <View style={styles.signatureCanvas}>
            <SignatureCanvas
              onOK={(signature) => {
                if (!name.trim()) return Alert.alert("กรุณากรอกชื่อผู้รับงาน");
                onSigned(name.trim(), signature);
              }}
              descriptionText="เซ็นชื่อในช่องด้านล่าง"
              clearText="ล้าง"
              confirmText={busy ? "กำลังบันทึก…" : "ยืนยันลายเซ็น"}
              webStyle=".m-signature-pad--footer { display:flex; gap:8px; } .button { border-radius:8px; }"
            />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

type AppScreen = "booting" | "enrollment" | "pin" | "permission" | "workspace";

export default function App() {
  const [screen, setScreen] = useState<AppScreen>("booting");
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<MobileWorkspace | null>(null);
  const [selected, setSelected] = useState<MobileAssignment | null>(null);
  const [pickedSheets, setPickedSheets] = useState("");
  const [plannedSheets, setPlannedSheets] = useState("");
  const [busy, setBusy] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);

  // Boot: ตรวจว่ามี device_token ใน SecureStore ไหม
  useEffect(() => {
    secureStorage.getItem(DEVICE_TOKEN_KEY).then((token) => {
      if (token) {
        setDeviceToken(token);
        setScreen("pin");
      } else {
        setScreen("enrollment");
      }
    });
  }, []);

  const loadWorkspace = useCallback(async (token?: string) => {
    const dt = token ?? deviceToken;
    if (!dt) return;
    const { data, error } = await supabase.rpc("get_floor_mobile_workspace", { p_device_token: dt });
    if (error || !data) {
      Alert.alert("โหลดงานไม่สำเร็จ", error?.message ?? "กรุณาลองใหม่");
      return;
    }
    const next = data as MobileWorkspace;
    setWorkspace(next);
    if (!next.device.backgroundPermission || next.device.backgroundPermission !== "always") {
      setScreen("permission");
    } else {
      setScreen("workspace");
    }
    if (selected) {
      const updated = next.assignments.find((item) => item.assignmentId === selected.assignmentId) ?? null;
      setSelected(updated);
    }
  }, [deviceToken, selected]);

  // Enrollment สำเร็จ
  async function handleEnrolled(dt: string, ds: string) {
    await secureStorage.setItem(DEVICE_TOKEN_KEY, dt);
    await secureStorage.setItem(DEVICE_SECRET_KEY, ds);
    setDeviceToken(dt);
    await loadWorkspace(dt);
  }

  // PIN verify สำเร็จ
  async function handlePinVerified() {
    await loadWorkspace();
  }

  // Reset: ลบ token ออก → กลับ enrollment
  async function handleReset() {
    await secureStorage.removeItem(DEVICE_TOKEN_KEY);
    await secureStorage.removeItem(DEVICE_SECRET_KEY);
    setDeviceToken(null);
    setWorkspace(null);
    setScreen("enrollment");
  }

  const upcoming = useMemo(
    () => (workspace?.assignments ?? []).filter((a) => new Date(a.slotEnd).getTime() >= Date.now() - 12 * 60 * 60 * 1000),
    [workspace],
  );

  async function startJob() {
    if (!selected || !deviceToken) return;
    if (!selected.acknowledgedAt) return Alert.alert("กรุณารับทราบงานก่อนเริ่มเดินทาง");
    if (selected.plannedSheetCount === null) return Alert.alert("ยังเริ่มงานไม่ได้", "หัวหน้าช่างต้องระบุจำนวนแผ่นที่วางแผนไว้ก่อน");
    const destination = extractCoordinates(selected.locationUrl);
    if (!destination) return Alert.alert("ยังเริ่ม GPS ไม่ได้", "ลิงก์ Google Maps ของงานนี้ไม่มีพิกัด กรุณาให้หัวหน้าช่างหรือฝ่ายขายปักหมุดใหม่");
    const picked = Number(pickedSheets);
    if (!Number.isInteger(picked) || picked < 0) return Alert.alert("กรุณาระบุจำนวนแผ่นที่หยิบมา");
    setBusy(true);
    try {
      const photoPath = await captureAndUploadStatusPhoto(selected.assignmentId, "travelling");
      const { data, error } = await supabase.rpc("start_floor_tracking", {
        p_device_token: deviceToken,
        p_assignment_id: selected.assignmentId,
        p_picked_sheet_count: picked,
        p_destination_latitude: destination.latitude,
        p_destination_longitude: destination.longitude,
        p_photo_paths: [photoPath],
      });
      if (error || !data?.sessionId) throw error ?? new Error("เริ่มงานไม่สำเร็จ");
      try {
        await startBackgroundTracking({
          sessionId: data.sessionId as string,
          assignmentId: selected.assignmentId,
          customerToken: data.customerToken as string,
          destinationLatitude: destination.latitude,
          destinationLongitude: destination.longitude,
        });
      } catch (trackingError) {
        await supabase.rpc("record_floor_job_status", {
          p_device_token: deviceToken,
          p_session_id: data.sessionId as string,
          p_status: "cancelled",
          p_photo_paths: [],
          p_note: "Background GPS failed to start",
        });
        throw trackingError;
      }
      await loadWorkspace();
      Alert.alert("เริ่มแชร์ตำแหน่งแล้ว", "ปิดหน้าจอได้ ระบบจะติดตามจนลูกค้าเซ็นรับงาน");
    } catch (error) {
      Alert.alert("เริ่มงานไม่สำเร็จ", errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: Exclude<JobStatus, "travelling" | "cancelled">) {
    if (!selected?.trackingSession || !deviceToken) return;
    setBusy(true);
    try {
      const photoPath = await captureAndUploadStatusPhoto(selected.assignmentId, status);
      const { data, error } = await supabase.rpc("record_floor_job_status", {
        p_device_token: deviceToken,
        p_session_id: selected.trackingSession.id,
        p_status: status,
        p_photo_paths: [photoPath],
        p_note: null,
      });
      if (error || !data) throw error ?? new Error("บันทึกสถานะไม่สำเร็จ");
      await loadWorkspace();
      if (status === "completed") setSignatureOpen(true);
    } catch (error) {
      Alert.alert("บันทึกไม่สำเร็จ", errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function savePlan() {
    if (!selected) return;
    const count = Number(plannedSheets);
    if (!Number.isInteger(count) || count < 0) return Alert.alert("กรุณาระบุจำนวนแผ่นที่ถูกต้อง");
    setBusy(true);
    const { data, error } = await supabase.rpc("set_floor_job_material_plan", {
      p_appointment_id: selected.appointmentId,
      p_planned_sheet_count: count,
      p_planned_by: workspace?.technician.name ?? "หัวหน้าช่าง",
    });
    setBusy(false);
    if (error || !data) return Alert.alert("บันทึกไม่สำเร็จ", error?.message ?? "ไม่มีสิทธิ์หัวหน้าช่าง");
    await loadWorkspace();
  }

  async function recordAssignmentEvent(assignment: MobileAssignment, eventType: "opened" | "acknowledged") {
    if (!deviceToken) return false;
    const { data, error } = await supabase.rpc("record_floor_mobile_assignment_event", {
      p_device_token: deviceToken,
      p_assignment_id: assignment.assignmentId,
      p_event_type: eventType,
    });
    if (error || !data) {
      if (eventType === "acknowledged") Alert.alert("รับทราบงานไม่สำเร็จ", error?.message ?? "กรุณาลองใหม่");
      return false;
    }
    return true;
  }

  async function acknowledgeAssignment() {
    if (!selected || selected.acknowledgedAt) return;
    setBusy(true);
    const saved = await recordAssignmentEvent(selected, "acknowledged");
    if (saved) await loadWorkspace();
    setBusy(false);
  }

  async function saveSignature(name: string, dataUrl: string) {
    if (!selected?.trackingSession || !deviceToken) return;
    setBusy(true);
    try {
      const path = await uploadSignature(selected.trackingSession.id, dataUrl);
      const { data, error } = await supabase.rpc("record_floor_customer_signature", {
        p_device_token: deviceToken,
        p_session_id: selected.trackingSession.id,
        p_signer_name: name,
        p_signature_path: path,
      });
      if (error || !data) throw error ?? new Error("บันทึกลายเซ็นไม่สำเร็จ");
      await stopBackgroundTracking();
      setSignatureOpen(false);
      await loadWorkspace();
      Alert.alert("ปิดงานเรียบร้อย", "หยุดแชร์ตำแหน่งแล้วและบันทึกลายเซ็นลูกค้าเรียบร้อย");
    } catch (error) {
      Alert.alert("บันทึกลายเซ็นไม่สำเร็จ", errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  // ── Render by screen state ──────────────────────────────────────────────────

  if (screen === "booting") {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}><ActivityIndicator size="large" /></View>
      </SafeAreaView>
    );
  }

  if (screen === "enrollment") {
    return <EnrollmentScreen onEnrolled={handleEnrolled} />;
  }

  if (screen === "pin" && deviceToken) {
    return <PinScreen deviceToken={deviceToken} onVerified={handlePinVerified} onReset={handleReset} />;
  }

  if (screen === "permission" && deviceToken) {
    return (
      <PermissionScreen
        deviceToken={deviceToken}
        onReady={() => { void loadWorkspace(); }}
      />
    );
  }

  if (!workspace) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
          <Text style={styles.subtitle}>กำลังโหลดงาน…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View>
          <Text style={styles.headerEyebrow}>FloorNow · หน้างานของฉัน</Text>
          <Text style={styles.headerTitle}>{workspace.technician.name}</Text>
          <Text style={styles.headerMeta}>{workspace.technician.teamName ?? "ไม่ระบุทีม"}</Text>
        </View>
        <Pressable onPress={handleReset}>
          <Text style={styles.headerAction}>ออกจากระบบ</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.page}>
        {selected ? (
          <>
            <Pressable onPress={() => setSelected(null)}><Text style={styles.back}>‹ กลับไปตารางงาน</Text></Pressable>
            <Text style={styles.title}>{selected.customerName ?? selected.jobNo ?? "งานติดตั้ง"}</Text>
            <Text style={styles.subtitle}>{thaiDate(selected.slotStart)} · {thaiTime(selected.slotStart)}–{thaiTime(selected.slotEnd)} น.</Text>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>การรับทราบงาน</Text>
              <Text style={styles.factValue}>
                {selected.acknowledgedAt
                  ? `รับทราบแล้ว ${thaiDate(selected.acknowledgedAt)} ${thaiTime(selected.acknowledgedAt)} น.`
                  : "กรุณาตรวจรายละเอียดทั้งหมดก่อนกดรับทราบ"}
              </Text>
              <Button
                label={selected.acknowledgedAt ? "✓ รับทราบงานแล้ว" : busy ? "กำลังบันทึก…" : "รับทราบงาน"}
                tone="success"
                onPress={() => void acknowledgeAssignment()}
                disabled={busy || Boolean(selected.acknowledgedAt)}
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>ข้อมูลจากฝ่ายขาย</Text>
              <View style={styles.fact}><Text style={styles.factLabel}>เลขบิล</Text><Text style={styles.factValue}>{selected.billNo ?? "—"}</Text></View>
              <View style={styles.fact}><Text style={styles.factLabel}>โทรศัพท์ลูกค้า</Text><Text style={styles.factValue}>{selected.customerPhone ?? "—"}</Text></View>
              <View style={styles.fact}><Text style={styles.factLabel}>สถานที่ติดตั้ง</Text><Text style={styles.factValue}>{selected.address ?? "—"}</Text></View>
              <View style={styles.fact}><Text style={styles.factLabel}>สินค้า / สเปก</Text><Text style={styles.factValue}>{selected.productName ?? selected.requirement ?? "—"}</Text></View>
              <View style={styles.fact}><Text style={styles.factLabel}>หมายเหตุ</Text><Text style={styles.factValue}>{selected.notes ?? "—"}</Text></View>
              {selected.locationUrl ? <Button label="เปิด Google Maps" tone="secondary" onPress={() => Linking.openURL(selected.locationUrl!)} /> : null}
            </View>

            <WorkOrderDetails payload={selected.rawPayload} />

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>วัสดุที่นำไปหน้างาน</Text>
              <View style={styles.materialRow}>
                <View><Text style={styles.factLabel}>หัวหน้ากำหนด</Text><Text style={styles.materialNumber}>{selected.plannedSheetCount ?? 0} แผ่น</Text></View>
                <View><Text style={styles.factLabel}>ช่างหยิบจริง</Text><Text style={styles.materialNumber}>{selected.pickedSheetCount ?? "—"} แผ่น</Text></View>
              </View>
              {workspace.technician.isTeamLead && !selected.trackingSession ? (
                <>
                  <TextInput value={plannedSheets} onChangeText={setPlannedSheets} keyboardType="number-pad" placeholder="จำนวนแผ่นที่กำหนด" style={styles.input} />
                  <Button label="บันทึกจำนวนที่กำหนด" tone="secondary" onPress={savePlan} disabled={busy} />
                </>
              ) : null}
              {!selected.trackingSession ? (
                <>
                  <Text style={styles.label}>จำนวนแผ่นที่หยิบมา</Text>
                  <TextInput value={pickedSheets} onChangeText={setPickedSheets} keyboardType="number-pad" placeholder="0" style={styles.input} />
                  <Button label={busy ? "กำลังเริ่มงาน…" : "ถ่ายภาพและเริ่มเดินทาง"} onPress={startJob} disabled={busy || !pickedSheets} />
                </>
              ) : null}
            </View>

            {selected.trackingSession ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>สถานะงาน</Text>
                <View style={styles.liveState}>
                  <Text style={styles.liveDot}>●</Text>
                  <View>
                    <Text style={styles.liveTitle}>{STATUS_LABELS[selected.trackingSession.status]}</Text>
                    <Text style={styles.factLabel}>Background GPS กำลังทำงาน</Text>
                  </View>
                </View>
                <Button label="ถึงบ้านลูกค้าแล้ว · ถ่ายภาพ" onPress={() => setStatus("arrived")} disabled={busy || selected.trackingSession.status !== "travelling"} />
                <Button label="เริ่มติดตั้ง · ถ่ายภาพ" onPress={() => setStatus("installing")} disabled={busy || selected.trackingSession.status !== "arrived"} />
                <Button label="ติดตั้งเสร็จ · ถ่ายภาพ" tone="success" onPress={() => setStatus("completed")} disabled={busy || selected.trackingSession.status !== "installing"} />
                {selected.trackingSession.status === "completed" ? (
                  <Button label="เปิดให้ลูกค้าเซ็นรับงาน" tone="success" onPress={() => setSignatureOpen(true)} disabled={busy} />
                ) : null}
                <Button label="แชร์ลิงก์สถานะให้ลูกค้า" tone="secondary" onPress={() => Share.share({ message: `${config.customerTrackingBaseUrl}/${selected.trackingSession!.customerToken}` })} />
              </View>
            ) : null}
          </>
        ) : (
          <>
            <View style={styles.listHeader}>
              <View>
                <Text style={styles.title}>ตารางงานของฉัน</Text>
                <Text style={styles.subtitle}>งานที่ได้รับมอบหมาย {upcoming.length} งาน</Text>
              </View>
              <Pressable onPress={() => void loadWorkspace()}><Text style={styles.refresh}>รีเฟรช</Text></Pressable>
            </View>
            {upcoming.map((assignment) => (
              <Pressable
                key={assignment.assignmentId}
                style={styles.jobCard}
                onPress={() => {
                  setSelected(assignment);
                  setPickedSheets(String(assignment.pickedSheetCount ?? assignment.plannedSheetCount ?? ""));
                  setPlannedSheets(String(assignment.plannedSheetCount ?? ""));
                  void recordAssignmentEvent(assignment, "opened");
                }}
              >
                <Text style={styles.jobDate}>{thaiDate(assignment.slotStart)}</Text>
                <Text style={styles.jobTitle}>{assignment.customerName ?? assignment.jobNo ?? "งานติดตั้ง"}</Text>
                <Text style={styles.jobMeta}>{thaiTime(assignment.slotStart)}–{thaiTime(assignment.slotEnd)} · {assignment.productName ?? assignment.requirement ?? "ยังไม่ระบุสเปก"}</Text>
                <View style={styles.badges}>
                  <Text style={styles.badge}>{assignment.teamName ?? "ทีมช่าง"}</Text>
                  {assignment.trackingSession
                    ? <Text style={styles.badgeLive}>{STATUS_LABELS[assignment.trackingSession.status]}</Text>
                    : <Text style={styles.badgeWaiting}>รอเริ่มงาน</Text>}
                </View>
              </Pressable>
            ))}
            {!upcoming.length ? <View style={styles.empty}><Text style={styles.subtitle}>ยังไม่มีงานที่ได้รับมอบหมาย</Text></View> : null}
          </>
        )}
      </ScrollView>

      <SignatureModal visible={signatureOpen} busy={busy} onClose={() => setSignatureOpen(false)} onSigned={saveSignature} />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f3f6fb" },
  centered: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  brandMark: { width: 52, height: 52, borderRadius: 15, backgroundColor: "#1559c9", alignItems: "center", justifyContent: "center", alignSelf: "center" },
  brandMarkText: { color: "#fff", fontWeight: "700", fontSize: 18 },
  title: { fontSize: 22, fontWeight: "700", color: "#172033" },
  subtitle: { color: "#66758e", marginTop: 4, lineHeight: 20 },
  card: { backgroundColor: "#fff", borderColor: "#dbe3ee", borderWidth: 1, borderRadius: 16, padding: 16, gap: 10, marginTop: 10 },
  label: { color: "#66758e", fontSize: 13, marginTop: 4 },
  input: { backgroundColor: "#fff", borderColor: "#cfd9e7", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: "#172033" },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  button: { backgroundColor: "#1559c9", borderRadius: 10, minHeight: 46, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, marginTop: 4 },
  buttonSecondary: { backgroundColor: "#fff", borderColor: "#bfd2ee", borderWidth: 1 },
  buttonSuccess: { backgroundColor: "#147a4b" },
  buttonDanger: { backgroundColor: "#c13f45" },
  buttonDim: { opacity: 0.48 },
  buttonText: { color: "#fff", fontWeight: "600" },
  buttonTextSecondary: { color: "#1559c9" },
  linkText: { color: "#1559c9", fontSize: 13, textAlign: "center" },
  // PIN
  pinRow: { flexDirection: "row", justifyContent: "center", gap: 10, marginVertical: 8 },
  pinCell: { width: 44, height: 54, borderRadius: 10, borderWidth: 1.5, borderColor: "#cfd9e7", backgroundColor: "#f6f8fc", alignItems: "center", justifyContent: "center" },
  pinCellActive: { borderColor: "#1559c9", backgroundColor: "#eef4ff" },
  pinDot: { fontSize: 22, color: "#172033" },
  pinHidden: { position: "absolute", opacity: 0, width: 1, height: 1 },
  // Permission
  permissionItem: { color: "#34435a", paddingVertical: 5 },
  // Header
  header: { backgroundColor: "#101827", paddingHorizontal: 18, paddingVertical: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerEyebrow: { color: "#93a4bb", fontSize: 12 },
  headerTitle: { color: "#fff", fontSize: 20, fontWeight: "700", marginTop: 3 },
  headerMeta: { color: "#c5d0de", fontSize: 13, marginTop: 2 },
  headerAction: { color: "#9fc0ff", fontSize: 13 },
  // Page
  page: { padding: 16, paddingBottom: 40 },
  listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  refresh: { color: "#1559c9", fontWeight: "600" },
  jobCard: { backgroundColor: "#fff", borderColor: "#dbe3ee", borderWidth: 1, borderRadius: 14, padding: 15, marginBottom: 11 },
  jobDate: { color: "#1559c9", fontSize: 13, fontWeight: "600" },
  jobTitle: { color: "#172033", fontSize: 17, fontWeight: "700", marginTop: 5 },
  jobMeta: { color: "#66758e", marginTop: 5, lineHeight: 20 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 },
  badge: { color: "#55647a", backgroundColor: "#eef2f7", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12 },
  badgeLive: { color: "#147a4b", backgroundColor: "#e8f7ef", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12 },
  badgeWaiting: { color: "#9a5a08", backgroundColor: "#fff6dd", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12 },
  empty: { backgroundColor: "#fff", borderRadius: 14, padding: 30, alignItems: "center" },
  back: { color: "#1559c9", fontWeight: "600", marginBottom: 12 },
  section: { backgroundColor: "#fff", borderColor: "#dbe3ee", borderWidth: 1, borderRadius: 14, padding: 15, marginTop: 14, gap: 10 },
  sectionTitle: { color: "#172033", fontSize: 16, fontWeight: "700", marginBottom: 3 },
  fact: { gap: 3 },
  factLabel: { color: "#7a889d", fontSize: 12 },
  factValue: { color: "#263248", lineHeight: 20 },
  workOrder: { backgroundColor: "#f6f8fc", borderRadius: 11, padding: 12, gap: 9 },
  workOrderTitle: { color: "#3f3b87", fontWeight: "700" },
  photoStrip: { marginTop: 2 },
  photo: { width: 130, height: 92, borderRadius: 9, marginRight: 8, backgroundColor: "#e9eef5" },
  materialRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#f6f8fc", borderRadius: 10, padding: 12 },
  materialNumber: { color: "#172033", fontWeight: "700", fontSize: 17, marginTop: 3 },
  liveState: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: "#e8f7ef", borderRadius: 10, padding: 12 },
  liveDot: { color: "#147a4b" },
  liveTitle: { color: "#146b46", fontWeight: "700" },
  modalHeader: { padding: 16, borderBottomColor: "#dbe3ee", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  close: { color: "#1559c9", fontWeight: "600" },
  signatureBody: { flex: 1, padding: 16, gap: 10 },
  signatureCanvas: { flex: 1, overflow: "hidden", borderRadius: 12, borderColor: "#dbe3ee", borderWidth: 1 },
});
