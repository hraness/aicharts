export const MODEL_CARD_FALLBACK_CREATOR_SLUG = "unlisted";
export const MODEL_CARD_FALLBACK_PROFILE_PREFIX = "upstream.";

export type ModelCardRouteStatus = Readonly<{
  isProvisional: boolean;
  provisionalIdentity: boolean;
  provisionalProfile: boolean;
  primaryReason: "model identity" | "profile setting" | null;
}>;

/**
 * Classifies a model-card route using the reserved namespaces that create
 * fallback identities and profiles. This module stays browser-safe so display,
 * indexing, and sitemap callers share one policy without importing Node code.
 */
export function modelCardRouteStatus(
  card: Readonly<{ canonicalModelId: string; profileSlug: string }>,
): ModelCardRouteStatus {
  const provisionalIdentity = card.canonicalModelId.startsWith(
    `${MODEL_CARD_FALLBACK_CREATOR_SLUG}/`,
  );
  const provisionalProfile = card.profileSlug.startsWith(
    MODEL_CARD_FALLBACK_PROFILE_PREFIX,
  );
  return {
    isProvisional: provisionalIdentity || provisionalProfile,
    primaryReason: provisionalIdentity
      ? "model identity"
      : provisionalProfile
        ? "profile setting"
        : null,
    provisionalIdentity,
    provisionalProfile,
  };
}
