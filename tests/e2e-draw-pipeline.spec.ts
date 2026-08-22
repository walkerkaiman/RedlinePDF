import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Full Draw Pipeline', () => {
  // Test: activate line tool → click canvas to start draw → drag → release → verify markup created
  
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    const root = page.locator('#app').first();
    await expect(root).toBeVisible({ timeout: 8000 });

  });


  test('click line tool → click canvas to start draw → drag → release commits markup', async ({ page }) => {
    // Step 1: Find and activate the line tool
    
    const lineBtn = page.locator('[data-tool="line"]').first();
    
    if (await lineBtn.count() === 0) {
      throw new Error('Line tool button not found — cannot test draw pipeline');
    
    }

    // Verify it's clickable and can be activated
    
    await expect(lineBtn).toBeVisible();
    await lineBtn.click();
    
    await expect(lineBtn).toHaveClass(/active/, { timeout: 3000 });
    console.log('✅ Line tool activated');

    // Step 2: Find the canvas/SVG element and get its bounding box
    
    const canvas = page.locator('#konva-canvas, svg.konva-stage').first();
    
    if (await canvas.count() === 0) {
      throw new Error('No konva canvas found — cannot test drawing');
    }

    const box = await canvas.boundingBox();
    
    expect(box).toBeDefined();
    console.log(`📍 Canvas at (${box!.x}, ${box!.y})`);

    // Step 3: Click on the canvas to START the draw (mousedown)
    
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;

    await page.mouse.move(startX, startY, { steps: 5 });
    await page.mouse.down();
    
    console.log('✅ Mouse down at center of canvas');

    // Step 4: Drag to another position (mousemove)
    
    const endX = startX + 100;
    const endY = startY + 50;

    await page.mouse.move(endX, endY, { steps: 5 });
    
    console.log('✅ Mouse moved during drag');

    // Step 5: Release mouse (mouseup) — this should complete the draw
    
    await page.mouse.up();
    console.log('✅ Mouse up — draw should be committed to markup layer');

    // Step 6: Verify the markup was actually created in appState
    
    const svgLines = await canvas.locator('line').count();
    const svgPaths = await canvas.locator('path').count();
    
    console.log(`📊 SVG elements after draw: ${svgLines} lines, ${svgPaths} paths`);

    if (svgLines > 0 || svgPaths > 0) {
      console.log('✅ Drawing committed to markup layer');
      
      await page.screenshot({ path: '/tmp/redlinepdf-full-draw-verified.png' });
    } else {
      throw new Error(`❌ No SVG elements created after draw — pipeline failed. Found ${svgLines} lines, ${svgPaths} paths`);
    
  }
});
