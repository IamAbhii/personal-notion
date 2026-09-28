// Image helpers for paste paths. Downscaling here keeps the block payload under the server's
// 2 MB image limit and avoids blowing the keepalive 64 KiB quota (which would surface as a
// false "offline" error even when the device is connected).

/** Longest edge a pasted image may have after rescaling. Retina screenshots are typically 2x. */
export const IMAGE_MAX_EDGE_PX = 1600;

/**
 * When a PNG data URL exceeds this byte size we re-encode as JPEG. Screenshots are text-heavy so
 * PNG is preferred for sharpness; JPEG is the fallback when the PNG would be unreasonably large.
 */
export const IMAGE_PNG_SIZE_THRESHOLD_BYTES = 1_500_000;

/**
 * Loads an image blob into an HTMLImageElement. Resolves when the image has decoded, rejects on
 * error. The caller is responsible for revoking the object URL.
 */
function loadImage(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = objectUrl;
  });
}

/**
 * Compresses a pasted image file/blob to a data URL suitable for storage:
 *  - Scales down so the longest edge is at most IMAGE_MAX_EDGE_PX (never upscales).
 *  - Encodes as PNG first; if the result exceeds IMAGE_PNG_SIZE_THRESHOLD_BYTES, re-encodes as
 *    JPEG at 0.85 quality. Screenshots are text-heavy so PNG is preferred; JPEG is the size
 *    fallback.
 *
 * Always revokes the object URL created internally, so the caller need not manage it.
 */
export async function compressPastedImage(file: File | Blob): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);

    const { naturalWidth: w, naturalHeight: h } = img;
    const longestEdge = Math.max(w, h);
    // Only downscale — never upscale a small image.
    const scale = longestEdge > IMAGE_MAX_EDGE_PX ? IMAGE_MAX_EDGE_PX / longestEdge : 1;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const pngDataUrl = canvas.toDataURL('image/png');
    // Re-encode as JPEG when the PNG is too large for comfortable storage.
    if (pngDataUrl.length > IMAGE_PNG_SIZE_THRESHOLD_BYTES) {
      return canvas.toDataURL('image/jpeg', 0.85);
    }
    return pngDataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
