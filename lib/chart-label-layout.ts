export type LabelBounds = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export type LabelAnchor = {
  height: number;
  id: string;
  priority: number;
  width: number;
  x: number;
  y: number;
};

export type LabelObstacle = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type LabelPlacement = LabelObstacle & {
  id: string;
};

type LayoutOptions = {
  gap?: number;
  maxRings?: number;
  offset?: number;
  obstacles?: readonly LabelObstacle[];
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function overlapArea(left: LabelObstacle, right: LabelObstacle, gap: number): number {
  const width = Math.min(left.x + left.width + gap, right.x + right.width + gap) - Math.max(left.x, right.x);
  const height = Math.min(left.y + left.height + gap, right.y + right.height + gap) - Math.max(left.y, right.y);
  return Math.max(0, width) * Math.max(0, height);
}

function candidatesFor(
  anchor: LabelAnchor,
  bounds: LabelBounds,
  gap: number,
  maxRings: number,
  offset: number,
): LabelObstacle[] {
  const maximumX = bounds.right - anchor.width;
  const maximumY = bounds.bottom - anchor.height;
  if (maximumX < bounds.left || maximumY < bounds.top) {
    throw new RangeError(`Label ${anchor.id} does not fit inside the chart bounds.`);
  }

  const chartCenterX = (bounds.left + bounds.right) / 2;
  const chartCenterY = (bounds.top + bounds.bottom) / 2;
  const sideOrder = anchor.x <= chartCenterX ? ["right", "center", "left"] as const : ["left", "center", "right"] as const;
  const verticalOrder = anchor.y <= chartCenterY ? ["below", "above"] as const : ["above", "below"] as const;
  const candidates: LabelObstacle[] = [];
  const seen = new Set<string>();

  for (let ring = 0; ring <= maxRings; ring += 1) {
    const verticalShift = ring * (anchor.height + gap);
    for (const vertical of verticalOrder) {
      const y = vertical === "above"
        ? anchor.y - offset - anchor.height - verticalShift
        : anchor.y + offset + verticalShift;
      for (const side of sideOrder) {
        const x = side === "right"
          ? anchor.x + offset
          : side === "left"
            ? anchor.x - offset - anchor.width
            : anchor.x - anchor.width / 2;
        const candidate = {
          height: anchor.height,
          width: anchor.width,
          x: clamp(x, bounds.left, maximumX),
          y: clamp(y, bounds.top, maximumY),
        };
        const key = `${candidate.x.toFixed(2)}:${candidate.y.toFixed(2)}`;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push(candidate);
        }
      }
    }
  }

  return candidates;
}

/** Place important labels first, preferring nearby positions without collisions. */
export function layoutChartLabels(
  anchors: readonly LabelAnchor[],
  bounds: LabelBounds,
  options: LayoutOptions = {},
): Map<string, LabelPlacement> {
  const gap = options.gap ?? 8;
  const maxRings = options.maxRings ?? 12;
  const offset = options.offset ?? 14;
  const obstacles = options.obstacles ?? [];
  if (![bounds.bottom, bounds.left, bounds.right, bounds.top, gap, maxRings, offset].every(Number.isFinite)) {
    throw new RangeError("Label layout requires finite bounds and options.");
  }
  if (bounds.left >= bounds.right || bounds.top >= bounds.bottom || gap < 0 || maxRings < 0 || offset < 0) {
    throw new RangeError("Label layout bounds and options must be positive.");
  }

  const ordered = [...anchors].sort((left, right) => (
    right.priority - left.priority
    || left.y - right.y
    || left.x - right.x
    || left.id.localeCompare(right.id)
  ));
  const placed: LabelPlacement[] = [];

  for (const anchor of ordered) {
    const candidates = candidatesFor(anchor, bounds, gap, maxRings, offset);
    const clearCandidate = candidates.find((candidate) => (
      placed.every((placement) => overlapArea(candidate, placement, gap) === 0)
      && obstacles.every((obstacle) => overlapArea(candidate, obstacle, Math.min(gap, 4)) === 0)
    ));
    const selected = clearCandidate ?? candidates.reduce((best, candidate) => {
      const candidatePenalty = [
        ...placed.map((placement) => overlapArea(candidate, placement, gap)),
        ...obstacles.map((obstacle) => overlapArea(candidate, obstacle, Math.min(gap, 4))),
      ].reduce((total, area) => total + area, 0);
      const bestPenalty = [
        ...placed.map((placement) => overlapArea(best, placement, gap)),
        ...obstacles.map((obstacle) => overlapArea(best, obstacle, Math.min(gap, 4))),
      ].reduce((total, area) => total + area, 0);
      return candidatePenalty < bestPenalty ? candidate : best;
    });
    placed.push({ ...selected, id: anchor.id });
  }

  return new Map(placed.map((placement) => [placement.id, placement]));
}
