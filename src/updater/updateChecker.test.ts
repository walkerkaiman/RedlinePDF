import { describe, it, expect } from 'vitest';
import { resolveUpdate } from './updateChecker';

describe('resolveUpdate', () => {
  it('returns UP_TO_DATE when no newer version available', () => {
    const result = resolveUpdate('0.1.5', { latest_version: '0.1.5' }, null);
    expect(result.status).toBe('up-to-date');
    expect(result.latestVersion).toBe('0.1.5');
  });

  it('returns UPDATE_AVAILABLE with download URL when newer version exists', () => {
    const result = resolveUpdate('0.1.4', { latest_version: '0.2.0', download_url: 'https://example.com/update.deb' }, null);
    expect(result.status).toBe('available');
    expect(result.latestVersion).toBe('0.2.0');
    expect(result.downloadUrl).toBe('https://example.com/update.deb');
  });

  it('returns ERROR when rust command throws', () => {
    const result = resolveUpdate('0.1.4', null, new Error('network failure'));
    expect(result.status).toBe('error');
  });
});
