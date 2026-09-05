export type SvgAffineTransform = Readonly<{
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}>;

export type SvgPointerLocation = Readonly<{
  unitsPerCssPixel: number;
  x: number;
  y: number;
}>;

export type SvgClientBounds = Readonly<{
  height: number;
  left: number;
  top: number;
  width: number;
}>;

/** Invert the live screen CTM while retaining the CSS-to-user-unit scale for hit radii. */
export function clientPointThroughSvgTransform(
  clientX: number,
  clientY: number,
  transform: SvgAffineTransform,
): SvgPointerLocation | null {
  const values = [
    clientX,
    clientY,
    transform.a,
    transform.b,
    transform.c,
    transform.d,
    transform.e,
    transform.f,
  ];
  if (!values.every(Number.isFinite)) return null;
  const determinant = transform.a * transform.d - transform.b * transform.c;
  const cssPixelsPerUnit = Math.hypot(transform.a, transform.b);
  if (Math.abs(determinant) <= Number.EPSILON || cssPixelsPerUnit <= 0) return null;
  const translatedX = clientX - transform.e;
  const translatedY = clientY - transform.f;
  return {
    unitsPerCssPixel: 1 / cssPixelsPerUnit,
    x: (transform.d * translatedX - transform.c * translatedY) / determinant,
    y: (-transform.b * translatedX + transform.a * translatedY) / determinant,
  };
}

/** Axis-aligned fallback for a temporarily unavailable screen CTM. */
export function clientPointThroughSvgBounds(
  clientX: number,
  clientY: number,
  bounds: SvgClientBounds,
  viewBoxWidth: number,
  viewBoxHeight: number,
): SvgPointerLocation | null {
  if (
    ![clientX, clientY, bounds.height, bounds.left, bounds.top, bounds.width, viewBoxHeight, viewBoxWidth]
      .every(Number.isFinite)
    || bounds.width <= 0
    || bounds.height <= 0
    || viewBoxWidth <= 0
    || viewBoxHeight <= 0
  ) return null;
  return {
    unitsPerCssPixel: Math.max(viewBoxWidth / bounds.width, viewBoxHeight / bounds.height),
    x: (clientX - bounds.left) * viewBoxWidth / bounds.width,
    y: (clientY - bounds.top) * viewBoxHeight / bounds.height,
  };
}

export function svgUnitsForCssPixels(cssPixels: number, unitsPerCssPixel: number): number | null {
  if (!Number.isFinite(cssPixels) || !Number.isFinite(unitsPerCssPixel) || cssPixels < 0 || unitsPerCssPixel <= 0) {
    return null;
  }
  return cssPixels * unitsPerCssPixel;
}

/** `detail === 0` distinguishes keyboard/AT activation from physical pointer clicks. */
export function isAssistiveSvgClick(detail: number): boolean {
  return detail === 0;
}
