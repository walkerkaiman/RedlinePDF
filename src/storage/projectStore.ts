import { openDB, type IDBPDatabase } from 'idb';
import type { ProjectData } from '../model/document.ts';

const DB_NAME = 'redlinepdf';
const DB_VERSION = 2;
const STORE_PROJECT = 'project';
const STORE_PDF = 'pdfBytes';
const STORE_RECENT_CACHE = 'recentCache';
const AUTOSAVE_KEY = 'autosave';

interface ProjectRecord {
  key: string;
  data: ProjectData;
  savedAt: number;
}

interface PdfRecord {
  key: string;
  bytes: Uint8Array;
}

interface RecentCacheRecord {
  key: string;       // UUID matching RecentEntry.cacheKey
  bytes: Uint8Array; // raw file bytes (PDF or .redline as UTF-8)
}

async function getDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_PROJECT)) {
        db.createObjectStore(STORE_PROJECT, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_PDF)) {
        db.createObjectStore(STORE_PDF, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_RECENT_CACHE)) {
        db.createObjectStore(STORE_RECENT_CACHE, { keyPath: 'key' });
      }
    },
  });
}

/** Store raw file bytes in the recent-files cache. Returns the cache key. */
export async function cacheRecentFile(key: string, bytes: Uint8Array): Promise<void> {
  const db = await getDb();
  const record: RecentCacheRecord = { key, bytes };
  await db.put(STORE_RECENT_CACHE, record);
}

/** Retrieve raw file bytes from the recent-files cache. Returns null if not found. */
export async function getCachedRecentFile(key: string): Promise<Uint8Array | null> {
  const db = await getDb();
  const record = await db.get(STORE_RECENT_CACHE, key) as RecentCacheRecord | undefined;
  return record?.bytes ?? null;
}

/** Remove a single entry from the recent-files cache. */
export async function removeCachedRecentFile(key: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_RECENT_CACHE, key);
}

/** Save project model + PDF bytes to IndexedDB (autosave slot) */
export async function autosaveProject(project: ProjectData, pdfBytes: Uint8Array): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([STORE_PROJECT, STORE_PDF], 'readwrite');
  const projectRecord: ProjectRecord = { key: AUTOSAVE_KEY, data: project, savedAt: Date.now() };
  const pdfRecord: PdfRecord = { key: AUTOSAVE_KEY, bytes: pdfBytes };
  await Promise.all([
    tx.objectStore(STORE_PROJECT).put(projectRecord),
    tx.objectStore(STORE_PDF).put(pdfRecord),
    tx.done,
  ]);
}

/** Load autosaved project from IndexedDB */
export async function loadAutosave(): Promise<{ project: ProjectData; pdfBytes: Uint8Array } | null> {
  const db = await getDb();
  const [projectRecord, pdfRecord] = await Promise.all([
    db.get(STORE_PROJECT, AUTOSAVE_KEY) as Promise<ProjectRecord | undefined>,
    db.get(STORE_PDF, AUTOSAVE_KEY) as Promise<PdfRecord | undefined>,
  ]);
  if (!projectRecord || !pdfRecord) return null;
  return { project: projectRecord.data, pdfBytes: pdfRecord.bytes };
}

/** Clear autosave slot */
export async function clearAutosave(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([STORE_PROJECT, STORE_PDF], 'readwrite');
  await Promise.all([
    tx.objectStore(STORE_PROJECT).delete(AUTOSAVE_KEY),
    tx.objectStore(STORE_PDF).delete(AUTOSAVE_KEY),
    tx.done,
  ]);
}

/** Build the raw .redline JSON string (used by both browser download and Tauri native save) */
export function buildRedlinePayload(project: ProjectData, pdfBytes: Uint8Array): string {
  const payload = {
    version: 1,
    project,
    pdfBase64: uint8ArrayToBase64(pdfBytes),
  };
  return JSON.stringify(payload);
}

/** Export a .redline project file (JSON + base64 PDF) and trigger download */
export function exportProjectFile(project: ProjectData, pdfBytes: Uint8Array, fileName: string): void {
  const json = buildRedlinePayload(project, pdfBytes);
  const blob = new Blob([json], { type: 'application/json' });
  triggerDownload(blob, fileName.replace(/\.pdf$/i, '') + '.redline');
}

/** Parse a .redline file and return project data + PDF bytes */
export async function importProjectFile(file: File): Promise<{ project: ProjectData; pdfBytes: Uint8Array }> {
  const text = await file.text();
  const payload = JSON.parse(text) as { version: number; project: ProjectData; pdfBase64: string };
  if (!payload.project || !payload.pdfBase64) {
    throw new Error('Invalid .redline file format');
  }
  const pdfBytes = base64ToUint8Array(payload.pdfBase64);
  return { project: payload.project, pdfBytes };
}

/**
 * Save a file with the best available dialog for the current browser.
 *
 * - Chrome / Edge 86+: opens a real "Save As" dialog (File System Access API)
 *   where the user can type a filename and choose a folder.
 * - Firefox / Safari / older browsers: falls back to a normal browser download
 *   (respects the browser's "always ask where to save" setting).
 * - If the user cancels the picker the promise resolves silently.
 *
 * IMPORTANT: must be called within a browser user-activation window (shortly
 * after a click/key event). If heavy async work will happen before the file is
 * written, use `openSaveFilePicker` + `writeFileHandle` instead so the picker
 * opens while activation is still fresh.
 */
export async function saveWithFilePicker(
  blob: Blob,
  suggestedName: string,
  description: string,
  accept: Record<string, string[]>,
): Promise<void> {
  const handle = await openSaveFilePicker(suggestedName, description, accept);
  if (handle === null) {
    // Either cancelled (File System Access API present) or API not available.
    if ('showSaveFilePicker' in window) return; // user cancelled
    triggerDownload(blob, suggestedName);       // API not supported → download
    return;
  }
  await writeFileHandle(handle, blob);
}

/**
 * Open the native "Save As" picker and return the file handle.
 *
 * Call this IMMEDIATELY after a user-activation event (click, key) so the
 * browser's transient-activation window is still open. The actual file write
 * can happen later via `writeFileHandle`.
 *
 * Returns null if:
 *  - the File System Access API is not available (use `triggerDownload` instead)
 *  - the user cancelled the picker
 */
export async function openSaveFilePicker(
  suggestedName: string,
  description: string,
  accept: Record<string, string[]>,
): Promise<FileSystemFileHandle | null> {
  if (!('showSaveFilePicker' in window)) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (window as any).showSaveFilePicker({
      suggestedName,
      types: [{ description, accept }],
    });
  } catch (err) {
    if ((err as DOMException).name === 'AbortError') return null; // user cancelled
    console.warn('showSaveFilePicker failed:', err);
    return null;
  }
}

/**
 * Write a blob to a previously-obtained FileSystemFileHandle.
 * Unlike `showSaveFilePicker`, `createWritable` does not need user activation.
 */
export async function writeFileHandle(handle: FileSystemFileHandle, blob: Blob): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/** Trigger a browser file download */
export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
