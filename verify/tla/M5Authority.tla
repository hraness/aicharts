----------------------------- MODULE M5Authority -----------------------------
EXTENDS Naturals
\* Two accounts and browser attempts; response identity is bound independently
\* of successful data. Missing/conflict responses have the same account guard.
\* UnsafeGeneration removes the ownership-generation check from read acceptance:
\* a response captured before two account switches becomes visible (negative
\* control only).
CONSTANT UnsafeGeneration
VARIABLE s
Init == s = [account |-> 1, generation |-> 0, attempt |-> 0, authenticatedAttempt |-> 0,
  authenticatedAccount |-> 0, approved |-> 0, enrolled |-> 0,
  requestAccount |-> 0, requestGeneration |-> 0, visible |-> 0,
  expired |-> FALSE, refused |-> FALSE, replaced |-> FALSE, accepted |-> FALSE]
NewAttempt == /\ s.attempt < 2 /\ s.approved = 0
  /\ s' = [s EXCEPT !.attempt = @ + 1, !.authenticatedAttempt = 0,
    !.authenticatedAccount = 0, !.replaced = s.attempt = 1]
Authenticate == /\ s.attempt # 0 /\ s.authenticatedAttempt = 0 /\ ~s.expired
  /\ s' = [s EXCEPT !.authenticatedAttempt = s.attempt,
    !.authenticatedAccount = s.account, !.approved = s.account]
\* Fresh authentication itself is the atomic browser approval. The retained
\* internal approve operation is only exact live readback of that decision.
ApprovalReadback == /\ s.authenticatedAttempt = s.attempt /\ s.attempt # 0
  /\ s.authenticatedAccount = s.account /\ ~s.expired /\ s.approved = s.account
  /\ UNCHANGED s
Confirm == /\ s.approved = s.account /\ s.approved # 0 /\ s.enrolled = 0 /\ ~s.expired
  /\ s' = [s EXCEPT !.enrolled = s.approved]
RefuseForeignDecision == /\ s.authenticatedAccount # 0
  /\ s.account # s.authenticatedAccount /\ ~s.refused
  /\ s' = [s EXCEPT !.refused = TRUE]
SwitchAccount == /\ s.generation < 2
  /\ s' = [s EXCEPT !.account = 3 - @, !.generation = @ + 1, !.visible = 0]
StartRead == /\ s.requestAccount = 0 /\ ~s.expired
  /\ s' = [s EXCEPT !.requestAccount = s.account, !.requestGeneration = s.generation]
AcceptRead == /\ s.requestAccount = s.account /\ s.requestAccount # 0
  /\ (UnsafeGeneration \/ s.requestGeneration = s.generation) /\ ~s.expired /\ ~s.accepted
  /\ s' = [s EXCEPT !.visible = s.requestAccount, !.accepted = TRUE]
RefuseLateRead == /\ s.requestAccount # 0 /\ ~s.refused
  /\ (s.requestAccount # s.account \/ s.requestGeneration # s.generation \/ s.expired)
  /\ s' = [s EXCEPT !.refused = TRUE]
Expire == /\ ~s.expired /\ s' = [s EXCEPT !.expired = TRUE, !.visible = 0]
Terminal == /\ s.expired /\ UNCHANGED s
Next == NewAttempt \/ Authenticate \/ ApprovalReadback \/ Confirm \/ RefuseForeignDecision
  \/ SwitchAccount \/ StartRead \/ AcceptRead \/ RefuseLateRead \/ Expire \/ Terminal
TypeOK == /\ s.account \in 1..2 /\ s.generation \in 0..2 /\ s.attempt \in 0..2
  /\ s.authenticatedAttempt \in 0..2 /\ s.authenticatedAccount \in 0..2
  /\ s.approved \in 0..2 /\ s.enrolled \in 0..2 /\ s.requestAccount \in 0..2
  /\ s.requestGeneration \in 0..2 /\ s.visible \in 0..2
  /\ <<s.expired, s.refused, s.replaced, s.accepted>> \in [1..4 -> BOOLEAN]
Safety == /\ (s.enrolled = 0 \/ s.enrolled = s.approved)
  /\ (s.visible = 0 \/ (s.visible = s.account /\ s.requestGeneration = s.generation /\ ~s.expired))
  /\ (s.authenticatedAttempt = 0 \/ s.authenticatedAttempt = s.attempt)
NoSuccessWitness == s.enrolled = 0 \/ ~s.accepted
NoRefusalWitness == ~s.refused
NoRecoveryWitness == ~s.replaced \/ s.enrolled = 0
=============================================================================
