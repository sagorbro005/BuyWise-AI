import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

// Uses an installed Chromium browser. The test creates a fresh anonymous
// workspace and stops at purchase review; buyer sign-in is a separate gate.
const channel = process.env.BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chrome');
const browser = await chromium.launch({ channel });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:3000');
  // ngrok Free may show its visitor interstitial before the actual app.
  await page.getByRole('button', { name: /visit site/i }).or(page.getByLabel('Per-purchase cap ($)', { exact: true })).first().waitFor();
  if (await page.getByRole('button', { name: /visit site/i }).count()) {
    await page.getByRole('button', { name: /visit site/i }).click();
  }
  await page.getByLabel('Per-purchase cap ($)', { exact: true }).fill('260');
  await page.getByRole('button', { name: 'Confirm mandate' }).click();
  await page.getByRole('button', { name: 'Run an attack test' }).click();
  await page.getByText('Stopped before PayPal', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Choose a safe alternative' }).click();
  await page.locator('article').filter({ hasText: 'Hush 75 Wireless' }).getByRole('button', { name: 'Review purchase' }).click();
  await page.getByRole('heading', { name: 'Review your purchase' }).waitFor();
  assert.match(await page.locator('.checkout-summary').textContent(), /\$245\.00/);
  await page.getByRole('button', { name: 'Cancel purchase' }).click();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await page.getByRole('heading', { name: 'Decision trail' }).waitFor();
  await page.getByLabel('Search audit events').fill('attack');
  await page.locator('.timeline-panel .ag-row').filter({ hasText: 'Attack test blocked' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.timeline-panel .ag-row').length === 1);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export filtered audit CSV' }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'buywise-audit.csv');
  const stream = await download.createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk.toString();
  assert.match(csv, /Attack test blocked/);
  assert.match(csv, /Evidence SHA-256/);
  assert.doesNotMatch(csv, /Mandate confirmed/);
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.locator('article').filter({ hasText: 'Hush 75 Wireless' }).getByRole('button', { name: 'Review purchase' }).click();
  await page.getByRole('heading', { name: 'Review your purchase' }).waitFor();
  const otherTab = await page.context().newPage();
  await otherTab.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:3000');
  await otherTab.getByRole('button', { name: 'Revoke mandate' }).click();
  await otherTab.getByRole('button', { name: 'Confirm mandate' }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('heading', { name: 'Review your purchase' }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'Find my best fit' }).isDisabled(), true);
  assert.equal(await page.locator('article').filter({ hasText: 'Hush 75 Wireless' }).getByRole('button', { name: 'Review purchase' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Confirm mandate' }).click();
  await page.getByRole('button', { name: 'Update mandate' }).waitFor();
  await otherTab.close();
  console.log('Browser passed: filtered CSV export, mandate, attack, purchase review, cancellation, audit search, cross-tab revocation and reactivation.');
} finally {
  await browser.close();
}
