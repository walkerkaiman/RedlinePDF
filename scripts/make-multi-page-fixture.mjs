// Generate a 3-page test PDF fixture for cross-page markup-isolation e2e tests.
import { PDFDocument } from 'pdf-lib';
import fs from 'fs';

const doc = await PDFDocument.create();
for (let i = 0; i < 3; i++) {
  const page = doc.addPage([612, 792]);
  page.drawText(`RedlinePDF cross-page fixture — page ${i + 1}`, {
    x: 72, y: 720, size: 18,
  });
  page.drawText(`Anchor A top-left`, { x: 72, y: 700, size: 11 });
  page.drawText(`Anchor B bottom-right`, { x: 420, y: 60, size: 11 });
}
const out = await doc.save();
const dest = new URL('../tests/fixtures/test-3page.pdf', import.meta.url);
fs.writeFileSync(dest, out);
console.log('wrote', dest.pathname, out.length, 'bytes');
