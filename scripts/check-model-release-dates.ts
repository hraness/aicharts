import { MODEL_CARD_CATALOG } from "../lib/model-card-data";
import { MODEL_RELEASE_DATES } from "../lib/model-release-date-data";

const verified = MODEL_RELEASE_DATES.filter(entry => entry.status === "verified").length;
const pending = MODEL_RELEASE_DATES.length - verified;

console.info(
  `Validated ${String(MODEL_RELEASE_DATES.length)} official release records for ${String(MODEL_CARD_CATALOG.length)} curated model identities (${String(verified)} verified, ${String(pending)} pending).`,
);
