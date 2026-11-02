import { apiRequest } from "@/lib/queryClient";
import { fileToDataUrl } from "@/lib/offline-outbox";
import { prepareUploadFile, uploadFile } from "@/lib/upload-media";

export const FARMER_PHOTO_LIMIT = 6;

export type ScenePhoto = {
  url: string;
  filename: string;
  mimeType: string;
  byteSize?: number;
};

export type QueuedScenePhoto = {
  dataUrl: string;
  name: string;
};

/** Shrink and upload each photo. The first can ride on the report; the rest are attachments. */
export async function uploadScenePhotos(files: File[]): Promise<ScenePhoto[]> {
  const out: ScenePhoto[] = [];
  for (const file of files) {
    const shrunk = await prepareUploadFile(file, { preset: "compact" });
    const uploaded = await uploadFile(shrunk, shrunk.type);
    out.push({
      url: uploaded.objectUrl,
      filename: shrunk.name,
      mimeType: shrunk.type || "image/jpeg",
      byteSize: uploaded.byteSize,
    });
  }
  return out;
}

export async function queueScenePhotos(files: File[]): Promise<QueuedScenePhoto[]> {
  const out: QueuedScenePhoto[] = [];
  for (const file of files) {
    const shrunk = await prepareUploadFile(file, { preset: "compact" });
    out.push({ dataUrl: await fileToDataUrl(shrunk), name: shrunk.name });
  }
  return out;
}

/** Attach photos the report body did not already store. */
export async function attachScenePhotos(
  incidentId: number,
  photos: ScenePhoto[],
  firstAlreadyStored: boolean,
): Promise<void> {
  const pending = firstAlreadyStored ? photos.slice(1) : photos;
  for (const photo of pending) {
    await apiRequest("POST", `/api/incidents/${incidentId}/attachments`, {
      url: photo.url,
      filename: photo.filename,
      mimeType: photo.mimeType,
      evidencePhase: "scene",
      byteSize: photo.byteSize,
    });
  }
}
