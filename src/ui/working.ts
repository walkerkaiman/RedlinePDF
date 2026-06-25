/**
 * Full-screen "working" overlay — shows a spinner + message while the app
 * is doing something slow (loading a PDF, rendering for export, etc.).
 *
 * Call showWorking(message) to display it and hideWorking() to dismiss it.
 * Multiple concurrent calls stack: hideWorking() only dismisses when the
 * last caller has finished (ref-counted).
 */

let depth = 0;

export function showWorking(message = 'Working…'): void {
  const overlay = document.getElementById('working-overlay')!;
  const msg = document.getElementById('working-message')!;
  msg.textContent = message;
  depth++;
  if (depth === 1) overlay.classList.add('working-visible');
}

export function updateWorking(message: string): void {
  const msg = document.getElementById('working-message')!;
  if (msg) msg.textContent = message;
}

export function hideWorking(): void {
  if (depth <= 0) return;
  depth--;
  if (depth === 0) {
    document.getElementById('working-overlay')!.classList.remove('working-visible');
  }
}
