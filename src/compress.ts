/* Browser-side photo compression (loaded only with the report flow). No library: canvas.toBlob.
   Longest side at most 1280 px, WebP at quality 0.8. Files under 300 KB are sent as they are. */

export const MAX_ORIGINAL_BYTES = 12 * 1024 * 1024;
const SEND_AS_IS_BYTES = 300 * 1024;
const MAX_SIDE = 1280;

export class PhotoTooLargeError extends Error {}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));

export async function compressPhoto(file: File): Promise<Blob> {
  if (file.size > MAX_ORIGINAL_BYTES) throw new PhotoTooLargeError("This photo is larger than 12 MB. Please pick another photo.");
  if (file.size <= SEND_AS_IS_BYTES) return file;
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decode(file);
  } catch {
    return file; // e.g. HEIC on browsers that cannot decode it: the server converts it
  }
  const w = "naturalWidth" in source ? source.naturalWidth : source.width;
  const h = "naturalHeight" in source ? source.naturalHeight : source.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ("close" in source) source.close();
  const blob = (await toBlob(canvas, "image/webp", 0.8)) ?? (await toBlob(canvas, "image/jpeg", 0.8));
  return blob && blob.size < file.size ? blob : file;
}
