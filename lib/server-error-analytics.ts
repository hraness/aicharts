const serverErrorNames = new Set([
  "AggregateError",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);

/** Collapse request failures to a useful type without retaining message or stack text. */
export function sanitizedServerError(value: unknown): Error {
  const name = value instanceof Error && serverErrorNames.has(value.name)
    ? value.name
    : "Error";
  const safe = new Error("Server request failed");
  safe.name = name;
  safe.stack = undefined;
  return safe;
}
