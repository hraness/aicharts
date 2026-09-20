import registry from "../../data/usage-registry.json";

/** Only public catalog identities may cross the detailed usage boundary. */
export const STATS_REGISTRY_REVISION = 1 as const;
export const STATS_CLIENTS: readonly Readonly<{ id: string; name: string }>[] = Object.freeze(registry.clients.map(client => Object.freeze({ ...client })));
const clients = new Set(STATS_CLIENTS.map(client => client.id));
const providers = new Set(registry.providers);
const models = new Set(registry.models);
export const isStatsClient = (value: unknown): value is string => typeof value === "string" && clients.has(value);
export const isStatsProvider = (value: unknown): value is string => typeof value === "string" && providers.has(value);
export const isStatsModel = (value: unknown): value is string => typeof value === "string" && models.has(value);
export const statsClientName = (id: string): string => STATS_CLIENTS.find(client => client.id === id)?.name ?? "Unknown client";
