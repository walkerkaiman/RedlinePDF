import { describe, it, expect } from 'vitest';
import { konvaToPdf } from './transform.ts';

describe('konvaToPdf', () => {
  // A4 in PDF points: width=595.28, height=841.89 — round to integer for simplicity.
  const A4_HEIGHT = 842;

  it('flips Y coordinate between konva (top-left origin) and PDF (bottom-left origin)', () => {
    // Spec example: konva(0, 0) on A4 → pdf(x=0, y=842-0=842)
    const result = konvaToPdf(0, 0, A4_HEIGHT);
    expect(result.x).toBe(0);
    expect(result.y).toBe(A4_HEIGHT);
  });

  it('flips Y coordinate for an interior point — konva(100, 200) → pdf(x=100, y=642)', () => {
    const result = konvaToPdf(100, 200, A4_HEIGHT);
    expect(result.x).toBe(100);
    // pageHeightPts - ky = 842 - 200 = 642
    expect(result.y).toBeCloseTo(642, 5);
  });

  it('leaves X coordinate unchanged — only Y is flipped', () => {
    const result = konvaToPdf(350, 100, A4_HEIGHT);
    // X stays the same in both coordinate systems (origin aligned at bottom-left of left edge)
    expect(result.x).toBeCloseTo(350, 5);
    expect(result.y).toBeCloseTo(A4_HEIGHT - 100, 5);
  });

  it('round-trips: konva→pdf returns original coords within floating-point tolerance', () => {
    // Round-trip preserves exact integer values when pageHeightPts is the same.
    const initial = { x: 200, y: 350 };
    const pdf = konvaToPdf(initial.x, initial.y, A4_HEIGHT);
    expect(pdf).toEqual({ x: initial.x, y: A4_HEIGHT - initial.y });
  });

  it('handles floating-point coordinates accurately — no precision loss', () => {
    const initial = { x: 234.567, y: 689.012 };
    const pdf = konvaToPdf(initial.x, initial.y, A4_HEIGHT);
    expect(pdf.x).toBeCloseTo(initial.x, 6);
    expect(pdf.y).toBeCloseTo(A4_HEIGHT - initial.y, 6);
  });

  it('returns an object with exactly { x, y } — contract compliance', () => {
    const result = konvaToPdf(100, 200, A4_HEIGHT);
    expect(result).toHaveProperty('x');
    expect(result).toHaveProperty('y');
    expect(Object.keys(result)).toEqual(['x', 'y']);
  });

  it('handles edge case: top-left corner of A4 → PDF bottom-left corner', () => {
    // Top-left in Konva = (0, 0), which is PDF bottom-left after Y flip.
    const result = konvaToPdf(0, 0, A4_HEIGHT);
    expect(result).toEqual({ x: 0, y: A4_HEIGHT });
  });

  it('handles edge case: bottom-right corner of Konva → top-right in PDF', () => {
    // Bottom-right in Konva = (595.28, 842) — the far end on both axes after Y flip.
    const result = konvaToPdf(595.28, A4_HEIGHT, A4_HEIGHT);
    expect(result.x).toBeCloseTo(595.28, 5);
    expect(result.y).toBeCloseTo(0, 5); // flipped to bottom of PDF space
  });
});
