import { readImage } from '@tauri-apps/plugin-clipboard-manager';

/** Decode the native clipboard image and hand the existing attachment path a PNG. */
export async function readClipboardImage(): Promise<File | null> {
  const image = await readImage().catch((error: unknown) => {
    // arboard uses this error when the clipboard holds text or is empty.
    if (String(error).includes('clipboard contents were not available')) return null;
    throw error;
  });
  if (!image) return null;
  try {
    const { width, height } = await image.size();
    if (width * height > 10_000_000) throw new Error('Clipboard image exceeds the 10 megapixel import limit');
    const rgba = await image.rgba();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('Could not encode PNG')),
      'image/png',
    ));
    return new File([blob], 'image.png', { type: 'image/png' });
  } finally {
    await image.close();
  }
}
