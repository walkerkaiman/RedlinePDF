import Konva from 'konva';
import type { Markup, PenMarkup, LineMarkup, ArrowMarkup, RectMarkup, EllipseMarkup, BoxMarkup, TextMarkup, MeasureLinearMarkup, MeasureRectMarkup, MeasurePolyMarkup, Point } from '../model/document.ts';
import { pdfToKonva, pdfPointsToKonva, pdfRectToKonva } from '../geometry/transform.ts';

export interface KonvaStageManager {
  stage: Konva.Stage;
  bgLayer: Konva.Layer;
  markupLayer: Konva.Layer;
  interactionLayer: Konva.Layer;
  pageHeightPts: number;
  pageWidthPts: number;

  /** Set the PDF background image. widthPts/heightPts are the Konva-space size. */
  setPdfImage(canvas: HTMLCanvasElement, widthPts: number, heightPts: number): void;
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
  /** Update an existing node's properties */
  updateMarkupNode(markup: Markup): void;
  /** Clear all markup nodes */
  clearMarkups(): void;
  /** Get stage pointer position in konva (layer) space */
  getLayerPointer(): Point | null;
  /** Redraw all layers */
  draw(): void;
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

    case 'rect': {
      const m = markup as RectMarkup;
      const r = pdfRectToKonva(m.x, m.y, m.width, m.height, pageHeightPts);
      node = new Konva.Rect({
        name: 'markup',
        id: markup.id,
        ...r,
        stroke: strokeColor,
        strokeWidth,
        opacity: strokeOpacity,
        fill: 'transparent',
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
        stroke: strokeColor,
        strokeWidth,
        opacity: strokeOpacity,
        fill: 'transparent',
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
        stroke: strokeColor,
        strokeWidth,
        strokeOpacity,
        fill: hexWithOpacity(fillColor, fillOpacity),
        hitStrokeWidth: Math.max(10, strokeWidth),
      });
      break;
    }

    case 'text': {
      const m = markup as TextMarkup;
      const r = pdfRectToKonva(m.x, m.y, m.width, m.height, pageHeightPts);
      const textStyle = style;
      const group = new Konva.Group({ name: 'markup', id: markup.id, x: r.x, y: r.y });

      const bgRect = new Konva.Rect({
        width: r.width,
        height: r.height,
        fill: hexWithOpacity(textStyle.bgColor ?? '#ffffff', textStyle.bgOpacity ?? 0.8),
      });
      const text = new Konva.Text({
        x: 4, y: 4,
        width: r.width - 8,
        height: r.height - 8,
        text: m.text,
        fontFamily: textStyle.fontFamily ?? 'Arial',
        fontSize: textStyle.fontSize ?? 12,
        fontStyle: [textStyle.bold ? 'bold' : '', textStyle.italic ? 'italic' : ''].filter(Boolean).join(' ') || 'normal',
        fill: textStyle.textColor ?? '#e63946',
        wrap: 'word',
      });
      group.add(bgRect, text);
      node = group;
      break;
    }

    case 'measure-linear': {
      const m = markup as MeasureLinearMarkup;
      const p1 = pdfToKonva(m.x1, m.y1, pageHeightPts);
      const p2 = pdfToKonva(m.x2, m.y2, pageHeightPts);
      const group = new Konva.Group({ name: 'markup', id: markup.id });

      const line = new Konva.Line({
        points: [p1.x, p1.y, p2.x, p2.y],
        stroke: '#0077cc', strokeWidth: 1.5, dash: [6, 3],
      });

      // Tick marks
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const perp = angle + Math.PI / 2;
      const tickLen = 6;
      const ticks = new Konva.Line({
        points: [
          p1.x + tickLen * Math.cos(perp), p1.y + tickLen * Math.sin(perp),
          p1.x - tickLen * Math.cos(perp), p1.y - tickLen * Math.sin(perp),
          ...([NaN, NaN]), // move
          p2.x + tickLen * Math.cos(perp), p2.y + tickLen * Math.sin(perp),
          p2.x - tickLen * Math.cos(perp), p2.y - tickLen * Math.sin(perp),
        ],
        stroke: '#0077cc', strokeWidth: 1.5,
      });

      const label = new Konva.Text({
        x: (p1.x + p2.x) / 2 + 6,
        y: (p1.y + p2.y) / 2 - 16,
        text: m.label,
        fontSize: 11,
        fontFamily: 'Arial',
        fill: '#0077cc',
        padding: 3,
      });
      const labelBg = new Konva.Rect({
        x: (p1.x + p2.x) / 2 + 3,
        y: (p1.y + p2.y) / 2 - 19,
        width: label.width() + 6,
        height: label.height() + 6,
        fill: 'rgba(255,255,255,0.85)',
        cornerRadius: 2,
      });
      group.add(line, ticks, labelBg, label);
      node = group;
      break;
    }

    case 'measure-rect': {
      const m = markup as MeasureRectMarkup;
      const r = pdfRectToKonva(m.x, m.y, m.width, m.height, pageHeightPts);
      const group = new Konva.Group({ name: 'markup', id: markup.id });

      const rect = new Konva.Rect({
        ...r,
        stroke: '#0077cc', strokeWidth: 1.5, dash: [6, 3],
        fill: 'rgba(0, 119, 204, 0.08)',
      });
      const label = new Konva.Text({
        x: r.x + r.width / 2 - 40,
        y: r.y + r.height / 2 - 10,
        text: m.label,
        fontSize: 11, fontFamily: 'Arial', fill: '#0077cc',
        align: 'center', width: 80,
      });
      const labelBg = new Konva.Rect({
        x: r.x + r.width / 2 - 43,
        y: r.y + r.height / 2 - 13,
        width: 86, height: label.height() + 6,
        fill: 'rgba(255,255,255,0.85)', cornerRadius: 2,
      });
      group.add(rect, labelBg, label);
      node = group;
      break;
    }

    case 'measure-poly': {
      const m = markup as MeasurePolyMarkup;
      const group = new Konva.Group({ name: 'markup', id: markup.id });

      if (m.points.length >= 2) {
        const konvaPoints: number[] = [];
        for (const p of m.points) {
          const kp = pdfToKonva(p.x, p.y, pageHeightPts);
          konvaPoints.push(kp.x, kp.y);
        }
        const poly = new Konva.Line({
          points: konvaPoints,
          closed: m.points.length >= 3,
          stroke: '#0077cc', strokeWidth: 1.5, dash: [6, 3],
          fill: m.points.length >= 3 ? 'rgba(0,119,204,0.08)' : undefined,
        });
        group.add(poly);

        // Vertex dots
        for (const p of m.points) {
          const kp = pdfToKonva(p.x, p.y, pageHeightPts);
          group.add(new Konva.Circle({ x: kp.x, y: kp.y, radius: 4, fill: '#0077cc' }));
        }

        if (m.points.length >= 3) {
          const cx = m.points.reduce((s, p) => s + p.x, 0) / m.points.length;
          const cy = m.points.reduce((s, p) => s + p.y, 0) / m.points.length;
          const kc = pdfToKonva(cx, cy, pageHeightPts);
          const label = new Konva.Text({
            x: kc.x - 40, y: kc.y - 10,
            text: m.label, fontSize: 11, fontFamily: 'Arial', fill: '#0077cc',
            align: 'center', width: 80,
          });
          const labelBg = new Konva.Rect({
            x: kc.x - 43, y: kc.y - 13,
            width: 86, height: label.height() + 6,
            fill: 'rgba(255,255,255,0.85)', cornerRadius: 2,
          });
          group.add(labelBg, label);
        }
      }
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
      if (existing) {
        existing.destroy();
      }
      const newNode = createMarkupNode(markup, _pageHeightPts);
      markupLayer.add(newNode as Konva.Shape);
      markupLayer.draw();
    },

    clearMarkups(): void {
      markupLayer.destroyChildren();
      markupLayer.draw();
    },

    getLayerPointer,

    draw(): void {
      stage.draw();
    },
  };
}
