----------------------- MODULE M10ContributionFlight -----------------------
EXTENDS Naturals, FiniteSets

\* A finite protocol abstraction. PersistFlight stands for a successful durable
\* native reservation, not proof of fsync/rename, transport or source refinement.
CONSTANTS Sequential, UnsafeNullClear, UnsafeCancelSequence, UnsafeOldReply

Operations == IF Sequential THEN 1..2 ELSE {1}
Devices == {1, 2}
Populations == {1, 2}
Slots == {1, 2}
TerminalOutcomes == {"committed", "abandoned"}
Outcomes == {"absent", "pending"} \cup TerminalOutcomes
Phases == {"empty", "queued", "reserved", "provider", "returned", "reply", "verified"}
Kinds == {"empty", "upload", "status", "cancel"}
Replies == Outcomes \cup {"none", "refused"}
EmptyMessage == [op |-> 0, body |-> 0, kind |-> "empty", phase |-> "empty",
  cancelRevision |-> 0, reply |-> "none", replyRevision |-> 0, run |-> 0, retry |-> FALSE]
EmptyBatch == [body |-> 0, device |-> 1, population |-> 1,
  epoch |-> 0, sequence |-> 0, expectedRevision |-> 0]

VARIABLE s
Init == s = [current |-> 0, prepared |-> 0, allocated |-> 0,
  batch |-> [op \in Operations |-> EmptyBatch], durable |-> {},
  frozenBatch |-> [op \in Operations |-> EmptyBatch],
  retiredBy |-> [op \in Operations |-> 0], localSequence |-> 0,
  decision |-> [op \in Operations |-> "upload"], cancelRevision |-> [op \in Operations |-> 0],
  cancelObserved |-> [op \in Operations |-> FALSE],
  uploads |-> [op \in Operations |-> 0], controlUsed |-> [op \in Operations |-> FALSE],
  message |-> [slot \in Slots |-> EmptyMessage],
  operation |-> [op \in Operations |-> "absent"],
  mode |-> [op \in Operations |-> "none"], pending |-> 0,
  terminalRevision |-> [op \in Operations |-> 0],
  terminalWrites |-> [op \in Operations |-> 0],
  metadataCharges |-> [op \in Operations |-> 0],
  immutableCharges |-> [op \in Operations |-> 0],
  revision |-> 0, sequence |-> 0, heads |-> {}, objects |-> {},
  authenticated |-> TRUE, epoch |-> 0, nativeEpoch |-> 0,
  writer |-> [population \in Populations |-> 1], capacity |-> Cardinality(Operations),
  environment |-> "unchanged", externalRevision |-> 0,
  run |-> 0, lost |-> {}, restartedAfterLoss |-> FALSE, statusAfterRestart |-> FALSE,
  retriedAfterStatus |-> FALSE, recoveredExact |-> FALSE,
  lateReserve |-> FALSE, heldCancellation |-> FALSE, lateCommit |-> FALSE, staleRejected |-> FALSE,
  statusPure |-> TRUE]

Terminals == {op \in Operations : s.operation[op] \in TerminalOutcomes}
Charged == {op \in Operations : s.metadataCharges[op] = 1}
Compatible == s.nativeEpoch = 0
Authorized(op) == s.authenticated /\ s.epoch = s.batch[op].epoch
Writer(op) == s.writer[s.batch[op].population] = s.batch[op].device
Position(op) == s.batch[op].sequence = s.sequence + 1
  /\ s.batch[op].expectedRevision = s.revision
CanStart(op) == s.pending = 0 /\ Position(op) /\ Writer(op)
  /\ Cardinality(Charged) < s.capacity
CanContinue(op) == s.pending = op /\ s.operation[op] = "pending"
  /\ Position(op) /\ Writer(op)
Server(value) == <<value.operation, value.mode, value.pending,
  value.terminalRevision, value.terminalWrites, value.metadataCharges,
  value.immutableCharges, value.revision, value.sequence, value.heads, value.objects>>
Reply(slot, outcome, revision) == [s.message[slot] EXCEPT
  !.phase = "reply", !.reply = outcome, !.replyRevision = revision]
NewMessage(op, kind, retry) == [op |-> op, body |-> s.batch[op].body,
  kind |-> kind, phase |-> "queued", cancelRevision |-> s.revision,
  reply |-> "none", replyRevision |-> 0, run |-> s.run, retry |-> retry]

PrepareFlight == /\ Compatible /\ s.current = 0 /\ s.prepared = 0
  /\ s.allocated < Cardinality(Operations)
  /\ LET op == s.allocated + 1
     IN s' = [s EXCEPT !.prepared = op, !.allocated = op,
       !.batch[op] = [body |-> op, device |-> 1, population |-> op,
         epoch |-> 0, sequence |-> s.localSequence + 1, expectedRevision |-> s.revision]]
PersistFlight == /\ Compatible /\ s.prepared # 0 /\ s.current = 0
  /\ s' = [s EXCEPT !.current = s.prepared, !.prepared = 0,
    !.frozenBatch[s.prepared] = s.batch[s.prepared],
    !.durable = @ \cup {s.prepared}]

SendUpload == /\ Compatible /\ s.current # 0 /\ s.current \in s.durable
  /\ s.decision[s.current] = "upload"
  /\ s.message[1].phase = "empty" /\ s.uploads[s.current] = 0
  /\ s' = [s EXCEPT !.message[1] = NewMessage(s.current, "upload", FALSE),
    !.uploads[s.current] = @ + 1]
SendExactRetry == /\ Compatible /\ s.current # 0 /\ s.current \in s.durable
  /\ s.decision[s.current] = "upload"
  /\ s.message[1].phase = "empty" /\ s.uploads[s.current] = 1
  /\ (~Sequential \/ s.current = 1)
  /\ s' = [s EXCEPT !.message[1] = NewMessage(s.current, "upload", TRUE),
    !.uploads[s.current] = @ + 1,
    !.retriedAfterStatus = @ \/ (s.run = 1 /\ s.statusAfterRestart)]
SendStatus == /\ Compatible /\ s.current # 0 /\ s.current \in s.durable
  /\ s.decision[s.current] = "upload"
  /\ ~s.cancelObserved[s.current]
  /\ s.message[2].phase = "empty" /\ ~s.controlUsed[s.current]
  /\ s' = [s EXCEPT !.message[2] = NewMessage(s.current, "status", FALSE),
    !.controlUsed[s.current] = TRUE]
\* One completed authenticated position read is abstracted atomically. Its
\* snapshot can become stale before either persistence or cancellation delivery.
ReadCancellationPosition == /\ Compatible /\ s.current # 0 /\ s.current \in s.durable
  /\ Authorized(s.current) /\ s.message[2].phase = "empty"
  /\ s.decision[s.current] = "upload" /\ ~s.controlUsed[s.current] /\ ~s.cancelObserved[s.current]
  /\ LET next == [s EXCEPT !.cancelObserved[s.current] = TRUE, !.cancelRevision[s.current] = s.revision]
     IN s' = [next EXCEPT !.statusPure = s.statusPure /\ Server(next) = Server(s)]
PersistCancellation == /\ Compatible /\ s.current # 0 /\ s.current \in s.durable
  /\ s.decision[s.current] = "upload" /\ ~s.controlUsed[s.current]
  /\ s.cancelObserved[s.current]
  /\ s' = [s EXCEPT !.decision[s.current] = "cancel"]
SendCancel == /\ Compatible /\ s.current # 0 /\ s.current \in s.durable
  /\ s.decision[s.current] = "cancel"
  /\ s.message[2].phase = "empty" /\ ~s.controlUsed[s.current]
  /\ s' = [s EXCEPT !.message[2] = [NewMessage(s.current, "cancel", FALSE) EXCEPT
      !.cancelRevision = s.cancelRevision[s.current]],
    !.controlUsed[s.current] = TRUE]

ReserveUpload == /\ s.message[1].kind = "upload" /\ s.message[1].phase = "queued"
  /\ LET op == s.message[1].op
     IN IF ~Authorized(op)
       THEN s' = [s EXCEPT !.message[1] = Reply(1, "refused", 0)]
       ELSE IF s.operation[op] \in TerminalOutcomes
         THEN s' = [s EXCEPT !.message[1] = Reply(1, s.operation[op], s.terminalRevision[op]),
           !.lateReserve = @ \/ s.mode[op] = "cancelled-before-reserve"]
       ELSE IF s.operation[op] = "pending"
         THEN s' = [s EXCEPT !.message[1].phase = "reserved"]
       ELSE IF CanStart(op)
         THEN s' = [s EXCEPT !.operation[op] = "pending", !.mode[op] = "reserved",
           !.pending = op, !.metadataCharges[op] = @ + 1,
           !.immutableCharges[op] = @ + 1, !.message[1].phase = "reserved"]
       ELSE s' = [s EXCEPT !.message[1] = Reply(1, "refused", 0)]
DispatchR2 == /\ s.message[1].phase = "reserved"
  /\ LET op == s.message[1].op
     IN IF ~Authorized(op)
       THEN s' = [s EXCEPT !.message[1] = Reply(1, "refused", 0)]
       ELSE IF s.operation[op] \in TerminalOutcomes
         THEN s' = [s EXCEPT !.message[1] = Reply(1, s.operation[op], s.terminalRevision[op])]
       ELSE IF CanContinue(op)
         THEN s' = [s EXCEPT !.message[1].phase = "provider"]
       ELSE s' = [s EXCEPT !.message[1] = Reply(1, "refused", 0)]
ProviderReturns == /\ s.message[1].phase = "provider"
  \* Immutable completion is not canonical commitment or cancellation failure.
  /\ s' = [s EXCEPT !.objects = @ \cup {s.message[1].body}, !.message[1].phase = "returned"]
CommitUpload == /\ s.message[1].phase = "returned"
  /\ LET op == s.message[1].op
     IN IF ~Authorized(op)
       THEN s' = [s EXCEPT !.message[1] = Reply(1, "refused", 0)]
       ELSE IF s.operation[op] \in TerminalOutcomes
         THEN s' = [s EXCEPT !.message[1] = Reply(1, s.operation[op], s.terminalRevision[op]),
           !.lateCommit = @ \/ (s.operation[op] = "abandoned" /\ s.heldCancellation)]
       ELSE IF CanContinue(op)
         THEN s' = [s EXCEPT !.operation[op] = "committed", !.pending = 0,
           !.terminalRevision[op] = s.revision + 1, !.terminalWrites[op] = @ + 1,
           !.revision = @ + 1, !.sequence = s.batch[op].sequence, !.heads = @ \cup {op},
           !.message[1] = Reply(1, "committed", s.revision + 1)]
       ELSE s' = [s EXCEPT !.message[1] = Reply(1, "refused", 0)]

CancelReady(op) == Authorized(op) /\ Writer(op)
  /\ s.message[2].cancelRevision = s.revision
  /\ s.revision >= s.batch[op].expectedRevision
  /\ s.batch[op].sequence = s.sequence + 1
CancelAbsent == /\ s.message[2].kind = "cancel" /\ s.message[2].phase = "queued"
  /\ LET op == s.message[2].op
     IN /\ s.operation[op] = "absent" /\ CancelReady(op)
        /\ s.pending = 0 /\ Cardinality(Charged) < s.capacity
        /\ s' = [s EXCEPT !.operation[op] = "abandoned", !.mode[op] = "cancelled-before-reserve",
          !.metadataCharges[op] = @ + 1, !.terminalWrites[op] = @ + 1,
          !.terminalRevision[op] = s.revision + 1, !.revision = @ + 1,
          !.sequence = IF UnsafeCancelSequence THEN @ ELSE s.batch[op].sequence,
          !.message[2] = Reply(2, "abandoned", s.revision + 1)]
CancelPending == /\ s.message[2].kind = "cancel" /\ s.message[2].phase = "queued"
  /\ LET op == s.message[2].op
     IN /\ s.operation[op] = "pending" /\ s.pending = op /\ CancelReady(op)
        /\ s' = [s EXCEPT !.operation[op] = "abandoned", !.pending = 0,
          !.heldCancellation = @ \/ s.message[1].phase = "provider",
          !.terminalWrites[op] = @ + 1, !.terminalRevision[op] = s.revision + 1, !.revision = @ + 1,
          !.sequence = IF UnsafeCancelSequence THEN @ ELSE s.batch[op].sequence,
          !.message[2] = Reply(2, "abandoned", s.revision + 1)]
CancelExistingOrRefused == /\ s.message[2].kind = "cancel" /\ s.message[2].phase = "queued"
  /\ LET op == s.message[2].op
     IN /\ ~(CancelReady(op) /\ ((s.operation[op] = "pending" /\ s.pending = op)
          \/ (s.operation[op] = "absent" /\ s.pending = 0 /\ Cardinality(Charged) < s.capacity)))
        /\ IF Authorized(op) /\ s.operation[op] \in TerminalOutcomes
          THEN s' = [s EXCEPT !.message[2] = Reply(2, s.operation[op], s.terminalRevision[op])]
          ELSE s' = [s EXCEPT !.message[2] = Reply(2, "refused", 0)]
ReadStatus == /\ s.message[2].kind = "status" /\ s.message[2].phase = "queued"
  /\ LET op == s.message[2].op
         result == IF Authorized(op) THEN s.operation[op] ELSE "refused"
         next == [s EXCEPT !.message[2] = Reply(2, result,
           IF result \in TerminalOutcomes THEN s.terminalRevision[op] ELSE 0)]
     IN s' = [next EXCEPT !.statusPure = s.statusPure /\ Server(next) = Server(s)]

ObserveNonterminal(slot) == /\ s.message[slot].phase = "reply"
  /\ s.message[slot].reply \notin TerminalOutcomes
  /\ LET op == s.message[slot].op
         clear == UnsafeNullClear /\ s.message[slot].kind = "status"
           /\ s.message[slot].reply = "absent" /\ s.current = op
           /\ s.message[slot].run = s.run /\ Compatible
     IN s' = [s EXCEPT !.message[slot] = EmptyMessage,
       !.current = IF clear THEN 0 ELSE @,
       !.retiredBy[op] = IF clear THEN op ELSE @]
VerifyTerminal(slot) == /\ Compatible /\ s.message[slot].phase = "reply"
  /\ s.message[slot].reply \in TerminalOutcomes /\ s.message[slot].run = s.run
  /\ s.current = s.message[slot].op /\ s.current \in s.durable
  /\ s.message[slot].body = s.batch[s.current].body
  /\ (IF s.message[slot].reply = "committed"
    THEN s.message[slot].replyRevision = s.batch[s.current].expectedRevision + 1
    ELSE s.message[slot].replyRevision > s.batch[s.current].expectedRevision)
  /\ s' = [s EXCEPT !.message[slot].phase = "verified",
    !.statusAfterRestart = @ \/ (s.run = 1 /\ s.message[slot].kind = "status")]
SettleTerminal(slot) == /\ Compatible /\ s.message[slot].phase = "verified" /\ s.current # 0
  /\ (UnsafeOldReply \/ s.current = s.message[slot].op)
  /\ s' = [s EXCEPT !.retiredBy[s.current] = s.message[slot].op,
    !.localSequence = s.batch[s.message[slot].op].sequence,
    !.current = 0, !.message[slot] = EmptyMessage,
    !.recoveredExact = @ \/ (s.run = 1 /\ s.retriedAfterStatus /\ s.message[slot].retry)]
RejectStale(slot) == /\ s.message[slot].phase \in {"reply", "verified"}
  /\ (s.message[slot].run # s.run \/ s.message[slot].op # s.current \/ ~Compatible)
  /\ s' = [s EXCEPT !.message[slot] = EmptyMessage, !.staleRejected = TRUE]
LoseReply(slot) == /\ s.message[slot].phase = "reply"
  /\ s' = [s EXCEPT !.lost = IF s.message[slot].reply = "committed"
      THEN @ \cup {s.message[slot].op} ELSE @, !.message[slot] = EmptyMessage]
Restart == /\ ~Sequential /\ s.run = 0 /\ s.current # 0
  /\ s.uploads[s.current] > 0
  /\ s' = [s EXCEPT !.run = 1, !.restartedAfterLoss = 1 \in s.lost,
    !.cancelObserved = [op \in Operations |-> s.decision[op] = "cancel" /\ s.cancelObserved[op]],
    !.cancelRevision = [op \in Operations |-> IF s.decision[op] = "cancel" THEN s.cancelRevision[op] ELSE 0],
    !.message = [slot \in Slots |-> IF s.message[slot].phase \in {"reply", "verified"}
      THEN EmptyMessage ELSE s.message[slot]]]

\* One environmental interference per finite history. Other combinations,
\* restoration custody and generation migration are intentionally outside M10.
Revoke == /\ ~Sequential /\ s.environment = "unchanged" /\ s.current # 0
  /\ s' = [s EXCEPT !.authenticated = FALSE, !.environment = "revoked"]
ChangeEpoch == /\ ~Sequential /\ s.environment = "unchanged" /\ s.current # 0
  /\ s' = [s EXCEPT !.epoch = 1, !.nativeEpoch = 1, !.environment = "epoch"]
TransferWriter == /\ ~Sequential /\ s.environment = "unchanged" /\ s.current # 0
  /\ s' = [s EXCEPT !.writer[s.batch[s.current].population] = 2, !.environment = "writer"]
ExhaustCapacity == /\ ~Sequential /\ s.environment = "unchanged" /\ s.current # 0
  /\ s' = [s EXCEPT !.capacity = Cardinality(Charged), !.environment = "capacity"]
AdvanceOtherRevision == /\ ~Sequential /\ s.environment = "unchanged" /\ s.current # 0
  /\ s.pending = 0
  /\ s' = [s EXCEPT !.revision = @ + 1, !.externalRevision = 1, !.environment = "revision"]

\* Deliberate refusal or finite send-budget exhaustion may retain a flight.
\* Stuttering expresses absence of fairness, not a recovery/liveness proof.
Quiescent == /\ s.prepared = 0 /\ (\A slot \in Slots : s.message[slot].phase = "empty") /\ UNCHANGED s
Next == PrepareFlight \/ PersistFlight \/ SendUpload \/ SendExactRetry \/ SendStatus \/ SendCancel
  \/ ReadCancellationPosition \/ PersistCancellation
  \/ ReserveUpload \/ DispatchR2 \/ ProviderReturns \/ CommitUpload
  \/ CancelAbsent \/ CancelPending \/ CancelExistingOrRefused \/ ReadStatus \/ Restart
  \/ Revoke \/ ChangeEpoch \/ TransferWriter \/ ExhaustCapacity \/ AdvanceOtherRevision \/ Quiescent
  \/ (\E slot \in Slots : ObserveNonterminal(slot) \/ VerifyTerminal(slot)
    \/ SettleTerminal(slot) \/ RejectStale(slot) \/ LoseReply(slot))

TypeOK == /\ s.current \in Operations \cup {0} /\ s.prepared \in Operations \cup {0}
  /\ s.allocated \in 0..2 /\ s.durable \subseteq Operations
  /\ s.retiredBy \in [Operations -> Operations \cup {0}] /\ s.localSequence \in 0..2
  /\ s.decision \in [Operations -> {"upload", "cancel"}] /\ s.cancelRevision \in [Operations -> 0..3]
  /\ s.cancelObserved \in [Operations -> BOOLEAN]
  /\ s.uploads \in [Operations -> 0..2] /\ s.controlUsed \in [Operations -> BOOLEAN]
  /\ s.operation \in [Operations -> Outcomes]
  /\ s.mode \in [Operations -> {"none", "reserved", "cancelled-before-reserve"}]
  /\ s.pending \in Operations \cup {0} /\ s.terminalRevision \in [Operations -> 0..3]
  /\ s.terminalWrites \in [Operations -> 0..2]
  /\ s.metadataCharges \in [Operations -> 0..2] /\ s.immutableCharges \in [Operations -> 0..2]
  /\ s.revision \in 0..3 /\ s.sequence \in 0..2
  /\ s.heads \subseteq Operations /\ s.objects \subseteq Operations /\ s.lost \subseteq Operations
  /\ s.writer \in [Populations -> Devices] /\ s.capacity \in 0..2
  /\ s.epoch \in 0..1 /\ s.nativeEpoch \in 0..1 /\ s.externalRevision \in 0..1 /\ s.run \in 0..1
  /\ s.environment \in {"unchanged", "revoked", "epoch", "writer", "capacity", "revision"}
  /\ <<s.authenticated, s.restartedAfterLoss, s.statusAfterRestart, s.retriedAfterStatus, s.recoveredExact,
       s.lateReserve, s.heldCancellation, s.lateCommit, s.staleRejected, s.statusPure>> \in [1..10 -> BOOLEAN]
  /\ (\A op \in Operations : s.batch[op] \in [body : Operations \cup {0}, device : Devices,
        population : Populations, epoch : 0..1, sequence : 0..2, expectedRevision : 0..3])
  /\ (\A op \in Operations : s.frozenBatch[op] \in [body : Operations \cup {0}, device : Devices,
        population : Populations, epoch : 0..1, sequence : 0..2, expectedRevision : 0..3])
  /\ (\A slot \in Slots : s.message[slot] \in [op : Operations \cup {0}, body : Operations \cup {0},
        kind : Kinds, phase : Phases, cancelRevision : 0..3, reply : Replies,
        replyRevision : 0..3, run : 0..1, retry : BOOLEAN])

FrozenUntilTerminal == /\ (s.current # 0 => s.current \in s.durable /\ s.retiredBy[s.current] = 0)
  /\ (\A op \in s.durable : s.retiredBy[op] = 0 => (s.current = op /\ s.batch[op] = s.frozenBatch[op]))
  /\ (\A op \in Operations : s.retiredBy[op] # 0 => s.retiredBy[op] = op /\ op \in Terminals)
SendOnlyDurable == \A slot \in Slots : s.message[slot].phase # "empty" =>
  s.message[slot].op \in s.durable /\ s.message[slot].body = s.batch[s.message[slot].op].body
  /\ (s.message[slot].kind = "cancel" => s.decision[s.message[slot].op] = "cancel"
      /\ s.message[slot].cancelRevision = s.cancelRevision[s.message[slot].op])
TerminalConservation == /\ s.sequence = Cardinality(Terminals)
  /\ s.revision = Cardinality(Terminals) + s.externalRevision
  /\ {s.batch[op].sequence : op \in Terminals} = 1..s.sequence
  /\ (\A op \in Operations : s.terminalWrites[op] = IF op \in Terminals THEN 1 ELSE 0)
ChargeOnce == /\ Cardinality(Charged) <= s.capacity
  /\ (\A op \in Operations :
      /\ s.metadataCharges[op] = IF s.operation[op] = "absent" THEN 0 ELSE 1
      /\ s.immutableCharges[op] = IF s.mode[op] = "reserved" THEN 1 ELSE 0)
CanonicalSafety == /\ s.heads = {op \in Operations : s.operation[op] = "committed"}
  /\ s.heads \subseteq s.objects
  /\ (\A op \in Operations :
      /\ (s.operation[op] = "pending" <=> s.pending = op)
      /\ (s.operation[op] = "committed" => s.terminalRevision[op] = s.batch[op].expectedRevision + 1)
      /\ (s.operation[op] = "abandoned" => s.terminalRevision[op] > s.batch[op].expectedRevision)
      /\ (s.mode[op] = "cancelled-before-reserve" => s.operation[op] = "abandoned" /\ op \notin s.objects))
ReadOnlyStatus == s.statusPure
Safety == FrozenUntilTerminal /\ SendOnlyDurable /\ TerminalConservation /\ ChargeOnce /\ CanonicalSafety /\ ReadOnlyStatus

NoCancelBeforeReserveWitness == ~s.lateReserve
NoHeldCancellationWitness == ~s.lateCommit
NoLostReplyRecoveryWitness == ~(s.recoveredExact /\ s.restartedAfterLoss /\ s.lost = {1} /\ s.retiredBy[1] = 1)
=============================================================================
