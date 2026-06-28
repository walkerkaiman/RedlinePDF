/**
 * Tauri integration layer.
 * Provides native file open/save dialogs when running inside the Tauri desktop app.
 * All functions are no-ops (return null) when running in a regular browser.
 *
 * These packages are bundled by Vite. They only do anything at call-time (via
 * Tauri IPC), so importing them in a browser context is safe — they just
 * export functions that wrap window.__TAURI_INTERNALS__, which is not present
 * in a browser and therefore never reached (isTauri() guards all calls).
 */

import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile, readTextFile, exists } from '@tauri-apps/plugin-fs';
import { desktopDir, join } from '@tauri-apps/api/path';

/** Returns true when running inside a Tauri desktop window */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Open a native "Open PDF" dialog and return the file bytes, name, and path.
 * Returns null in a browser (handled by <input type="file">).
 */
export async function openPdfFileNative(): Promise<{ bytes: Uint8Array; name: string; path: string } | null> {
  if (!isTauri()) return null;
  try {
    const selected = await open({
      title: 'Open PDF',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      multiple: false,
    });
    if (!selected || Array.isArray(selected)) return null;
    const path = selected as string;
    const bytes = await readFile(path);
    const name = path.split(/[\\/]/).pop() ?? 'document.pdf';
    return { bytes: new Uint8Array(bytes), name, path };
  } catch (err) {
    console.error('Tauri file open failed:', err);
    return null;
  }
}

/**
 * Open a PDF from a known path (used for Recent Files).
 * Returns null if the file cannot be read (e.g. moved or deleted).
 */
export async function openRecentPdfNative(path: string): Promise<{ bytes: Uint8Array; name: string } | null> {
  if (!isTauri()) return null;
  try {
    const bytes = await readFile(path);
    const name = path.split(/[\\/]/).pop() ?? 'document.pdf';
    return { bytes: new Uint8Array(bytes), name };
  } catch (err) {
    console.error('Tauri recent PDF open failed:', err);
    return null;
  }
}

/**
 * Open a .redline project from a known path (used for Recent Files).
 * Returns null if the file cannot be read.
 */
export async function openRecentProjectNative(path: string): Promise<File | null> {
  if (!isTauri()) return null;
  try {
    const text = await readTextFile(path);
    const blob = new Blob([text], { type: 'application/json' });
    const name = path.split(/[\\/]/).pop() ?? 'project.redline';
    return new File([blob], name, { type: 'application/json' });
  } catch (err) {
    console.error('Tauri recent project open failed:', err);
    return null;
  }
}

/**
 * Save bytes via a native "Save" dialog.
 * Returns the path saved to, or null if cancelled or in browser mode.
 */
export async function saveFileNative(
  bytes: Uint8Array,
  defaultName: string,
  extension: string,
  filterLabel: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  try {
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
 * Save PNG bytes to the user's Desktop with an auto-incrementing filename so
 * files never collide. Returns the full saved path, or null if not in Tauri.
 *
 * Example: baseName "drawing" → Desktop/drawing_1.png, drawing_2.png, …
 */
export async function saveSnapshotToDesktop(baseName: string, bytes: Uint8Array): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const desktop = await desktopDir();
    let n = 1;
    let fullPath: string;
    do {
      fullPath = await join(desktop, `${baseName}_${n}.png`);
      n++;
    } while (await exists(fullPath));
    await writeFile(fullPath, bytes);
    return fullPath;
  } catch (err) {
    console.error('Tauri snapshot save failed:', err);
    return null;
  }
}

/**
 * Open a native "Open Project" (.redline) dialog and return a File object + path.
 * Returns null in a browser.
 */
export async function openProjectFileNative(): Promise<{ file: File; path: string } | null> {
  if (!isTauri()) return null;
  try {
    const selected = await open({
      title: 'Open Project',
      filters: [{ name: 'RedlinePDF Projects', extensions: ['redline'] }],
      multiple: false,
    });
    if (!selected || Array.isArray(selected)) return null;
    const path = selected as string;
    const text = await readTextFile(path);
    const blob = new Blob([text], { type: 'application/json' });
    const name = path.split(/[\\/]/).pop() ?? 'project.redline';
    return { file: new File([blob], name, { type: 'application/json' }), path };
  } catch (err) {
    console.error('Tauri project open failed:', err);
    return null;
  }
}
