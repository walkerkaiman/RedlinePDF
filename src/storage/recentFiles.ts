/**
 * Recent files persistence via localStorage.
 * Stores up to MAX_RECENT entries for PDFs and .redline projects separately.
 * Each entry records the display name, the full OS path (Tauri only; null in
 * browser), and the timestamp of the last open.
 */

export interface RecentEntry {
  name: string;
  path: string | null;
  openedAt: number;
  /** IndexedDB key for the cached file bytes (browser only; null in Tauri) */
  cacheKey: string | null;
}

const MAX_RECENT = 10;
const KEY_PDF     = 'redlinepdf_recent_pdf';
const KEY_PROJECT = 'redlinepdf_recent_project';

function load(key: string): RecentEntry[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as RecentEntry[];
  } catch {
    return [];
  }
}

function save(key: string, entries: RecentEntry[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    // Ignore quota errors — recent files are non-critical
  }
}

function addEntry(key: string, entry: RecentEntry): void {
  let entries = load(key);
  // Deduplicate: remove any existing entry with the same path (or name if path is null)
  entries = entries.filter(e =>
    entry.path !== null ? e.path !== entry.path : e.name !== entry.name
  );
  entries.unshift(entry);
  if (entries.length > MAX_RECENT) entries.length = MAX_RECENT;
  save(key, entries);
}

function removeEntry(key: string, path: string | null, name: string): void {
  let entries = load(key);
  entries = entries.filter(e =>
    path !== null ? e.path !== path : e.name !== name
  );
  save(key, entries);
}

export function getRecentPdfs(): RecentEntry[]     { return load(KEY_PDF); }
export function getRecentProjects(): RecentEntry[] { return load(KEY_PROJECT); }

export function addRecentPdf(entry: RecentEntry): void     { addEntry(KEY_PDF, entry); }
export function addRecentProject(entry: RecentEntry): void { addEntry(KEY_PROJECT, entry); }

export function removeRecentPdf(path: string | null, name: string): void {
  removeEntry(KEY_PDF, path, name);
}
export function removeRecentProject(path: string | null, name: string): void {
  removeEntry(KEY_PROJECT, path, name);
}
