/** Compare two semver strings (major.minor.patch). Returns true when remote > local. */
export function isNewerVersion(remote: string, local: string): boolean {
  const [ra, ba] = [remote, local].map(v => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) {
    if ((ra[i] ?? 0) > (ba[i] ?? 0)) return true;
    if ((ra[i] ?? 0) < (ba[i] ?? 0)) return false;
  }
  return false; // equal
}
