/** File-type helpers shared by the drag-drop and file-input paths.

    Pure functions — unit-tested in tests/unit/fileTypes.test.ts, because the
    Tauri drag-drop path cannot be exercised by the browser e2e harness. */

/** Supported image extensions (leading dot). */
export const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
]);

/** True if a file name (from OS drag-drop or an input) is a supported image. */
export function hasImageExtension(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

/** True if a browser File is a supported image (name-based, matching drop). */
export function isImageFile(file: File): boolean {
  return hasImageExtension(file.name);
}

/** Correct MIME for an image file name (File.type feeds the data-URL prefix,
 *  so image/jpg / image/svg would break decoding of the dropped image). */
export function imageMimeFor(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  switch (ext) {
    case 'jpg': return 'image/jpeg';
    case 'svg': return 'image/svg+xml';
    default: return 'image/' + ext; // png, gif, webp, bmp, jpeg
  }
}
