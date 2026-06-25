/**
 * Simple promise-based modal dialog.
 * Returns the resolved value (from clicking OK) or null (Cancel/Escape).
 */

export function showModal(title: string, bodyHtml: string, okText = 'OK'): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay')!;
    const modalTitle = document.getElementById('modal-title')!;
    const modalBody = document.getElementById('modal-body')!;
    const okBtn = document.getElementById('modal-ok') as HTMLButtonElement;
    const cancelBtn = document.getElementById('modal-cancel') as HTMLButtonElement;
    const closeBtn = document.getElementById('modal-close') as HTMLButtonElement;

    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    okBtn.textContent = okText;
    overlay.style.display = 'flex';

    // Focus first input if present
    setTimeout(() => {
      const firstInput = modalBody.querySelector<HTMLInputElement>('input, select');
      if (firstInput) firstInput.focus();
    }, 50);

    function done(result: string | null) {
      overlay.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKeyDown);
      resolve(result);
    }

    function onOk() { done('ok'); }
    function onCancel() { done(null); }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter') { e.preventDefault(); done('ok'); }
      if (e.key === 'Escape') done(null);
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKeyDown);
  });
}

// ── Export quality dialog ─────────────────────────────────────────────────

export interface ExportOptions {
  dpi: number;
  /** PDF-point scale factor (= dpi / 72). */
  scale: number;
  /**
   * 0-based page indices to export.
   * null means "all pages" (original behaviour).
   */
  pageIndices: number[] | null;
}

/**
 * Parse a human-readable page range string into 0-based page indices.
 * Accepts comma-separated values and ranges (e.g. "1, 3-5, 7").
 * Returns null if the input represents all pages or is empty.
 * Invalid tokens are silently skipped.
 */
function parsePageRange(raw: string, totalPages: number): number[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const indices = new Set<number>();
  for (const token of trimmed.split(/[,;]+/)) {
    const part = token.trim();
    const rangeMatch = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      const from = parseInt(rangeMatch[1], 10) - 1;
      const to   = parseInt(rangeMatch[2], 10) - 1;
      for (let i = Math.max(0, from); i <= Math.min(totalPages - 1, to); i++) {
        indices.add(i);
      }
    } else {
      const n = parseInt(part, 10);
      if (!isNaN(n)) {
        const idx = n - 1;
        if (idx >= 0 && idx < totalPages) indices.add(idx);
      }
    }
  }

  if (indices.size === 0 || indices.size === totalPages) return null;
  return [...indices].sort((a, b) => a - b);
}

/**
 * Show a pre-export dialog letting the user pick output resolution and page range.
 * Returns ExportOptions or null if the user cancels.
 */
export async function showExportOptionsDialog(
  totalPages: number,
  currentPage: number,
): Promise<ExportOptions | null> {
  const multiPage = totalPages > 1;
  const pagesSection = multiPage ? `
    <div class="export-section-label">Pages</div>
    <div class="page-options">
      <label class="page-option">
        <input type="radio" name="export-pages" value="all" checked>
        <span>All pages <span class="quality-dpi">(${totalPages} pages)</span></span>
      </label>
      <label class="page-option">
        <input type="radio" name="export-pages" value="current">
        <span>Current page <span class="quality-dpi">(Page ${currentPage + 1})</span></span>
      </label>
      <label class="page-option page-option-custom">
        <input type="radio" name="export-pages" value="custom">
        <span>Custom range</span>
        <input type="text" id="export-page-range" class="page-range-input"
               placeholder="e.g. 1, 3-5, 7" disabled
               title="Comma-separated pages or ranges (e.g. 1, 3-5, 7)" />
      </label>
    </div>` : '';

  const body = `
    <div class="export-section-label">Quality</div>
    <div class="quality-options">
      <label class="quality-option">
        <input type="radio" name="export-quality" value="96" id="eq-screen">
        <div class="quality-info">
          <strong>Screen / Share <span class="quality-dpi">96 DPI</span></strong>
          <span class="quality-desc">Compact file — ideal for email or digital review</span>
        </div>
      </label>
      <label class="quality-option">
        <input type="radio" name="export-quality" value="150" id="eq-standard" checked>
        <div class="quality-info">
          <strong>Standard Print <span class="quality-dpi">150 DPI</span> <span class="quality-badge">Recommended</span></strong>
          <span class="quality-desc">Good balance of quality and file size for everyday printing</span>
        </div>
      </label>
      <label class="quality-option">
        <input type="radio" name="export-quality" value="300" id="eq-hq">
        <div class="quality-info">
          <strong>High Quality Print <span class="quality-dpi">300 DPI</span></strong>
          <span class="quality-desc">Professional quality — larger files and slower export for large-format drawings</span>
        </div>
      </label>
    </div>
    ${pagesSection}
    <p class="modal-hint">
      Standard PDF points are 72 pt/inch. Higher DPI renders more pixels per point.
    </p>
  `;

  // Wire up the custom range input enable/disable AFTER the modal renders.
  setTimeout(() => {
    const radios = document.querySelectorAll<HTMLInputElement>('input[name="export-pages"]');
    const rangeInput = document.getElementById('export-page-range') as HTMLInputElement | null;
    radios.forEach(r => r.addEventListener('change', () => {
      if (rangeInput) rangeInput.disabled = r.value !== 'custom';
      if (r.value === 'custom' && rangeInput) rangeInput.focus();
    }));
  }, 0);

  const result = await showModal('Export PDF', body, 'Export');
  if (!result) return null;

  const selectedQuality = document.querySelector<HTMLInputElement>('input[name="export-quality"]:checked');
  const dpi = selectedQuality ? parseInt(selectedQuality.value, 10) : 150;

  let pageIndices: number[] | null = null;
  if (multiPage) {
    const selectedPages = document.querySelector<HTMLInputElement>('input[name="export-pages"]:checked');
    const mode = selectedPages?.value ?? 'all';
    if (mode === 'current') {
      pageIndices = [currentPage];
    } else if (mode === 'custom') {
      const rangeInput = document.getElementById('export-page-range') as HTMLInputElement | null;
      pageIndices = parsePageRange(rangeInput?.value ?? '', totalPages);
    }
    // 'all' → pageIndices stays null
  }

  return { dpi, scale: dpi / 72, pageIndices };
}
