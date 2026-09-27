---------------------------- MODULE M3Admission ----------------------------
EXTENDS Naturals, Sequences, FiniteSets
\* One fixed request per device. Each immutable terminal decision binds the
\* exact request and one account revision, including rejection. Revocation
\* after freeze cannot rewrite that frozen decision.
\* UnsafeRevocation removes the revocation check from the frozen decision: a
\* revoked device's request is accepted and published (negative control only).
CONSTANT UnsafeRevocation
VARIABLE s
Devices == {1, 2}
Init == s = [revision |-> 0, owner |-> 0, stage |-> "idle", decision |-> "none",
  revoked |-> {}, completed |-> {}, charged |-> {}, object |-> {}, journal |-> <<>>,
  head |-> 0, frozenAuthorized |-> FALSE, success |-> FALSE,
  refused |-> FALSE, recovered |-> FALSE]
Reserve(d) == /\ s.stage = "idle" /\ d \notin s.completed
  /\ s' = [s EXCEPT !.owner = d, !.stage = "reserved", !.charged = @ \cup {d}]
FreezeDecision == /\ s.stage = "object"
  /\ s' = [s EXCEPT !.stage = "frozen",
    !.decision = IF (~UnsafeRevocation /\ s.owner \in s.revoked) \/ s.head # 0 THEN "reject" ELSE "accept",
    !.frozenAuthorized = s.owner \notin s.revoked /\ s.head = 0]
PutImmutable == /\ s.stage = "reserved"
  /\ s' = [s EXCEPT !.stage = "object", !.object = @ \cup {s.owner}]
PutJournal == /\ s.stage = "frozen"
  /\ s' = [s EXCEPT !.stage = "journal"]
Publish == /\ s.stage = "journal"
  /\ s' = [s EXCEPT !.revision = @ + 1, !.stage = "idle", !.completed = @ \cup {s.owner},
    !.journal = Append(@, [device |-> s.owner, accepted |-> s.decision = "accept", authorized |-> s.frozenAuthorized]),
    !.head = IF s.decision = "accept" THEN s.owner ELSE s.head,
    !.success = @ \/ s.decision = "accept", !.refused = @ \/ s.decision = "reject"]
Revoke(d) == /\ d \notin s.revoked /\ s' = [s EXCEPT !.revoked = @ \cup {d}]
ReplayTerminal(d) == /\ d \in s.completed /\ ~s.recovered
  /\ s' = [s EXCEPT !.recovered = TRUE]
Terminal == /\ s.completed = Devices /\ s.stage = "idle" /\ UNCHANGED s
Next == (\E d \in Devices : Reserve(d) \/ Revoke(d) \/ ReplayTerminal(d))
  \/ FreezeDecision \/ PutImmutable \/ PutJournal \/ Publish \/ Terminal
TypeOK == /\ s.revision \in 0..2 /\ s.owner \in 0..2
  /\ s.stage \in {"idle", "reserved", "frozen", "object", "journal"}
  /\ s.decision \in {"none", "accept", "reject"}
  /\ s.revoked \subseteq Devices /\ s.completed \subseteq Devices
  /\ s.charged \subseteq Devices /\ s.object \subseteq Devices
  /\ s.head \in 0..2 /\ s.journal \in Seq([device : Devices, accepted : BOOLEAN, authorized : BOOLEAN])
  /\ <<s.frozenAuthorized, s.success, s.refused, s.recovered>> \in [1..4 -> BOOLEAN]
AcceptedPositions == {i \in 1..Len(s.journal) : s.journal[i].accepted}
Safety == /\ Len(s.journal) = s.revision /\ Cardinality(s.completed) = s.revision
  /\ s.completed \subseteq s.object /\ s.object \subseteq s.charged
  /\ (\A i, j \in 1..Len(s.journal) : i # j => s.journal[i].device # s.journal[j].device)
  /\ (\A i \in 1..Len(s.journal) : s.journal[i].accepted => s.journal[i].authorized)
  /\ IF AcceptedPositions = {} THEN s.head = 0 ELSE
      s.head = s.journal[CHOOSE i \in AcceptedPositions : \A j \in AcceptedPositions : j <= i].device
NoSuccessWitness == ~s.success
NoRefusalWitness == ~s.refused
NoRecoveryWitness == ~s.recovered
=============================================================================
