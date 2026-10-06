import type { Attachment } from "./model";

// IndexedDB has room for far more, but every attachment rides along in the JSON backup and the
// daily snapshot; this keeps a handful of screenshots affordable without turning the workspace
// file into a file server. Pick a smaller board if a single reference image needs to be bigger.
export const ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;

const THUMBNAIL_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function isThumbnailType(type: string): boolean {
  return THUMBNAIL_TYPES.has(type.trim().toLowerCase());
}

function fail(message: string): never { throw new Error(message); }
function str(x: unknown, label: string): asserts x is string { if (typeof x !== "string" || !x.trim()) fail(`${label} is required`); }

export function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
}

export function validateAttachment(input: unknown): asserts input is Attachment {
  if (!input || typeof input !== "object") fail("Invalid attachment");
  const a = input as Record<string, unknown>;
  str(a.id, "Attachment id"); str(a.name, "Attachment name"); str(a.type, "Attachment type"); str(a.data, "Attachment data");
  if (!/^data:[^,]*,/.test(a.data)) fail("Attachment data must be a data URL");
  if (dataUrlByteLength(a.data) > ATTACHMENT_MAX_BYTES) fail(`Attachment exceeds the ${ATTACHMENT_MAX_BYTES / (1024 * 1024)} MiB limit`);
}

// Never trust the stored MIME string for the download: it came from the browser's (or an
// imported file's) own say-so, and a mislabeled type is exactly what a malicious attachment would
// use to get an SVG opened as a page instead of saved to disk. application/octet-stream always
// downloads, never navigates or renders.
export function attachmentBlob(a: Pick<Attachment, "data">): Blob {
  const comma = a.data.indexOf(",");
  const base64 = comma >= 0 ? a.data.slice(comma + 1) : a.data;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "application/octet-stream" });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}
