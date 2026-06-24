/**
 * Tauri integration layer.
 * Provides native file open/save dialogs when running inside Tauri.
 * Falls back silently to browser <input type="file"> when running in a browser.
 *
 * The /* @vite-ignore * / comments suppress Vite's module resolution for these
 * imports — they are only available at runtime inside the Tauri webview.
 */

/** Returns true when running inside a Tauri window */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Open a native "Open PDF" dialog.
 * Returns null in a browser (handled by <input type="file">).
 */
export async function openPdfFileNative(): Promise<{ bytes: Uint8Array; name: string } | null> {
  if (!isTauri()) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore – available only inside Tauri webview
    const { open } = await import(/* @vite-ignore */ '@tauri-apps/plugin-dialog');
    // @ts-ignore
    const { readFile } = await import(/* @vite-ignore */ '@tauri-apps/plugin-fs');

    const path = await open({
      title: 'Open PDF',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      multiple: false,
    });

    if (!path || Array.isArray(path)) return null;

    const bytes = await readFile(path);
    const name = (path as string).split(/[\\/]/).pop() ?? 'document.pdf';
    return { bytes: new Uint8Array(bytes), name };
  } catch (err) {
    console.error('Tauri file open failed:', err);
    return null;
  }
}

/**
 * Save bytes via a native "Save" dialog.
 * Returns the path saved to, or null if cancelled.
 */
export async function saveFileNative(
  bytes: Uint8Array,
  defaultName: string,
  extension: string,
  filterLabel: string
): Promise<string | null> {
  if (!isTauri()) return null;

  try {
    // @ts-ignore
    const { save } = await import(/* @vite-ignore */ '@tauri-apps/plugin-dialog');
    // @ts-ignore
    const { writeFile } = await import(/* @vite-ignore */ '@tauri-apps/plugin-fs');

    const path = await save({
      title: 'Save File',
      defaultPath: defaultName,
      filters: [{ name: filterLabel, extensions: [extension] }],
    });

    if (!path) return null;
    await writeFile(path, bytes);
    return path;
  } catch (err) {
    console.error('Tauri file save failed:', err);
    return null;
  }
}

/**
 * Open a native "Open Project" (.redline) dialog.
 */
export async function openProjectFileNative(): Promise<File | null> {
  if (!isTauri()) return null;

  try {
    // @ts-ignore
    const { open } = await import(/* @vite-ignore */ '@tauri-apps/plugin-dialog');
    // @ts-ignore
    const { readTextFile } = await import(/* @vite-ignore */ '@tauri-apps/plugin-fs');

    const path = await open({
      title: 'Open Project',
      filters: [{ name: 'RedlinePDF Projects', extensions: ['redline'] }],
      multiple: false,
    });

    if (!path || Array.isArray(path)) return null;

    const text = await readTextFile(path as string);
    const blob = new Blob([text], { type: 'application/json' });
    const name = (path as string).split(/[\\/]/).pop() ?? 'project.redline';
    return new File([blob], name, { type: 'application/json' });
  } catch (err) {
    console.error('Tauri project open failed:', err);
    return null;
  }
}
