------------------------------ MODULE M2Ledger ------------------------------
EXTENDS Naturals, FiniteSets
\* Two independent source/occurrence pairs and two monotone revisions each.
\* Source stamps and canonical facts publish in one transaction. Partial scans
\* are refused by the caller before that transaction. Outbox bytes are frozen.
VARIABLE s
Ids == {1, 2}
Zero == [i \in Ids |-> 0]
Pending == {i \in Ids : s.facts[i] > s.acked[i]}
Init == s = [cursor |-> Zero, facts |-> Zero, acked |-> Zero, frozen |-> Zero,
  revision |-> 0, freezes |-> 0, settlements |-> 0,
  refused |-> FALSE, reopened |-> FALSE, retried |-> FALSE,
  oldAck |-> FALSE]
CommitScan(i) == /\ s.facts[i] < 2
  /\ s' = [s EXCEPT !.facts[i] = @ + 1, !.cursor[i] = @ + 1,
    !.revision = @ + 1]
RefuseIncompleteScan == /\ ~s.refused /\ s' = [s EXCEPT !.refused = TRUE]
Freeze == /\ s.frozen = Zero /\ Pending # {}
  /\ s' = [s EXCEPT !.frozen = [i \in Ids |-> IF i \in Pending THEN s.facts[i] ELSE 0],
    !.revision = @ + 1, !.freezes = @ + 1]
ExactRetry == /\ s.frozen # Zero /\ ~s.retried
  /\ s' = [s EXCEPT !.retried = TRUE]
SettleExactReceipt == /\ s.frozen # Zero
  /\ s' = [s EXCEPT !.acked = [i \in Ids |-> IF s.frozen[i] > 0 THEN s.frozen[i] ELSE s.acked[i]],
    !.oldAck = @ \/ (\E i \in Ids : s.frozen[i] > 0 /\ s.frozen[i] < s.facts[i]),
    !.frozen = Zero, !.revision = @ + 1, !.settlements = @ + 1]
Reopen == /\ ~s.reopened /\ s' = [s EXCEPT !.reopened = TRUE]
Terminal == /\ (\A i \in Ids : s.facts[i] = 2) /\ Pending = {}
  /\ s.frozen = Zero /\ UNCHANGED s
Next == (\E i \in Ids : CommitScan(i)) \/ RefuseIncompleteScan \/ Freeze
  \/ ExactRetry \/ SettleExactReceipt \/ Reopen \/ Terminal
TypeOK == /\ s.cursor \in [Ids -> 0..2] /\ s.facts \in [Ids -> 0..2]
  /\ s.acked \in [Ids -> 0..2] /\ s.frozen \in [Ids -> 0..2]
  /\ s.revision \in 0..12 /\ s.freezes \in 0..4 /\ s.settlements \in 0..4
  /\ <<s.refused, s.reopened, s.retried, s.oldAck>> \in [1..4 -> BOOLEAN]
Safety == /\ s.cursor = s.facts
  /\ s.revision = s.facts[1] + s.facts[2] + s.freezes + s.settlements
  /\ s.settlements <= s.freezes /\ s.freezes <= s.settlements + 1
  /\ (\A i \in Ids : s.acked[i] <= s.facts[i])
  /\ (\A i \in Ids : s.frozen[i] = 0 \/ (s.acked[i] < s.frozen[i] /\ s.frozen[i] <= s.facts[i]))
NoSuccessWitness == s.revision = 0
NoRefusalWitness == ~s.refused
NoRecoveryWitness == ~s.reopened \/ ~s.oldAck \/ Pending = {}
=============================================================================
