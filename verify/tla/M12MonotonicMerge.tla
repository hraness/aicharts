-------------------------- MODULE M12MonotonicMerge --------------------------
EXTENDS Naturals, FiniteSets

\* One committed (day, client, model) stats cell under the usage worker's
\* monotonic floor merge: a stored daily projection may only be replaced by a
\* larger value, never lowered. Inflated models a forked Codex child whose
\* inherited cumulative counter was admitted as own usage — the observed
\* production overcount. AdmissionGuard models the tokens-per-record
\* plausibility bound evaluated before any value may enter pending.
CONSTANT AdmissionGuard
VARIABLES stored, pending, submitted, wasOver, drained
vars == <<stored, pending, submitted, wasOver, drained>>

Truth == 120
Inflated == 240
Submissions == {Truth, Inflated}

Init == /\ stored = 0
        /\ pending = {}
        /\ submitted = {}
        /\ wasOver = FALSE
        /\ drained = FALSE

\* Admission is the only gate: under the plausibility bound, a submission whose
\* per-record tokens exceed the bound is refused and never reaches the merge.
\* Resubmitting an already pending value is a set union — inherently
\* idempotent at this layer.
Submit(v) ==
    /\ (AdmissionGuard => v <= Truth)
    /\ pending' = pending \cup {v}
    /\ submitted' = submitted \cup {v}
    /\ UNCHANGED <<stored, wasOver, drained>>

\* The merge floor: stored rises to max(stored, v); a lower honest value cannot
\* correct a committed overcount.
Merge ==
    /\ \E v \in pending:
        /\ stored' = (IF v > stored THEN v ELSE stored)
        /\ pending' = pending \ {v}
        /\ drained' = TRUE
        /\ wasOver' = (wasOver \/ ((IF v > stored THEN v ELSE stored) > Truth))
        /\ UNCHANGED submitted

Next == (\E v \in Submissions : Submit(v)) \/ Merge
Spec == Init /\ [][Next]_vars

TypeOK == /\ stored \in {0} \cup Submissions
          /\ pending \subseteq submitted
          /\ submitted \subseteq Submissions
          /\ wasOver \in BOOLEAN /\ drained \in BOOLEAN
          /\ stored # 0 => drained
NoOvercount == stored <= Truth
\* Once a committed cell exceeds truth, no subsequent merge lowers it — not
\* even a later honest resubmission. Holds in every reachable state: the
\* hazard is that overcount is permanent, never that it is repaired.
NoCorrection == wasOver => stored > Truth
\* After an inflated commit, an honest resubmission is fully drained while the
\* stored cell remains inflated: the overcount is committed and
\* uncorrectable. Expected violated unguarded; holds guarded.
ResubmitHonestCorrects == (wasOver /\ Truth \in submitted /\ pending = {}) => stored <= Truth
StoredFromSubmissions == stored \in {0} \cup submitted
=============================================================================
