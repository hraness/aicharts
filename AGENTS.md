Keep the product name lowercase. The icon at `app/icon.svg` supplies the favicon and header. Export its PNG for the portfolio with the command in `showcase/README.md`.

Add a dated entry to `journal/entries.json` with each release or reader-visible change, including website design and documentation between releases. Use a stable slug, category and affected surfaces. Describe what people can do or see. The public release feed already records individual model data refreshes. For internal changes or a release already covered, explain why in a `Changelog-skip: <reason>` trailer on the PR head commit.

Keep Introducing aicharts pinned above recent changelog entries at `/blog`. Preserve its canonical URL and publication date, demonstrate one or two shipped features, and finish with the reusable article action. Verify the article in a browser at narrow and wide widths and with JavaScript off. Preserve the existing article-end view and click event names, action, slug and consent controls.

Use the homepage benchmark picker for selections throughout aicharts. Use its compact variant in forms and secondary controls. Group large menus by the reader’s task or device family and keep search available across groups. On /local, show model quality before device speeds and memory.

## Explorer journey map

After `bun install --frozen-lockfile`, run `node_modules/.bin/ra map` at the root. Build the local site, then use `node_modules/.bin/ra walk compare-reasoning-cost` through the shared browser lane. This replays the actual benchmark picker, keyboard recovery and chart controls with the checked-in data. Read `walk.json` and compare its four screenshots in order. Update the map when the explorer workflow changes.

Required CI keeps the walkthrough evidence in the `journey-walks` artifact.
