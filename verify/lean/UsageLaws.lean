import Std

/- Mathematical aggregation laws over arbitrary finite histories. These do not
   by themselves establish refinement of Rust, SQL, or provider observations.
   Production-width scalar refusal and evidence propagation are checked on
   the Rust kernel separately; population identity is a caller obligation. -/
namespace UsageLaws

def knownTotal : List (Option Nat) → Nat
  | [] => 0
  | none :: rest => knownTotal rest
  | some value :: rest => value + knownTotal rest

def knownCount : List (Option Nat) → Nat
  | [] => 0
  | none :: rest => knownCount rest
  | some _ :: rest => 1 + knownCount rest

def unknownCount : List (Option Nat) → Nat
  | [] => 0
  | none :: rest => 1 + unknownCount rest
  | some _ :: rest => unknownCount rest

theorem evidence_partition (history : List (Option Nat)) :
    knownCount history + unknownCount history = history.length := by
  induction history with
  | nil => rfl
  | cons observation rest ih =>
    cases observation <;> simp_all [knownCount, unknownCount] <;> omega

theorem known_zero_is_observed (rest : List (Option Nat)) :
    knownTotal (some 0 :: rest) = knownTotal (none :: rest) ∧
    knownCount (some 0 :: rest) = knownCount (none :: rest) + 1 ∧
    unknownCount (none :: rest) = unknownCount (some 0 :: rest) + 1 := by
  simp [knownTotal, knownCount, unknownCount, Nat.add_comm]

theorem total_append (left right : List (Option Nat)) :
    knownTotal (left ++ right) = knownTotal left + knownTotal right := by
  induction left with
  | nil => simp [knownTotal]
  | cons observation rest ih =>
    cases observation <;> simp [knownTotal, ih, Nat.add_assoc]

theorem known_append (left right : List (Option Nat)) :
    knownCount (left ++ right) = knownCount left + knownCount right := by
  induction left with
  | nil => simp [knownCount]
  | cons observation rest ih =>
    cases observation <;> simp [knownCount, ih, Nat.add_assoc]

theorem unknown_append (left right : List (Option Nat)) :
    unknownCount (left ++ right) = unknownCount left + unknownCount right := by
  induction left with
  | nil => simp [unknownCount]
  | cons observation rest ih =>
    cases observation <;> simp [unknownCount, ih, Nat.add_assoc]

theorem correction_conserves_other_observations
    (before after : List (Option Nat)) (old replacement : Nat) :
    knownTotal (before ++ some old :: after) - old + replacement =
      knownTotal (before ++ some replacement :: after) := by
  simp only [total_append, knownTotal]
  omega

theorem reasoning_partition (output reasoning : Nat) (subset : reasoning ≤ output) :
    (output - reasoning) + reasoning = output := by omega

def boundedFold (limit accumulator : Nat) : List Nat → Option Nat
  | [] => if accumulator ≤ limit then some accumulator else none
  | value :: rest =>
      if accumulator + value ≤ limit then boundedFold limit (accumulator + value) rest
      else none

theorem bounded_fold_exact (limit accumulator : Nat) (history : List Nat) :
    boundedFold limit accumulator history =
      if accumulator + history.sum ≤ limit then some (accumulator + history.sum) else none := by
  induction history generalizing accumulator with
  | nil => simp [boundedFold]
  | cons value rest ih =>
    simp only [boundedFold, List.sum_cons]
    split
    · rw [ih]
      simp [Nat.add_assoc]
    · have beyond : ¬accumulator + (value + rest.sum) ≤ limit := by omega
      simp [beyond]

theorem bounded_fold_refuses_exactly_over_limit (limit accumulator : Nat) (history : List Nat) :
    boundedFold limit accumulator history = none ↔ limit < accumulator + history.sum := by
  rw [bounded_fold_exact]
  split <;> simp_all <;> omega

#print axioms evidence_partition
#print axioms known_zero_is_observed
#print axioms total_append
#print axioms known_append
#print axioms unknown_append
#print axioms correction_conserves_other_observations
#print axioms reasoning_partition
#print axioms bounded_fold_exact
#print axioms bounded_fold_refuses_exactly_over_limit

end UsageLaws
