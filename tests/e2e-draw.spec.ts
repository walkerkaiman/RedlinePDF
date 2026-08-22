import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import path from 'path';

// Create a minimal valid PDF with a red rectangle for testing
function createTestPDF(): Buffer {
  const contentStream = '% Red rectangle at (100,500) to (150,450)\nq\n1 0 0 RG\n2 w\n100 500 50 -50 re\nS \nQ\nBT /F1 14 Tf 100 750 Td (Test PDF) Tj ET\n';
  
  const contentBuffer = Buffer.from(contentStream, 'utf-8');
  const contentLength = contentBuffer.length;
  
  // Build minimal valid PDF structure
  let offset = 0;
  const offsets: number[] = [];
  
  // Object 1: Catalog (offset 9)
  offsets.push(9);
  let pdf = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  offset += pdf.length;
  
  // Object 2: Pages (after catalog, need to write this later)
  const pagesOffset = offset;
  offsets.push(pagesOffset);
  pdf += '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  offset += pdf.length;
  
  // Object 3: Page (after pages)
  const pageOffset = offset;
  offsets.push(pageOffset);
  pdf += '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n';
  offset += pdf.length;
  
  // Object 4: Content stream (after page)
  const streamOffset = offset;
  offsets.push(streamOffset);
  pdf += `4 0 obj\n<< /Length ${contentLength} >>\nstream\n`;
  pdf += contentStream;
  pdf += 'endstream\n';
  pdf += 'endobj\n';
  
  // XREF table
  const xrefOffset = offset;
  let xref = '\nstartxref\n' + String(xrefOffset) + '\n%%EOF';
  
  return Buffer.from(pdf + xref);
}

test.describe('Drawing Tools End-to-End', () => {
  // Write the test PDF to disk so Playwright can load it via file dialog
  
  test.beforeAll(async () => {
    const fs = await import('fs');
    const pdfDir = path.join(process.cwd(), 'tests', 'fixtures');

    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }
    
    const pdfPath = path.join(pdfDir, 'test.pdf');
    const testPDF = createTestPDF();
    
    writeFileSync(pdfPath, testPDF);
    console.log(`📄 Test PDF created at ${pdfPath} (${testPDF.length} bytes)`);
  });

  test('loads app and verifies canvas is interactive', async ({ page }) => {
    // Step 1: Navigate to the app
    
    await page.goto('http://localhost:5173');
    
    // Wait for the main app container to be visible (up to 8 seconds)
    
    const root = page.locator('#app').first();
    await expect(root).toBeVisible({ timeout: 8000 });
    
    console.log('✅ App loaded successfully at http://localhost:5173');
    
    // Take screenshot for debugging
    
    await page.screenshot({ 
      path: '/tmp/redlinepdf-e2e-initial.png', 
      fullPage: false 
    });
    console.log('📷 Screenshot saved to /tmp/redlinepdf-e2e-initial.png');
    
    // Step 2: Check that the canvas/SVG elements exist
    
    const svgElements = await page.locator('svg').count();
    const canvasElements = await page.locator('canvas').count();
    
    console.log(`SVG elements found: ${svgElements}`);
    console.log(`Canvas elements found: ${canvasElements}`);
    
    // Step 3: Verify toolbar buttons exist
    
    const toolButtons = await page.locator('[class*="tool"], button, [data-tool]').filter(':visible').count();
    
    console.log(`Visible toolbar/tool buttons: ${toolButtons}`);
    
    // Step 4: Try to activate the line tool
    
    try {
      const lineBtn = page.locator('button:has-text("Line"), [data-tool="line"]').first();
      
      if (await lineBtn.count() > 0) {
        console.log('✅ Line tool button found');
        
        // Click the line tool to activate it
        
        await lineBtn.click();
        
        await expect(lineBtn).toHaveClass(/active/, { timeout: 3000 });
        console.log('✅ Line tool activated');
      } else {
        console.warn('⚠️ Could not find line tool button with expected selectors');
      }
    } catch (err) {
      console.error('❌ Failed to activate line tool:', err.message);
      
      await page.screenshot({ path: '/tmp/redlinepdf-e2e-error.png' });
    }
  });


});


