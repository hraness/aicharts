----------------------------- MODULE M12Reclamation -----------------------------
EXTENDS Naturals, FiniteSets

\* A bounded kernel protocol for physical reclamation, not a refinement of
\* R2, SQL or the index walk. Objects abstract immutable index nodes; the
\* referenced set abstracts every live root the walk can reach (published,
\* staged, retained publications, rebuild scratch). Recording a candidate
\* never proves it is unreferenced. A step snapshots the references, verifies
\* the candidate against that snapshot inside a transaction that fails on any
\* change, and only then issues the provider delete. UnsafeHorizon removes the
\* retention wait, UnsafeWalk removes the transactional re-check, and
\* UnsafeReplay resumes a crashed delete without the head and reference check.
CONSTANTS Wide, UnsafeHorizon, UnsafeWalk, UnsafeReplay
Objects == IF Wide THEN 1..3 ELSE 1..2
MaxTime == 3
Horizon == 1
States == {"none", "recorded", "held", "deleting", "reclaimed"}
Phases == {"idle", "verify", "delete", "mark"}

VARIABLE s
Init == s = [now |-> 0, exists |-> {1}, referenced |-> {1},
  ledger |-> [o \in Objects |-> "none"], recordedAt |-> [o \in Objects |-> 0],
  reclaimedAt |-> [o \in Objects |-> 0], deletes |-> [o \in Objects |-> 0],
  created |-> [o \in Objects |-> IF o = 1 THEN 1 ELSE 0],
  phase |-> "idle", object |-> 0, walk |-> {}, crashed |-> FALSE, resumed |-> FALSE,
  conflicted |-> FALSE, heldAfterConflict |-> FALSE]

Idle == s.phase = "idle"
Eligible(o) == UnsafeHorizon \/ s.now >= s.recordedAt[o] + Horizon

Tick == /\ s.now < MaxTime /\ s' = [s EXCEPT !.now = @ + 1]
\* A projection stage creates a new referenced node. Quiescence: never during a step.
Stage(o) == /\ Idle /\ o \notin s.exists /\ s.ledger[o] # "reclaimed" /\ s.created[o] < 2
  /\ s' = [s EXCEPT !.exists = @ \cup {o}, !.referenced = @ \cup {o}, !.created[o] = @ + 1]
\* Retirement or supersession drops a root; the account keeps at least one.
Retire(o) == /\ Idle /\ o \in s.referenced /\ Cardinality(s.referenced) > 1
  /\ s' = [s EXCEPT !.referenced = @ \ {o}]
\* Content addressing lets a later stage reference an existing unreferenced node.
\* The step holds the account's projection and rebuild flight markers from its
\* transaction through the provider delete, so a re-reference can race only the
\* walk before the transaction (over-approximated here) or follow a crash.
Reref(o) == /\ o \in s.exists /\ o \notin s.referenced /\ s.ledger[o] # "reclaimed"
  /\ s.phase \in {"idle", "verify"}
  /\ s' = [s EXCEPT !.referenced = @ \cup {o}]
Record(o) == /\ Idle /\ o \in s.exists /\ s.ledger[o] = "none"
  /\ s' = [s EXCEPT !.ledger[o] = IF o \in s.referenced THEN "held" ELSE "recorded",
       !.recordedAt[o] = s.now]
Begin(o) == /\ Idle /\ s.ledger[o] \in {"recorded", "held", "deleting"} /\ Eligible(o)
  /\ s' = [s EXCEPT !.phase = "verify", !.object = o, !.walk = s.referenced,
       !.resumed = s.ledger[o] = "deleting"]
\* A crashed delete whose object is already gone only needs its ledger mark.
ResumeReclaimed == /\ s.phase = "verify" /\ s.ledger[s.object] = "deleting"
  /\ s.object \notin s.exists /\ ~UnsafeReplay
  /\ s' = [s EXCEPT !.ledger[s.object] = "reclaimed", !.reclaimedAt[s.object] = s.now,
       !.phase = "idle", !.object = 0, !.walk = {}]
ResumeUnsafe == /\ s.phase = "verify" /\ s.ledger[s.object] = "deleting" /\ UnsafeReplay
  /\ s' = [s EXCEPT !.phase = "delete"]
Conflict == /\ s.phase = "verify" /\ ~UnsafeWalk /\ s.walk # s.referenced
  /\ ~(s.ledger[s.object] = "deleting" /\ (s.object \notin s.exists \/ UnsafeReplay))
  /\ s' = [s EXCEPT !.phase = "idle", !.object = 0, !.walk = {}, !.conflicted = TRUE]
Hold == /\ s.phase = "verify" /\ (UnsafeWalk \/ s.walk = s.referenced)
  /\ ~(s.ledger[s.object] = "deleting" /\ (s.object \notin s.exists \/ UnsafeReplay))
  /\ s.object \in s.walk
  /\ s' = [s EXCEPT !.ledger[s.object] = "held", !.phase = "idle", !.object = 0, !.walk = {},
       !.heldAfterConflict = @ \/ s.conflicted]
MarkDeleting == /\ s.phase = "verify" /\ (UnsafeWalk \/ s.walk = s.referenced)
  /\ ~(s.ledger[s.object] = "deleting" /\ (s.object \notin s.exists \/ UnsafeReplay))
  /\ s.object \notin s.walk
  /\ s' = [s EXCEPT !.ledger[s.object] = "deleting", !.phase = "delete"]
Delete == /\ s.phase = "delete" /\ s.deletes[s.object] < 2
  /\ s' = [s EXCEPT !.exists = @ \ {s.object}, !.deletes[s.object] = @ + 1, !.phase = "mark"]
MarkReclaimed == /\ s.phase = "mark"
  /\ s' = [s EXCEPT !.ledger[s.object] = "reclaimed", !.reclaimedAt[s.object] = s.now,
       !.phase = "idle", !.object = 0, !.walk = {}]
\* The job loses its in-memory step; durable ledger rows persist.
Crash == /\ ~Idle /\ ~s.crashed
  /\ s' = [s EXCEPT !.phase = "idle", !.object = 0, !.walk = {}, !.crashed = TRUE]
Terminal == /\ Idle /\ s.now = MaxTime /\ UNCHANGED s

Next == Tick \/ Crash \/ Terminal \/ ResumeReclaimed \/ ResumeUnsafe \/ Conflict \/ Hold
  \/ MarkDeleting \/ Delete \/ MarkReclaimed
  \/ (\E o \in Objects : Stage(o) \/ Retire(o) \/ Reref(o) \/ Record(o) \/ Begin(o))

TypeOK == /\ s.now \in 0..MaxTime /\ s.exists \subseteq Objects /\ s.referenced \subseteq Objects
  /\ s.ledger \in [Objects -> States] /\ s.recordedAt \in [Objects -> 0..MaxTime]
  /\ s.reclaimedAt \in [Objects -> 0..MaxTime] /\ s.deletes \in [Objects -> 0..2]
  /\ s.created \in [Objects -> 0..2]
  /\ s.phase \in Phases /\ s.object \in Objects \cup {0} /\ s.walk \subseteq Objects
  /\ (Idle <=> s.object = 0) /\ s.referenced # {}
  /\ (s.phase \in {"delete", "mark"} => s.ledger[s.object] = "deleting")
\* No referenced object is ever reclaimed; a provider delete only ever targets an
\* object that was created since its previous delete.
Safety == /\ s.referenced \subseteq s.exists
  /\ \A o \in Objects : (s.deletes[o] <= s.created[o] /\ (s.ledger[o] = "reclaimed" => o \notin s.exists))
\* Reclamation waits the full retention horizon after the candidate was recorded.
Retention == \A o \in Objects : s.ledger[o] = "reclaimed"
  => s.reclaimedAt[o] >= s.recordedAt[o] + Horizon
NoCrashResumeWitness == ~(s.crashed /\ s.resumed /\ s.phase = "idle"
  /\ (\E o \in Objects : s.ledger[o] = "reclaimed" /\ s.deletes[o] = 1))
NoConflictHoldWitness == ~(s.heldAfterConflict /\ (\E o \in Objects : s.ledger[o] = "held" /\ o \in s.referenced))
=============================================================================
