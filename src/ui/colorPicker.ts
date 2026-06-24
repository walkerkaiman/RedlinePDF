/**
 * Color picker component.
 * Returns a container element with preset swatches + a native color input.
 */

// Redline construction colors
export const PRESET_COLORS = [
  '#e63946', // Redline red
  '#ff6b00', // Safety orange
  '#ffd700', // Yellow
  '#2dc653', // Green
  '#0077cc', // Blue
  '#6a0dad', // Purple
  '#ffffff',  // White
  '#000000',  // Black
];

export interface ColorPickerOptions {
  label?: string;
  initialColor?: string;
  onChange: (color: string) => void;
}

export function createColorPicker(options: ColorPickerOptions): HTMLElement {
  const { label = 'Color', initialColor = '#e63946', onChange } = options;

  const container = document.createElement('div');
  container.className = 'color-picker-group';

  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  container.appendChild(labelEl);

  const swatchRow = document.createElement('div');
  swatchRow.className = 'color-swatches';

  PRESET_COLORS.forEach(color => {
    const swatch = document.createElement('button');
    swatch.className = 'color-swatch';
    swatch.style.backgroundColor = color;
    swatch.title = color;
    if (color === initialColor) swatch.classList.add('selected');
    swatch.addEventListener('click', () => {
      swatchRow.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      nativeInput.value = color;
      onChange(color);
    });
    swatchRow.appendChild(swatch);
  });

  // Custom color input
  const nativeInput = document.createElement('input');
  nativeInput.type = 'color';
  nativeInput.value = initialColor;
  nativeInput.className = 'color-native';
  nativeInput.title = 'Custom color';
  nativeInput.addEventListener('input', () => {
    swatchRow.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
    onChange(nativeInput.value);
  });
  swatchRow.appendChild(nativeInput);

  container.appendChild(swatchRow);
  return container;
}

/** Update the selected swatch in an existing color picker container */
export function setPickerColor(container: HTMLElement, color: string): void {
  const nativeInput = container.querySelector<HTMLInputElement>('input[type="color"]');
  if (nativeInput) nativeInput.value = color;
  container.querySelectorAll('.color-swatch').forEach(s => {
    const btn = s as HTMLButtonElement;
    btn.classList.toggle('selected', btn.style.backgroundColor === hexToRgbStyle(color));
  });
}

function hexToRgbStyle(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
