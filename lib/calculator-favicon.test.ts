import { describe, expect, test } from "bun:test";
import { assertProperty, fc } from "./property-test";
import { calculatorFaviconHref, calculatorFaviconSvg, compactUsd } from "./calculator-favicon";

describe("calculator favicon", () => {
  test("compact currency keeps two significant figures and one suffix", () => {
    expect(compactUsd(0)).toBe("$0");
    expect(compactUsd(200)).toBe("$200");
    expect(compactUsd(949.4)).toBe("$949");
    expect(compactUsd(950)).toBe("$1.0k");
    expect(compactUsd(999.6)).toBe("$1.0k");
    expect(compactUsd(2412)).toBe("$2.4k");
    expect(compactUsd(9960)).toBe("$10k");
    expect(compactUsd(14_000)).toBe("$14k");
    expect(compactUsd(840_000)).toBe("$840k");
    expect(compactUsd(999_600)).toBe("$1.0M");
    expect(compactUsd(1_250_000)).toBe("$1.3M");
    expect(compactUsd(Number.NaN)).toBe("$0");
    expect(compactUsd(-5)).toBe("$0");
  });

  test("compact currency never exceeds five characters for any plausible monthly figure", () => {
    assertProperty(fc.property(fc.double({ min: 0, max: 1e11, noNaN: true }), (value) => {
      expect(compactUsd(value).length).toBeLessThanOrEqual(5);
      expect(compactUsd(value)).toMatch(/^\$\d+(\.\d)?[kMB]?$/u);
    }));
  });

  test("the SVG escapes text and the href is a data URI", () => {
    expect(calculatorFaviconSvg("<$>")).toContain("&lt;$&gt;");
    expect(calculatorFaviconSvg("$14k")).not.toContain("textLength=\"\"");
    expect(calculatorFaviconSvg("$14k")).toContain("textLength=\"52\"");
    expect(calculatorFaviconSvg("$14")).not.toContain("textLength");
    expect(calculatorFaviconHref(14_000)).toStartWith("data:image/svg+xml,%3Csvg");
    expect(decodeURIComponent(calculatorFaviconHref(14_000))).toContain(">$14k</text>");
  });
});
