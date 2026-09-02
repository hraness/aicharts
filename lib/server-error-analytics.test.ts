import { describe, expect, test } from "bun:test";

import { sanitizedServerError } from "./server-error-analytics";

describe("server error analytics", () => {
  test("retains only an approved error type", () => {
    const error = sanitizedServerError(
      new TypeError("email=private@example.com token=secret https://example.com/private"),
    );

    expect(error.name).toBe("TypeError");
    expect(error.message).toBe("Server request failed");
    expect(error.stack).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("private@example.com");
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  test("collapses custom names and non-errors", () => {
    expect(sanitizedServerError(Object.assign(new Error("private"), {
      name: "CustomerEmailError",
    })).name).toBe("Error");
    expect(sanitizedServerError("private free-form text").name).toBe("Error");
  });
});
