// A streamed page can briefly contain its loading landmark and a hidden final
// landmark together. Wait for the unique, visible resolved page before auditing.
export async function waitForPublicPage(page, { minimal = false, timeout = 15_000 } = {}) {
  await page.waitForFunction(({ minimal }) => {
    const mains = document.querySelectorAll('main');
    if (mains.length !== 1 || !mains[0].checkVisibility()) return false;
    const heading = mains[0].querySelector('h1');
    return minimal || Boolean(heading?.checkVisibility() && heading.textContent.trim());
  }, { minimal }, { timeout });
}
