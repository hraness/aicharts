import assert from "node:assert/strict";

/** Drive only an owned test context: this deliberately saves a declined choice. */
export async function verifySettledConsentFlow(page, { allowHidden = false, screenshot } = {}) {
  const note = page.locator('[data-slot="hraness-cookie-consent"]');
  assert.equal(await note.count(), 1, "Expected one shared consent control");
  assert.equal(await note.getAttribute("data-consent-placement"), "flow");
  if (allowHidden && !await note.isVisible()) return { state: "hidden", runtime: "not active", placement: "flow" };
  await note.waitFor({ state: "visible", timeout: 15000 });
  const initialState = await note.getAttribute("data-consent-state");
  assert.ok(["required", "clear", "declined"].includes(initialState), `Unexpected consent state ${initialState}`);
  const prior = await page.evaluate(() => {
    const saved = { x: scrollX, y: scrollY, font: document.documentElement.style.fontSize, behavior: document.documentElement.style.scrollBehavior, base: parseFloat(getComputedStyle(document.documentElement).fontSize) };
    document.documentElement.style.scrollBehavior = "auto";
    return saved;
  });
  const samples = [];
  const fontSizes = { base: prior.base, restored: null };
  async function closePanel() {
    if (await note.locator("details").getAttribute("open") !== null) await note.locator("summary").click();
  }
  async function decline() {
    await closePanel();
    await note.locator("summary").click();
    await note.getByRole("button", { name: "Decline analytics", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-slot="hraness-cookie-consent"]')?.dataset.consentState === "declined");
    await closePanel();
  }
  async function measure(state) {
    for (const scale of [1, 2]) {
      const appliedFontSize = await page.evaluate(async ({ base, scale }) => {
        document.documentElement.style.fontSize = `${base * scale}px`;
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return parseFloat(getComputedStyle(document.documentElement).fontSize);
      }, { base: prior.base, scale });
      assert.equal(appliedFontSize, prior.base * scale, `Consent check must apply ${scale * 100}% text size`);
      for (const position of ["near", "end"]) {
        await page.evaluate(position => {
          const footer = document.querySelector('[data-hraness-marketing="footer"]') ?? document.querySelector('[data-slot="hraness-site-footer"]');
          scrollTo(0, position === "near" ? footer.getBoundingClientRect().top + scrollY - innerHeight * 0.65 : document.documentElement.scrollHeight);
        }, position);
        const metrics = await note.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const footer = element.closest('[data-slot="hraness-site-footer"]');
          const bounds = footer?.getBoundingClientRect();
          const intersects = box => box.width > 0 && box.height > 0 && rect.left < box.right - 0.5 && rect.right > box.left + 0.5 && rect.top < box.bottom - 0.5 && rect.bottom > box.top + 0.5;
          const overlapping = [...document.querySelectorAll('footer a, footer button, footer summary, [data-hraness-marketing="footer"] a')]
            .filter(target => !element.contains(target) && intersects(target.getBoundingClientRect()))
            .map(target => ({ text: target.textContent.trim(), label: target.getAttribute("aria-label") }));
          return { position: getComputedStyle(element).position, insideFooter: !!bounds && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1, overlapping, overflow: document.documentElement.scrollWidth > innerWidth + 1, width: rect.width, height: rect.height };
        });
        assert.equal(metrics.position, "relative", `${state}/${scale}/${position}: settled preferences must stay in document flow`);
        assert.equal(metrics.insideFooter, true, `${state}/${scale}/${position}: preferences outside shared footer`);
        assert.deepEqual(metrics.overlapping, [], `${state}/${scale}/${position}: preferences cover footer controls`);
        assert.equal(metrics.overflow, false, `${state}/${scale}/${position}: page overflows`);
        samples.push({ state, scale, scrollPosition: position, ...metrics });
        if (screenshot) await screenshot({ page, state, scale, position });
      }
      await note.locator("summary").click();
      const panel = note.locator("details > div");
      assert.equal(await panel.isVisible(), true);
      await panel.scrollIntoViewIfNeeded();
      await panel.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const beforePanelAlignment = await panel.boundingBox();
      if (beforePanelAlignment && (beforePanelAlignment.y < -1 || beforePanelAlignment.y + beforePanelAlignment.height > page.viewportSize().height + 1)) {
        await panel.evaluate(async element => {
          element.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'instant' });
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
      }
      const panelBox = await panel.boundingBox();
      const geometry = await panel.evaluate(element => {
        const css = getComputedStyle(element);
        const note = element.closest('[data-slot="hraness-cookie-consent"]');
        return { boxSizing: css.boxSizing, maxHeight: css.maxHeight, padding: css.padding,
          details: element.closest('details').getBoundingClientRect().toJSON(),
          note: note.getBoundingClientRect().toJSON(),
          controlRows: getComputedStyle(note).getPropertyValue('--_hraness-site-footer-control-rows'),
          rootFontSize: getComputedStyle(document.documentElement).fontSize };
      });
      assert.ok(panelBox && panelBox.x >= -1 && panelBox.y >= -1 && panelBox.x + panelBox.width <= page.viewportSize().width + 1 && panelBox.y + panelBox.height <= page.viewportSize().height + 1, `${state}/${scale}: preferences panel leaves viewport ${JSON.stringify({ panelBox, viewport: page.viewportSize(), ...geometry })}`);
      samples.at(-1).panel = { beforeAlignment: beforePanelAlignment, afterAlignment: panelBox, viewport: page.viewportSize(), appliedFontSize, ...geometry };
      for (const name of ["Accept analytics", "Decline analytics"]) {
        const control = note.getByRole("button", { name, exact: true });
        await control.scrollIntoViewIfNeeded();
        const access = await control.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const panel = element.closest("details > div").getBoundingClientRect();
          return { insidePanel: rect.left >= panel.left - 1 && rect.right <= panel.right + 1 && rect.top >= panel.top - 1 && rect.bottom <= panel.bottom + 1,
            insideViewport: rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1,
            hitTarget: element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)) };
        });
        assert.deepEqual(access, { insidePanel: true, insideViewport: true, hitTarget: true }, `${state}/${scale}: ${name} is clipped or covered`);
      }
      await closePanel();
    }
  }
  try {
    await closePanel();
    if (initialState === "required") await decline();
    await measure(initialState === "required" ? "declined" : initialState);
    if (initialState === "clear") { await decline(); await measure("declined"); }
    return { initialState, placement: "flow", samples, panelAccess: true, fontSizes };
  } finally {
    try { await closePanel(); }
    finally {
      fontSizes.restored = await page.evaluate(async prior => {
        document.documentElement.style.fontSize = prior.font;
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        scrollTo(prior.x, prior.y);
        document.documentElement.style.scrollBehavior = prior.behavior;
        return parseFloat(getComputedStyle(document.documentElement).fontSize);
      }, prior);
      assert.equal(fontSizes.restored, prior.base, "Consent check must restore the original text size");
    }
  }
}
