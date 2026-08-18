import { describe, it, expect } from 'vitest';
import { isNewerVersion } from './versionCompare';

describe('isNewerVersion', () => {
  it('returns false when versions are equal', () => {
    expect(isNewerVersion('0.1.5', '0.1.5')).toBe(false);
  });

  it('returns true when remote is newer patch', () => {
    expect(isNewerVersion('0.1.6', '0.1.5')).toBe(true);
  });

  it('returns false when local is newer patch', () => {
    expect(isNewerVersion('0.1.4', '0.1.5')).toBe(false);
  });

  it('returns true when remote is newer minor', () => {
    expect(isNewerVersion('0.2.0', '0.1.10')).toBe(true);
  });

  it('returns true when remote is newer major', () => {
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
  });
});
