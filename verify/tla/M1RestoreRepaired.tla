------------------------- MODULE M1RestoreRepaired -------------------------
EXTENDS Naturals, FiniteSets

\* Two independent executions, one epoch transition. The clock is diagnostic.
\* A terminal immutable tail has no remaining SQL/visibility continuation.
\* OpCount independent executions; the development profile uses 2, nightly 3.
CONSTANT OpCount
VARIABLE s
Ops == 1..OpCount
Live == {o \in Ops : s.disposition[o] = "live"}
CanPublish == {o \in Ops : s.stage[o] \in {"running", "ready"}}
Init == s = [epoch |-> 0, phase |-> "open", clock |-> 0,
  disposition |-> [o \in Ops |-> "none"], known |-> {},
  stage |-> [o \in Ops |-> "idle"], captured |-> [o \in Ops |-> 0],
  kind |-> [o \in Ops |-> "immutable"], charged |-> {}, objects |-> {},
  committed |-> {}, orphan |-> {}, refused |-> FALSE, late |-> FALSE,
  orphanAfterPublish |-> FALSE]

Grant(o) == /\ s.phase = "open" /\ s.epoch = 0
  /\ s.disposition[o] = "none"
  /\ s' = [s EXCEPT !.disposition[o] = "live", !.captured[o] = s.epoch]
\* Grant persistence precedes reply delivery. Readback uses the same attempt.
ReadGrant(o) == /\ o \in Live /\ o \notin s.known
  /\ s' = [s EXCEPT !.known = @ \cup {o}]
CancelBeforeWork(o) == /\ s.disposition[o] \in {"none", "live"}
  /\ s.stage[o] = "idle"
  /\ s' = [s EXCEPT !.disposition[o] = "cancelled"]
Dispatch(o, k) == /\ o \in Live \cap s.known /\ s.stage[o] = "idle"
  /\ s' = [s EXCEPT !.stage[o] = "running", !.kind[o] = k,
    !.charged = @ \cup {o}]
ProviderReturns(o) == /\ s.stage[o] = "running"
  /\ s' = [s EXCEPT !.stage[o] = "ready", !.objects = @ \cup {o}]
CanonicalCommit(o) == /\ s.stage[o] = "ready"
  /\ s' = [s EXCEPT !.stage[o] = "done", !.committed = @ \cup {o},
    !.late = @ \/ s.captured[o] < s.epoch]
\* Fixed namespace-anchor writes cannot take this terminal-timeout branch.
TerminalTimeout(o) == /\ s.stage[o] = "running" /\ s.kind[o] = "immutable"
  /\ s' = [s EXCEPT !.stage[o] = "tail"]
Release(o) == /\ o \in Live /\ s.stage[o] \in {"idle", "done", "tail"}
  /\ s' = [s EXCEPT !.disposition[o] = "released"]
LateOrphan(o) == /\ s.stage[o] = "tail"
  /\ s' = [s EXCEPT !.stage[o] = "done", !.objects = @ \cup {o},
    !.orphan = @ \cup {o}, !.orphanAfterPublish = @ \/ s.captured[o] < s.epoch]
AdvanceClock == /\ s.clock = 0 /\ s' = [s EXCEPT !.clock = 1]
Close == /\ s.epoch = 0 /\ s.phase = "open"
  /\ s' = [s EXCEPT !.phase = "closed"]
RefusePublish == /\ s.phase = "closed" /\ Live # {} /\ ~s.refused
  /\ s' = [s EXCEPT !.refused = TRUE]
PublishEpoch == /\ s.phase = "closed" /\ Live = {}
  /\ s' = [s EXCEPT !.phase = "open", !.epoch = 1]
Terminal == /\ s.epoch = 1 /\ CanPublish = {}
  /\ \A o \in Ops : s.stage[o] # "tail"
  /\ UNCHANGED s
Next == (\E o \in Ops : Grant(o) \/ ReadGrant(o) \/ CancelBeforeWork(o)
  \/ (\E k \in {"canonical", "immutable"} : Dispatch(o, k))
  \/ ProviderReturns(o) \/ CanonicalCommit(o) \/ TerminalTimeout(o)
  \/ Release(o) \/ LateOrphan(o)) \/ AdvanceClock \/ Close
  \/ RefusePublish \/ PublishEpoch \/ Terminal
TypeOK == /\ s.epoch \in 0..1 /\ s.phase \in {"open", "closed"}
  /\ s.clock \in 0..1 /\ s.disposition \in [Ops -> {"none", "live", "cancelled", "released"}]
  /\ s.stage \in [Ops -> {"idle", "running", "ready", "done", "tail"}]
  /\ s.known \subseteq Ops /\ s.captured \in [Ops -> 0..1]
  /\ s.kind \in [Ops -> {"canonical", "immutable"}]
  /\ s.charged \subseteq Ops /\ s.objects \subseteq Ops
  /\ s.committed \subseteq Ops /\ s.orphan \subseteq Ops
  /\ <<s.refused, s.late, s.orphanAfterPublish>> \in [1..3 -> BOOLEAN]
Safety == /\ CanPublish \subseteq Live /\ ~s.late
  /\ s.committed \subseteq s.objects /\ s.objects \subseteq s.charged
  /\ s.orphan \cap s.committed = {}
  /\ (s.epoch = 1 => Live = {})
NoSuccessWitness == s.committed = {}
NoRefusalWitness == ~s.refused
NoRecoveryWitness == s.epoch = 0 \/ ~s.refused \/ s.committed = {}
NoOrphanWitness == ~s.orphanAfterPublish
=============================================================================
