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

/- Fork-replay deduplication laws: a stream of (turn, delta) observations where
   forked children replay inherited prefix records. Correct accounting sums each
   logical turn exactly once; a replayed copy contributes nothing. -/

/-- The seen-turn frontier after processing a stream. -/
def dedupSeen (seen : List Nat) : List (Nat × Nat) → List Nat
  | [] => seen
  | (turn, _) :: rest =>
      dedupSeen (if turn ∈ seen then seen else turn :: seen) rest

/-- The deduplicated token sum: first occurrence of each turn contributes its
   delta; later copies contribute zero. -/
def dedupSum (seen : List Nat) : List (Nat × Nat) → Nat
  | [] => 0
  | (turn, delta) :: rest =>
      (if turn ∈ seen then 0 else delta) +
        dedupSum (if turn ∈ seen then seen else turn :: seen) rest

theorem dedupSeen_retains (seen : List Nat) (xs : List (Nat × Nat)) :
    ∀ t ∈ seen, t ∈ dedupSeen seen xs := by
  induction xs generalizing seen with
  | nil => intro t ht; simpa [dedupSeen] using ht
  | cons head rest ih =>
    obtain ⟨turn, delta⟩ := head
    intro t ht
    simp only [dedupSeen]
    by_cases h : turn ∈ seen
    · simp only [h, ↓reduceIte]; exact ih seen t ht
    · simp only [h, ↓reduceIte]
      exact ih (turn :: seen) t (List.mem_cons_of_mem _ ht)

theorem dedupSeen_absorbs (seen : List Nat) (xs : List (Nat × Nat)) :
    ∀ p ∈ xs, p.1 ∈ dedupSeen seen xs := by
  induction xs generalizing seen with
  | nil => intro p hp; cases hp
  | cons head rest ih =>
    obtain ⟨turn, delta⟩ := head
    intro p hp
    simp only [dedupSeen]
    by_cases h : turn ∈ seen
    · simp only [h, ↓reduceIte]
      rcases List.mem_cons.mp hp with rfl | hp
      · exact dedupSeen_retains seen rest turn h
      · exact ih seen p hp
    · simp only [h, ↓reduceIte]
      rcases List.mem_cons.mp hp with rfl | hp
      · exact dedupSeen_retains (turn :: seen) rest turn List.mem_cons_self
      · exact ih (turn :: seen) p hp

theorem dedupSeen_all_seen (seen : List Nat) (xs : List (Nat × Nat))
    (h : ∀ p ∈ xs, p.1 ∈ seen) :
    dedupSeen seen xs = seen := by
  induction xs generalizing seen with
  | nil => rfl
  | cons head rest ih =>
    obtain ⟨turn, delta⟩ := head
    have ht : turn ∈ seen := h ⟨turn, delta⟩ List.mem_cons_self
    have hrest : ∀ p ∈ rest, p.1 ∈ seen := fun p hp => h p (List.mem_cons_of_mem _ hp)
    simp only [dedupSeen, ht, ↓reduceIte]
    exact ih seen hrest

theorem dedupSeen_append (seen : List Nat) (xs ys : List (Nat × Nat)) :
    dedupSeen seen (xs ++ ys) = dedupSeen (dedupSeen seen xs) ys := by
  induction xs generalizing seen with
  | nil => rfl
  | cons head rest ih =>
    obtain ⟨turn, delta⟩ := head
    simp only [List.cons_append, dedupSeen]
    by_cases h : turn ∈ seen
    · simp only [h, ↓reduceIte]; exact ih seen
    · simp only [h, ↓reduceIte]; exact ih (turn :: seen)

theorem dedupSum_all_seen (seen : List Nat) (xs : List (Nat × Nat))
    (h : ∀ p ∈ xs, p.1 ∈ seen) :
    dedupSum seen xs = 0 := by
  induction xs generalizing seen with
  | nil => rfl
  | cons head rest ih =>
    obtain ⟨turn, delta⟩ := head
    have ht : turn ∈ seen := h ⟨turn, delta⟩ List.mem_cons_self
    have hrest : ∀ p ∈ rest, p.1 ∈ seen := fun p hp => h p (List.mem_cons_of_mem _ hp)
    simp only [dedupSum, ht, ↓reduceIte, Nat.zero_add]
    exact ih seen hrest

theorem dedupSum_append (seen : List Nat) (xs ys : List (Nat × Nat)) :
    dedupSum seen (xs ++ ys) =
      dedupSum seen xs + dedupSum (dedupSeen seen xs) ys := by
  induction xs generalizing seen with
  | nil => simp [dedupSum, dedupSeen]
  | cons head rest ih =>
    obtain ⟨turn, delta⟩ := head
    simp only [List.cons_append, dedupSum, dedupSeen]
    by_cases h : turn ∈ seen
    · simp only [h, ↓reduceIte, Nat.zero_add]
      rw [ih seen]
    · simp only [h, ↓reduceIte]
      rw [ih (turn :: seen)]
      omega

/-- Each logical turn is counted exactly once: replaying an already-processed
   prefix contributes nothing, so a forked child's echoed parent records can
   never double-count. -/
theorem dedup_replay_neutral (xs ys : List (Nat × Nat)) :
    dedupSum [] ((xs ++ xs) ++ ys) = dedupSum [] (xs ++ ys) := by
  rw [dedupSum_append [] (xs ++ xs) ys, dedupSum_append [] xs xs,
      dedupSum_all_seen _ _ (dedupSeen_absorbs [] xs), Nat.add_zero,
      dedupSeen_append, dedupSeen_all_seen _ _ (dedupSeen_absorbs [] xs),
      dedupSum_append [] xs ys]

theorem dedupSum_distinct (seen : List Nat) (xs : List (Nat × Nat))
    (disjoint : ∀ p ∈ xs, p.1 ∉ seen) (nodup : (xs.map Prod.fst).Nodup) :
    dedupSum seen xs = (xs.map Prod.snd).sum := by
  induction xs generalizing seen with
  | nil => simp [dedupSum]
  | cons head rest ih =>
    obtain ⟨turn, delta⟩ := head
    simp only [List.map_cons, List.nodup_cons] at nodup
    obtain ⟨hnotin, hrest⟩ := nodup
    have ht : turn ∉ seen := disjoint ⟨turn, delta⟩ List.mem_cons_self
    have hdisj : ∀ p ∈ rest, p.1 ∉ turn :: seen := by
      intro p hp
      simp only [List.mem_cons, not_or]
      exact ⟨fun heq => hnotin (List.mem_map.mpr ⟨p, hp, heq⟩),
        disjoint p (List.mem_cons_of_mem _ hp)⟩
    simp only [dedupSum, List.map_cons, List.sum_cons, ht, ↓reduceIte]
    rw [ih (turn :: seen) hdisj hrest]

#print axioms evidence_partition
#print axioms known_zero_is_observed
#print axioms total_append
#print axioms known_append
#print axioms unknown_append
#print axioms correction_conserves_other_observations
#print axioms reasoning_partition
#print axioms bounded_fold_exact
#print axioms bounded_fold_refuses_exactly_over_limit
#print axioms dedupSeen_retains
#print axioms dedupSeen_absorbs
#print axioms dedupSeen_all_seen
#print axioms dedupSeen_append
#print axioms dedupSum_all_seen
#print axioms dedupSum_append
#print axioms dedup_replay_neutral
#print axioms dedupSum_distinct

end UsageLaws
