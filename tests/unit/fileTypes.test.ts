import { describe, it, expect } from 'vitest';
import { hasImageExtension, imageMimeFor, IMAGE_EXTENSIONS } from '../../src/util/fileTypes.ts';

describe('hasImageExtension', () => {
  it('accepts every supported extension, any case', () => {
    for (const ext of IMAGE_EXTENSIONS) {
      expect(hasImageExtension(`photo${ext}`)).toBe(true);
      expect(hasImageExtension(`photo${ext.toUpperCase()}`)).toBe(true);
    }
  });

  it('accepts dotted paths and hidden-ish names', () => {
    expect(hasImageExtension('/home/user/my.plan.png')).toBe(true);
  });

  it('rejects non-image and extension-less names', () => {
    expect(hasImageExtension('sheet.pdf')).toBe(false);
    expect(hasImageExtension('project.redline')).toBe(false);
    expect(hasImageExtension('README')).toBe(false);
    expect(hasImageExtension('archive.tar.gz')).toBe(false); // .gz not an image
  });

  it('is dot-aware (regression: bare ext vs dotted set mismatch)', () => {
    // The Tauri drop path once compared 'png' against a set of '.png' entries,
    // so NO image ever matched and drops fell through as "unsupported".
    expect(hasImageExtension('png')).toBe(false);
    for (const bare of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']) {
      expect(hasImageExtension(`${bare}.png`)).toBe(true);
    }
  });
});

describe('imageMimeFor', () => {
  it('maps extensions to real MIME types', () => {
    expect(imageMimeFor('a.png')).toBe('image/png');
    expect(imageMimeFor('a.JPG')).toBe('image/jpeg');
    expect(imageMimeFor('a.jpeg')).toBe('image/jpeg');
    expect(imageMimeFor('a.svg')).toBe('image/svg+xml');
    expect(imageMimeFor('a.webp')).toBe('image/webp');
    expect(imageMimeFor('a.gif')).toBe('image/gif');
    expect(imageMimeFor('a.bmp')).toBe('image/bmp');
  });
});
