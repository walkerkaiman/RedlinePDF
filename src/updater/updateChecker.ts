import { isNewerVersion } from './versionCompare';

export type UpdateStatus = 'up-to-date' | 'available' | 'error';

export interface CheckUpdateResult {
  status: UpdateStatus;
  latestVersion?: string;
  downloadUrl?: string;
}

/** Pure dispatcher: given local version and Rust command result, decide the update state. */
export function resolveUpdate(
  currentVersion: string,
  rustOutput: { latest_version: string; download_url?: string } | null,
  err: Error | null,
): CheckUpdateResult {
  if (err) return { status: 'error' };
  if (!rustOutput) return { status: 'error' };

  const lv = rustOutput.latest_version;
  const available = isNewerVersion(lv, currentVersion);
  return available
    ? { status: 'available', latestVersion: lv, downloadUrl: rustOutput.download_url }
    : { status: 'up-to-date', latestVersion: lv };
}

/** Call Rust command and compare against current version. */
export async function checkForUpdates(currentVersion: string): Promise<CheckUpdateResult> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rustOutput = (await invoke('check_for_update')) as any;
    return resolveUpdate(currentVersion, rustOutput, null);
  } catch (e) {
    console.error('Updater error:', e);
    return resolveUpdate(currentVersion, null, e instanceof Error ? e : new Error(String(e)));
  }
}
