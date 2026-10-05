import { readFileSync } from "node:fs";
import { join } from "node:path";

/** scripts/install.sh, read once at build so aicharts.io/install.sh serves the reviewed bytes. */
export const installScript = readFileSync(join(process.cwd(), "scripts/install.sh"), "utf8");
