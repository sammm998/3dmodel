'use client';
import { viewportHandles } from '../three/registry';

/** Small JPEG thumbnail of the current viewport (for project cards/versions). */
export function captureThumbnail(width = 480): string | null {
  const src = viewportHandles.gl?.domElement;
  if (!src || !src.width) return null;
  const c = document.createElement('canvas');
  const h = Math.round((src.height / src.width) * width);
  c.width = width;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(src, 0, 0, width, h);
    return c.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;
  }
}

/** High-resolution still of the current view. */
export async function captureImage(scale = 2): Promise<Blob | null> {
  const gl = viewportHandles.gl;
  if (!gl) return null;
  const prev = gl.getPixelRatio();
  gl.setPixelRatio(Math.min(4, window.devicePixelRatio * scale));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 150));
  const blob = await new Promise<Blob | null>((res) => gl.domElement.toBlob(res, 'image/png'));
  gl.setPixelRatio(prev);
  return blob;
}
