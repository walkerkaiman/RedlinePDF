import { PDFDocument, degrees } from 'pdf-lib';
import type { PageData } from '../model/document.ts';

/**
 * Structural PDF operations (combine / reorder / delete / rotate).
 *
 * Core invariant these functions maintain: the returned PDF bytes always have
 * their page order match `project.pages` array order, so `pages[i].index === i`
 * stays true and the pdf.js renderer needs no identity indirection.
 * Markups live in the project model, never in the PDF bytes, so rebuilding
 * bytes never touches annotations.
 *
 * NOTE: pdf-lib copyPages does not carry over AcroForm fields or PDF-level
 * annotations from source documents. Acceptable for plan sets; documented in README.
 */

async function loadDoc(bytes: Uint8Array): Promise<PDFDocument> {
  // copy bytes: PDFDocument.load can detach from / mutate the input buffer,
  // and our `pdfBytes` module state must stay usable for autosave.
  return PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });
}

export interface MergeResult {
  bytes: Uint8Array;
  addedPages: number;
}

/**
 * Append (insertAt = null) or insert (insertAt = 0..target page count) all
 * pages of `newBytes` into `baseBytes`. Throws on invalid/encrypted input.
 */
export async function mergePdfBytes(
  baseBytes: Uint8Array,
  newBytes: Uint8Array,
  insertAt: number | null = null,
): Promise<MergeResult> {
  const target = await loadDoc(baseBytes);
  const source = await loadDoc(newBytes);

  if (source.getPageCount() === 0) {
    throw new Error('The dropped PDF contains no pages.');
  }

  const at = insertAt === null ? target.getPageCount() : Math.max(0, Math.min(insertAt, target.getPageCount()));

  const copied = await target.copyPages(source, source.getPageIndices());
  copied.forEach((p, i) => target.insertPage(at + i, p));

  const bytes = await target.save({ useObjectStreams: true });
  return { bytes, addedPages: copied.length };
}

/**
 * Rebuild the PDF with pages in the given order (permutation of 0..n-1).
 */
export async function reorderPdfBytes(bytes: Uint8Array, order: number[]): Promise<Uint8Array> {
  const source = await loadDoc(bytes);
  const n = source.getPageCount();
  if (order.length !== n || new Set(order).size !== n || order.some(i => i < 0 || i >= n)) {
    throw new Error(`Invalid reorder permutation (expected ${n} unique indices in 0..${n - 1}).`);
  }
  // pdf-lib 1.17 has no in-place movePages: copy pages into a fresh document
  // in the requested order (copyPages preserves content, resources, /Rotate).
  const target = await PDFDocument.create();
  const copied = await target.copyPages(source, order);
  copied.forEach(p => target.addPage(p));
  return target.save({ useObjectStreams: true });
}

/**
 * Delete the page at `index`. Refuses to delete the last remaining page.
 */
export async function deletePdfPage(bytes: Uint8Array, index: number): Promise<Uint8Array> {
  const doc = await loadDoc(bytes);
  const n = doc.getPageCount();
  if (index < 0 || index >= n) throw new Error(`Page ${index} out of range (${n} pages).`);
  if (n === 1) throw new Error('Cannot delete the only page.');
  doc.removePage(index);
  return doc.save({ useObjectStreams: true });
}

/**
 * Rotate the page at `index` by `deltaDeg` (e.g. 90). Only the /Rotate entry
 * changes — page content is never rasterized.
 */
export async function rotatePdfPage(bytes: Uint8Array, index: number, deltaDeg: number): Promise<Uint8Array> {
  const doc = await loadDoc(bytes);
  if (index < 0 || index >= doc.getPageCount()) throw new Error(`Page ${index} out of range.`);
  const page = doc.getPage(index);
  const current = page.getRotation().angle;
  page.setRotation(degrees((((current + deltaDeg) % 360) + 360) % 360));
  return doc.save({ useObjectStreams: true });
}

/**
 * Apply a new page order to the project model: re-splice `project.pages`,
 * renumber `pages[].index`, and remap every `markup.pageIndex` so annotations
 * travel with their page. Call BEFORE rebuilding the PDF bytes.
 */
export function applyPageOrder(pages: PageData[], order: number[]): PageData[] {
  const n = pages.length;
  if (order.length !== n || new Set(order).size !== n || order.some(i => i < 0 || i >= n)) {
    throw new Error(`Invalid reorder permutation (expected ${n} unique indices in 0..${n - 1}).`);
  }
  const newPages = order.map((oldPos, newIndex) => ({ page: pages[oldPos], newIndex }));
  for (const { page, newIndex } of newPages) {
    page.index = newIndex;
    // Markups are owned by their page object; pageIndex is positional and must
    // follow the page to its new slot (also corrects legacy drift).
    for (const m of page.markups) m.pageIndex = newIndex;
  }
  return newPages.map(x => x.page);
}

/**
 * Renumber pages after an insert/delete changed array length:
 * sets pages[i].index = i and syncs each markup.pageIndex.
 */
export function renumberPages(pages: PageData[]): void {
  pages.forEach((p, i) => {
    p.index = i;
    for (const m of p.markups) m.pageIndex = i;
  });
}
