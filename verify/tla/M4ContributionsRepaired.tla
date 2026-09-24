---------------------- MODULE M4ContributionsRepaired ----------------------
EXTENDS Naturals, FiniteSets
\* Current containment: ambiguous legacy overlap refuses. Exact overlap
\* reconciliation and copied-ledger deduplication remain Phase 5 obligations.
VARIABLE s
Bodies == {1, 2}
Init == s = [revision |-> 0, pending |-> 0, charged |-> {}, abandoned |-> {},
  completed |-> {}, writer |-> 1, predecessorRevoked |-> FALSE, dayOwner |-> 0,
  dayValue |-> 0, legacyValue |-> 7, overlapRefused |-> FALSE,
  refused |-> FALSE, transferred |-> FALSE]
Reserve(b) == /\ s.pending = 0 /\ b \notin s.abandoned \cup s.completed
  /\ s.revision < 2 /\ s.writer = 1 /\ ~s.predecessorRevoked
  /\ s' = [s EXCEPT !.pending = b, !.charged = @ \cup {b}]
RefuseSupersede == /\ s.pending # 0 /\ ~s.refused
  /\ s' = [s EXCEPT !.refused = TRUE]
Abandon == /\ s.pending # 0 /\ s.revision < 2
  /\ s' = [s EXCEPT !.revision = @ + 1, !.abandoned = @ \cup {s.pending}, !.pending = 0]
Commit == /\ s.pending # 0 /\ s.revision < 2 /\ s.writer = 1
  /\ ~s.predecessorRevoked
  /\ s' = [s EXCEPT !.revision = @ + 1, !.dayValue = s.pending,
    !.dayOwner = s.writer, !.completed = @ \cup {s.pending}, !.pending = 0]
RefuseAmbiguousOverlap == /\ ~s.overlapRefused
  /\ s' = [s EXCEPT !.overlapRefused = TRUE]
RevokePredecessor == /\ ~s.predecessorRevoked /\ s.pending = 0
  /\ s' = [s EXCEPT !.predecessorRevoked = TRUE]
TransferWriter == /\ s.predecessorRevoked /\ s.writer = 1 /\ s.pending = 0
  /\ s' = [s EXCEPT !.writer = 2, !.transferred = TRUE]
RefusePredecessorReplacement == /\ s.writer = 2 /\ s.dayOwner = 1 /\ ~s.refused
  /\ s' = [s EXCEPT !.refused = TRUE]
Terminal == /\ s.pending = 0 /\ (s.writer = 2 \/ s.revision = 2) /\ UNCHANGED s
Next == (\E b \in Bodies : Reserve(b)) \/ RefuseSupersede \/ Abandon \/ Commit
  \/ RefuseAmbiguousOverlap \/ RevokePredecessor \/ TransferWriter
  \/ RefusePredecessorReplacement \/ Terminal
TypeOK == /\ s.revision \in 0..2 /\ s.pending \in 0..2
  /\ s.charged \subseteq Bodies /\ s.abandoned \subseteq Bodies /\ s.completed \subseteq Bodies
  /\ s.writer \in 1..2 /\ s.dayOwner \in 0..1 /\ s.dayValue \in 0..2
  /\ s.legacyValue = 7
  /\ <<s.predecessorRevoked, s.overlapRefused, s.refused, s.transferred>> \in [1..4 -> BOOLEAN]
Safety == /\ s.abandoned \cap s.completed = {}
  /\ (s.pending = 0 \/ s.pending \notin s.abandoned \cup s.completed)
  /\ s.abandoned \cup s.completed \subseteq s.charged
  /\ s.revision = Cardinality(s.abandoned) + Cardinality(s.completed)
  /\ (s.dayValue # 0 => s.dayOwner = 1)
  /\ (s.writer = 2 => s.predecessorRevoked)
NoSuccessWitness == s.completed = {}
NoRefusalWitness == ~s.refused \/ ~s.overlapRefused
NoRecoveryWitness == ~s.transferred \/ s.dayOwner # 1
NoAbandonmentWitness == s.abandoned = {} \/ s.completed = {}
=============================================================================
