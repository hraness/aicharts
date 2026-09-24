------------------------------ MODULE M6Consent ------------------------------
EXTENDS Naturals
\* Decision 0 is absent, 1 grants, 2 withdraws. Publication may lag the source.
\* This checks ordered delivery/ABA custody, not Phase 10's visibility deadline.
VARIABLE s
Init == s = [source |-> 0, hint |-> 0, captured |-> 0, stamp |-> 0,
  delivery |-> "idle", indexVersion |-> 0, member |-> FALSE, tombstone |-> 0,
  refused |-> FALSE, recovered |-> FALSE, published |-> FALSE]
GrantConsent == /\ s.source = 0 /\ s' = [s EXCEPT !.source = 1]
WithdrawConsent == /\ s.source = 1 /\ s' = [s EXCEPT !.source = 2]
DispatchHint(v) == /\ s.delivery = "idle" /\ v \in 1..s.source
  /\ s' = [s EXCEPT !.hint = v, !.stamp = s.indexVersion, !.delivery = "waiting"]
SourceReply == /\ s.delivery = "waiting"
  /\ s' = [s EXCEPT !.captured = s.source, !.delivery = "ready"]
ApplyDelivery == /\ s.delivery = "ready" /\ s.hint = s.captured
  /\ s.stamp = s.indexVersion /\ s.captured >= s.tombstone
  /\ s' = [s EXCEPT !.indexVersion = s.captured, !.member = s.captured = 1,
    !.tombstone = IF s.captured = 2 THEN 2 ELSE s.tombstone,
    !.published = @ \/ s.captured = 1, !.delivery = "idle"]
RefuseStaleDelivery == /\ s.delivery = "ready"
  /\ (s.hint # s.captured \/ s.stamp # s.indexVersion \/ s.captured < s.tombstone)
  /\ s' = [s EXCEPT !.refused = TRUE, !.delivery = "idle"]
\* A separately registered refresh/current withdrawal can win during await.
RefreshCurrent == /\ s.source > s.indexVersion
  /\ s' = [s EXCEPT !.indexVersion = s.source, !.member = s.source = 1,
    !.tombstone = IF s.source = 2 THEN 2 ELSE s.tombstone,
    !.published = @ \/ s.source = 1, !.recovered = TRUE]
Terminal == /\ s.source = 2 /\ s.indexVersion = 2 /\ s.delivery = "idle" /\ UNCHANGED s
Next == GrantConsent \/ WithdrawConsent \/ (\E v \in 1..2 : DispatchHint(v))
  \/ SourceReply \/ ApplyDelivery \/ RefuseStaleDelivery \/ RefreshCurrent \/ Terminal
TypeOK == /\ s.source \in 0..2 /\ s.hint \in 0..2 /\ s.captured \in 0..2
  /\ s.stamp \in 0..2 /\ s.indexVersion \in 0..2 /\ s.tombstone \in {0, 2}
  /\ s.delivery \in {"idle", "waiting", "ready"}
  /\ <<s.member, s.refused, s.recovered, s.published>> \in [1..4 -> BOOLEAN]
Safety == /\ s.indexVersion <= s.source /\ s.tombstone <= s.indexVersion
  /\ (s.member <=> s.indexVersion = 1) /\ (s.tombstone = 2 => ~s.member)
NoSuccessWitness == ~s.published
NoRefusalWitness == ~s.refused
NoRecoveryWitness == ~s.recovered \/ s.indexVersion # 2
=============================================================================
