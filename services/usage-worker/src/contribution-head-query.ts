import { checkContributionAuthority, contributionIdentity, ContributionFault, type ContributionAuthority } from "../../../lib/usage/contributions";
import { parseContributionHeadPage, parseContributionHeadQuery, type ContributionHeadEntry, type ContributionHeadQueryResult,
  type ContributionMemberCursor } from "../../../lib/usage/contribution-head-query";
import { ContributionState } from "./contributions-state";

/** The account owner supplies freshly authenticated upload authority inside its
 * read-only restore fence. This entire read is synchronous: no initialization,
 * transaction write, object fetch, historical snapshot or repair is performed. */
export function queryContributionHeads(state: ContributionState, input: unknown, authority: ContributionAuthority): ContributionHeadQueryResult {
  try {
    const query = parseContributionHeadQuery(input);
    if (!query) return { ok: false, error: "invalid_input" };
    const control = state.control();
    checkContributionAuthority(control, authority, query.deviceId);
    if (query.accountId !== control.accountId) throw new ContributionFault("unauthorized");
    if (query.generation !== control.generation) throw new ContributionFault("generation_conflict");
    if (control.phase !== "active") throw new ContributionFault("recovery_required");
    const population = state.population(query.populationId);
    if (!population || population.generation !== query.generation || population.deviceId !== query.deviceId
      || population.writerRevision !== query.writerRevision) throw new ContributionFault("writer_conflict");
    if (query.expectedRevision !== null && query.expectedRevision !== control.revision) throw new ContributionFault("conflict");
    if (population.revision > control.revision || population.memberCount > control.membershipCount) throw new ContributionFault("storage_invalid");
    const entries: ContributionHeadEntry[] = []; let next: ContributionMemberCursor | null = null;
    if (query.mode === "heads") {
      for (const id of query.ids) entries.push({ id, head: state.head(id), membershipHeadHash: state.membership(population.id, id)?.headHash ?? null });
    } else {
      if (query.cursor && (query.cursor.populationRevision !== population.revision || query.cursor.populationHead !== population.headHash))
        throw new ContributionFault("population_conflict");
      // Primary key (population_id, id) bounds the seek and its page. A cursor
      // can neither enumerate other populations nor authorize an old revision.
      const rows = state.sql.exec("SELECT id, head_hash FROM usage_contribution_memberships WHERE population_id = ? AND id > ? ORDER BY id LIMIT ?",
        population.id, query.cursor?.afterId ?? "", query.limit + 1).toArray();
      if (rows.length > query.limit + 1 || rows.length > population.memberCount) throw new ContributionFault("storage_invalid");
      let prior = query.cursor?.afterId ?? "";
      for (const row of rows) {
        if (!contributionIdentity(row.id, 32) || row.id <= prior || !contributionIdentity(row.head_hash)) throw new ContributionFault("storage_invalid");
        prior = row.id;
      }
      for (const row of rows.slice(0, query.limit)) {
        const id = row.id as string;
        entries.push({ id, head: state.head(id), membershipHeadHash: row.head_hash as string });
      }
      if (rows.length > query.limit) next = { schemaVersion: 3, accountId: query.accountId, generation: query.generation,
        deviceId: query.deviceId, populationId: population.id, writerRevision: population.writerRevision,
        revision: control.revision, populationRevision: population.revision, populationHead: population.headHash, afterId: entries.at(-1)!.id };
    }
    const page = parseContributionHeadPage(query, { schemaVersion: 3, profile: "contribution-heads-v3", mode: query.mode,
      accountId: control.accountId, generation: control.generation, deviceId: query.deviceId, revision: control.revision,
      observedAtMs: authority.observedAtMs, population, entries, next });
    return page ? { ok: true, value: page } : { ok: false, error: "storage_invalid" };
  } catch (cause) { return { ok: false, error: cause instanceof ContributionFault ? cause.code : "storage_unavailable" }; }
}
