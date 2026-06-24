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
}

/**
 * Show a pre-export dialog letting the user pick an output resolution.
 * Returns ExportOptions or null if the user cancels.
 */
export async function showExportOptionsDialog(): Promise<ExportOptions | null> {
  const body = `
    <p>Choose the output resolution for the exported PDF.</p>
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
    <p class="modal-hint">
      Standard PDF points are 72 pt/inch. Higher DPI renders more pixels per point.
    </p>
  `;

  const result = await showModal('Export Quality', body, 'Export');
  if (!result) return null;

  const selected = document.querySelector<HTMLInputElement>('input[name="export-quality"]:checked');
  const dpi = selected ? parseInt(selected.value, 10) : 150;
  return { dpi, scale: dpi / 72 };
}
