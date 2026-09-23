----------------------------- MODULE M1Restore -----------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Ops, ExpireLeases, UnfencedMaintenance
VARIABLES clock, epoch, phase, leases, stage, capturedEpoch, drainClaim,
          restored, objects, publications, orphans, lateSQL, maintenance,
          unfencedWrite, settledGood, orphanWitness

vars == <<clock, epoch, phase, leases, stage, capturedEpoch, drainClaim,
          restored, objects, publications, orphans, lateSQL, maintenance,
          unfencedWrite, settledGood, orphanWitness>>
Stages == {"idle", "acquired", "provider", "sql-ready", "committed", "tail", "settled"}
CanStillCommit == {o \in Ops : stage[o] \in {"acquired", "provider", "sql-ready"}}

Init == /\ clock = 0 /\ epoch = 0 /\ phase = "open" /\ leases = {}
        /\ stage = [o \in Ops |-> "idle"] /\ capturedEpoch = [o \in Ops |-> 0]
        /\ drainClaim = FALSE /\ restored = FALSE /\ objects = {}
        /\ publications = {} /\ orphans = {} /\ lateSQL = FALSE
        /\ maintenance = "idle" /\ unfencedWrite = FALSE
        /\ settledGood = {} /\ orphanWitness = FALSE

Acquire(o) ==
    /\ phase = "open" /\ epoch = 0 /\ clock = 0 /\ stage[o] = "idle"
    /\ leases' = leases \cup {o} /\ stage' = [stage EXCEPT ![o] = "acquired"]
    /\ capturedEpoch' = [capturedEpoch EXCEPT ![o] = epoch]
    /\ UNCHANGED <<clock, epoch, phase, drainClaim, restored, objects,
                   publications, orphans, lateSQL, maintenance, unfencedWrite,
                   settledGood, orphanWitness>>

Dispatch(o) ==
    /\ stage[o] = "acquired" /\ stage' = [stage EXCEPT ![o] = "provider"]
    /\ UNCHANGED <<clock, epoch, phase, leases, capturedEpoch, drainClaim,
                   restored, objects, publications, orphans, lateSQL,
                   maintenance, unfencedWrite, settledGood, orphanWitness>>

ProviderReturns(o) ==
    /\ stage[o] = "provider"
    /\ objects' = objects \cup {o} /\ stage' = [stage EXCEPT ![o] = "sql-ready"]
    /\ UNCHANGED <<clock, epoch, phase, leases, capturedEpoch, drainClaim,
                   restored, publications, orphans, lateSQL, maintenance,
                   unfencedWrite, settledGood, orphanWitness>>

\* The captured account transaction observation has no current external fence.
SQLCommit(o) ==
    /\ stage[o] = "sql-ready"
    /\ publications' = publications \cup {o}
    /\ lateSQL' = (lateSQL \/ capturedEpoch[o] < epoch)
    /\ stage' = [stage EXCEPT ![o] = "committed"]
    /\ UNCHANGED <<clock, epoch, phase, leases, capturedEpoch, drainClaim,
                   restored, objects, orphans, maintenance, unfencedWrite,
                   settledGood, orphanWitness>>

Release(o) ==
    /\ stage[o] = "committed"
    /\ leases' = leases \ {o} /\ stage' = [stage EXCEPT ![o] = "settled"]
    /\ settledGood' = settledGood \cup {o}
    /\ UNCHANGED <<clock, epoch, phase, capturedEpoch, drainClaim, restored,
                   objects, publications, orphans, lateSQL, maintenance,
                   unfencedWrite, orphanWitness>>

\* An explicit environmental settlement contract, NOT a baseline cancellation
\* API: all future canonical continuations have irreversibly been removed.
SettleWithoutContinuation(o) ==
    /\ stage[o] = "provider"
    /\ stage' = [stage EXCEPT ![o] = "tail"] /\ leases' = leases \ {o}
    /\ UNCHANGED <<clock, epoch, phase, capturedEpoch, drainClaim, restored,
                   objects, publications, orphans, lateSQL, maintenance,
                   unfencedWrite, settledGood, orphanWitness>>

LateImmutableOrphan(o) ==
    /\ stage[o] = "tail"
    /\ objects' = objects \cup {o} /\ orphans' = orphans \cup {o}
    /\ stage' = [stage EXCEPT ![o] = "settled"]
    /\ orphanWitness' = (orphanWitness \/ capturedEpoch[o] < epoch)
    /\ UNCHANGED <<clock, epoch, phase, leases, capturedEpoch, drainClaim,
                   restored, publications, lateSQL, maintenance,
                   unfencedWrite, settledGood>>

AdvanceClock ==
    /\ clock < 2 /\ clock' = clock + 1
    /\ UNCHANGED <<epoch, phase, leases, stage, capturedEpoch, drainClaim,
                   restored, objects, publications, orphans, lateSQL,
                   maintenance, unfencedWrite, settledGood, orphanWitness>>

\* Every granted lease has deadline 1. Expiration does not stop a continuation.
Expire ==
    /\ ExpireLeases /\ clock >= 1 /\ leases # {} /\ leases' = {}
    /\ UNCHANGED <<clock, epoch, phase, stage, capturedEpoch, drainClaim,
                   restored, objects, publications, orphans, lateSQL,
                   maintenance, unfencedWrite, settledGood, orphanWitness>>

Close ==
    /\ epoch = 0 /\ phase = "open" /\ phase' = "closed"
    /\ UNCHANGED <<clock, epoch, leases, stage, capturedEpoch, drainClaim,
                   restored, objects, publications, orphans, lateSQL,
                   maintenance, unfencedWrite, settledGood, orphanWitness>>

ObserveDrain ==
    /\ phase = "closed" /\ leases = {} /\ ~drainClaim /\ drainClaim' = TRUE
    /\ UNCHANGED <<clock, epoch, phase, leases, stage, capturedEpoch, restored,
                   objects, publications, orphans, lateSQL, maintenance,
                   unfencedWrite, settledGood, orphanWitness>>

Restore ==
    /\ phase = "closed" /\ drainClaim /\ ~restored /\ restored' = TRUE
    /\ UNCHANGED <<clock, epoch, phase, leases, stage, capturedEpoch, drainClaim,
                   objects, publications, orphans, lateSQL, maintenance,
                   unfencedWrite, settledGood, orphanWitness>>

PublishEpoch ==
    /\ phase = "closed" /\ drainClaim /\ restored /\ leases = {}
    /\ epoch' = 1 /\ phase' = "open"
    /\ UNCHANGED <<clock, leases, stage, capturedEpoch, drainClaim, restored,
                   objects, publications, orphans, lateSQL, maintenance,
                   unfencedWrite, settledGood, orphanWitness>>

StartUnfencedMaintenance ==
    /\ UnfencedMaintenance /\ maintenance = "idle"
    /\ phase = "closed" /\ maintenance' = "started"
    /\ UNCHANGED <<clock, epoch, phase, leases, stage, capturedEpoch, drainClaim,
                   restored, objects, publications, orphans, lateSQL,
                   unfencedWrite, settledGood, orphanWitness>>

UnfencedPersistentWrite ==
    /\ maintenance = "started" /\ maintenance' = "done" /\ unfencedWrite' = TRUE
    /\ UNCHANGED <<clock, epoch, phase, leases, stage, capturedEpoch, drainClaim,
                   restored, objects, publications, orphans, lateSQL,
                   settledGood, orphanWitness>>

\* Only a genuinely quiescent completed recovery may stutter. Pending work
\* has a modeled next action; TLC's deadlock check remains enabled.
Terminal ==
    /\ epoch = 1 /\ \A o \in Ops : stage[o] \in {"idle", "settled"}
    /\ maintenance # "started" /\ UNCHANGED vars

Next == (\E o \in Ops : Acquire(o) \/ Dispatch(o) \/ ProviderReturns(o)
          \/ SQLCommit(o) \/ Release(o) \/ SettleWithoutContinuation(o)
          \/ LateImmutableOrphan(o))
        \/ AdvanceClock \/ Expire \/ Close \/ ObserveDrain \/ Restore
        \/ PublishEpoch \/ StartUnfencedMaintenance \/ UnfencedPersistentWrite
        \/ Terminal

TypeOK == /\ clock \in 0..2 /\ epoch \in 0..1 /\ phase \in {"open", "closed"}
          /\ leases \subseteq Ops /\ stage \in [Ops -> Stages]
          /\ capturedEpoch \in [Ops -> 0..1]
          /\ objects \subseteq Ops /\ publications \subseteq Ops /\ orphans \subseteq Ops
          /\ settledGood \subseteq Ops /\ maintenance \in {"idle", "started", "done"}
          /\ <<drainClaim, restored, lateSQL, unfencedWrite, orphanWitness>> \in [1..5 -> BOOLEAN]
ImmutableEvidenceDiscipline == /\ publications \subseteq objects
                              /\ orphans \subseteq objects
                              /\ orphans \cap publications = {}
DrainIsQuiescent == drainClaim => CanStillCommit = {}
NoPostRestoreSQLCommit == ~lateSQL
NoUnfencedPersistentEffect == ~unfencedWrite
\* Intentionally false reachability controls; failures demonstrate witnesses.
NoHealthySettlementWitness == settledGood = {}
NoPermittedOrphanWitness == ~orphanWitness
=============================================================================
