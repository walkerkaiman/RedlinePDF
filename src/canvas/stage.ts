import Konva from 'konva';
import type { Markup, PenMarkup, LineMarkup, ArrowMarkup, EllipseMarkup, BoxMarkup, TextMarkup, MeasureLinearMarkup, MeasureRectMarkup, MeasurePolyMarkup, PolygonAreaMarkup, CountMarkup, CountLegendMarkup, ImageMarkup, CountSymbol, Point } from '../model/document.ts';
import { pdfToKonva, pdfPointsToKonva, pdfRectToKonva, konvaPointsToPdf, konvaRectToPdf, konvaToPdf } from '../geometry/transform.ts';

export interface KonvaStageManager {
  stage: Konva.Stage;
  bgLayer: Konva.Layer;
  markupLayer: Konva.Layer;
  interactionLayer: Konva.Layer;
  pageHeightPts: number;
  pageWidthPts: number;

  /** Set the PDF background image. widthPts/heightPts are the Konva-space size. */
  setPdfImage(canvas: HTMLCanvasElement, widthPts: number, heightPts: number): void;
  /** Set an image file as the static background (drawn on the bgLayer). Used when no PDF is loaded. */
  setBackgroundImage(img: HTMLImageElement, widthPts: number, heightPts: number): void;
  /** Update only the canvas (keep Konva.Image size) for hi-res re-render after zoom */
  updatePdfCanvas(canvas: HTMLCanvasElement): void;
  /** Resize stage viewport (on container resize) */
  resize(widthPx: number, heightPx: number): void;
  /** Zoom to a level and center the page */
  setZoom(zoom: number): void;
  /** Add a markup to the markup layer and return the Konva node */
  addMarkupNode(markup: Markup): Konva.Node;
  /** Remove a node by markup id */
  removeMarkupNode(id: string): void;
  /** Find node by markup id */
  findNode(id: string): Konva.Node | undefined;
  /** Update an existing node's style properties */
  updateMarkupNode(markup: Markup): void;
  /**
   * Bake the Konva Transformer's accumulated scale/position into the markup
   * model coordinates and reset the node's transform to identity.
   * Call this whenever transformend/dragend fires so the model stays in sync
   * and exports correctly.
   */
  bakeTransform(markup: Markup): void;
  /** Clear all markup nodes */
  clearMarkups(): void;
  /** Get stage pointer position in konva (layer) space */
  getLayerPointer(): Point | null;
  /** Redraw all layers */
  draw(): void;
  /**
   * Capture the visible area of the PDF page (viewport ∩ page bounds) as a
   * PNG data URL. Transformer handles and selection overlays are hidden during
   * capture so they don't appear in the output.
   */
  captureViewportPng(pixelRatio?: number): string;
  /**
   * Capture the entire canvas at full background-image dimensions, including all
   * drawn markups. Used when no PDF is loaded to export an image-only session.
   */
  captureFullPng(pixelRatio?: number): string;
}

/** Map a CSS hex color + opacity to a Konva-compatible color string */
export function hexWithOpacity(hex: string, opacity: number): string {
  if (opacity >= 1) return hex;
  if (opacity <= 0) return 'transparent';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

/**
 * Create a centered Konva shape for a count symbol.
 * Returns a Konva.Group so callers don't need to know shape types.
 */
export function createCountSymbolShape(symbol: CountSymbol, color: string, size: number): Konva.Group {
  const g = new Konva.Group();
  const r = size / 2;
  switch (symbol) {
    case 'circle':
      g.add(new Konva.Circle({ radius: r, fill: color, stroke: '#fff', strokeWidth: 1.5 }));
      break;
    case 'square':
      g.add(new Konva.Rect({ x: -r, y: -r, width: size, height: size, fill: color, stroke: '#fff', strokeWidth: 1.5 }));
      break;
    case 'triangle':
      g.add(new Konva.RegularPolygon({ sides: 3, radius: r, fill: color, stroke: '#fff', strokeWidth: 1.5 }));
      break;
    case 'diamond':
      g.add(new Konva.RegularPolygon({ sides: 4, radius: r, rotation: 45, fill: color, stroke: '#fff', strokeWidth: 1.5 }));
      break;
    case 'cross': {
      const t = Math.max(1.5, size * 0.2);
      g.add(new Konva.Line({ points: [-r, 0, r, 0], stroke: color, strokeWidth: t, lineCap: 'round' }));
      g.add(new Konva.Line({ points: [0, -r, 0, r], stroke: color, strokeWidth: t, lineCap: 'round' }));
      break;
    }
    default:
      // Defensive: any unrecognized/legacy symbol (e.g. a stray Unicode bullet)
      // falls back to a circle so the stamp always renders visibly instead of
      // producing an empty, zero-size group.
      g.add(new Konva.Circle({ radius: r, fill: color, stroke: '#fff', strokeWidth: 1.5 }));
  }
  return g;
}

/** Create a Konva shape for the given markup (in Konva/screen space) */
export function createMarkupNode(markup: Markup, pageHeightPts: number): Konva.Node {
  const style = markup.style;
  const strokeColor = style.strokeColor ?? '#e63946';
  const strokeWidth = style.strokeWidth ?? 2;
  const strokeOpacity = style.strokeOpacity ?? 1;
  const fillColor = style.fillColor ?? '#e63946';
  const fillOpacity = style.fillOpacity ?? 0.2;

  let node: Konva.Node;

  switch (markup.type) {
    case 'pen': {
      const m = markup as PenMarkup;
      node = new Konva.Line({
        name: 'markup',
        id: markup.id,
        points: pdfPointsToKonva(m.points, pageHeightPts),
        stroke: strokeColor,
        strokeWidth,
        opacity: strokeOpacity,
        tension: 0.3,
        lineCap: 'round',
        lineJoin: 'round',
        hitStrokeWidth: Math.max(10, strokeWidth),
      });
      break;
    }

    case 'line': {
      const m = markup as LineMarkup;
      const p1 = pdfToKonva(m.x1, m.y1, pageHeightPts);
      const p2 = pdfToKonva(m.x2, m.y2, pageHeightPts);
      node = new Konva.Line({
        name: 'markup',
        id: markup.id,
        points: [p1.x, p1.y, p2.x, p2.y],
        stroke: strokeColor,
        strokeWidth,
        opacity: strokeOpacity,
        lineCap: 'round',
        hitStrokeWidth: Math.max(10, strokeWidth),
      });
      break;
    }

    case 'arrow': {
      const m = markup as ArrowMarkup;
      const p1 = pdfToKonva(m.x1, m.y1, pageHeightPts);
      const p2 = pdfToKonva(m.x2, m.y2, pageHeightPts);
      node = new Konva.Arrow({
        name: 'markup',
        id: markup.id,
        points: [p1.x, p1.y, p2.x, p2.y],
        stroke: strokeColor,
        strokeWidth,
        opacity: strokeOpacity,
        fill: strokeColor,
        pointerLength: Math.max(10, strokeWidth * 4),
        pointerWidth: Math.max(8, strokeWidth * 3),
        lineCap: 'round',
        hitStrokeWidth: Math.max(10, strokeWidth),
      });
      break;
    }

    case 'ellipse': {
      const m = markup as EllipseMarkup;
      const center = pdfToKonva(m.cx, m.cy, pageHeightPts);
      node = new Konva.Ellipse({
        name: 'markup',
        id: markup.id,
        x: center.x,
        y: center.y,
        radiusX: m.rx,
        radiusY: m.ry,
        stroke: hexWithOpacity(strokeColor, strokeOpacity),
        strokeWidth,
        fill: hexWithOpacity(fillColor, fillOpacity),
        hitStrokeWidth: Math.max(10, strokeWidth),
      });
      break;
    }

    case 'box': {
      const m = markup as BoxMarkup;
      const r = pdfRectToKonva(m.x, m.y, m.width, m.height, pageHeightPts);
      node = new Konva.Rect({
        name: 'markup',
        id: markup.id,
        ...r,
        stroke: hexWithOpacity(strokeColor, strokeOpacity),
        strokeWidth,
        fill: hexWithOpacity(fillColor, fillOpacity),
        hitStrokeWidth: Math.max(10, strokeWidth),
      });
      break;
    }

    case 'text': {
      const m = markup as TextMarkup;
      const pos = pdfToKonva(m.x, m.y, pageHeightPts);
      const textStyle = style;
      const group = new Konva.Group({ name: 'markup', id: markup.id, x: pos.x, y: pos.y });

      // Render text at its natural content size — no fixed width/height constraint.
      const text = new Konva.Text({
        x: 4, y: 4,
        text: m.text,
        fontFamily: textStyle.fontFamily ?? 'Arial',
        fontSize: textStyle.fontSize ?? 12,
        fontStyle: [textStyle.bold ? 'bold' : '', textStyle.italic ? 'italic' : ''].filter(Boolean).join(' ') || 'normal',
        fill: textStyle.textColor ?? '#e63946',
      });
      // Size the background rect to the text's natural dimensions
      const bgRect = new Konva.Rect({
        width: text.width() + 8,
        height: text.height() + 8,
        fill: hexWithOpacity(textStyle.bgColor ?? '#ffffff', textStyle.bgOpacity ?? 0.8),
      });
      group.add(bgRect, text);
      node = group;
      break;
    }

    case 'measure-linear': {
      const m = markup as MeasureLinearMarkup;
      const p1 = pdfToKonva(m.x1, m.y1, pageHeightPts);
      const p2 = pdfToKonva(m.x2, m.y2, pageHeightPts);
      const group = new Konva.Group({ name: 'markup', id: markup.id, opacity: style.strokeOpacity ?? 1 });
      const mColor = style.strokeColor ?? '#0077cc';
      const mWidth = style.strokeWidth ?? 1.5;

      const line = new Konva.Line({
        points: [p1.x, p1.y, p2.x, p2.y],
        stroke: mColor, strokeWidth: mWidth, dash: [6, 3],
        hitStrokeWidth: 12,
      });

      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const perp = angle + Math.PI / 2;
      const tickLen = 6;
      const ticks = new Konva.Line({
        points: [
          p1.x + tickLen * Math.cos(perp), p1.y + tickLen * Math.sin(perp),
          p1.x - tickLen * Math.cos(perp), p1.y - tickLen * Math.sin(perp),
          ...([NaN, NaN]),
          p2.x + tickLen * Math.cos(perp), p2.y + tickLen * Math.sin(perp),
          p2.x - tickLen * Math.cos(perp), p2.y - tickLen * Math.sin(perp),
        ],
        stroke: mColor, strokeWidth: mWidth,
        hitStrokeWidth: 12,
      });

      const label = new Konva.Text({
        x: (p1.x + p2.x) / 2 + 6, y: (p1.y + p2.y) / 2 - 16,
        text: m.label, fontSize: 11, fontFamily: 'Arial', fill: mColor, padding: 3,
      });
      const labelBg = new Konva.Rect({
        x: (p1.x + p2.x) / 2 + 3, y: (p1.y + p2.y) / 2 - 19,
        width: label.width() + 6, height: label.height() + 6,
        fill: 'rgba(255,255,255,0.85)', cornerRadius: 2,
      });
      group.add(line, ticks, labelBg, label);
      node = group;
      break;
    }

    case 'measure-rect': {
      const m = markup as MeasureRectMarkup;
      const r = pdfRectToKonva(m.x, m.y, m.width, m.height, pageHeightPts);
      const group = new Konva.Group({ name: 'markup', id: markup.id, opacity: style.strokeOpacity ?? 1 });
      const mColor = style.strokeColor ?? '#0077cc';
      const mWidth = style.strokeWidth ?? 1.5;

      const rect = new Konva.Rect({
        ...r,
        stroke: mColor, strokeWidth: mWidth, dash: [6, 3],
        fill: hexWithOpacity(mColor, 0.08),
        hitStrokeWidth: 12,
      });
      const label = new Konva.Text({
        x: r.x + r.width / 2 - 40, y: r.y + r.height / 2 - 10,
        text: m.label, fontSize: 11, fontFamily: 'Arial', fill: mColor,
        align: 'center', width: 80,
      });
      const labelBg = new Konva.Rect({
        x: r.x + r.width / 2 - 43, y: r.y + r.height / 2 - 13,
        width: 86, height: label.height() + 6,
        fill: 'rgba(255,255,255,0.85)', cornerRadius: 2,
      });
      group.add(rect, labelBg, label);
      node = group;
      break;
    }

    case 'measure-poly': {
      const m = markup as MeasurePolyMarkup;
      const group = new Konva.Group({ name: 'markup', id: markup.id, opacity: style.strokeOpacity ?? 1 });
      const mColor = style.strokeColor ?? '#0077cc';
      const mWidth = style.strokeWidth ?? 1.5;

      if (m.points.length >= 2) {
        const konvaPoints: number[] = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of m.points) {
          const kp = pdfToKonva(p.x, p.y, pageHeightPts);
          konvaPoints.push(kp.x, kp.y);
          if (kp.x < minX) minX = kp.x;
          if (kp.x > maxX) maxX = kp.x;
          if (kp.y < minY) minY = kp.y;
          if (kp.y > maxY) maxY = kp.y;
        }

        // Invisible full-area hitbox so the ENTIRE polygon (not just its thin
        // dashed outline / faint fill) is selectable, and so Konva.Transformer
        // can compute resize handles. Mirrors the polygon-area pattern.
        // fill is OPAQUE (not 'transparent') — on WebKitGTK the hit canvas skips
        // transparent fills, which left the polygon unselectable on the desktop.
        if (m.points.length >= 3) {
          group.add(new Konva.Rect({
            name: 'transform-hitbox',
            x: minX, y: minY,
            width: maxX - minX, height: maxY - minY,
            fill: '#ffffff',
            opacity: 0,
            hitFunc: function (ctx, shape) {
              ctx.beginPath();
              ctx.rect(0, 0, shape.width(), shape.height());
              ctx.closePath();
              ctx.fillStrokeShape(shape);
            },
          }));
        }

        const poly = new Konva.Line({
          points: konvaPoints,
          closed: m.points.length >= 3,
          stroke: mColor, strokeWidth: mWidth, dash: [6, 3],
          fill: m.points.length >= 3 ? hexWithOpacity(mColor, 0.08) : undefined,
          hitStrokeWidth: 12,
        });
        group.add(poly);

        for (const p of m.points) {
          const kp = pdfToKonva(p.x, p.y, pageHeightPts);
          group.add(new Konva.Circle({ x: kp.x, y: kp.y, radius: 4, fill: mColor }));
        }

        if (m.points.length >= 3) {
          const cx = m.points.reduce((s, p) => s + p.x, 0) / m.points.length;
          const cy = m.points.reduce((s, p) => s + p.y, 0) / m.points.length;
          const kc = pdfToKonva(cx, cy, pageHeightPts);
          const label = new Konva.Text({
            x: kc.x - 75, y: kc.y - 10,
            text: m.label, fontSize: 11, fontFamily: 'Arial', fill: mColor,
            align: 'center', width: 150,
          });
          const labelBg = new Konva.Rect({
            x: kc.x - 78, y: kc.y - 13,
            width: 156, height: label.height() + 6,
            fill: 'rgba(255,255,255,0.85)', cornerRadius: 2,
          });
          group.add(labelBg, label);
        }
      }
      node = group;
      break;
    }

    case 'polygon-area': {
      const m = markup as PolygonAreaMarkup;
      if (m.points.length >= 3) {
        const group = new Konva.Group({ name: 'markup', id: markup.id });

        // Convert all points to konva space and compute bounding box.
        const kvPoints: number[] = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of m.points) {
          const kp = pdfToKonva(p.x, p.y, pageHeightPts);
          kvPoints.push(kp.x, kp.y);
          if (kp.x < minX) minX = kp.x;
          if (kp.x > maxX) maxX = kp.x;
          if (kp.y < minY) minY = kp.y;
          if (kp.y > maxY) maxY = kp.y;
        }

        // Invisible bounding-box rect so Konva's Transformer can compute resize
        // handles (width/height).  Same approach that makes Box/Ellipse scalable.
        // NOTE: fill must be OPAQUE (not 'transparent') — on WebKitGTK the hit
        // canvas skips transparent fills, leaving the polygon with no interior hit
        // area (only the hairline outline), which made it unselectable on the
        // desktop. opacity:0 keeps it visually invisible while an explicit hitFunc
        // guarantees the whole bounding box is a hit target on every engine.
        group.add(new Konva.Rect({
          name: 'transform-hitbox',
          x: minX, y: minY,
          width: maxX - minX,
          height: maxY - minY,
          fill: '#ffffff',
          opacity: 0,
          hitFunc: function (ctx, shape) {
            ctx.beginPath();
            ctx.rect(0, 0, shape.width(), shape.height());
            ctx.closePath();
            ctx.fillStrokeShape(shape);
          },
        }));

        group.add(new Konva.Line({
          name: 'polygon-shape',
          closed: true,
          stroke: hexWithOpacity(strokeColor, style.strokeOpacity ?? 1),
          strokeWidth,
          fill: hexWithOpacity(fillColor, fillOpacity),
          points: kvPoints,
          hitStrokeWidth: Math.max(10, strokeWidth),
        }));
        node = group;
      } else {
        node = new Konva.Group({ name: 'markup', id: markup.id });
      }
      break;
    }

    case 'count': {
      const m = markup as CountMarkup;
      const pos = pdfToKonva(m.x, m.y, pageHeightPts);
      const size = m.size ?? 10;
      const group = new Konva.Group({ name: 'markup', id: markup.id, x: pos.x, y: pos.y });
      group.add(createCountSymbolShape(m.symbol, m.color, size));
      node = group;
      break;
    }

    case 'image': {
      const m = markup as ImageMarkup;
      // Convert PDF-space rect (bottom-left) to Konva-space rect (top-left) — same
      // approach used by Box / Ellipse so the group children sit at (0,0) with size
      // width x height and the group position is the top-left corner.
      const r = pdfRectToKonva(m.x, m.y, m.width, m.height, pageHeightPts);

      const sw = m.style?.strokeWidth ?? 0;
      const sc = m.style?.strokeColor ?? '#e63946';
      const so = m.style?.strokeOpacity ?? 1;

      // Build a group wrapping the Konva.Image with an invisible hitbox rect
      // so Konva.Transformer can compute resize handles.
      const group = new Konva.Group({
        name: 'markup',
        id: markup.id,
        x: r.x,
        y: r.y,
        opacity: m.opacity ?? 1,
      });

      // Invisible hitbox rect — Konva.Transformer reads .width()/.height()
      // from this rect to position resize handles.
      group.add(new Konva.Rect({
        name: 'transform-hitbox',
        x: 0, y: 0,
        width: m.width,
        height: m.height,
        fill: 'transparent',
        stroke: 'transparent',
      }));

      // Visible stroke overlay — rendered as a slightly smaller rect so it
      // sits inside the image boundary without being clipped by anti-aliasing.
      if (sw > 0) {
        group.add(new Konva.Rect({
          name: 'image-stroke',
          x: -sw / 2, y: -sw / 2,
          width: m.width + sw,
          height: m.height + sw,
          fill: 'transparent',
          stroke: hexWithOpacity(sc, so),
          strokeWidth: sw,
        }));
      }

      const konvaImg = new Konva.Image({ image: undefined });
      konvaImg.width(m.width);
      konvaImg.height(m.height);
      konvaImg.listening(false);

      // Once the browser image loads, assign it to the Konva node and redraw.
      const img = new window.Image();
      img.onload = () => {
        konvaImg.image(img);
        group.getLayer()?.batchDraw();
      };
      // Handle cached images (onload may have already fired)
      if (img.complete && img.naturalWidth > 0) {
        konvaImg.image(img);
        group.getLayer()?.batchDraw();
      }
      img.src = m.dataUrl;

      group.add(konvaImg);
      node = group;
      break;
    }

    case 'count-legend': {
      const m = markup as CountLegendMarkup;
      const pos = pdfToKonva(m.x, m.y, pageHeightPts);

      const PADDING = 8;
      const ROW_H = 18;
      const SYMBOL_SIZE = 10;
      const TITLE_H = 20;
      const COL_SYMBOL = PADDING;
      const COL_LABEL = PADDING + SYMBOL_SIZE + 6;
      const COL_COUNT_RIGHT = 150; // legend width minus padding
      const LEGEND_W = COL_COUNT_RIGHT + PADDING;

      const totalH = PADDING + TITLE_H + m.rows.length * ROW_H + PADDING;

      const group = new Konva.Group({
        name: 'markup', id: markup.id,
        x: pos.x, y: pos.y,
        scaleX: m.legendScale ?? 1,
        scaleY: m.legendScale ?? 1,
      });

      // Background
      group.add(new Konva.Rect({
        width: LEGEND_W, height: totalH,
        fill: 'rgba(255,255,255,0.93)',
        stroke: '#999', strokeWidth: 1,
        cornerRadius: 4,
        shadowColor: 'rgba(0,0,0,0.15)', shadowBlur: 4, shadowOffset: { x: 1, y: 1 },
      }));

      // Title
      group.add(new Konva.Text({
        x: PADDING, y: PADDING,
        width: LEGEND_W - PADDING * 2,
        text: m.title || 'Count Legend',
        fontSize: 11, fontFamily: 'Arial', fontStyle: 'bold',
        fill: '#222',
      }));

      // Rows
      m.rows.forEach((row, i) => {
        const rowY = PADDING + TITLE_H + i * ROW_H;
        const sym = createCountSymbolShape(row.symbol, row.color, SYMBOL_SIZE);
        sym.x(COL_SYMBOL + SYMBOL_SIZE / 2);
        sym.y(rowY + ROW_H / 2);
        group.add(sym);

        group.add(new Konva.Text({
          x: COL_LABEL, y: rowY + 2,
          width: COL_COUNT_RIGHT - COL_LABEL - 24,
          text: row.label,
          fontSize: 10, fontFamily: 'Arial', fill: '#222',
          ellipsis: true,
        }));

        group.add(new Konva.Text({
          x: COL_COUNT_RIGHT - 22, y: rowY + 2,
          width: 22,
          text: String(row.count),
          fontSize: 10, fontFamily: 'Arial', fill: '#444',
          align: 'right',
        }));
      });

      node = group;
      break;
    }

    default: {
      const m = markup as { id: string };
      node = new Konva.Group({ name: 'markup', id: m.id });
    }
  }

  return node;
}

/** Create the Konva stage manager */
export function createStage(containerId: string, width: number, height: number, pageHeightPts: number): KonvaStageManager {
  const stage = new Konva.Stage({ container: containerId, width, height });
  const bgLayer = new Konva.Layer();
  const markupLayer = new Konva.Layer();
  const interactionLayer = new Konva.Layer();
  stage.add(bgLayer, markupLayer, interactionLayer);

  let bgImage: Konva.Image | null = null;
  let _pageHeightPts = pageHeightPts;
  let _pageWidthPts = 0;

  function getLayerPointer(): Point | null {
    const pos = markupLayer.getRelativePointerPosition();
    if (!pos) return null;
    return { x: pos.x, y: pos.y };
  }

  return {
    stage,
    bgLayer,
    markupLayer,
    interactionLayer,
    get pageHeightPts() { return _pageHeightPts; },
    set pageHeightPts(v: number) { _pageHeightPts = v; },
    get pageWidthPts() { return _pageWidthPts; },
    set pageWidthPts(v: number) { _pageWidthPts = v; },

    setPdfImage(canvas: HTMLCanvasElement, widthPts: number, heightPts: number): void {
      _pageWidthPts = widthPts;
      _pageHeightPts = heightPts;
      if (bgImage) bgImage.destroy();
      // Konva.Image is always at (0,0) with size = (widthPts, heightPts) in Konva space.
      // The canvas can be any resolution; Konva stretches it to fill, giving hi-res rendering.
      bgImage = new Konva.Image({ image: canvas, x: 0, y: 0, width: widthPts, height: heightPts });
      bgLayer.destroyChildren();
      bgLayer.add(bgImage);
      bgLayer.draw();
    },

    setBackgroundImage(img: HTMLImageElement, widthPts: number, heightPts: number): void {
      _pageWidthPts = widthPts;
      _pageHeightPts = heightPts;
      if (bgImage) bgImage.destroy();
      bgImage = new Konva.Image({ image: img, x: 0, y: 0, width: widthPts, height: heightPts });
      bgLayer.destroyChildren();
      bgLayer.add(bgImage);
      bgLayer.draw();
    },

    updatePdfCanvas(canvas: HTMLCanvasElement): void {
      if (bgImage) {
        bgImage.image(canvas);
        bgLayer.draw();
      }
    },

    resize(widthPx: number, heightPx: number): void {
      stage.width(widthPx);
      stage.height(heightPx);
    },

    setZoom(zoom: number): void {
      const containerW = stage.width();
      const containerH = stage.height();
      const pageScreenW = _pageWidthPts * zoom;
      const pageScreenH = _pageHeightPts * zoom;
      stage.scale({ x: zoom, y: zoom });
      stage.position({
        x: Math.max(20, (containerW - pageScreenW) / 2),
        y: Math.max(20, (containerH - pageScreenH) / 2),
      });
      stage.draw();
    },

    addMarkupNode(markup: Markup): Konva.Node {
      const node = createMarkupNode(markup, _pageHeightPts);
      markupLayer.add(node as Konva.Shape);
      markupLayer.draw();
      return node;
    },

    removeMarkupNode(id: string): void {
      const node = stage.findOne(`#${id}`);
      if (node) {
        node.destroy();
        markupLayer.draw();
      }
    },

    findNode(id: string): Konva.Node | undefined {
      return stage.findOne(`#${id}`) ?? undefined;
    },

    updateMarkupNode(markup: Markup): void {
      const existing = stage.findOne(`#${markup.id}`);
      // Preserve the Konva transform so that if bakeTransform was not called
      // (e.g. for unsupported types), a style-only rebuild doesn't snap the
      // shape back to its un-scaled model coordinates.
      // NOTE: skip scale restore for 'text' — text boxes size from content,
      // and restoring old scaleX/scaleY after fontSize change makes the visual
      // font appear unchanged.
      const saved = existing && markup.type !== 'text'
        ? { x: existing.x(), y: existing.y(), scaleX: existing.scaleX(), scaleY: existing.scaleY(), rotation: existing.rotation() }
        : (existing ? { x: existing.x(), y: existing.y() } : null);
      if (existing) existing.destroy();
      const newNode = createMarkupNode(markup, _pageHeightPts);
      if (saved) newNode.setAttrs(saved);
      markupLayer.add(newNode as Konva.Shape);
      markupLayer.draw();
    },

    bakeTransform(markup: Markup): void {
      const node = stage.findOne(`#${markup.id}`);
      if (!node) return;

      const tx = node.x();
      const ty = node.y();
      const sx = node.scaleX();
      const sy = node.scaleY();

      if (tx === 0 && ty === 0 && Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9) return;

      const h = _pageHeightPts;

      switch (markup.type) {
        case 'pen': {
          const m = markup as PenMarkup;
          const line = node as Konva.Line;
          const raw = line.points();
          const baked: number[] = [];
          for (let i = 0; i < raw.length; i += 2) {
            baked.push(tx + raw[i] * sx, ty + raw[i + 1] * sy);
          }
          m.points = konvaPointsToPdf(baked, h);
          line.x(0); line.y(0); line.scaleX(1); line.scaleY(1); line.points(baked);
          break;
        }
        case 'line':
        case 'arrow': {
          const m = markup as LineMarkup | ArrowMarkup;
          const line = node as Konva.Line;
          const raw = line.points();
          const b = [tx + raw[0] * sx, ty + raw[1] * sy, tx + raw[2] * sx, ty + raw[3] * sy];
          const p1 = konvaToPdf(b[0], b[1], h);
          const p2 = konvaToPdf(b[2], b[3], h);
          m.x1 = p1.x; m.y1 = p1.y; m.x2 = p2.x; m.y2 = p2.y;
          line.x(0); line.y(0); line.scaleX(1); line.scaleY(1); line.points(b);
          break;
        }
        case 'box': {
          const m = markup as BoxMarkup;
          const rect = node as Konva.Rect;
          const kw = rect.width() * sx;
          const kh = rect.height() * sy;
          const pdf = konvaRectToPdf(tx, ty, kw, kh, h);
          m.x = pdf.x; m.y = pdf.y; m.width = pdf.width; m.height = pdf.height;
          rect.width(kw); rect.height(kh); rect.scaleX(1); rect.scaleY(1);
          break;
        }
        case 'ellipse': {
          const m = markup as EllipseMarkup;
          const ellipse = node as Konva.Ellipse;
          const bRx = ellipse.radiusX() * sx;
          const bRy = ellipse.radiusY() * sy;
          const ctr = konvaToPdf(tx, ty, h);
          m.cx = ctr.x; m.cy = ctr.y; m.rx = bRx; m.ry = bRy;
          ellipse.radiusX(bRx); ellipse.radiusY(bRy); ellipse.scaleX(1); ellipse.scaleY(1);
          break;
        }
        case 'text': {
          // Text boxes auto-size to content — only bake position, discard scale.
          const m = markup as TextMarkup;
          const pdfPos = konvaToPdf(tx, ty, h);
          m.x = pdfPos.x; m.y = pdfPos.y;
          node.x(tx); node.y(ty);
          node.scaleX(1); node.scaleY(1);
          break;
        }
        case 'measure-linear': {
          const m = markup as MeasureLinearMarkup;
          // Bake translation into PDF coords. Scale is ignored (it would
          // invalidate the pre-computed label string).
          if (tx !== 0 || ty !== 0) {
            m.x1 += tx; m.y1 -= ty;
            m.x2 += tx; m.y2 -= ty;
            (node as Konva.Group).getChildren().forEach(c => { c.x(c.x() + tx); c.y(c.y() + ty); });
            node.x(0); node.y(0);
          }
          node.scaleX(1); node.scaleY(1);
          break;
        }
        case 'measure-rect': {
          const m = markup as MeasureRectMarkup;
          if (tx !== 0 || ty !== 0) {
            m.x += tx; m.y -= ty;
            (node as Konva.Group).getChildren().forEach(c => { c.x(c.x() + tx); c.y(c.y() + ty); });
            node.x(0); node.y(0);
          }
          node.scaleX(1); node.scaleY(1);
          break;
        }
        case 'measure-poly': {
          const m = markup as MeasurePolyMarkup;
          if (tx !== 0 || ty !== 0) {
            m.points.forEach(p => { p.x += tx; p.y -= ty; });
            (node as Konva.Group).getChildren().forEach(c => { c.x(c.x() + tx); c.y(c.y() + ty); });
            node.x(0); node.y(0);
          }
          node.scaleX(1); node.scaleY(1);
          break;
        }
        case 'polygon-area': {
          const m = markup as PolygonAreaMarkup;
          if (node instanceof Konva.Group) {
            // Find children by name (not index) so a node rebuild that reorders
            // children can never silently break the bake. If the hitbox/line are
            // missing the node was built without them — fall back to translating
            // the group so the move still registers instead of no-op'ing.
            const hitbox = node.findOne<Konva.Rect>('.transform-hitbox') ?? null;
            const polyLine = node.findOne<Konva.Line>('.polygon-shape') ?? null;

            if (polyLine) {
              const raw = polyLine.points();
              const baked: number[] = [];
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (let i = 0; i < raw.length; i += 2) {
                const bx = tx + raw[i] * sx;
                const by = ty + raw[i + 1] * sy;
                baked.push(bx, by);
                if (bx < minX) minX = bx;
                if (bx > maxX) maxX = bx;
                if (by < minY) minY = by;
                if (by > maxY) maxY = by;
              }

              if (hitbox) {
                hitbox.x(minX);
                hitbox.y(minY);
                hitbox.width(Math.abs(maxX - minX));
                hitbox.height(Math.abs(maxY - minY));
              }

              const pdfCoords = konvaPointsToPdf(Array.from(baked), h);
              m.points = Array.from({ length: baked.length / 2 }, (_, i) => ({
                x: pdfCoords[i * 2],
                y: pdfCoords[i * 2 + 1],
              }));

              polyLine.points(baked);
            } else {
              // No polygon-shape line: just translate the group's children.
              node.getChildren().forEach(c => { c.x(c.x() + tx); c.y(c.y() + ty); });
            }
            node.x(0); node.y(0); node.scaleX(1); node.scaleY(1);
          }
          break;
        }
        case 'count': {
          // Node lives at absolute Konva position (pos.x, pos.y), so convert
          // the absolute tx/ty back to PDF coords rather than using the delta pattern.
          const m = markup as CountMarkup;
          const cPdf = konvaToPdf(tx, ty, h);
          m.x = cPdf.x; m.y = cPdf.y;
          node.x(tx); node.y(ty);
          node.scaleX(1); node.scaleY(1);
          break;
        }
        case 'count-legend': {
          // Same absolute-position approach. Also bake scale: sx = node.scaleX()
          // is already the cumulative total (Konva multiplies from the current base).
          const m = markup as CountLegendMarkup;
          const lPdf = konvaToPdf(tx, ty, h);
          m.x = lPdf.x; m.y = lPdf.y;
          m.legendScale = sx; // absolute total scale — store directly
          node.x(tx); node.y(ty);
          node.scaleX(m.legendScale); node.scaleY(m.legendScale);
          break;
        }

        case 'image': {
          const m = markup as ImageMarkup;
          if (node instanceof Konva.Group && node.children.length >= 2) {
            // Children: [0] transform-hitbox rect, [1] Konva.Image.
            const hitbox = node.children[0] as Konva.Rect;
            const konvaImg = node.children[1] as Konva.Image;

            // Apply group transform to size (position is already baked into tx/ty).
            const newW = m.width * sx;
            const newH = m.height * sy;

            // tx/ty are absolute top-left in Konva space. ImageMarkup.x/y stores
            // bottom-left in PDF space — convert accordingly.
            m.x = tx;
            m.y = h - ty - newH;
            m.width = newW;
            m.height = newH;

            hitbox.width(newW);
            hitbox.height(newH);
            konvaImg.width(newW);
            konvaImg.height(newH);

            // Keep the node at its current visual position (tx, ty) with identity
            // scale — do NOT reset to (0, 0). createMarkupNode places the group at
            // pdfRectToKonva(m.x, m.y, ...) which equals (tx, ty), so leaving it here
            // avoids a snap-to-origin that would occur if we zeroed position without
            // also re-creating children in local coords.
            node.scaleX(1); node.scaleY(1);
          }
          break;
        }
        default:
          node.x(0); node.y(0); node.scaleX(1); node.scaleY(1);
          break;
      }

      stage.batchDraw();
    },

    clearMarkups(): void {
      markupLayer.destroyChildren();
      markupLayer.draw();
    },

    getLayerPointer,

    draw(): void {
      stage.draw();
    },

    captureViewportPng(pixelRatio?: number): string {
      // Hide transformer / selection overlay so it doesn't appear in the PNG.
      interactionLayer.visible(false);
      stage.batchDraw();
      try {
        const z  = stage.scaleX();
        const px = stage.x();
        const py = stage.y();
        const pw = _pageWidthPts  * z;
        const ph = _pageHeightPts * z;

        // Crop to the intersection of the stage viewport and the PDF page bounds.
        const cropX = Math.max(0, px);
        const cropY = Math.max(0, py);
        const cropW = Math.min(stage.width(),  px + pw) - cropX;
        const cropH = Math.min(stage.height(), py + ph) - cropY;

        return stage.toDataURL({
          x: cropX,
          y: cropY,
          width:  Math.max(1, cropW),
          height: Math.max(1, cropH),
          pixelRatio: pixelRatio ?? window.devicePixelRatio ?? 1,
          mimeType: 'image/png',
        });
      } finally {
        interactionLayer.visible(true);
        stage.batchDraw();
      }
    },

    captureFullPng(pixelRatio?: number): string {
      // Capture the full canvas at background image dimensions.
      // Temporarily expand the stage to cover the entire bgImage so toDataURL
      // captures the full resolution, not just the small viewport.
      interactionLayer.visible(false);
      if (bgImage) {
        const imgW = bgImage.width() ?? stage.width();
        const imgH = bgImage.height() ?? stage.height();
        // Save original stage state
        const origW = stage.width();
        const origH = stage.height();
        const origPos = { x: stage.x(), y: stage.y() };
        try {
          stage.width(imgW);
          stage.height(imgH);
          stage.position({ x: 0, y: 0 });
          stage.scale({ x: 1, y: 1 });
          bgLayer.batchDraw();
          markupLayer.batchDraw();
          const pr = pixelRatio ?? window.devicePixelRatio ?? 1;
          return stage.toDataURL({
            x: 0,
            y: 0,
            width: imgW,
            height: imgH,
            pixelRatio: pr,
            mimeType: 'image/png',
          });
        } finally {
          stage.width(origW);
          stage.height(origH);
          stage.position(origPos);
          interactionLayer.visible(true);
          stage.batchDraw();
        }
      } else {
        stage.batchDraw();
        const pr = pixelRatio ?? window.devicePixelRatio ?? 1;
        return stage.toDataURL({
          x: 0, y: 0,
          width: stage.width(), height: stage.height(),
          pixelRatio: pr, mimeType: 'image/png',
        });
      }
    },
  };
}
