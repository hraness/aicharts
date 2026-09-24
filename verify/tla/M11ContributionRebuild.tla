----------------------- MODULE M11ContributionRebuild -----------------------
EXTENDS Naturals, FiniteSets

\* A bounded kernel protocol, not a refinement of JSON, SQL, R2 or the BigInt
\* fold. One-item chunks/pages expose the durable boundaries represented by
\* the implementation's sixteen-item envelopes. Identity tokens abstract full
\* immutable references; equal semantic cells need not have equal tokens.
\* Cutover admits the explicit, separately reviewed repair publication of a
\* fully compared job. UnsafeCutover removes only its anchor re-check.
CONSTANTS Sequential, WrongPublished, UnsafeQuota, UnsafeProof, UnsafeComparison,
  Cutover, UnsafeCutover
Jobs == IF Sequential THEN 1..2 ELSE {1}
Heads == 1..3
Cells == 1..2
Tokens == 1..6
Phases == {"absent", "building", "comparing", "match", "mismatch", "aborted", "published"}
Zero == [cell \in Cells |-> 0]
Fold(revision, prefix) == [cell \in Cells |->
  IF cell = 1 THEN IF prefix >= 1 THEN IF revision = 0 THEN 1 ELSE 3 ELSE 0
  ELSE IF prefix = 3 THEN 2 ELSE 0]
Published == [cell \in Cells |-> IF cell = 1 THEN 1 ELSE IF WrongPublished THEN 3 ELSE 2]
Live(head) == head # 2
Cost(head) == IF Live(head) THEN 1 ELSE 0
Token(job, head) == (job - 1) * 3 + head
EmptyJob == [phase |-> "absent", revision |-> 0, publication |-> 0, version |-> 0,
  cursor |-> 0, scratch |-> Zero, root |-> 0, compared |-> 0,
  charged |-> 0, pending |-> 0, lastExpected |-> 0]
EmptyReceipt == [job |-> 0, version |-> 0, phase |-> "absent", cursor |-> 0,
  compared |-> 0, scratch |-> Zero, charged |-> 0]
Receipt(job, value) == [job |-> job, version |-> value.version,
  phase |-> value.phase, cursor |-> value.cursor, compared |-> value.compared,
  scratch |-> value.scratch, charged |-> value.charged]
EmptyRun == [job |-> 0, version |-> 0, phase |-> "idle", head |-> 0,
  root |-> 0, scratch |-> Zero, owned |-> FALSE, proof |-> FALSE,
  compareOwned |-> FALSE, left |-> FALSE, right |-> FALSE,
  equal |-> FALSE, key |-> 0, epoch |-> 0]
EmptyProvider == [job |-> 0, head |-> 0, version |-> 0, epoch |-> 0, phase |-> "empty"]

VARIABLE s
Init == s = [job |-> [j \in Jobs |-> EmptyJob], receipt |-> [j \in Jobs |-> EmptyReceipt],
  allocated |-> 0, sourceRevision |-> 0, publication |-> 0, sourcePending |-> FALSE,
  authority |-> TRUE, evidence |-> TRUE, environment |-> "unchanged",
  sharedCharge |-> 0, reservations |-> {}, objects |-> {},
  run |-> EmptyRun, provider |-> EmptyProvider, epoch |-> 0,
  restarted |-> FALSE, lostReservation |-> FALSE, retriedPending |-> FALSE,
  committedRetry |-> FALSE, replayed |-> {}, replayPure |-> TRUE,
  heldReply |-> EmptyReceipt, delivered |-> FALSE, staleRefused |-> FALSE,
  heldAbort |-> FALSE, lateRejected |-> FALSE,
  rightFailed |-> FALSE, failedPrefix |-> 0, comparedAfterFailure |-> FALSE,
  forgedProof |-> FALSE, forgedComparison |-> FALSE,
  paired |-> [j \in Jobs |-> {}],
  published |-> Published, publishedBy |-> 0, publishedRevision |-> 0,
  unanchoredCutover |-> FALSE, replayedPublished |-> FALSE]

Active(job) == s.job[job].phase \in {"building", "comparing"}
Anchor(job) == s.authority /\ ~s.sourcePending
  /\ s.job[job].revision = s.sourceRevision
  /\ s.job[job].publication = s.publication
Current == s.run.job # 0 /\ Active(s.run.job)
  /\ s.run.version = s.job[s.run.job].version
  /\ s.run.epoch = s.epoch
Admitted == Current /\ Anchor(s.run.job)
PendingExact == s.job[s.run.job].pending = s.run.head
  /\ s.run.head = s.job[s.run.job].cursor + 1
Durable(value) == <<value.job, value.receipt, value.sharedCharge,
  value.reservations, value.objects, value.paired, value.published, value.publishedBy>>
ActiveJobs == {job \in Jobs : Active(job)}

\* Publication identity 2 is the root a mismatch cutover published; a later
\* job pins it exactly as the implementation pins the current root.
BeginJob == /\ s.authority /\ ~s.sourcePending
  /\ s.sourceRevision = 0 /\ s.publication \in {0, 2}
  /\ ActiveJobs = {} /\ s.allocated < Cardinality(Jobs)
  /\ LET j == s.allocated + 1
         value == [EmptyJob EXCEPT !.phase = "building", !.version = 1,
           !.revision = s.sourceRevision, !.publication = s.publication]
     IN s' = [s EXCEPT !.allocated = j, !.job[j] = value,
       !.receipt[j] = Receipt(j, value)]
StartStep(job) == /\ s.run.phase = "idle" /\ Active(job)
  /\ s' = [s EXCEPT !.run = [EmptyRun EXCEPT !.job = job,
    !.version = s.job[job].version, !.phase = "check", !.epoch = s.epoch]]
CheckStep == /\ s.run.phase = "check"
  /\ IF Admitted
    THEN s' = [s EXCEPT !.run.phase = IF s.job[s.run.job].phase = "building" THEN "head" ELSE "left"]
    ELSE s' = [s EXCEPT !.run.phase = "refused"]
ReadCommittedHead == /\ s.run.phase = "head"
  /\ IF ~Admitted \/ (~s.evidence /\ s.job[s.run.job].cursor + 1 = 3)
    THEN s' = [s EXCEPT !.run.phase = "refused"]
    ELSE LET j == s.run.job
             head == s.job[j].cursor + 1
         IN s' = [s EXCEPT !.run.head = head, !.run.phase = "planned", !.run.owned = TRUE,
           !.run.root = IF Live(head) THEN Token(j, head) ELSE s.job[j].root,
           !.run.scratch = Fold(s.job[j].revision, head)]
ReserveStage == /\ s.run.phase = "planned" /\ s.run.owned
  /\ IF ~Admitted
    THEN s' = [s EXCEPT !.run.phase = "refused"]
    ELSE LET j == s.run.job
             head == s.run.head
         IN IF s.job[j].pending # 0
           THEN IF PendingExact
             THEN s' = [s EXCEPT !.run.phase = "reserved",
               !.retriedPending = @ \/ (s.restarted /\ s.lostReservation)]
             ELSE s' = [s EXCEPT !.run.phase = "refused"]
           ELSE IF s.sharedCharge + Cost(head) <= 4
             THEN s' = [s EXCEPT !.job[j].pending = head,
               !.job[j].charged = @ + Cost(head),
               \* This mutant omits only the shared quota UPDATE; the job
               \* reservation and every ordinary continuation remain intact.
               !.sharedCharge = IF UnsafeQuota THEN @ ELSE @ + Cost(head),
               !.reservations = @ \cup {<<j, head>>}, !.run.phase = "reserved"]
             ELSE s' = [s EXCEPT !.run.phase = "refused"]
LoseReservationReply == /\ ~Sequential /\ ~s.lostReservation
  /\ s.run.phase = "reserved" /\ s.run.head = 1
  /\ s' = [s EXCEPT !.lostReservation = TRUE, !.run = EmptyRun]
Restart == /\ ~Sequential /\ ~s.restarted
  /\ (s.run.phase # "idle" \/ s.lostReservation)
  \* Durable state, raw provider effects and charges survive. Local checked
  \* plans/proofs and held response capabilities do not survive this boundary.
  /\ s' = [s EXCEPT !.run = EmptyRun, !.heldReply = EmptyReceipt,
    !.restarted = TRUE, !.epoch = 1]
DispatchPut == /\ s.run.phase = "reserved" /\ Live(s.run.head)
  /\ s.provider.phase = "empty"
  /\ IF Admitted /\ PendingExact
    THEN s' = [s EXCEPT !.provider = [job |-> s.run.job, head |-> s.run.head,
      version |-> s.run.version, epoch |-> s.run.epoch, phase |-> "held"], !.run.phase = "held"]
    ELSE s' = [s EXCEPT !.run.phase = "refused"]
EmptyStageProof == /\ s.run.phase = "reserved" /\ ~Live(s.run.head)
  /\ IF Admitted /\ PendingExact
    THEN s' = [s EXCEPT !.run.phase = "proof", !.run.proof = TRUE]
    ELSE s' = [s EXCEPT !.run.phase = "refused"]
ProviderReturns == /\ s.provider.phase = "held"
  \* Already dispatched immutable writes may finish after abort or retirement.
  /\ s' = [s EXCEPT !.objects = @ \cup {Token(s.provider.job, s.provider.head)},
    !.provider.phase = "returned"]
SameProvider == s.run.job = s.provider.job /\ s.run.head = s.provider.head
  /\ s.run.version = s.provider.version /\ s.run.epoch = s.provider.epoch
VerifyStoredStage == /\ s.run.phase = "held" /\ s.provider.phase = "returned" /\ SameProvider
  /\ IF Admitted /\ PendingExact
    THEN s' = [s EXCEPT !.run.phase = "proof", !.run.proof = TRUE, !.provider = EmptyProvider]
    ELSE s' = [s EXCEPT !.run.phase = "refused", !.provider = EmptyProvider,
      !.lateRejected = @ \/ (s.heldAbort /\ s.job[s.run.job].phase = "aborted")]
DiscardProviderTail == /\ s.provider.phase = "returned"
  /\ ~(s.run.phase = "held" /\ SameProvider)
  /\ s' = [s EXCEPT !.provider = EmptyProvider,
    !.lateRejected = @ \/ (s.heldAbort /\ s.job[s.provider.job].phase = "aborted")]
PresentUnverifiedProof == /\ ~s.forgedProof /\ s.run.phase = "reserved"
  /\ Live(s.run.head) /\ s.provider.phase = "empty"
  \* Adversarial kernel input has exact descriptor fields but no owned
  \* VerifiedContributionIndex capability. No provider effect is fabricated.
  /\ s' = [s EXCEPT !.run.phase = "proof", !.run.proof = FALSE, !.forgedProof = TRUE]
CommitHead == /\ s.run.phase = "proof" /\ s.run.owned
  /\ IF Admitted /\ PendingExact /\ (s.run.proof \/ UnsafeProof)
    THEN LET j == s.run.job
             value == [s.job[j] EXCEPT !.cursor = s.run.head, !.scratch = s.run.scratch,
               !.root = s.run.root, !.pending = 0, !.version = @ + 1,
               !.lastExpected = s.run.version,
               !.phase = IF s.run.head = 3 THEN "comparing" ELSE "building"]
         IN s' = [s EXCEPT !.job[j] = value, !.receipt[j] = Receipt(j, value),
           !.heldReply = Receipt(j, value), !.run = EmptyRun,
           !.committedRetry = @ \/ (s.retriedPending /\ s.run.head = 1)]
    ELSE s' = [s EXCEPT !.run.phase = "refused"]

ReadLeftPage == /\ s.run.phase = "left"
  /\ IF Admitted
    THEN s' = [s EXCEPT !.run.left = TRUE, !.run.key = s.job[s.run.job].compared + 1,
      !.run.phase = "right"]
    ELSE s' = [s EXCEPT !.run.phase = "refused"]
FailRightPage == /\ ~Sequential /\ ~s.rightFailed /\ s.run.phase = "right"
  /\ s.run.key = 2 /\ Admitted
  /\ s' = [s EXCEPT !.rightFailed = TRUE, !.failedPrefix = s.job[s.run.job].compared,
    !.run = EmptyRun]
ReadRightPage == /\ s.run.phase = "right"
  /\ IF Admitted
    THEN s' = [s EXCEPT !.run.right = TRUE, !.run.compareOwned = TRUE,
      !.run.equal = s.job[s.run.job].scratch[s.run.key] = s.published[s.run.key], !.run.phase = "comparison"]
    ELSE s' = [s EXCEPT !.run.phase = "refused"]
PresentUnownedComparison == /\ ~s.forgedComparison /\ s.run.phase = "left"
  /\ Admitted
  \* The caller retains a checked job but invents a complete comparison plan.
  \* Removing only comparisonPlans.has(plan) admits its remaining valid fields.
  /\ s' = [s EXCEPT !.run.key = 2, !.run.equal = TRUE,
    !.run.compareOwned = FALSE, !.run.phase = "comparison", !.forgedComparison = TRUE]
CommitComparison == /\ s.run.phase = "comparison"
  /\ IF Admitted /\ (s.run.compareOwned \/ UnsafeComparison)
    THEN LET j == s.run.job
             value == [s.job[j] EXCEPT !.version = @ + 1, !.lastExpected = s.run.version,
               !.compared = IF s.run.equal THEN s.run.key ELSE @,
               !.phase = IF ~s.run.equal THEN "mismatch" ELSE IF s.run.key = 2 THEN "match" ELSE "comparing"]
         IN s' = [s EXCEPT !.job[j] = value, !.receipt[j] = Receipt(j, value),
           !.paired[j] = IF s.run.left /\ s.run.right /\ s.run.equal THEN @ \cup {s.run.key} ELSE @,
           !.heldReply = Receipt(j, value), !.run = EmptyRun,
           !.comparedAfterFailure = @ \/ (s.rightFailed /\ s.run.key = 2)]
    ELSE s' = [s EXCEPT !.run.phase = "refused"]

AbortJob(job) == /\ s.authority /\ Active(job)
  /\ LET value == [s.job[job] EXCEPT !.phase = "aborted", !.version = @ + 1,
         !.lastExpected = s.job[job].version]
     IN s' = [s EXCEPT !.job[job] = value, !.receipt[job] = Receipt(job, value),
       !.heldAbort = @ \/ (s.provider.phase = "held" /\ s.provider.job = job)]
\* The compare-and-swap of a verified rebuild over the unchanged source
\* revision, projection frontiers, pending state and current root. It is a
\* distinct durable step with its own version; `advance` never reaches it.
\* No reservation or shared charge changes: the scratch root was charged
\* while it was built and the replaced root stays retained for cursors.
CutoverJob(job) == /\ Cutover /\ s.authority
  /\ s.job[job].phase \in {"match", "mismatch"}
  /\ (UnsafeCutover \/ Anchor(job))
  /\ LET value == [s.job[job] EXCEPT !.phase = "published", !.version = @ + 1,
         !.lastExpected = s.job[job].version]
     IN s' = [s EXCEPT !.job[job] = value, !.receipt[job] = Receipt(job, value),
       !.heldReply = Receipt(job, value), !.published = s.job[job].scratch,
       !.publishedBy = job, !.publishedRevision = s.job[job].revision,
       \* A repaired root is a new publication identity; a matching root is
       \* not, so other jobs pinned to it keep their anchor.
       !.publication = IF s.job[job].phase = "mismatch" THEN 2 ELSE s.publication,
       !.unanchoredCutover = @ \/ ~Anchor(job)]
RetireCall == /\ s.run.phase # "idle"
  /\ s' = [s EXCEPT !.run = EmptyRun]
ResetRefusal == /\ s.run.phase = "refused" /\ s' = [s EXCEPT !.run = EmptyRun]
ReplayLast(job) == /\ s.authority /\ s.job[job].lastExpected > 0 /\ job \notin s.replayed
  /\ LET next == [s EXCEPT !.replayed = @ \cup {job}, !.heldReply = s.receipt[job],
         !.replayedPublished = @ \/ s.receipt[job].phase = "published"]
     IN s' = [next EXCEPT !.replayPure = s.replayPure /\ Durable(next) = Durable(s)
       /\ next.heldReply = s.receipt[job]]
DeliverHeldReply == /\ s.heldReply.job # 0 /\ ~s.delivered
  /\ s' = [s EXCEPT !.delivered = TRUE]
RejectOlderVersion(job) == /\ s.authority /\ s.job[job].version >= 3 /\ ~s.staleRefused
  \* A version older than the single retained last request cannot start work.
  /\ s' = [s EXCEPT !.staleRefused = TRUE]

AdvanceSource == /\ ~Sequential /\ s.environment = "unchanged"
  /\ s' = [s EXCEPT !.sourceRevision = 1, !.environment = "source"]
ChangePublication == /\ ~Sequential /\ s.environment = "unchanged"
  /\ s' = [s EXCEPT !.publication = 1, !.environment = "publication"]
ReserveForeignSource == /\ ~Sequential /\ s.environment = "unchanged"
  /\ s' = [s EXCEPT !.sourcePending = TRUE, !.environment = "pending"]
RevokeAuthority == /\ ~Sequential /\ s.environment = "unchanged"
  /\ s' = [s EXCEPT !.authority = FALSE, !.environment = "authority"]
InvalidateHeadEvidence == /\ ~Sequential /\ s.environment = "unchanged"
  /\ s' = [s EXCEPT !.evidence = FALSE, !.environment = "evidence"]
\* Deliberate retained refusals/finite histories are not liveness failures.
Quiescent == /\ s.run.phase = "idle" /\ s.provider.phase = "empty" /\ UNCHANGED s
Next == BeginJob \/ CheckStep \/ ReadCommittedHead \/ ReserveStage \/ LoseReservationReply
  \/ Restart \/ DispatchPut \/ EmptyStageProof \/ ProviderReturns \/ VerifyStoredStage \/ DiscardProviderTail
  \/ PresentUnverifiedProof \/ CommitHead \/ ReadLeftPage \/ FailRightPage \/ ReadRightPage
  \/ PresentUnownedComparison \/ CommitComparison \/ RetireCall \/ ResetRefusal
  \/ DeliverHeldReply \/ AdvanceSource \/ ChangePublication \/ ReserveForeignSource \/ RevokeAuthority
  \/ InvalidateHeadEvidence \/ Quiescent
  \/ (\E job \in Jobs : StartStep(job) \/ AbortJob(job) \/ ReplayLast(job) \/ RejectOlderVersion(job)
    \/ CutoverJob(job))

TypeOK == /\ s.allocated \in 0..Cardinality(Jobs)
  /\ s.sourceRevision \in 0..1 /\ s.publication \in 0..2 /\ s.sharedCharge \in 0..4
  /\ s.objects \subseteq Tokens /\ s.reservations \subseteq (Jobs \X Heads)
  /\ s.epoch \in 0..1 /\ s.replayed \subseteq Jobs /\ s.failedPrefix \in 0..2
  /\ s.environment \in {"unchanged", "source", "publication", "pending", "authority", "evidence"}
  /\ s.run.job \in Jobs \cup {0} /\ s.provider.job \in Jobs \cup {0}
  /\ s.run.phase \in {"idle", "check", "head", "planned", "reserved", "held", "proof", "left", "right", "comparison", "refused"}
  /\ s.provider.phase \in {"empty", "held", "returned"}
  /\ (\A j \in Jobs : s.job[j].phase \in Phases /\ s.job[j].version \in 0..7
      /\ s.job[j].cursor \in 0..3 /\ s.job[j].compared \in 0..2
      /\ s.job[j].charged \in 0..2 /\ s.job[j].pending \in 0..3
      /\ s.job[j].root \in Tokens \cup {0} /\ s.paired[j] \subseteq Cells)
  /\ s.published \in [Cells -> 0..3] /\ s.publishedBy \in Jobs \cup {0} /\ s.publishedRevision \in 0..1
  /\ <<s.sourcePending, s.authority, s.evidence, s.restarted, s.lostReservation, s.retriedPending,
      s.committedRetry, s.replayPure, s.delivered, s.staleRefused, s.heldAbort, s.lateRejected,
      s.rightFailed, s.comparedAfterFailure, s.forgedProof, s.forgedComparison,
      s.unanchoredCutover, s.replayedPublished>> \in [1..18 -> BOOLEAN]

ChargedReservations == {pair \in s.reservations : Live(pair[2])}
Safety == /\ Cardinality(ActiveJobs) <= 1
  /\ s.sharedCharge = Cardinality(ChargedReservations)
  /\ s.replayPure
  /\ (\A job \in Jobs :
    /\ s.job[job].scratch = Fold(s.job[job].revision, s.job[job].cursor)
    /\ (s.job[job].root = 0 \/ s.job[job].root \in s.objects)
    /\ s.job[job].charged = Cardinality({pair \in ChargedReservations : pair[1] = job})
    /\ (s.job[job].pending # 0 => <<job, s.job[job].pending>> \in s.reservations)
    /\ (\A key \in 1..s.job[job].compared : key \in s.paired[job]
        /\ s.job[job].scratch[key] = s.published[key])
    /\ (s.job[job].phase = "match" => s.job[job].cursor = 3
        /\ s.job[job].compared = 2 /\ s.job[job].scratch = s.published)
    /\ (s.job[job].phase = "published" => s.job[job].cursor = 3
        /\ s.job[job].pending = 0 /\ s.publishedBy # 0)
    /\ (s.receipt[job].job # 0 => s.receipt[job].version = s.job[job].version
        /\ s.receipt[job].cursor = s.job[job].cursor /\ s.receipt[job].scratch = s.job[job].scratch))
  \* Cutover safety: never over a changed source revision, pending foreign
  \* reservation, drifted publication or revoked authority; the published
  \* cells always equal the complete verified scratch fold of a published
  \* job at the source revision it pinned, and nothing was charged again.
  /\ ~s.unanchoredCutover
  /\ (s.publishedBy # 0 => s.job[s.publishedBy].phase = "published"
    /\ s.published = s.job[s.publishedBy].scratch
    /\ s.published = Fold(s.publishedRevision, 3)
    /\ s.publishedRevision = s.job[s.publishedBy].revision
    /\ s.job[s.publishedBy].charged = Cardinality({pair \in ChargedReservations : pair[1] = s.publishedBy}))

NoPendingRecoveryWitness == ~(s.committedRetry /\ 1 \in s.replayed)
NoLateAbortWitness == ~(s.heldAbort /\ s.lateRejected /\ s.job[1].phase = "aborted"
  /\ Token(1, 1) \in s.objects /\ s.job[1].cursor = 0)
NoComparisonRetryWitness == ~(s.rightFailed /\ s.failedPrefix = 1 /\ s.comparedAfterFailure
  /\ s.job[1].phase = "mismatch" /\ s.job[1].compared = 1)
\* A mismatch repaired by cutover lets a later full rebuild match the repaired
\* publication; the retained publish receipt replays purely after delivery.
NoRepairMatchWitness == ~(s.publishedBy = 1 /\ s.job[1].compared = 1
  /\ s.job[2].phase = "match")
NoCutoverReplayWitness == ~(s.publishedBy = 1 /\ s.replayedPublished /\ s.replayPure
  /\ s.heldReply.phase = "published")
=============================================================================
