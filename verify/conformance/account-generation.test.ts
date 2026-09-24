import { expect, test } from "bun:test";
import { acceptUsageAccountReply, captureUsageAccountRead, currentUsageAccountRead, currentUsageAccountScope,
  invalidateUsageAccountGeneration, type UsageAccountReadTicket, type UsageAccountScope } from "../../lib/usage/account-generation";
import { readInUsageAccountGeneration } from "../../lib/usage/account-generation-read";
import { readPrivateStats } from "../../lib/usage/stats-client";
import { USAGE_ACCOUNT_HEADER } from "../../lib/usage/account-public";
import { CONFORMANCE_SEEDS, ConformanceTrace, scheduleRandom } from "./contracts";

const accounts = [`acct_${"a".repeat(32)}`, `acct_${"b".repeat(32)}`];

for (const seed of CONFORMANCE_SEEDS) test(`M5 generated response and lifecycle authority seed=${seed}`, () => {
  invalidateUsageAccountGeneration("lifecycle");
  const random = scheduleRandom(seed), trace = new ConformanceTrace("M5-generation", seed);
  const tickets: { actual: UsageAccountReadTicket; generation: number }[] = [];
  const scopes: { actual: UsageAccountScope; account: number; generation: number }[] = [];
  const model = { generation: 0, account: null as number | null };
  const image = () => ({ tickets: tickets.map(ticket => currentUsageAccountRead(ticket.actual)),
    scopes: scopes.map(scope => currentUsageAccountScope(scope.actual)) });
  const expected = () => ({ tickets: tickets.map(ticket => ticket.generation === model.generation),
    scopes: scopes.map(scope => scope.generation === model.generation && scope.account === model.account) });
  const capture = () => {
    tickets.push({ actual: captureUsageAccountRead(), generation: model.generation });
    trace.compare("capture", { ticket: tickets.length - 1 }, "ok", "ok", image(), expected()); return tickets.length - 1;
  };
  const reply = (ticket: number, account: number) => {
    const accepted = acceptUsageAccountReply(tickets[ticket].actual, accounts[account]);
    let result: "stale" | "identity-changed" | "accepted";
    if (tickets[ticket].generation !== model.generation) result = "stale";
    else if (account !== model.account) { model.generation++; model.account = account; result = "identity-changed"; }
    else result = "accepted";
    if (accepted.kind === "accepted") scopes.push({ actual: accepted.scope, account, generation: model.generation });
    trace.compare("reply", { ticket, account }, accepted.kind, result, image(), expected());
  };
  const invalidate = () => {
    invalidateUsageAccountGeneration("confirmed-signout"); model.generation++; model.account = null;
    trace.compare("signout", {}, "ok", "ok", image(), expected());
  };
  reply(capture(), 0); reply(capture(), 0);
  const old = capture(); reply(capture(), 1); reply(old, 0); reply(capture(), 1); invalidate();
  for (let step = 0; step < 24; step++) {
    const command = random(4);
    if (command === 0) invalidate();
    else if (command === 1) capture();
    else reply(command === 2 ? capture() : random(tickets.length), random(2));
  }
  trace.finish(["capture:ok", "reply:identity-changed", "reply:accepted", "reply:stale", "signout:ok"]);
  invalidateUsageAccountGeneration("lifecycle");
});

for (const seed of CONFORMANCE_SEEDS) test(`M5 authenticated negative replies and delayed signout seed=${seed}`, async () => {
  invalidateUsageAccountGeneration("lifecycle");
  const first = scheduleRandom(seed)(2), second = 1 - first, trace = new ConformanceTrace("M5-negative", seed);
  acceptUsageAccountReply(captureUsageAccountRead(), accounts[first]);
  const accepted = acceptUsageAccountReply(captureUsageAccountRead(), accounts[first]);
  if (accepted.kind !== "accepted") throw new Error("conformance_fixture:scope");
  trace.compare("adopt", { account: first }, "ok", "ok", { current: currentUsageAccountScope(accepted.scope) }, { current: true });
  let reads = 0;
  const fetcher = Object.assign(async () => {
    reads++;
    return new Response(JSON.stringify({ schemaVersion: 2, ok: false, error: "not_started" }), {
      status: 200, headers: { "content-type": "application/json; charset=utf-8", [USAGE_ACCOUNT_HEADER]: accounts[second] },
    });
  }, { preconnect() {} });
  const response = await readInUsageAccountGeneration(() => readPrivateStats(0, 1, new AbortController().signal, fetcher),
    reply => "accountId" in reply ? reply.accountId ?? null : null, () => true);
  trace.compare("authenticated-absence", { account: second }, response?.scope ? "bound" : "unbound", "bound",
    { oldCurrent: currentUsageAccountScope(accepted.scope), responseAccount: response?.scope?.accountId, reads },
    { oldCurrent: false, responseAccount: accounts[second], reads: 2 });
  const delayed = Promise.withResolvers<Response>(), entered = Promise.withResolvers<void>(); let current = true;
  const slow = Object.assign(async () => { entered.resolve(); return delayed.promise; }, { preconnect() {} });
  const pending = readInUsageAccountGeneration(() => readPrivateStats(0, 1, new AbortController().signal, slow),
    reply => "accountId" in reply ? reply.accountId ?? null : null, () => current);
  await entered.promise;
  current = false; invalidateUsageAccountGeneration("confirmed-signout");
  trace.compare("signout", {}, "ok", "ok", { responseCurrent: response?.scope ? currentUsageAccountScope(response.scope) : false }, { responseCurrent: false });
  delayed.resolve(new Response(JSON.stringify({ schemaVersion: 2, ok: false, error: "not_started" }), {
    status: 200, headers: { "content-type": "application/json; charset=utf-8", [USAGE_ACCOUNT_HEADER]: accounts[second] },
  }));
  const late = await pending;
  trace.compare("delayed-negative", {}, late === null ? "discarded" : "retained", "discarded", { oldCurrent: currentUsageAccountScope(accepted.scope) }, { oldCurrent: false });
  expect(late).toBeNull();
  trace.finish(["adopt:ok", "authenticated-absence:bound", "signout:ok", "delayed-negative:discarded"]);
});
