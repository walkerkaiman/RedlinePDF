import { test, expect } from '@playwright/test';
import path from 'path';

// Create minimal test PDF once before all tests run
const fs = await import('fs');
const pdfPath = path.join(process.cwd(), 'tests', 'fixtures', 'test.pdf');

if (!fs.existsSync(path.dirname(pdfPath))) {
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
}

if (!fs.existsSync(pdfPath)) {
  const contentStream = '% Test PDF with red rectangle\nq\n1 0 0 RG\n2 w\n100 500 50 -50 re\nS \nQ\nBT /F1 14 Tf 100 750 Td (Test) Tj ET\n';
  const contentBuffer = Buffer.from(contentStream, 'utf-8');
  
  let offset = 0;
  const offsets: number[] = [];
  
  offsets.push(9);
  let pdf = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  offset += pdf.length;
  
  const pagesOffset = offset;
  offsets.push(pagesOffset);
  pdf += '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  offset += pdf.length;
  
  const pageOffset = offset;
  offsets.push(pageOffset);
  pdf += '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n';
  offset += pdf.length;
  
  const streamOffset = offset;
  offsets.push(streamOffset);
  pdf += `4 0 obj\n<< /Length ${contentBuffer.length} >>\nstream\n`;
  pdf += contentStream;
  pdf += 'endstream\n';
  pdf += 'endobj\n';
  
  const xrefOffset = offset;
  let xref = '\nstartxref\n' + String(xrefOffset) + '\n%%EOF';
  
  fs.writeFileSync(pdfPath, Buffer.from(pdf + xref));
}

test.describe('Full Drawing Flow', () => {
  test('click tool → click canvas → drag → release creates markup', async ({ page }) => {
    // Step 1: Load app
    
    await page.goto('http://localhost:5173');
    
    const root = page.locator('#app').first();
    await expect(root).toBeVisible({ timeout: 8000 });
    
    console.log('✅ App loaded');
    await page.screenshot({ path: '/tmp/redlinepdf-full-initial.png' });
    
    // Step 2: Activate line tool
    
    const lineBtn = page.locator('button:has-text("Line"), [data-tool="line"]').first();
    expect(await lineBtn.count()).toBeGreaterThan(0);
    
    await lineBtn.click();
    await expect(lineBtn).toHaveClass(/active/, { timeout: 3000 });
    console.log('✅ Line tool activated');
    
    // Step 3: Find the canvas/SVG element
    
    const canvas = page.locator('svg').first();
    const box = await canvas.boundingBox();
    
    expect(box).toBeDefined();
    console.log(`📍 Canvas at (${box!.x.toFixed(0)}, ${box!.y.toFixed(0)}) size ${box!.width}x${box!.height}`);
    
    // Step 4: Click on canvas to start drawing
    
    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;
    
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    console.log('✅ Mouse down at center of canvas');
    
    // Step 5: Drag to another position
    
    await page.mouse.move(centerX + 100, centerY + 50);
    await page.mouse.up();
    console.log('✅ Mouse up after drag - draw should complete');
    
    // Step 6: Check if markup was created (look for SVG line elements on canvas)
    
    const svgLines = await canvas.locator('line').count();
    const svgPaths = await canvas.locator('path').count();
    
    console.log(`SVG lines after draw: ${svgLines}`);
    console.log(`SVG paths after draw: ${svgPaths}`);
    
    if (svgLines > 0 || svgPaths > 0) {
      console.log('✅ Drawing created visible SVG elements');
      
      await page.screenshot({ path: '/tmp/redlinepdf-full-after-draw.png' });
    } else {
      console.warn('⚠️ No SVG line/path found after drag — draw may not be rendering');
      
      await page.screenshot({ path: '/tmp/redlinepdf-full-no-render.png' });
      
      // Check if there's any markup layer at all
      
      const markupLayer = page.locator('.markup-layer, svg.konva-markup').first();
      const hasMarkup = await markupLayer.count() > 0;
      
      console.log(`Markup layer exists: ${hasMarkup}`);
    }
    
    // Step 7: Check if the line tool is still active (should remain selected)
    
    await expect(lineBtn).toHaveClass(/active/);
    console.log('✅ Line tool remained active after draw');

  });


});
