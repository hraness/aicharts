import assert from 'node:assert/strict';
import { waitForPublicPage } from './public-page-readiness.mjs';

export async function verifyPublicPageReadiness(browser) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent('<main id="loading"><p role="status">Loading</p></main>');
    await page.evaluate(() => {
      setTimeout(() => {
        const resolved = document.createElement('div');
        resolved.id = 'resolved';
        resolved.hidden = true;
        resolved.innerHTML = '<main><h1>Leaderboard</h1></main>';
        document.body.append(resolved);
      }, 75);
      setTimeout(() => {
        document.querySelector('#loading').remove();
        document.querySelector('#resolved').hidden = false;
      }, 200);
    });
    await waitForPublicPage(page);
    assert.equal(await page.locator('main').count(), 1);
    assert.equal(await page.locator('main h1').textContent(), 'Leaderboard');
    assert.equal(await page.locator('main h1').isVisible(), true);
    for (const markup of [
      '<main><p role="status">Loading</p></main>',
      '<main><h1>One</h1></main><main hidden><h1>Two</h1></main>',
      '<main><h1 hidden>Hidden heading</h1></main>',
      '<main hidden><h1>Hidden page</h1></main>',
    ]) {
      await page.setContent(markup);
      await assert.rejects(waitForPublicPage(page, { timeout: 150 }), /Timeout/u,
        'Unresolved loading, duplicate landmarks, and hidden content must fail readiness.');
    }
    await page.setContent('<main>Minimal public page</main>');
    await waitForPublicPage(page, { minimal: true });
    console.log('Public page readiness: delayed streaming resolved; permanent loading, duplicates, and hidden content rejected.');
  } finally {
    await context.close();
  }
}
