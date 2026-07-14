/** Shared upload limits and client-side compression before POST /api/uploads */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB — must match server
export const MAX_DOC_BYTES = 5 * 1024 * 1024; // PDF / office docs
export const MAX_VOICE_BYTES = 5 * 1024 * 1024; // voice notes — must match server
export const MAX_VOICE_SECONDS = 120;

export const IMAGE_PRESETS = {
  /** Incident evidence (camera / file picker) */
  evidence: { maxPx: 1600, quality: 0.82 },
  /** Chat images */
  chat: { maxPx: 1280, quality: 0.8 },
  /** Live incident arrival photos */
  compact: { maxPx: 1024, quality: 0.72 },
  /** Admin custom map uploads — slightly higher for floor-plan detail */
  map: { maxPx: 2048, quality: 0.85 },
} as const;

export type ImagePreset = keyof typeof IMAGE_PRESETS;

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export function formatUploadLimit(bytes = MAX_UPLOAD_BYTES): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${Math.round(mb)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function isImageType(type: string): boolean {
  return type.startsWith("image/");
}

function isAudioType(type: string): boolean {
  return type.startsWith("audio/");
}

function isVideoType(type: string): boolean {
  return type.startsWith("video/");
}

function isDocumentType(type: string): boolean {
  return (
    type === "application/pdf" ||
    type.startsWith("application/msword") ||
    type.startsWith("application/vnd.openxmlformats-officedocument") ||
    type.startsWith("text/")
  );
}

function maxBytesForType(type: string): number {
  if (isDocumentType(type)) return MAX_DOC_BYTES;
  if (isAudioType(type)) return MAX_VOICE_BYTES;
  return MAX_UPLOAD_BYTES;
}

export async function compressImageFile(
  file: File,
  maxPx: number,
  quality: number,
): Promise<File> {
  return new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          canvas.width = 0;
          canvas.height = 0;
          if (blob) {
            resolve(
              new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }),
            );
          } else {
            reject(new Error("Image compression failed"));
          }
        },
        "image/jpeg",
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error("Could not read image"));
    };
    img.src = blobUrl;
  });
}

export type PrepareUploadOptions = {
  preset?: ImagePreset;
};

/**
 * Compress images and enforce per-type size limits before upload.
 * Non-image files are passed through unchanged (but size-checked).
 */
export async function prepareUploadFile(
  file: File,
  options: PrepareUploadOptions = {},
): Promise<File> {
  const preset = IMAGE_PRESETS[options.preset ?? "evidence"];

  if (isVideoType(file.type) && file.size > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(
      `Video is too large (max ${formatUploadLimit()}). Try a shorter clip or lower quality.`,
    );
  }

  const maxBytes = maxBytesForType(file.type);
  if (!isImageType(file.type) && file.size > maxBytes) {
    const label = isAudioType(file.type)
      ? "Recording"
      : isVideoType(file.type)
        ? "Video"
        : isDocumentType(file.type)
          ? "Document"
          : "File";
    throw new UploadValidationError(`${label} is too large (max ${formatUploadLimit(maxBytes)}).`);
  }

  let uploadFile = file;
  if (isImageType(file.type)) {
    uploadFile = await compressImageFile(file, preset.maxPx, preset.quality);
    if (uploadFile.size > MAX_UPLOAD_BYTES) {
      throw new UploadValidationError(
        `Photo is still too large after compression (max ${formatUploadLimit()}).`,
      );
    }
  }

  return uploadFile;
}

export async function uploadFile(
  body: Blob | File,
  contentType?: string,
): Promise<{ objectUrl: string; byteSize: number }> {
  const type =
    contentType ??
    (body instanceof File ? body.type : undefined) ??
    "application/octet-stream";

  if (body.size > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(`File is too large (max ${formatUploadLimit()}).`);
  }

  const resp = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": type },
    body,
    credentials: "include",
  });

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    throw new Error(
      typeof errData.message === "string" ? errData.message : `Upload failed (${resp.status})`,
    );
  }

  const data = (await resp.json()) as { objectUrl: string; byteSize?: number };
  return {
    objectUrl: data.objectUrl,
    byteSize: typeof data.byteSize === "number" ? data.byteSize : body.size,
  };
}

export async function prepareAndUploadFile(
  file: File,
  options: PrepareUploadOptions = {},
): Promise<{ objectUrl: string; byteSize: number; file: File }> {
  const processed = await prepareUploadFile(file, options);
  const { objectUrl, byteSize } = await uploadFile(processed, processed.type);
  return { objectUrl, byteSize, file: processed };
}
