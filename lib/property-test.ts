import fc from "fast-check";
import type { IProperty, Parameters } from "fast-check";

export { fc };

const propertyParameters = {
  numRuns: 200,
  interruptAfterTimeLimit: 10_000,
  markInterruptAsFailure: true,
} satisfies Parameters<unknown>;

export function assertProperty<Values>(
  property: IProperty<Values>,
  overrides: Parameters<Values> = {},
): void {
  fc.assert(property, { ...propertyParameters, ...overrides });
}
