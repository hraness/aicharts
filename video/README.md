# aicharts launch film

The 42-second film embedded in `/blog/introducing-ai-charts`. It is built from the Slopcamera `launch-film` template. The product surfaces are the site's own launch mockups (`components/launch-mockups`), stacked on one board in `mockups.tsx`, so the film and the post show the same illustrations. Every number and the status come from `app/launch/facts.ts` through `{{fact}}` slots in `film.json`; no number is typed by hand.

The film has six acts:

1. Cold open: two lines on the problem.
2. Title: the name and its one-line promise.
3. Product walk: four steps across the score and cost chart, the coding-agent chart, the usage dashboard and the collector terminal, with a camera, a cursor and a drawn highlight.
4. Proof: the snapshot counts, counted up from the facts module.
5. Limits: what aicharts does not do.
6. End card: name and address.

## Files

| File | What it holds |
| --- | --- |
| `film.json` | Copy, aspect, frame rate, colors, fonts and product CSS. Numbers are `{{fact}}` slots. |
| `mockups.tsx` | The board: the site's launch mockups, labelled as illustrations. |
| `timeline.ts` | Act order and length. `film.js`, captions and per-beat clips all read it. |
| `film.html` | The stage, with `{{SLOT}}` placeholders that `build.ts` fills. |
| `film.css` | Canvas, scenes, masks and grain. |
| `film.js` | The choreography. Each frame is a pure function of time. |
| `build.ts` | Writes `film.html`, `scene.json`, `captions.vtt` and `beats.json` to `out/` (16:9), `out/square/` (1:1) or `out/portrait/` (9:16). |

## Make the film

Run each command from this directory, one render at a time. Slopcamera waits for host-resource admission before it renders. Look at the stills before rendering.

```sh
bun install
bun run still                 # out/stills; still:portrait for 9:16
bun run render                # 16:9, out/export.json
bun run deliver               # MP4, WebM, poster, social still, 1:1 cut and per-beat clips in out/deliver
bun run render:portrait       # native 9:16 layout, out/portrait/export.json
bun run deliver:portrait      # out/deliver-vertical
```

Copy the delivered files the site serves into `public/media/`:

- `aicharts-launch.{mp4,webm}`, `aicharts-launch-poster.jpg` and `captions.vtt` as `aicharts-launch.vtt` (embedded in the post)
- `aicharts-launch-1x1.mp4` (square cut for feeds)
- `aicharts-launch-vertical.{mp4,webm}` (native 9:16 for Reels, Shorts and TikTok-style feeds)
- `aicharts-launch-<act>.mp4` and `aicharts-launch-vertical-<act>.mp4` (one clip per act, to attach to the matching post in the social kit)

`app/blog/introducing-ai-charts-film.test.ts` checks that every file the post references is committed and that the captions run the film's full length.

## Rules for the copy

- Take every number from `app/launch/facts.ts`. Do not type numbers into `film.json`.
- Describe the surfaces as illustrations wherever the film is posted: they are drawn from checked data, not screenshots.
- Use sentence case and plain words. One idea per act.
