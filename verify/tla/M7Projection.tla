---------------------------- MODULE M7Projection ----------------------------
EXTENDS Naturals
\* Small coherent day projection. Constructors/reads do not migrate or audit
\* into SQL. Explicit registered maintenance rebuilds only derived evidence.
VARIABLE s
Init == s = [schema |-> 7, canonical |-> 1, projection |-> 0, sourceOwner |-> 0,
  writer |-> 1, authoritativeValid |-> TRUE, registered |-> FALSE,
  closed |-> FALSE, auditCached |-> FALSE, scrubbed |-> FALSE,
  readWitness |-> FALSE, refused |-> FALSE, rebuilt |-> FALSE]
Read == /\ ~s.readWitness /\ s' = [s EXCEPT !.readWitness = TRUE]
RegisterMaintenance == /\ ~s.closed /\ ~s.registered
  /\ s' = [s EXCEPT !.registered = TRUE]
Prepare == /\ s.registered /\ s.authoritativeValid
  /\ (s.schema = 7 \/ s.sourceOwner # 0)
  /\ s' = [s EXCEPT !.schema = 8, !.sourceOwner = IF s.schema = 7 THEN s.writer ELSE s.sourceOwner,
    !.projection = s.canonical, !.auditCached = TRUE, !.rebuilt = TRUE]
Release == /\ s.registered /\ s' = [s EXCEPT !.registered = FALSE]
CommitCorrection == /\ s.registered /\ s.schema = 8 /\ s.authoritativeValid
  /\ s.sourceOwner # 0 /\ s.canonical = 1
  /\ s' = [s EXCEPT !.canonical = 2, !.projection = 2]
CorruptDerived == /\ s.projection # 0 /\ s' = [s EXCEPT !.projection = 0]
CorruptAuthority == /\ s.authoritativeValid /\ s.auditCached
  /\ s' = [s EXCEPT !.authoritativeValid = FALSE]
ScrubRefuses == /\ s.registered /\ ~s.authoritativeValid
  /\ s' = [s EXCEPT !.scrubbed = TRUE, !.refused = TRUE]
Close == /\ ~s.closed /\ s' = [s EXCEPT !.closed = TRUE]
RefuseClosedMaintenance == /\ s.closed /\ ~s.registered /\ ~s.refused
  /\ s' = [s EXCEPT !.refused = TRUE]
Terminal == /\ s.closed /\ ~s.registered /\ UNCHANGED s
Next == Read \/ RegisterMaintenance \/ Prepare \/ Release \/ CommitCorrection
  \/ CorruptDerived \/ CorruptAuthority \/ ScrubRefuses \/ Close
  \/ RefuseClosedMaintenance \/ Terminal
TypeOK == /\ s.schema \in {7, 8} /\ s.canonical \in 1..2 /\ s.projection \in 0..2
  /\ s.sourceOwner \in 0..1 /\ s.writer = 1
  /\ <<s.authoritativeValid, s.registered, s.closed, s.auditCached, s.scrubbed,
    s.readWitness, s.refused, s.rebuilt>> \in [1..8 -> BOOLEAN]
Safety == /\ (s.projection = 0 \/ s.projection = s.canonical)
  /\ (s.schema = 8 => s.sourceOwner = 1)
  /\ (s.scrubbed => ~s.authoritativeValid /\ s.refused)
NoSuccessWitness == ~s.rebuilt
NoRefusalWitness == ~s.refused
NoRecoveryWitness == ~s.auditCached \/ ~s.scrubbed
=============================================================================
