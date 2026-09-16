import { maybeShowSupportInvitation, runSupportCommand } from './support-foundation.mjs';

export const supportProfile = Object.freeze({
  id: 'aicharts', name: 'AI Charts', updates: true,
  valueProposition: 'Support ongoing development of sourced AI comparisons and private local usage tools.',
});

export function supportOptions(options = {}) {
  return { command: [process.execPath, process.argv[1]], env: { ...process.env }, ...options };
}

export function runAtlasSupport(args, options) {
  return runSupportCommand(supportProfile, args, supportOptions(options));
}

export async function completedAtlasRead(options, stderr) {
  try {
    await maybeShowSupportInvitation(supportProfile, { ...supportOptions(options), usefulResult: true, stderr });
  } catch { /* Optional support cannot change the completed benchmark result. */ }
}
