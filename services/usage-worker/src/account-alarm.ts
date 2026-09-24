import { ContributionFault, CONTRIBUTION_MAX_TIME } from "../../../lib/usage/contributions";
import { statsInteger } from "../../../lib/usage/stats-contract";

export const ACCOUNT_ALARM_MAX_ARMS = 32;
/** One process-local serialization queue for the object's single durable
 * alarm. It grants no authority: every awaited boundary re-enters the caller's
 * checked lease, and a later request can only preserve or advance the wake. */
export class AccountAlarm {
  #tail: Promise<void> = Promise.resolve();
  #pending = 0;
  constructor(readonly storage: Pick<DurableObjectStorage, "getAlarm" | "setAlarm">) {}
  async arm(deadline: number, admitted: () => void): Promise<void> {
    if (!statsInteger(deadline, 0, CONTRIBUTION_MAX_TIME)) throw new ContributionFault("clock_regressed");
    if (this.#pending >= ACCOUNT_ALARM_MAX_ARMS) throw new ContributionFault("limit");
    this.#pending++;
    const operation = this.#tail.then(async () => {
      admitted(); const current = await this.storage.getAlarm(); admitted();
      if (current !== null && !statsInteger(current, 0, CONTRIBUTION_MAX_TIME)) throw new ContributionFault("storage_invalid");
      if (current !== null && current <= deadline) return;
      await this.storage.setAlarm(deadline); admitted();
    });
    this.#tail = operation.catch(() => {});
    try { await operation; } finally { this.#pending--; }
  }
}
