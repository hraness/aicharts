------------------------- MODULE M8StagedProjection -------------------------
EXTENDS Naturals, FiniteSets

\* A finite slice starts at a previously complete, published canonical root.
\* Revisions below are relative to that root, not account revision zero.
\* DeepReplay has two chunks per phase and one correction. The other slice
\* has one chunk per phase and two corrections, allowing publication to
\* overlap its successor, coalescing, and retained-reference pressure.
CONSTANTS DeepReplay, TightQuota, UnsafeRecharge, UnsafeEarlyApply,
  UnsafeEarlyPublish, UnsafeDrain

MaxRevision == IF DeepReplay THEN 1 ELSE 2
Items == IF DeepReplay THEN 2 ELSE 1
Steps == Items * 2
StepIds == (1..MaxRevision) \X (1..Steps)
NoStep == <<0, 0>>
Quota == IF TightQuota THEN Cardinality(StepIds) - 1 ELSE Cardinality(StepIds)
MaxTime == 3
PublishInterval == 1
RetireHorizon == 2
MaxReferences == 2
Infinity == MaxTime + RetireHorizon + 1
Cohorts == 1..2
EmptyRoot == [cohort \in Cohorts |-> 0]
Target(revision) == IF revision % 2 = 0 THEN 1 ELSE 2
Canonical(revision) == [cohort \in Cohorts |->
  IF cohort = Target(revision) THEN Items ELSE 0]
AtProgress(revision, progress) == [cohort \in Cohorts |->
  IF progress <= Items
    THEN IF cohort = Target(revision - 1) THEN Items - progress ELSE 0
    ELSE IF cohort = Target(revision) THEN progress - Items ELSE 0]

VARIABLE s
Init == s = [applied |-> 0, appliedRoot |-> Canonical(0),
  published |-> 0, stage |-> 0, progress |-> 0, stageRoot |-> EmptyRoot,
  pending |-> NoStep, charged |-> {}, bytes |-> 0, objects |-> {},
  mode |-> "idle", live |-> {}, closed |-> FALSE, drained |-> FALSE,
  appliedAtClose |-> MaxRevision + 1, now |-> 0, lastPublishedAt |-> 0,
  references |-> {0}, roots |-> [revision \in 0..MaxRevision |-> Canonical(0)],
  expiry |-> [revision \in 0..MaxRevision |-> Infinity],
  everPublished |-> {0}, lostAck |-> FALSE, restarted |-> FALSE,
  retried |-> FALSE, intentReady |-> FALSE, badInterval |-> FALSE, publishedWhileWaiting |-> FALSE]

Worker == "worker" \in s.live
Publisher == "publisher" \in s.live
Ready == Worker /\ s.mode = "ready"
Position == <<s.stage, s.progress + 1>>
LiveReferences == {revision \in s.references :
  revision = s.published \/ s.expiry[revision] > s.now}
Authorized(revision) == revision \in LiveReferences

RegisterWorker == /\ ~s.closed /\ s.mode = "idle" /\ ~Worker
  /\ s' = [s EXCEPT !.live = @ \cup {"worker"}, !.mode = "ready",
    !.retried = FALSE, !.intentReady = FALSE]
RegisterPublisher == /\ ~s.closed /\ ~Publisher
  /\ s' = [s EXCEPT !.live = @ \cup {"publisher"}]
SettleWorker == /\ Worker /\ s.mode \in {"ready", "verified", "failed"}
  \* A failed or deliberately abandoned invocation has no later canonical
  \* callback. Waiting work cannot settle merely because time passed.
  /\ s' = [s EXCEPT !.live = @ \ {"worker"}, !.mode = "idle", !.intentReady = FALSE]
SettlePublisher == /\ Publisher
  /\ s' = [s EXCEPT !.live = @ \ {"publisher"}]
Close == /\ ~s.closed
  /\ s' = [s EXCEPT !.closed = TRUE, !.appliedAtClose = s.applied]
Drain == /\ s.closed /\ ~s.drained
  /\ (s.live = {} \/ UnsafeDrain)
  /\ s' = [s EXCEPT !.drained = TRUE]
AdvanceClock == /\ s.now < MaxTime /\ s' = [s EXCEPT !.now = @ + 1]

BeginRevision == /\ Ready /\ s.stage = 0 /\ s.applied < MaxRevision
  /\ s' = [s EXCEPT !.stage = s.applied + 1, !.progress = 0,
    !.stageRoot = s.appliedRoot]
Reserve == /\ Ready /\ s.stage # 0 /\ s.progress < Steps
  /\ s.pending = NoStep /\ s.bytes < Quota
  /\ s' = [s EXCEPT !.pending = Position, !.charged = @ \cup {Position},
    !.bytes = @ + 1, !.retried = FALSE, !.intentReady = TRUE]
ReserveAgain == /\ Ready /\ s.pending = Position /\ ~s.retried
  /\ s' = [s EXCEPT !.retried = TRUE, !.intentReady = TRUE,
    !.bytes = IF UnsafeRecharge THEN @ + 1 ELSE @]
DispatchPut == /\ Ready /\ s.pending = Position /\ s.intentReady
  /\ s' = [s EXCEPT !.mode = "waiting"]
PutAndVerify == /\ Worker /\ s.mode = "waiting"
  /\ s' = [s EXCEPT !.objects = @ \cup {s.pending}, !.mode = "verified"]
LosePutAcknowledgement == /\ Worker /\ s.mode = "waiting" /\ ~s.lostAck
  \* Exact immutable bytes exist, but this invocation will not commit SQL.
  /\ s' = [s EXCEPT !.objects = @ \cup {s.pending}, !.mode = "failed",
    !.lostAck = TRUE]
Restart == /\ s.mode = "idle" /\ s.pending # NoStep /\ s.lostAck /\ ~s.restarted
  \* An ordinary new controller instance loses only volatile caches. The
  \* prior invocation settled explicitly; this is not force-drain of a crash.
  /\ s' = [s EXCEPT !.restarted = TRUE]
CommitChunk == /\ Worker /\ s.mode = "verified" /\ s.pending = Position
  /\ s.pending \in s.objects
  /\ s' = [s EXCEPT !.stageRoot = AtProgress(s.stage, s.progress + 1),
    !.progress = @ + 1, !.pending = NoStep, !.mode = "ready", !.intentReady = FALSE]
ApplyRevision == /\ Ready /\ s.stage # 0 /\ s.pending = NoStep
  /\ (s.progress = Steps \/ (UnsafeEarlyApply /\ s.progress > 0))
  /\ s' = [s EXCEPT !.applied = s.stage, !.appliedRoot = s.stageRoot,
    !.stage = 0, !.progress = 0, !.stageRoot = EmptyRoot]
Publish == /\ (Publisher \/ Ready) /\ s.applied > s.published
  /\ (s.now >= s.lastPublishedAt + PublishInterval \/ UnsafeEarlyPublish)
  /\ Cardinality(LiveReferences) < MaxReferences
  /\ s' = [s EXCEPT !.published = s.applied,
    !.references = LiveReferences \cup {s.applied},
    !.roots[s.applied] = s.appliedRoot,
    !.expiry[s.published] = s.now + RetireHorizon,
    !.expiry[s.applied] = Infinity, !.lastPublishedAt = s.now,
    !.everPublished = @ \cup {s.applied},
    !.badInterval = @ \/ s.now < s.lastPublishedAt + PublishInterval,
    !.publishedWhileWaiting = @ \/ s.mode = "waiting"]
Terminal == /\ (s.drained \/ (s.applied = MaxRevision /\ s.published = MaxRevision /\ s.live = {}))
  /\ UNCHANGED s
Next == RegisterWorker \/ RegisterPublisher \/ SettleWorker \/ SettlePublisher
  \/ Close \/ Drain \/ AdvanceClock \/ BeginRevision \/ Reserve \/ ReserveAgain
  \/ DispatchPut \/ PutAndVerify \/ LosePutAcknowledgement \/ Restart
  \/ CommitChunk \/ ApplyRevision \/ Publish \/ Terminal

TypeOK == /\ s.applied \in 0..MaxRevision /\ s.published \in 0..MaxRevision
  /\ s.stage \in 0..MaxRevision /\ s.progress \in 0..Steps
  /\ s.appliedRoot \in [Cohorts -> 0..Items]
  /\ s.stageRoot \in [Cohorts -> 0..Items]
  /\ s.pending \in StepIds \cup {NoStep} /\ s.charged \subseteq StepIds
  /\ s.objects \subseteq StepIds /\ s.bytes \in 0..(2 * Cardinality(StepIds))
  /\ s.mode \in {"idle", "ready", "waiting", "verified", "failed"}
  /\ s.live \subseteq {"worker", "publisher"}
  /\ s.appliedAtClose \in 0..(MaxRevision + 1) /\ s.now \in 0..MaxTime
  /\ s.lastPublishedAt \in 0..MaxTime /\ s.references \subseteq 0..MaxRevision
  /\ s.everPublished \subseteq 0..MaxRevision
  /\ s.roots \in [0..MaxRevision -> [Cohorts -> 0..Items]]
  /\ s.expiry \in [0..MaxRevision -> 0..Infinity]
  /\ <<s.closed, s.drained, s.lostAck, s.restarted, s.retried, s.intentReady,
    s.badInterval, s.publishedWhileWaiting>> \in [1..8 -> BOOLEAN]
Safety == /\ s.published <= s.applied
  /\ s.appliedRoot = Canonical(s.applied)
  /\ (IF s.stage = 0 THEN s.progress = 0 /\ s.stageRoot = EmptyRoot
      ELSE s.stage = s.applied + 1 /\ s.stageRoot = AtProgress(s.stage, s.progress))
  /\ (s.pending # NoStep => s.pending = Position /\ s.pending \in s.charged)
  /\ s.bytes = Cardinality(s.charged) /\ s.bytes <= Quota
  /\ s.objects \subseteq s.charged
  /\ (s.mode = "idle" <=> ~Worker)
  /\ (s.intentReady => s.pending # NoStep /\ Worker)
  /\ (s.mode \in {"waiting", "verified", "failed"} => s.intentReady)
  /\ (s.mode = "verified" => s.pending \in s.objects)
  /\ (s.drained => s.closed /\ s.live = {} /\ s.mode = "idle")
  /\ Cardinality(s.references) <= MaxReferences
  /\ s.published \in s.references /\ s.expiry[s.published] = Infinity
  /\ s.references \subseteq s.everPublished
  /\ (\A revision \in s.references :
    s.roots[revision] = Canonical(revision) /\ revision <= s.published)
  /\ (\A revision \in s.references \ {s.published} :
    s.expiry[revision] < Infinity)
  /\ ~s.badInterval

NoSuccessWitness == s.published = 0
NoRecoveryWitness == ~(s.lostAck /\ s.restarted /\ s.stage = 0
  /\ s.pending = NoStep /\ s.applied = MaxRevision)
NoCoalescingWitness == ~(s.published = 2 /\ 1 \notin s.everPublished)
NoRetentionWaitWitness == ~(s.applied > s.published
  /\ s.now >= s.lastPublishedAt + PublishInterval
  /\ Cardinality(LiveReferences) = MaxReferences)
NoExpiryWitness == ~(s.published = 2 /\ 0 \notin s.references /\ 1 \in s.references)
NoConcurrentPublicationWitness == ~s.publishedWhileWaiting
NoCloseDrainWitness == ~(s.drained /\ s.applied > s.appliedAtClose)
NoCapacityRefusalWitness == ~(Ready /\ s.stage # 0 /\ s.progress < Steps
  /\ s.pending = NoStep /\ s.bytes = Quota)
=============================================================================
