import type { PdfRenderer } from '../pdf/renderer.ts';
import type { ProjectData } from '../model/document.ts';

/**
 * Page thumbnail rail — reorder (HTML5 drag), rotate/delete (context menu),
 * insert-at-position (OS file drop between cards).
 *
 * The panel is a pure VIEW: every structural change is requested through the
 * ops callbacks (owned by main.ts, which owns undo + the combined PDF bytes).
 * Thumbnails are rendered lazily via IntersectionObserver and the whole list
 * is rebuilt after any structural change, so there is no stale-cache problem.
 */

export interface PagePanelOps {
  reorder(order: number[]): void;
  deletePage(index: number): void;
  rotatePage(index: number): void;
  /** OS-dropped PDF file(s) inserted before `insertAt` (null = end). */
  insertPdfFiles(files: File[], insertAt: number | null): void;
}

export interface PagePanel {
  render(renderer: PdfRenderer, project: ProjectData): void;
  setActive(index: number): void;
  setOpen(open: boolean): void;
  isOpen(): boolean;
}

const THUMB_SCALE = 0.25;

export function initPagePanel(ops: PagePanelOps): PagePanel {
  const panel = document.getElementById('page-panel')!;
  const list = document.getElementById('page-panel-list')!;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const card = entry.target as HTMLElement;
      observer.unobserve(card);
      void renderThumb(card);
    }
  }, { root: list, rootMargin: '200px' });

  let currentRenderer: PdfRenderer | null = null;
  let currentProject: ProjectData | null = null;
  let activeIndex = -1;
  let open = false;
  let dropSourceIndex: number | null = null; // internal reorder drag source
  let menu: HTMLElement | null = null;

  // ── insertion indicator ─────────────────────────────────────────────────────
  const line = document.createElement('div');
  line.className = 'page-insert-line';
  line.style.display = 'none';

  function insertionIndexFrom(y: number): number {
    const cards = [...list.querySelectorAll<HTMLElement>('.page-card')];
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return cards.length;
  }

  function showLine(at: number): void {
    const cards = [...list.querySelectorAll<HTMLElement>('.page-card')];
    if (at >= cards.length) list.appendChild(line);
    else list.insertBefore(line, cards[at]);
    line.style.display = 'block';
  }

  function hideLine(): void { line.style.display = 'none'; }

  // ── thumbnails ──────────────────────────────────────────────────────────────
  async function renderThumb(card: HTMLElement): Promise<void> {
    const idx = Number(card.dataset.index);
    if (!currentRenderer || currentRenderer.isDestroyed() || Number.isNaN(idx) || idx >= currentRenderer.numPages) return;
    try {
      const info = await currentRenderer.loadPage(idx, THUMB_SCALE);
      if (currentRenderer.isDestroyed()) return; // renderer swapped mid-render
      const holder = card.querySelector('.page-thumb');
      if (!holder) return;
      info.canvas.style.width = '100%';
      info.canvas.style.height = 'auto';
      info.canvas.style.display = 'block';
      holder.appendChild(info.canvas);
    } catch {
      // Renderer was destroyed/replaced mid-render — the card will be re-rendered
      // by the next render() pass; not an error worth surfacing.
    }
  }

  // ── context menu ────────────────────────────────────────────────────────────
  function closeMenu(): void { menu?.remove(); menu = null; }

  function openMenu(x: number, y: number, index: number): void {
    closeMenu();
    const last = (currentProject?.pages.length ?? 0) <= 1;
    menu = document.createElement('div');
    menu.className = 'page-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    const items: Array<[string, () => void, boolean]> = [
      ['Rotate 90°', () => ops.rotatePage(index), false],
      ['Delete page', () => ops.deletePage(index), last],
    ];
    for (const [label, fn, disabled] of items) {
      const item = document.createElement('button');
      item.textContent = label;
      item.disabled = disabled;
      if (disabled) item.title = 'Cannot delete the only page';
      item.addEventListener('click', () => { closeMenu(); fn(); });
      menu.appendChild(item);
    }
    document.body.appendChild(menu);
  }

  document.addEventListener('pointerdown', e => { if (menu && !menu.contains(e.target as Node)) closeMenu(); }, true);
  window.addEventListener('blur', closeMenu);

  // ── render ──────────────────────────────────────────────────────────────────
  function render(renderer: PdfRenderer, project: ProjectData): void {
    currentRenderer = renderer;
    currentProject = project;
    closeMenu();
    hideLine();
    list.textContent = '';
    project.pages.forEach((p, i) => {
      const card = document.createElement('div');
      card.className = 'page-card';
      card.draggable = true;
      card.dataset.index = String(i);
      card.dataset.pageId = p.pageId;
      if (i === activeIndex) card.classList.add('active');

      const badge = document.createElement('span');
      badge.className = 'page-num';
      badge.textContent = String(i + 1);
      card.appendChild(badge);

      if (p.markups.length > 0) {
        const dot = document.createElement('span');
        dot.className = 'page-markup-dot';
        dot.title = `${p.markups.length} markup${p.markups.length === 1 ? '' : 's'} on this page`;
        card.appendChild(dot);
      }
      if (p.scale.calibrated) {
        const tick = document.createElement('span');
        tick.className = 'page-cal-tick';
        tick.title = 'Scale calibrated';
        card.appendChild(tick);
      }

      const thumb = document.createElement('div');
      thumb.className = 'page-thumb';
      card.appendChild(thumb);

      const src = document.createElement('div');
      src.className = 'page-src';
      src.textContent = p.sourceFile ?? '';
      src.title = p.sourceFile ?? '';
      card.appendChild(src);

      card.title = `Page ${i + 1}${p.sourceFile ? ` — ${p.sourceFile}` : ''}`;

      card.addEventListener('click', () => { activeIndex = i; }); // main.ts drives setActive via appState
      card.addEventListener('contextmenu', e => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY, i);
      });

      // reorder drag (internal HTML5 DnD — unaffected by Tauri OS-drop interception)
      card.addEventListener('dragstart', e => {
        dropSourceIndex = i;
        e.dataTransfer!.effectAllowed = 'move';
        e.dataTransfer!.setData('text/x-redline-page', String(i));
      });
      card.addEventListener('dragend', () => { dropSourceIndex = null; hideLine(); });

      list.appendChild(card);
      observer.observe(card);
    });
    list.appendChild(line);
  }

  // ── panel-level drop handling (reorder + OS file insert) ───────────────────
  list.addEventListener('dragover', e => {
    const hasFiles = Array.from(e.dataTransfer?.types ?? []).includes('Files');
    if (dropSourceIndex === null && !hasFiles) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = hasFiles ? 'copy' : 'move';
    showLine(insertionIndexFrom(e.clientY));
  });

  list.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    const at = insertionIndexFrom(e.clientY);
    hideLine();

    const files = e.dataTransfer ? [...e.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith('.pdf')) : [];
    if (files.length > 0) {
      ops.insertPdfFiles(files, at);
      dropSourceIndex = null;
      return;
    }
    const from = dropSourceIndex;
    dropSourceIndex = null;
    if (from === null || from === at || from === at - 1) return;
    const n = currentProject?.pages.length ?? 0;
    const order = [...Array(n).keys()];
    order.splice(from, 1);
    order.splice(at, 0, from);
    ops.reorder(order);
  });

  // ── open/close ─────────────────────────────────────────────────────────────
  function setOpen(next: boolean): void {
    open = next;
    panel.classList.toggle('open', open);
    document.getElementById('btn-page-panel')?.classList.toggle('active', open);
  }

  function setActive(index: number): void {
    activeIndex = index;
    for (const c of list.querySelectorAll<HTMLElement>('.page-card')) {
      c.classList.toggle('active', Number(c.dataset.index) === index);
    }
    list.querySelector('.page-card.active')?.scrollIntoView({ block: 'nearest' });
  }

  return { render, setActive, setOpen, isOpen: () => open };
}
