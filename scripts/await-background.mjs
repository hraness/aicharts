// Wait for a background CI command started with `nohup sh -c '...; echo $? > status'`
// and report it as if it had run in this step: print its log, then exit with its
// status. Its directory holds `pid`, `log` and, once finished, `status`.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const directory = process.argv[2];
if (!directory || process.argv.length !== 3) {
  console.error("usage: node scripts/await-background.mjs <directory>");
  process.exit(2);
}
const pid = Number((await readFile(resolve(directory, "pid"), "utf8")).trim());
if (!Number.isSafeInteger(pid) || pid <= 1) {
  console.error("await-background: invalid pid file");
  process.exit(2);
}
const read = async name => { try { return await readFile(resolve(directory, name), "utf8"); } catch { return null; } };
const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pause = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));

let status = await read("status");
let goneSince = null;
while (status === null) {
  // The status file is renamed into place just before the shell exits; allow for that gap.
  if (!alive()) {
    goneSince ??= Date.now();
    if (Date.now() - goneSince > 5_000) break;
  }
  await pause(500);
  status = await read("status");
}
process.stdout.write((await read("log")) ?? "(no log)\n");
if (status === null) {
  console.error(`await-background: process ${String(pid)} exited without recording a status`);
  process.exit(1);
}
const code = Number(status.trim());
process.exit(Number.isInteger(code) && code >= 0 && code <= 255 ? code : 1);
