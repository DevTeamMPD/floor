import "server-only";

type GraphDriveItem = { id: string; webUrl: string; folder?: { childCount: number } };

export type SharePointDocument = {
  itemId: string;
  webUrl: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
};

const SITE_HOSTNAME = process.env.SHAREPOINT_SITE_HOSTNAME ?? "mpdgroupco.sharepoint.com";
const SITE_PATH = process.env.SHAREPOINT_SITE_PATH ?? "/sites/bebeplayspace";
const ROOT_FOLDER = process.env.SHAREPOINT_FLOOR_ROOT ?? "floor-jobs";
const SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

let tokenCache: { token: string; expiresAt: number } | null = null;
let driveIdCache: string | null = null;

function requiredEnvironment() {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  return tenantId && clientId && clientSecret ? { tenantId, clientId, clientSecret } : null;
}

export function isSharePointConfigured() { return Boolean(requiredEnvironment()); }

export function safeSharePointSegment(value: string) {
  return value.replace(/[\\/:*?"<>|#%~]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "untitled";
}

async function getAccessToken() {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const environment = requiredEnvironment();
  if (!environment) throw new Error("ยังไม่ได้ตั้งค่า SharePoint integration บนเซิร์ฟเวอร์");

  const response = await fetch(`https://login.microsoftonline.com/${environment.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: environment.clientId,
      client_secret: environment.clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }),
    cache: "no-store",
  });
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!response.ok || !payload.access_token) throw new Error("ไม่สามารถยืนยันตัวตนกับ SharePoint ได้");
  tokenCache = { token: payload.access_token, expiresAt: Date.now() + Math.max(60, Number(payload.expires_in ?? 3600) - 120) * 1000 };
  return tokenCache.token;
}

async function getDriveId(token: string) {
  if (driveIdCache) return driveIdCache;
  const siteResponse = await fetch(`https://graph.microsoft.com/v1.0/sites/${SITE_HOSTNAME}:${SITE_PATH}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const site = await siteResponse.json() as { id?: string };
  if (!siteResponse.ok || !site.id) throw new Error("ไม่พบ SharePoint site ที่ตั้งค่าไว้");
  const drivesResponse = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const drives = await drivesResponse.json() as { value?: { id: string; name: string; driveType: string }[] };
  const drive = (drives.value ?? []).find((item) => item.name === "Shared Documents")
    ?? (drives.value ?? []).find((item) => item.name === "Documents")
    ?? (drives.value ?? []).find((item) => item.driveType === "documentLibrary");
  if (!drivesResponse.ok || !drive) throw new Error("ไม่พบ Document Library ของ SharePoint");
  driveIdCache = drive.id;
  return drive.id;
}

async function ensureFolder(token: string, driveId: string, parentPath: string, name: string): Promise<GraphDriveItem> {
  const safeName = safeSharePointSegment(name);
  const childrenUrl = parentPath
    ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${parentPath}:/children`
    : `https://graph.microsoft.com/v1.0/drives/${driveId}/items/root/children`;
  const response = await fetch(childrenUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: safeName, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    cache: "no-store",
  });
  if (response.status === 409) {
    const existing = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${parentPath}/${encodeURIComponent(safeName)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (existing.ok) return existing.json() as Promise<GraphDriveItem>;
  }
  if (!response.ok) throw new Error("ไม่สามารถสร้างโฟลเดอร์เอกสารบน SharePoint ได้");
  return response.json() as Promise<GraphDriveItem>;
}

export async function ensureJobDocumentFolder(jobNo: string, workflowStage: string) {
  const token = await getAccessToken();
  const driveId = await getDriveId(token);
  const root = await ensureFolder(token, driveId, "", ROOT_FOLDER);
  const job = await ensureFolder(token, driveId, safeSharePointSegment(ROOT_FOLDER), jobNo);
  const stage = await ensureFolder(token, driveId, `${safeSharePointSegment(ROOT_FOLDER)}/${encodeURIComponent(safeSharePointSegment(jobNo))}`, workflowStage);
  return { folderId: stage.id, folderUrl: stage.webUrl, rootFolderId: root.id, jobFolderId: job.id };
}

export async function uploadJobDocument(input: { jobNo: string; workflowStage: string; fileName: string; mimeType: string; content: ArrayBuffer }) : Promise<SharePointDocument> {
  if (input.content.byteLength > SIMPLE_UPLOAD_MAX_BYTES) throw new Error("ไฟล์เกิน 4 MB; ขั้นต่อไปจะรองรับการอัปโหลดไฟล์ขนาดใหญ่ผ่าน upload session");
  const token = await getAccessToken();
  const driveId = await getDriveId(token);
  await ensureJobDocumentFolder(input.jobNo, input.workflowStage);
  const path = `${safeSharePointSegment(ROOT_FOLDER)}/${encodeURIComponent(safeSharePointSegment(input.jobNo))}/${encodeURIComponent(safeSharePointSegment(input.workflowStage))}/${encodeURIComponent(safeSharePointSegment(input.fileName))}`;
  const response = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${path}:/content`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": input.mimeType || "application/octet-stream" },
    body: input.content,
    cache: "no-store",
  });
  const item = await response.json() as GraphDriveItem & { name?: string; size?: number; file?: { mimeType?: string } };
  if (!response.ok || !item.id || !item.webUrl) throw new Error("อัปโหลดเอกสารไป SharePoint ไม่สำเร็จ");
  return { itemId: item.id, webUrl: item.webUrl, fileName: item.name ?? safeSharePointSegment(input.fileName), mimeType: item.file?.mimeType ?? input.mimeType ?? "application/octet-stream", fileSizeBytes: item.size ?? input.content.byteLength };
}
