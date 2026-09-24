--------------------------- MODULE M9AccountWork ---------------------------
EXTENDS Naturals, FiniteSets

\* Two finite scheduling slices, not an implementation refinement. HeldSlice
\* has consent plus two successive projection positions. RecoverySlice has
\* two executions at one position, including restart and an old capability.
CONSTANTS RecoverySlice, UnsafeEarlyRelease, UnsafeCompletionArm, UnsafeABA

Classes == {"consent", "projection"}
Handlers == 1..2
Jobs == IF RecoverySlice THEN 1..2 ELSE 1..3
JobClass(job) == IF ~RecoverySlice /\ job = 1 THEN "consent" ELSE "projection"
JobOwner(job) == IF RecoverySlice THEN job ELSE IF job <= 2 THEN 1 ELSE 2
Owned(handler) == {job \in Jobs : JobOwner(job) = handler}
Target(kind) == IF kind = "consent" THEN IF RecoverySlice THEN 0 ELSE 1
  ELSE IF RecoverySlice THEN 1 ELSE 2
Phases == {"fresh", "claimed", "pending", "returned", "failed", "advanced",
  "finished", "lost_pending", "lost_done"}

VARIABLE s
Init == s = [position |-> [kind \in Classes |-> 0],
  flight |-> [kind \in Classes |-> 0],
  flightState |-> [kind \in Classes |-> "none"],
  marker |-> [kind \in Classes |-> 0],
  attempts |-> [kind \in Classes |-> 0],
  phase |-> [job \in Jobs |-> "fresh"],
  capturedKey |-> [job \in Jobs |-> 0],
  capturedAttempt |-> [job \in Jobs |-> 0],
  wake |-> TRUE, watchDue |-> {}, handler |-> 0, allocated |-> 0,
  handlerStage |-> "idle", handlerDone |-> {}, leases |-> {}, abandoned |-> {},
  closed |-> FALSE, drained |-> FALSE, restarted |-> FALSE,
  resumed |-> FALSE, staleRejected |-> FALSE, staleCleared |-> FALSE,
  armFailed |-> FALSE, lateCompleted |-> FALSE]

Pending(kind) == s.position[kind] < Target(kind)
Eligible(kind) == Pending(kind) /\ s.flight[kind] = 0
ReadyJobs(handler) == {job \in Owned(handler) : Eligible(JobClass(job))}
AnyEligible == \E kind \in Classes : Eligible(kind)
Current(job) == s.flight[JobClass(job)] = job
Callable(job) == Current(job) /\ s.marker[JobClass(job)] = job
ActualDone(job) == s.phase[job] \in {"finished", "lost_done"}

\* Only the one current alarm handler consumes the replaceable wake. The
\* watchdog-only handler below has no provider work and is one atomic turn.
StartHandler == /\ ~s.closed /\ s.handler = 0 /\ s.wake
  /\ s.allocated < 2 /\ ReadyJobs(s.allocated + 1) # {}
  /\ s' = [s EXCEPT !.handler = s.allocated + 1, !.allocated = @ + 1,
    !.handlerStage = "claim", !.wake = FALSE,
    !.leases = @ \cup {s.allocated + 1}]
ClaimJobs == /\ s.handler # 0 /\ s.handlerStage = "claim"
  /\ LET selected == ReadyJobs(s.handler)
         kinds == {JobClass(job) : job \in selected}
     IN /\ selected # {}
        \* The successful alarm arm precedes the synchronous claim. No
        \* external await follows the successful arm before that SQL turn.
        /\ s' = [s EXCEPT !.wake = TRUE, !.handlerStage = "dispatch",
          !.flight = [kind \in Classes |-> IF kind \in kinds
            THEN CHOOSE job \in selected : JobClass(job) = kind ELSE s.flight[kind]],
          !.flightState = [kind \in Classes |-> IF kind \in kinds THEN "running" ELSE s.flightState[kind]],
          !.marker = [kind \in Classes |-> IF kind \in kinds
            THEN CHOOSE job \in selected : JobClass(job) = kind ELSE s.marker[kind]],
          !.attempts = [kind \in Classes |-> IF kind \in kinds THEN s.attempts[kind] + 1 ELSE s.attempts[kind]],
          !.phase = [job \in Jobs |-> IF job \in selected THEN "claimed" ELSE s.phase[job]],
          !.capturedKey = [job \in Jobs |-> IF job \in selected THEN s.position[JobClass(job)] ELSE s.capturedKey[job]],
          !.capturedAttempt = [job \in Jobs |-> IF job \in selected THEN s.attempts[JobClass(job)] + 1 ELSE s.capturedAttempt[job]]]
Dispatch(job) == /\ s.phase[job] = "claimed" /\ Callable(job)
  /\ JobOwner(job) \in s.leases
  /\ s' = [s EXCEPT !.phase[job] = "pending"]
YieldHandler == /\ s.handler # 0 /\ s.handlerStage = "dispatch"
  /\ (\A job \in Owned(s.handler) : s.phase[job] # "claimed")
  /\ s' = [s EXCEPT !.handlerDone = @ \cup {s.handler},
    !.handler = 0, !.handlerStage = "idle"]

ProviderReturns(job) == /\ s.phase[job] = "pending"
  /\ s' = [s EXCEPT !.phase[job] = "returned"]
ProviderFails(job) == /\ RecoverySlice /\ s.phase[job] = "pending"
  /\ s' = [s EXCEPT !.phase[job] = "failed"]
CommitProjection(job) == /\ JobClass(job) = "projection"
  /\ s.phase[job] = "returned" /\ Callable(job)
  /\ s.capturedKey[job] = s.position["projection"]
  /\ s.position["projection"] < Target("projection")
  \* Canonical progress also arms first. The work position changes while
  \* the independent persisted flight identity and original custody remain.
  /\ s' = [s EXCEPT !.wake = TRUE, !.position["projection"] = @ + 1,
    !.attempts["projection"] = 0, !.phase[job] = "advanced"]
CompleteJob(job) == /\ Callable(job)
  /\ (s.phase[job] \in {"advanced", "failed"}
      \/ (JobClass(job) = "consent" /\ s.phase[job] = "returned"))
  /\ LET kind == JobClass(job)
     IN s' = [s EXCEPT
       \* The mutant removes just this checked pre-completion arm.
       !.wake = IF UnsafeCompletionArm THEN @ ELSE TRUE,
       !.position[kind] = IF kind = "consent" /\ s.phase[job] = "returned"
         THEN @ + 1 ELSE @,
       !.flight[kind] = 0, !.flightState[kind] = "none", !.marker[kind] = 0,
       !.watchDue = @ \ {kind}, !.phase[job] = "finished",
       !.lateCompleted = @ \/ (kind = "consent" /\ s.flightState[kind] = "awaiting")]
FailCompletionArm(job) == /\ RecoverySlice /\ Callable(job)
  /\ s.phase[job] = "failed" /\ s.flightState[JobClass(job)] = "awaiting"
  /\ ~s.wake
  \* The actual provider and callback have settled, so external custody can
  \* end, but the durable flight remains a visible repair obligation.
  /\ s' = [s EXCEPT !.phase[job] = "finished",
    !.marker[JobClass(job)] = 0, !.armFailed = TRUE]

Tick == /\ (\E kind \in Classes : s.flightState[kind] = "running" /\ kind \notin s.watchDue)
  /\ s' = [s EXCEPT !.watchDue = @ \cup {kind \in Classes : s.flightState[kind] = "running"}]
Watchdog(kind) == /\ ~s.closed /\ s.handler = 0 /\ s.wake /\ kind \in s.watchDue
  /\ s.flightState[kind] = "running"
  /\ s' = [s EXCEPT !.flightState[kind] = "awaiting", !.watchDue = @ \ {kind},
    !.wake = AnyEligible \/ (\E other \in Classes \ {kind} : s.flightState[other] = "running")]

Restart == /\ RecoverySlice /\ ~s.restarted
  /\ (\E kind \in Classes : s.flight[kind] # 0)
  /\ (\E job \in Jobs : s.phase[job] = "pending")
  \* Losing local callbacks never clears the independent durable flight,
  \* wake, or restore holder. A remote operation may still finish afterwards.
  /\ s' = [s EXCEPT !.restarted = TRUE, !.handler = 0, !.handlerStage = "idle",
    !.abandoned = @ \cup s.leases, !.marker = [kind \in Classes |-> 0],
    !.phase = [job \in Jobs |-> IF s.phase[job] = "pending" THEN "lost_pending"
      ELSE IF s.phase[job] \in {"claimed", "returned", "failed", "advanced"}
        THEN "lost_done" ELSE s.phase[job]]]
LostProviderReturns(job) == /\ s.phase[job] = "lost_pending"
  /\ s' = [s EXCEPT !.phase[job] = "lost_done"]
ExplicitResume(kind) == /\ RecoverySlice /\ ~s.resumed /\ ~s.closed
  /\ s.flightState[kind] = "awaiting" /\ s.marker[kind] = 0
  /\ s' = [s EXCEPT !.resumed = TRUE, !.wake = TRUE,
    !.flight[kind] = 0, !.flightState[kind] = "none",
    !.attempts[kind] = 0, !.watchDue = @ \ {kind}]
ReplayOldCapability(job) == /\ RecoverySlice /\ s.resumed /\ ~s.restarted
  /\ ~s.staleRejected /\ ~s.staleCleared
  /\ ActualDone(job) /\ s.capturedAttempt[job] > 0
  /\ LET kind == JobClass(job)
         replacement == s.flight[kind]
     IN /\ replacement # 0 /\ replacement # job
        /\ s.capturedKey[job] = s.capturedKey[replacement]
        /\ s.capturedAttempt[job] = s.capturedAttempt[replacement]
        \* This adversarial duplicate retains a formerly owned capability
        \* after a failed completion arm. A restart cannot resurrect callbacks.
        /\ IF UnsafeABA
          THEN s' = [s EXCEPT !.flight[kind] = 0, !.flightState[kind] = "none",
            !.watchDue = @ \ {kind}, !.staleCleared = TRUE]
          ELSE s' = [s EXCEPT !.staleRejected = TRUE]

ReleaseLease(handler) == /\ handler \in s.leases /\ handler \in s.handlerDone
  /\ handler \notin s.abandoned
  /\ (UnsafeEarlyRelease \/ \A job \in Owned(handler) : s.phase[job] \in {"fresh", "finished"})
  /\ s' = [s EXCEPT !.leases = @ \ {handler}]
Close == /\ ~s.closed /\ s' = [s EXCEPT !.closed = TRUE]
Drain == /\ s.closed /\ ~s.drained /\ s.leases = {}
  /\ s' = [s EXCEPT !.drained = TRUE]
\* Finite-prefix exhaustion and deliberate repair stops are observable states,
\* not deadlocks or claims of eventual service. No fairness is assumed.
Quiescent == /\ s.handler = 0 /\ UNCHANGED s
Next == StartHandler \/ ClaimJobs \/ YieldHandler \/ Tick \/ Restart \/ Close \/ Drain \/ Quiescent
  \/ (\E job \in Jobs : Dispatch(job) \/ ProviderReturns(job) \/ ProviderFails(job)
    \/ CommitProjection(job) \/ CompleteJob(job) \/ FailCompletionArm(job)
    \/ LostProviderReturns(job) \/ ReplayOldCapability(job))
  \/ (\E kind \in Classes : Watchdog(kind) \/ ExplicitResume(kind))
  \/ (\E handler \in Handlers : ReleaseLease(handler))

TypeOK == /\ s.position \in [Classes -> 0..2]
  /\ s.flight \in [Classes -> Jobs \cup {0}]
  /\ s.marker \in [Classes -> Jobs \cup {0}]
  /\ s.flightState \in [Classes -> {"none", "running", "awaiting"}]
  /\ s.attempts \in [Classes -> 0..2]
  /\ s.phase \in [Jobs -> Phases]
  /\ s.capturedKey \in [Jobs -> 0..2]
  /\ s.capturedAttempt \in [Jobs -> 0..2]
  /\ s.watchDue \subseteq Classes /\ s.handler \in 0..2 /\ s.allocated \in 0..2
  /\ s.handlerStage \in {"idle", "claim", "dispatch"}
  /\ s.handlerDone \subseteq Handlers /\ s.leases \subseteq Handlers /\ s.abandoned \subseteq Handlers
  /\ <<s.wake, s.closed, s.drained, s.restarted, s.resumed, s.staleRejected,
    s.staleCleared, s.armFailed, s.lateCompleted>> \in [1..9 -> BOOLEAN]
Safety ==
  /\ (\A kind \in Classes :
        /\ s.position[kind] <= Target(kind)
        /\ (s.flight[kind] = 0 <=> s.flightState[kind] = "none")
        /\ (s.flight[kind] # 0 => JobClass(s.flight[kind]) = kind)
        /\ (s.marker[kind] # 0 => s.marker[kind] = s.flight[kind])
        /\ (Eligible(kind) \/ s.flightState[kind] = "running" => s.wake \/ s.handler # 0)
        /\ (kind \in s.watchDue => s.flightState[kind] = "running"))
  /\ (\A job \in Jobs :
        /\ (s.phase[job] \notin {"fresh", "finished"} => JobOwner(job) \in s.leases)
        /\ (s.phase[job] # "fresh" => s.capturedAttempt[job] > 0)
        /\ (s.phase[job] \in {"claimed", "pending", "returned", "failed", "advanced"} => Callable(job)))
  /\ (s.handler # 0 => s.handler \in s.leases)
  /\ (s.handler = 0 <=> s.handlerStage = "idle")
  /\ (s.drained => s.closed /\ s.leases = {} /\ s.handler = 0)
  /\ ~s.staleCleared

NoIndependentProgressWitness == RecoverySlice \/ ~(s.position["projection"] = 2
  /\ s.flight["projection"] = 0 /\ s.phase[1] = "pending" /\ 1 \in s.leases)
NoWatchdogWitness == RecoverySlice \/ ~(s.position["projection"] = 2
  /\ s.phase[1] = "pending" /\ s.flightState["consent"] = "awaiting" /\ ~s.wake)
NoLateSettlementWitness == RecoverySlice \/ ~(s.lateCompleted /\ s.drained
  /\ s.position["consent"] = 1 /\ s.position["projection"] = 2)
NoRecoveryWitness == ~RecoverySlice \/ ~(s.restarted /\ s.resumed
  /\ s.position["projection"] = 1 /\ s.flight["projection"] = 0
  /\ s.phase[1] = "lost_done" /\ s.abandoned # {} /\ s.abandoned \subseteq s.leases)
NoArmRefusalWitness == ~RecoverySlice \/ ~(s.armFailed /\ ~s.wake
  /\ s.flightState["projection"] = "awaiting" /\ s.marker["projection"] = 0
  /\ s.leases = {})
=============================================================================
