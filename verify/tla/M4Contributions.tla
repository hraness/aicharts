-------------------------- MODULE M4Contributions --------------------------
EXTENDS Naturals, FiniteSets

CONSTANT ProvenOverlap
VARIABLES legacyStored, detailedStage, visible, readDone, retrySeen, snapshotTokens
vars == <<legacyStored, detailedStage, visible, readDone, retrySeen, snapshotTokens>>

\* TRUE is a DIFFERENT payload: the same foreign occurrence with all 120
\* tokens. FALSE is the independent local occurrence with 15 tokens. TRUE
\* never licenses treating the 15-token payload as replacement for 120.
DetailedPopulation == IF ProvenOverlap THEN {"foreign"} ELSE {"local"}
DetailedTokens == IF ProvenOverlap THEN 120 ELSE 15

Init == /\ legacyStored = FALSE /\ detailedStage = "idle"
        /\ visible = {} /\ readDone = FALSE /\ retrySeen = FALSE /\ snapshotTokens = 0
SeedForeignLegacy ==
    /\ ~legacyStored /\ legacyStored' = TRUE
    /\ UNCHANGED <<detailedStage, visible, readDone, retrySeen, snapshotTokens>>
ReserveDetailed ==
    /\ legacyStored /\ detailedStage = "idle" /\ detailedStage' = "reserved"
    /\ UNCHANGED <<legacyStored, visible, readDone, retrySeen, snapshotTokens>>
FreezeDetailed ==
    /\ detailedStage = "reserved" /\ detailedStage' = "frozen"
    /\ UNCHANGED <<legacyStored, visible, readDone, retrySeen, snapshotTokens>>
PublishDetailed ==
    /\ detailedStage = "frozen" /\ detailedStage' = "published"
    /\ snapshotTokens' = DetailedTokens
    /\ UNCHANGED <<legacyStored, visible, readDone, retrySeen>>
ReadProjection ==
    /\ detailedStage = "published" /\ ~readDone
    \* Baseline ownership suppresses all legacy observations for this client/day.
    /\ visible' = DetailedPopulation
    /\ readDone' = TRUE
    /\ UNCHANGED <<legacyStored, detailedStage, retrySeen, snapshotTokens>>
RetrySame ==
    /\ detailedStage = "published" /\ ~retrySeen /\ retrySeen' = TRUE
    /\ UNCHANGED <<legacyStored, detailedStage, visible, readDone, snapshotTokens>>
Terminal == /\ readDone /\ retrySeen /\ UNCHANGED vars
Next == SeedForeignLegacy \/ ReserveDetailed \/ FreezeDetailed \/ PublishDetailed
        \/ ReadProjection \/ RetrySame \/ Terminal

ExpectedPopulation == IF ProvenOverlap THEN {"foreign"} ELSE {"foreign", "local"}
ObservedTokens == (IF "foreign" \in visible THEN 120 ELSE 0)
                  + (IF "local" \in visible THEN 15 ELSE 0)
ExpectedTokens == IF ProvenOverlap THEN 120 ELSE 135
TypeOK == /\ legacyStored \in BOOLEAN /\ readDone \in BOOLEAN /\ retrySeen \in BOOLEAN
          /\ detailedStage \in {"idle", "reserved", "frozen", "published"}
          /\ visible \subseteq {"foreign", "local"}
          /\ snapshotTokens \in {0, 15, 120}
CanonicalHistoryRetained == detailedStage # "idle" => legacyStored
SnapshotPayloadMatches == readDone => ObservedTokens = snapshotTokens
ForeignPopulationPreserved == readDone => visible = ExpectedPopulation
TokensConserved == readDone => ObservedTokens = ExpectedTokens
NoReadRetryWitness == ~(readDone /\ retrySeen)
=============================================================================
