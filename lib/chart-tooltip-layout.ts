export type TooltipPoint = Readonly<{
  x: number;
  y: number;
}>;

export type TooltipRect = Readonly<{
  height: number;
  width: number;
  x: number;
  y: number;
}>;

export type TooltipBounds = Readonly<{
  bottom: number;
  left: number;
  right: number;
  top: number;
}>;

export type TooltipPlacement = TooltipRect & Readonly<{
  connector: Readonly<{
    end: TooltipPoint;
    start: TooltipPoint;
  }>;
}>;

type TooltipLayoutOptions = Readonly<{
  gap?: number;
  maxRings?: number;
  obstacles?: readonly TooltipRect[];
}>;

type Direction =
  | "east"
  | "north"
  | "northEast"
  | "northWest"
  | "south"
  | "southEast"
  | "southWest"
  | "west";

type ScoredCandidate = Readonly<{
  anchorCovered: number;
  clampShift: number;
  connector: TooltipPlacement["connector"];
  connectorCrossings: number;
  directionRank: number;
  distance: number;
  overlap: number;
  rect: TooltipRect;
}>;

const directionsTowardNorth = [
  "north",
  "northEast",
  "northWest",
  "west",
  "east",
  "south",
  "southEast",
  "southWest",
] as const satisfies readonly Direction[];

const directionsTowardSouth = [
  "south",
  "southEast",
  "southWest",
  "west",
  "east",
  "north",
  "northEast",
  "northWest",
] as const satisfies readonly Direction[];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function expandRect(rect: TooltipRect, amount: number): TooltipRect {
  return {
    height: rect.height + amount * 2,
    width: rect.width + amount * 2,
    x: rect.x - amount,
    y: rect.y - amount,
  };
}

function overlapArea(left: TooltipRect, right: TooltipRect): number {
  const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  return Math.max(0, width) * Math.max(0, height);
}

function containsPoint(rect: TooltipRect, point: TooltipPoint): boolean {
  return point.x >= rect.x
    && point.x <= rect.x + rect.width
    && point.y >= rect.y
    && point.y <= rect.y + rect.height;
}

function nearestEdgePoint(rect: TooltipRect, point: TooltipPoint): TooltipPoint {
  const clampedX = clamp(point.x, rect.x, rect.x + rect.width);
  const clampedY = clamp(point.y, rect.y, rect.y + rect.height);
  if (!containsPoint(rect, point)) return { x: clampedX, y: clampedY };

  const edges = [
    { distance: point.x - rect.x, point: { x: rect.x, y: point.y } },
    { distance: rect.x + rect.width - point.x, point: { x: rect.x + rect.width, y: point.y } },
    { distance: point.y - rect.y, point: { x: point.x, y: rect.y } },
    { distance: rect.y + rect.height - point.y, point: { x: point.x, y: rect.y + rect.height } },
  ];
  return edges.reduce((best, candidate) => candidate.distance < best.distance ? candidate : best).point;
}

function segmentIntersectsRect(start: TooltipPoint, end: TooltipPoint, rect: TooltipRect): boolean {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  let minimum = 0;
  let maximum = 1;
  const constraints = [
    [-deltaX, start.x - rect.x],
    [deltaX, rect.x + rect.width - start.x],
    [-deltaY, start.y - rect.y],
    [deltaY, rect.y + rect.height - start.y],
  ] as const;

  for (const [coefficient, distance] of constraints) {
    if (coefficient === 0) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / coefficient;
    if (coefficient < 0) minimum = Math.max(minimum, ratio);
    else maximum = Math.min(maximum, ratio);
    if (minimum > maximum) return false;
  }
  return maximum >= 0 && minimum <= 1;
}

function rawCandidate(
  anchor: TooltipPoint,
  popup: Readonly<{ height: number; width: number }>,
  direction: Direction,
  distance: number,
): TooltipRect {
  const centeredX = anchor.x - popup.width / 2;
  const centeredY = anchor.y - popup.height / 2;
  const left = anchor.x - popup.width - distance;
  const right = anchor.x + distance;
  const above = anchor.y - popup.height - distance;
  const below = anchor.y + distance;

  switch (direction) {
    case "north": return { ...popup, x: centeredX, y: above };
    case "northEast": return { ...popup, x: right, y: above };
    case "east": return { ...popup, x: right, y: centeredY };
    case "southEast": return { ...popup, x: right, y: below };
    case "south": return { ...popup, x: centeredX, y: below };
    case "southWest": return { ...popup, x: left, y: below };
    case "west": return { ...popup, x: left, y: centeredY };
    case "northWest": return { ...popup, x: left, y: above };
  }
}

function compareCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
  return left.anchorCovered - right.anchorCovered
    || left.overlap - right.overlap
    || left.connectorCrossings - right.connectorCrossings
    || left.directionRank - right.directionRank
    || left.clampShift - right.clampShift
    || left.distance - right.distance;
}

function assertFiniteRect(rect: TooltipRect, label: string): void {
  if (![rect.height, rect.width, rect.x, rect.y].every(Number.isFinite)) {
    throw new RangeError(`${label} must contain finite coordinates and dimensions.`);
  }
  if (rect.height < 0 || rect.width < 0) {
    throw new RangeError(`${label} dimensions cannot be negative.`);
  }
}

/**
 * Places a viewport-level chart tooltip without covering visible chart labels.
 * Clear candidates and leader paths win before directional preference or distance.
 */
export function placeChartTooltip(
  anchor: TooltipPoint,
  popup: Readonly<{ height: number; width: number }>,
  bounds: TooltipBounds,
  options: TooltipLayoutOptions = {},
): TooltipPlacement {
  const gap = options.gap ?? 12;
  const maxRings = options.maxRings ?? 4;
  const inputObstacles = options.obstacles ?? [];
  if (![anchor.x, anchor.y, popup.height, popup.width, bounds.bottom, bounds.left, bounds.right, bounds.top, gap, maxRings]
    .every(Number.isFinite)) {
    throw new RangeError("Tooltip layout requires finite geometry.");
  }
  if (
    bounds.left >= bounds.right
    || bounds.top >= bounds.bottom
    || popup.height <= 0
    || popup.width <= 0
    || popup.width > bounds.right - bounds.left
    || popup.height > bounds.bottom - bounds.top
    || gap < 0
    || maxRings < 0
    || !Number.isInteger(maxRings)
  ) {
    throw new RangeError("Tooltip layout bounds, popup size, and options must be positive and compatible.");
  }
  for (const obstacle of inputObstacles) assertFiniteRect(obstacle, "Tooltip obstacle");

  const originX = bounds.left;
  const originY = bounds.top;
  const layoutAnchor = { x: anchor.x - originX, y: anchor.y - originY };
  const layoutBounds = {
    bottom: bounds.bottom - originY,
    left: 0,
    right: bounds.right - originX,
    top: 0,
  };
  const obstacles = inputObstacles.map((obstacle) => ({
    ...obstacle,
    x: obstacle.x - originX,
    y: obstacle.y - originY,
  }));
  const maximumX = layoutBounds.right - popup.width;
  const maximumY = layoutBounds.bottom - popup.height;
  const roomAbove = layoutAnchor.y - layoutBounds.top;
  const roomBelow = layoutBounds.bottom - layoutAnchor.y;
  const directions = roomAbove >= popup.height + gap || roomAbove >= roomBelow
    ? directionsTowardNorth
    : directionsTowardSouth;
  const ringStep = Math.max(24, Math.min(popup.width, popup.height) * 0.2);
  const seen = new Set<string>();
  const candidates: ScoredCandidate[] = [];

  for (let ring = 0; ring <= maxRings; ring += 1) {
    const distance = gap + ring * (gap + ringStep);
    for (const [directionRank, direction] of directions.entries()) {
      const raw = rawCandidate(layoutAnchor, popup, direction, distance);
      const rect = {
        ...popup,
        x: clamp(raw.x, layoutBounds.left, maximumX),
        y: clamp(raw.y, layoutBounds.top, maximumY),
      };
      const key = `${rect.x.toFixed(3)}:${rect.y.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const connector = {
        start: layoutAnchor,
        end: nearestEdgePoint(rect, layoutAnchor),
      };
      const expandedObstacles = obstacles.map((obstacle) => expandRect(obstacle, gap));
      candidates.push({
        anchorCovered: containsPoint(rect, layoutAnchor) ? 1 : 0,
        clampShift: Math.abs(rect.x - raw.x) + Math.abs(rect.y - raw.y),
        connector,
        connectorCrossings: expandedObstacles.filter((obstacle) => (
          segmentIntersectsRect(connector.start, connector.end, obstacle)
        )).length,
        directionRank,
        distance: Math.hypot(
          connector.end.x - layoutAnchor.x,
          connector.end.y - layoutAnchor.y,
        ),
        overlap: expandedObstacles.reduce((total, obstacle) => total + overlapArea(rect, obstacle), 0),
        rect,
      });
    }
  }

  const selected = candidates.reduce((best, candidate) => (
    compareCandidates(candidate, best) < 0 ? candidate : best
  ));
  return {
    ...selected.rect,
    connector: {
      end: {
        x: selected.connector.end.x + originX,
        y: selected.connector.end.y + originY,
      },
      start: anchor,
    },
    x: selected.rect.x + originX,
    y: selected.rect.y + originY,
  };
}
