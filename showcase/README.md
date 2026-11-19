The portfolio uses the favicon and a square crop from the actual release explorer. From the repository root, export the scalable mark with librsvg.

```sh
rsvg-convert -w 512 -h 512 -o showcase/icon.png app/icon.svg
```

Build with `bun run build`, install the Chromium version for the pinned Playwright package, and run `bun run showcase`. The browser opens the local explorer at 480 pixels wide, takes a square crop from the top of the chart card, and records the source, chart data, browser and image digest beside the WebP.
