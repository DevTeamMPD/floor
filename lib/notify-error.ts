import { floorErrorMessage } from "@/lib/floor-error-message";

// A tiny module-level pub/sub -- the same imperative pattern sonner's own
// toast() uses -- so notifyError(...) can be called from any client
// component without React context, and ErrorPopupHost (mounted once in
// app/(admin)/layout.tsx) re-renders whenever a new error comes in.
export interface ErrorPopupState {
  id: number;
  title: string;
  message: string;
  detail: string | null;
}

type Listener = (state: ErrorPopupState | null) => void;
const listeners = new Set<Listener>();
let current: ErrorPopupState | null = null;
let nextId = 1;

export function subscribeErrorPopup(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

function emit(state: ErrorPopupState | null) {
  current = state;
  listeners.forEach((listener) => listener(state));
}

function rawDetail(error: unknown): string | null {
  if (typeof error === "string") return null; // plain validation text has no extra technical detail
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [
      value.code ? `code: ${value.code}` : null,
      typeof value.message === "string" && value.message.trim() ? `message: ${value.message.trim()}` : null,
      typeof value.details === "string" && value.details.trim() ? `details: ${value.details.trim()}` : null,
      typeof value.hint === "string" && value.hint.trim() ? `hint: ${value.hint.trim()}` : null,
    ].filter((part): part is string => Boolean(part));
    if (parts.length) return parts.join("\n");
  }
  if (error instanceof Error && error.stack) return error.stack;
  return null;
}

/**
 * Shows the shared error popup (see components/ui/error-popup.tsx).
 * Replaces every `toast.error(...)` call across the app -- pass a plain
 * validation string exactly like before, or an Error/Postgrest error object
 * (optionally with an `action` label, matching the old floorActionError
 * convention) and it will be run through floorErrorMessage for the friendly
 * text shown to every user, while the raw code/message/hint stays available
 * behind the admin-only "ดูรายละเอียด" toggle.
 */
export function notifyError(error: unknown, action?: string) {
  const message = typeof error === "string" ? error : action ? `${action}ไม่สำเร็จ: ${floorErrorMessage(error)}` : floorErrorMessage(error);
  emit({ id: nextId++, title: "เกิดข้อผิดพลาด", message, detail: rawDetail(error) });
}

export function dismissErrorPopup() {
  emit(null);
}
