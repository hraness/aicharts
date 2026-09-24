-------------------------- MODULE M4Supersession ---------------------------
EXTENDS Naturals, FiniteSets

VARIABLES pending, seen, superseded, charges, frozen, committed,
          lastSuperseded, retrySeen, capacityRefused
vars == <<pending, seen, superseded, charges, frozen, committed,
          lastSuperseded, retrySeen, capacityRefused>>
Intents == {"A", "B"}
TotalCharges == charges["A"] + charges["B"]
Init == /\ pending = "none" /\ seen = {} /\ superseded = {}
        /\ charges = [i \in Intents |-> 0] /\ frozen = FALSE /\ committed = "none"
        /\ lastSuperseded = "none" /\ retrySeen = FALSE /\ capacityRefused = FALSE

\* Both intents use the same device, expected revision and next sequence.
\* Ghost superseded records the required terminal decision absent in baseline SQL.
Reserve(i) ==
    /\ pending = "none" /\ committed = "none" /\ TotalCharges < 3
    /\ pending' = i /\ seen' = seen \cup {i}
    /\ charges' = [charges EXCEPT ![i] = @ + 1]
    /\ UNCHANGED <<superseded, frozen, committed, lastSuperseded,
                   retrySeen, capacityRefused>>
ReserveFirstA == /\ seen = {} /\ Reserve("A")
ReserveB == /\ seen = {"A"} /\ lastSuperseded = "A" /\ Reserve("B")
ReplayA == /\ seen = Intents /\ lastSuperseded = "B" /\ Reserve("A")
Supersede ==
    /\ pending # "none" /\ ~frozen /\ committed = "none"
    /\ superseded' = superseded \cup {pending}
    /\ lastSuperseded' = pending /\ pending' = "none"
    /\ retrySeen' = FALSE
    /\ UNCHANGED <<seen, charges, frozen, committed, capacityRefused>>
RetrySame ==
    /\ pending # "none" /\ ~retrySeen /\ retrySeen' = TRUE
    /\ UNCHANGED <<pending, seen, superseded, charges, frozen, committed,
                   lastSuperseded, capacityRefused>>
Freeze ==
    /\ pending # "none" /\ ~frozen /\ committed = "none" /\ frozen' = TRUE
    /\ UNCHANGED <<pending, seen, superseded, charges, committed,
                   lastSuperseded, retrySeen, capacityRefused>>
Publish ==
    /\ frozen /\ committed = "none" /\ committed' = pending /\ pending' = "none"
    /\ UNCHANGED <<seen, superseded, charges, frozen, lastSuperseded,
                   retrySeen, capacityRefused>>
RefuseAtCapacity ==
    /\ TotalCharges = 3 /\ pending = "none" /\ committed = "none"
    /\ ~capacityRefused /\ capacityRefused' = TRUE
    /\ UNCHANGED <<pending, seen, superseded, charges, frozen, committed,
                   lastSuperseded, retrySeen>>
Terminal == /\ (committed # "none" \/ capacityRefused)
            /\ UNCHANGED vars
Next == ReserveFirstA \/ ReserveB \/ ReplayA \/ Supersede \/ RetrySame
        \/ Freeze \/ Publish \/ RefuseAtCapacity \/ Terminal

TypeOK == /\ pending \in Intents \cup {"none"} /\ committed \in Intents \cup {"none"}
          /\ lastSuperseded \in Intents \cup {"none"}
          /\ seen \subseteq Intents /\ superseded \subseteq Intents
          /\ charges \in [Intents -> 0..2] /\ TotalCharges <= 3
          /\ <<frozen, retrySeen, capacityRefused>> \in [1..3 -> BOOLEAN]
CommittedWasFrozen == committed # "none" => frozen
SupersededCannotReturn == pending = "none" \/ pending \notin superseded
ChargeEachIntentOnce == \A i \in Intents : charges[i] <= 1
NoSuccessfulRetryWitness == ~(committed # "none" /\ retrySeen)
NoCapacityRefusalWitness == ~capacityRefused
=============================================================================
