type BuildEnvironment = Readonly<Record<string, unknown>>;

/** Data-refresh CI already builds and browser-checks the generated candidate. */
export function shouldSkipVercelBuild(environment: BuildEnvironment): boolean {
  const branch = environment.VERCEL_GIT_COMMIT_REF;
  return environment.VERCEL === "1"
    && environment.VERCEL_ENV === "preview"
    && environment.VERCEL_TARGET_ENV === "preview"
    && environment.VERCEL_GIT_PROVIDER === "github"
    && environment.VERCEL_GIT_REPO_OWNER === "hraness"
    && environment.VERCEL_GIT_REPO_SLUG === "aicharts"
    && typeof branch === "string"
    && /^automation\/model-data-refresh-[1-9]\d*-[1-9]\d*$/u.test(branch);
}

if (import.meta.main) {
  const skip = shouldSkipVercelBuild(process.env);
  console.log(skip
    ? "Skipping the generated data-refresh Preview; required CI validates this candidate."
    : "Continuing the Vercel build.");
  // Vercel's Ignored Build Step uses zero to skip and one to continue.
  process.exitCode = skip ? 0 : 1;
}
