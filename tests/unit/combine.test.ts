import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  mergePdfBytes, reorderPdfBytes, deletePdfPage, rotatePdfPage,
  applyPageOrder, renumberPages,
} from '../../src/pdf/combine.ts';
import type { PageData } from '../../src/model/document.ts';

const FIXTURES = path.join(__dirname, '..', 'fixtures');

function bytesOf(file: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, file)));
}

async function pageSizes(bytes: Uint8Array): Promise<Array<[number, number]>> {
  const doc = await PDFDocument.load(bytes.slice(0));
  return doc.getPages().map(p => {
    const { width, height } = p.getSize();
    return [Math.round(width), Math.round(height)] as [number, number];
  });
}

// Fixtures: test.pdf = 1 page 612x792 · test-3page-mixed.pdf = 3 pages
// 200x300 / 300x200 / 250x250 — distinct sizes let us verify page identity.
const base1 = bytesOf('test.pdf');
const three = bytesOf('test-3page-mixed.pdf');
const SIZES3: Array<[number, number]> = [[200, 300], [300, 200], [250, 250]];

function page(id: string, index: number, markupIds: string[] = []): PageData {
  return {
    index,
    pageId: id,
    scale: { pointsPerUnit: 0, calibrationUnit: 'in', calibrated: false },
    markups: markupIds.map(mid => ({ id: mid, type: 'box', pageIndex: index, style: {}, x: 0, y: 0, width: 1, height: 1 })),
    countCategories: [],
  };
}

describe('mergePdfBytes', () => {
  it('appends pages at the end by default', async () => {
    const { bytes, addedPages } = await mergePdfBytes(base1, three);
    expect(addedPages).toBe(3);
    expect(await pageSizes(bytes)).toEqual([[612, 792], ...SIZES3]);
  });

  it('inserts at a given position', async () => {
    const { bytes } = await mergePdfBytes(three, base1, 1);
    expect(await pageSizes(bytes)).toEqual([[200, 300], [612, 792], [300, 200], [250, 250]]);
  });

  it('does not mutate the input buffers (autosave bytes stay usable)', async () => {
    const before = Buffer.from(three);
    await mergePdfBytes(three, base1, null);
    expect(Buffer.compare(Buffer.from(three), before)).toBe(0);
    const doc = await PDFDocument.load(three.slice(0));
    expect(doc.getPageCount()).toBe(3);
  });

  it('throws on garbage input', async () => {
    await expect(mergePdfBytes(base1, new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});

describe('reorderPdfBytes', () => {
  it('rebuilds bytes in the requested order', async () => {
    const bytes = await reorderPdfBytes(three, [2, 0, 1]);
    expect(await pageSizes(bytes)).toEqual([[250, 250], [200, 300], [300, 200]]);
  });

  it('round-trips: reorder then inverse reorder restores original order', async () => {
    const once = await reorderPdfBytes(three, [2, 0, 1]);
    const back = await reorderPdfBytes(once, [1, 2, 0]);
    expect(await pageSizes(back)).toEqual(SIZES3);
  });

  it('rejects invalid permutations', async () => {
    await expect(reorderPdfBytes(three, [0, 0, 2])).rejects.toThrow(/permutation/);
    await expect(reorderPdfBytes(three, [0, 1])).rejects.toThrow(/permutation/);
    await expect(reorderPdfBytes(three, [0, 1, 5])).rejects.toThrow(/permutation/);
  });
});

describe('deletePdfPage', () => {
  it('removes the page at index', async () => {
    const bytes = await deletePdfPage(three, 1);
    expect(await pageSizes(bytes)).toEqual([[200, 300], [250, 250]]);
  });

  it('refuses to delete the only page', async () => {
    await expect(deletePdfPage(base1, 0)).rejects.toThrow(/only page/);
  });
});

describe('rotatePdfPage', () => {
  it('adds rotation without touching other pages', async () => {
    const bytes = await rotatePdfPage(three, 1, 90);
    const doc = await PDFDocument.load(bytes.slice(0));
    expect(doc.getPage(1).getRotation().angle).toBe(90);
    expect(doc.getPage(0).getRotation().angle).toBe(0);
  });

  it('accumulates and wraps at 360', async () => {
    let bytes = await rotatePdfPage(three, 0, 270);
    bytes = await rotatePdfPage(bytes, 0, 90);
    const doc = await PDFDocument.load(bytes.slice(0));
    expect(doc.getPage(0).getRotation().angle).toBe(0);
  });
});

describe('applyPageOrder (model remap)', () => {
  it('re-splices pages, renumbers index, and drags markups along', () => {
    const pages = [
      page('p_a', 0, ['m1']),
      page('p_b', 1, ['m2', 'm3']),
      page('p_c', 2),
    ];
    const next = applyPageOrder(pages, [2, 0, 1]);
    expect(next.map(p => p.pageId)).toEqual(['p_c', 'p_a', 'p_b']);
    expect(next.map(p => p.index)).toEqual([0, 1, 2]);
    expect(next[1].markups.map(m => m.pageIndex)).toEqual([1]);      // m1 followed p_a to slot 1
    expect(next[2].markups.map(m => m.pageIndex)).toEqual([2, 2]);   // m2,m3 followed p_b to slot 2
  });

  it('identity order is a no-op', () => {
    const pages = [page('p_a', 0, ['m1']), page('p_b', 1)];
    const next = applyPageOrder(pages, [0, 1]);
    expect(next.map(p => p.pageId)).toEqual(['p_a', 'p_b']);
    expect(next[0].markups[0].pageIndex).toBe(0);
  });

  it('rejects invalid permutations', () => {
    const pages = [page('p_a', 0), page('p_b', 1)];
    expect(() => applyPageOrder(pages, [0, 0])).toThrow(/permutation/);
  });
});

describe('renumberPages', () => {
  it('fixes indices after insert/delete', () => {
    const pages = [page('p_b', 3, ['m9']), page('p_a', 7, ['m8'])];
    renumberPages(pages);
    expect(pages.map(p => p.index)).toEqual([0, 1]);
    expect(pages[0].markups[0].pageIndex).toBe(0);
    expect(pages[1].markups[0].pageIndex).toBe(1);
  });
});
