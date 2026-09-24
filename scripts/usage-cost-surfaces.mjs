import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Owned SQL declarations, including additive migrations. Tests, vendored
 * parsers and generated/ignored workspaces are not product storage owners. */
export function usageSqlSources(root) {
	const scan = (directory) => readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
		if (/^(?:tests?|fixtures?|__tests__)$/u.test(entry.name) || /(?:[._-](?:test|tests|worker)|^tests)\.(?:ts|rs)$/u.test(entry.name)) return [];
		const path = `${directory}/${entry.name}`;
		return entry.isDirectory() ? scan(path) : entry.isFile() && /\.(?:ts|rs)$/u.test(entry.name) ? [path] : [];
	});
	return [...scan("services/usage-worker/src"), ...readdirSync(join(root, "crates"), { withFileTypes: true })
		.filter(entry => entry.isDirectory()).flatMap(entry => scan(`crates/${entry.name}/src`))].sort();
}

/** Check discovery and all object families against both maintained inventories.
 * A passing registry is not evidence of physical-budget or deletion qualification. */
export function checkUsageCostSurfaces(sources, inventory, capacities, costs) {
	const errors = [];
	const byId = new Map(inventory.map(row => [row.id, row]));
	for (const [path, source] of Object.entries(sources)) {
		// The checked source set is product-owned. Object writers must name an
		// immutable family even when their SQL metadata is already registered.
		if (path.startsWith("services/") && /\.(?:put|createMultipartUpload|uploadPart)\s*\(/u.test(source)
			&& !inventory.some(row => row.id.startsWith("r2:") && row.owner === path))
			errors.push(`${path}: object writer missing from assurance inventory`);
		for (const match of source.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z_0-9]*)/giu)) {
			const id = `${path.startsWith("services/") ? "worker" : "ledger"}:${match[1]}`;
			if (byId.get(id)?.owner !== path || byId.get(id)?.table !== match[1]) errors.push(`${id}: SQL declaration missing from assurance inventory (${path})`);
			if (costs[id]?.owner !== path) errors.push(`${id}: SQL declaration missing from cost registry (${path})`);
		}
	}
	const limits = new Map(capacities.map(row => [row.id, row.value]));
	for (const row of inventory) {
		const cost = costs[row.id];
		if (!cost || cost.owner !== row.owner || cost.kind !== row.kind || cost.assurancePolicy !== row.retentionPolicy) {
			errors.push(`${row.id}: cost/assurance surface ownership or retention drift`);
			continue;
		}
		const references = cost.budget?.capacityRefs;
		if (references === null || typeof references !== "object" || Array.isArray(references) || Object.keys(references).length === 0) {
			errors.push(`${row.id}: missing source-bound capacity references`);
			continue;
		}
		for (const [id, value] of Object.entries(references)) if (limits.get(id) !== value) errors.push(`${row.id}: capacity drift for ${id}`);
		if (row.kind === "derived" && cost.source !== row.rebuildFrom) errors.push(`${row.id}: rebuild source drift`);
	}
	for (const [id, entry] of Object.entries(costs)) if (entry.assurancePolicy && !byId.has(id)) errors.push(`${id}: stale usage surface registration`);
	return [...new Set(errors)].sort();
}

export function inspectUsageCostSurfaces(root, costs) {
	const read = path => JSON.parse(readFileSync(join(root, path), "utf8"));
	return checkUsageCostSurfaces(Object.fromEntries(usageSqlSources(root).map(path => [path, readFileSync(join(root, path), "utf8")])),
		read("verify/assurance/surfaces.json").surfaces, read("verify/assurance/capacities.json").capacities, costs);
}
