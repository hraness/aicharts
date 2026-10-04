#!/usr/bin/env bash
# Captures the film's real charts from aicharts.io in dark mode (2026-10-04), then crops each to its chart.
set -euo pipefail
cd "$(dirname "$0")"
bun site-shot.ts https://aicharts.io/ shots/home.png --width 1600 --height 1100 --wait 2500
bun site-shot.ts https://aicharts.io/coding shots/coding.png --width 1600 --height 1100 --wait 2500
magick shots/home.png -crop 2720x1340+360+680 +repage shots/home-chart.png
magick shots/coding.png -crop 2400x1080+300+1000 +repage shots/coding-chart.png
