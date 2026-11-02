# aicharts launch film

The benchmark film source lives in `story/story.config.ts` and uses the story-film engine documented in `story/ENGINE.md`. Its model and coding-agent chart shots come from aicharts.io. The previously published movie advertised usage collection and has been removed from the introducing article and public media. The article retains its benchmark illustrations.

An illustration-based version is also maintained here with the Slopcamera `launch-film` template. Its product surfaces are the site's benchmark mockups (`components/launch-mockups`), stacked on one board in `mockups.tsx`. Every snapshot count comes from `app/launch/facts.ts` through `{{fact}}` slots in `film.json`. The commands below build this version into `out/`; they do not publish media.

The film has six acts:

1. Cold open: two lines on the problem.
2. Title: the name and its one-line promise.
3. Product walk: four steps across the score and cost chart, the coding-agent chart, the benchmarks library and its source data, with a camera, a cursor and a drawn highlight.
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

Before publishing a new benchmark film, inspect its delivered files and captions, and add matching article video metadata. The delivery names are:

- `aicharts-launch.{mp4,webm}`, `aicharts-launch-poster.jpg` and `captions.vtt` as `aicharts-launch.vtt` (embedded in the post)
- `aicharts-launch-1x1.mp4` (square cut for feeds)
- `aicharts-launch-vertical.{mp4,webm}` (native 9:16 for Reels, Shorts and TikTok-style feeds)
- `aicharts-launch-<act>.mp4` and `aicharts-launch-vertical-<act>.mp4` (one clip per act)

`video/film-config.test.ts` checks fact references and the camera targets in the benchmark-only film sources.

## Rules for the copy

- Take every number from `app/launch/facts.ts`. Do not type numbers into `film.json`.
- Describe the surfaces as illustrations wherever the film is posted: they are drawn from checked data, not screenshots.
- Use sentence case and plain words. One idea per act.
