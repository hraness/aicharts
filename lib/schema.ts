import { z } from "zod";
import type { ZodType } from "zod";

import { err, ok, type Result } from "./result";

export { z };

export function parseResult<Output>(
  schema: ZodType<Output>,
  value: unknown,
): Result<Output, z.ZodError> {
  const parsed = schema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err(parsed.error);
}
