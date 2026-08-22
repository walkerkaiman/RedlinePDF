import { test, expect } from '@playwright/test';

// Simple e2e test: verify line tool can be activated without errors
test.describe('Line Tool Activation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    // Wait for app to load
    
    const root = page.locator('#app').first();
    await expect(root).toBeVisible({ timeout: 8000 });
  
});


  test('activate line tool without crash', async ({ page }) => {
    const lineBtn = page.locator('[data-tool="line"], button:has-text("Line")').first();
    
    if (await lineBtn.count() === 0) {
      throw new Error('Line tool not found');
    
    }

    // Click the line tool to activate it
    
    await expect(lineBtn).toBeVisible();
    await lineBtn.click();
    
    // Verify active state applied without crashing
    
    await expect(lineBtn).toHaveClass(/active/, { timeout: 3000 });
    console.log('✅ Line tool activated successfully');

  });


});

