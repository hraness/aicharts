
namespace aicharts_metrics
open Aeneas Aeneas.Std Result

/-- The existing per-record contract: the half-up offset must first fit u128,
    then floor division happens once, followed by the 24-digit admission bound. -/
def pricingPost (pico : Nat) (result : core.result.Result U128 Error) : Prop :=
  match result with
  | .Ok value => pico + 500000 ≤ U128.max ∧
      value.val = (pico + 500000) / 1000000 ∧
      value.val ≤ 999999999999999999999999
  | .Err error =>
      (error = Error.Overflow ∧ U128.max < pico + 500000) ∨
      (error = Error.Limit ∧ pico + 500000 ≤ U128.max ∧
        999999999999999999999999 < (pico + 500000) / 1000000)

@[step]
theorem pricing_admit_decimal_exact (value : U128) :
    arithmetic.admit_decimal value ⦃ result => match result with
      | .Ok admitted => admitted = value ∧ value.val ≤ 999999999999999999999999
      | .Err error => error = Error.Limit ∧ 999999999999999999999999 < value.val ⦄ := by
  unfold arithmetic.admit_decimal
  split <;> simp_all [MAX_DECIMAL]

theorem pricing_terminal_body_exact
    (tokens : Array U128 5#usize) (rates : Array (Option U128) 5#usize) (pico : U128) :
    arithmetic.price_microusd_loop.body tokens rates pico 5#usize ⦃ flow =>
      match flow with
      | .done result => pricingPost pico.val result
      | .cont _ => False ⦄ := by
  unfold arithmetic.price_microusd_loop.body
  simp
  step
  cases r with
  | Ok added =>
    have addedBound := U128.le_max added
    simp only [core.result.Result.Insts.CoreOpsTry.branch, bind_tc_ok]
    step
    step
    cases r1 <;> simp_all [pricingPost] <;> scalar_tac
  | Err error =>
    simp_all [pricingPost, core.result.Result.Insts.CoreOpsTry.branch,
      core.result.Result.Insts.CoreOpsTry_traitFromResidualResult.from_residual]

theorem pricing_terminal_exact
    (tokens : Array U128 5#usize) (rates : Array (Option U128) 5#usize) (pico : U128) :
    arithmetic.price_microusd_loop tokens rates pico 5#usize ⦃ pricingPost pico.val ⦄ := by
  unfold arithmetic.price_microusd_loop
  rw [loop.eq_def]
  apply WP.spec_bind (pricing_terminal_body_exact tokens rates pico)
  intro flow post
  cases flow <;> simp_all

def pricingUnitTokens (tokens : U128) : Array U128 5#usize :=
  Array.make 5#usize [tokens, 0#u128, 0#u128, 0#u128, 0#u128]

def pricingUnitRates : Array (Option U128) 5#usize :=
  Array.make 5#usize [some 1#u128, none, none, none, none]

theorem pricing_unit_product (tokens : U128) :
    tokens.checked_mul 1#u128 = some tokens := by
  have productSpec := U128.checked_mul_bv_spec tokens 1#u128
  have tokenBound := U128.le_max tokens
  cases product : tokens.checked_mul 1#u128 <;> simp_all <;> scalar_tac

theorem pricing_unit_first_body (tokens : U128) :
    arithmetic.price_microusd_loop.body (pricingUnitTokens tokens) pricingUnitRates
      0#u128 0#usize ⦃ flow => flow = .cont (tokens, 1#usize) ⦄ := by
  simp [arithmetic.price_microusd_loop.body, pricingUnitTokens, pricingUnitRates,
    Array.index_usize, pricing_unit_product, core.option.Option.ok_or,
    core.result.Result.Insts.CoreOpsTry.branch, lift]
  split
  · step
    congr 2 <;> scalar_tac
  · step
    cases r2 with
    | Ok value =>
      simp
      step
      congr 2 <;> scalar_tac
    | Err error =>
      have tokenBound := U128.le_max tokens
      simp at r2_post
      scalar_tac

theorem pricing_unit_tail_token (tokens : U128) (index : Usize)
    (lower : 1 ≤ index.val) (upper : index.val < 5) :
    Array.index_usize (pricingUnitTokens tokens) index = ok 0#u128 := by
  have choices : index.val = 1 ∨ index.val = 2 ∨ index.val = 3 ∨ index.val = 4 := by omega
  rcases choices with h | h | h | h <;>
    simp [Array.index_usize, pricingUnitTokens, h]

theorem pricing_unit_tail_body (tokens pico : U128) (index : Usize)
    (lower : 1 ≤ index.val) (upper : index.val < 5) :
    arithmetic.price_microusd_loop.body (pricingUnitTokens tokens) pricingUnitRates
      pico index ⦃ flow => ∃ next, flow = .cont (pico, next) ∧ next.val = index.val + 1 ⦄ := by
  have indexBound : index < 5#usize := by scalar_tac
  have zero := pricing_unit_tail_token tokens index lower upper
  simp [arithmetic.price_microusd_loop.body, indexBound, zero]
  step
  exact ⟨index1, rfl, index1_post⟩

theorem pricing_unit_tail_exact (tokens : U128) :
    arithmetic.price_microusd_loop (pricingUnitTokens tokens) pricingUnitRates
      tokens 1#usize ⦃ pricingPost tokens.val ⦄ := by
  unfold arithmetic.price_microusd_loop
  refine loop.spec_decr_nat
    (fun (state : U128 × Usize) => 5 - state.2.val)
    (fun state => state.1 = tokens ∧ 1 ≤ state.2.val ∧ state.2.val ≤ 5)
    (pricingPost tokens.val)
    (fun state => arithmetic.price_microusd_loop.body
      (pricingUnitTokens tokens) pricingUnitRates state.1 state.2)
    (tokens, 1#usize) ?_ ?_
  · intro state invariant
    rcases state with ⟨pico, index⟩
    rcases invariant with ⟨same, lower, upper⟩
    dsimp at same lower upper ⊢
    subst pico
    by_cases continues : index.val < 5
    · apply WP.spec_mono (pricing_unit_tail_body tokens tokens index lower continues)
      intro flow post
      rcases post with ⟨next, sameFlow, advanced⟩
      subst flow
      simp
      omega
    · have terminal : index = 5#usize := by
        apply UScalar.val_eq_imp
        simp
        omega
      subst index
      apply WP.spec_mono (pricing_terminal_body_exact
        (pricingUnitTokens tokens) pricingUnitRates tokens)
      intro flow post
      cases flow <;> simp_all
  · simp

/-- Actual extracted production pricing for the complete u128 token domain at
    unit rate; all unused rates are unknown. No domain premise or price stub. -/
theorem pricing_unit_rate_exact (tokens : U128) :
    arithmetic.price_microusd (pricingUnitTokens tokens) pricingUnitRates
      ⦃ pricingPost tokens.val ⦄ := by
  unfold arithmetic.price_microusd arithmetic.price_microusd_loop
  rw [loop.eq_def]
  apply WP.spec_bind (pricing_unit_first_body tokens)
  intro flow same
  subst flow
  simpa [arithmetic.price_microusd_loop] using pricing_unit_tail_exact tokens

theorem pricing_unit_success_witness :
    ∃ value, arithmetic.price_microusd
        (pricingUnitTokens 999999999999999999999999000000#u128) pricingUnitRates =
          ok (.Ok value) ∧ value.val = 999999999999999999999999 := by
  obtain ⟨result, evaluates, post⟩ := WP.spec_imp_exists
    (pricing_unit_rate_exact 999999999999999999999999000000#u128)
  cases result <;> simp_all [pricingPost, U128.max, U128.numBits]

theorem pricing_unit_overflow_witness :
    arithmetic.price_microusd
      (pricingUnitTokens 340282366920938463463374607431768211455#u128) pricingUnitRates =
        ok (.Err Error.Overflow) := by
  obtain ⟨result, evaluates, post⟩ := WP.spec_imp_exists
    (pricing_unit_rate_exact 340282366920938463463374607431768211455#u128)
  cases result <;> simp_all [pricingPost, U128.max, U128.numBits]

theorem pricing_unit_limit_witness :
    arithmetic.price_microusd
      (pricingUnitTokens 1000000000000000000000000000000#u128) pricingUnitRates =
        ok (.Err Error.Limit) := by
  obtain ⟨result, evaluates, post⟩ := WP.spec_imp_exists
    (pricing_unit_rate_exact 1000000000000000000000000000000#u128)
  cases result <;> simp_all [pricingPost, U128.max, U128.numBits]
  omega

#print axioms pricing_admit_decimal_exact
#print axioms pricing_terminal_body_exact
#print axioms pricing_terminal_exact
#print axioms pricing_unit_product
#print axioms pricing_unit_first_body
#print axioms pricing_unit_tail_token
#print axioms pricing_unit_tail_body
#print axioms pricing_unit_tail_exact
#print axioms pricing_unit_rate_exact
#print axioms pricing_unit_success_witness
#print axioms pricing_unit_overflow_witness
#print axioms pricing_unit_limit_witness

end aicharts_metrics


namespace aicharts_metrics
open Aeneas Aeneas.Std Result

def pricingResultNat (result : core.result.Result U128 Error) : core.result.Result Nat Error :=
  match result with
  | .Ok value => .Ok value.val
  | .Err error => .Err error

def pricingFinish (pico : Nat) : core.result.Result Nat Error :=
  if U128.max < pico + 500000 then .Err Error.Overflow
  else if 999999999999999999999999 < (pico + 500000) / 1000000 then .Err Error.Limit
  else .Ok ((pico + 500000) / 1000000)

/-- Independent unbounded arithmetic: for nonnegative quantities, admitting
    `pico + tokens * rate` also admits the product. Separate machine product and
    sum checks therefore have the same Overflow result. Rate lookup follows the
    zero-token guard, and the fold stops at the first refusal. -/
def pricingBucket (tokens : Nat) (rate : Option Nat) (pico : Nat) :
    core.result.Result Nat Error :=
  if tokens = 0 then .Ok pico
  else match rate with
    | none => .Err Error.MissingRate
    | some rate =>
      if pico + tokens * rate ≤ U128.max then .Ok (pico + tokens * rate)
      else .Err Error.Overflow

def pricingFold (tokens : Array U128 5#usize) (rates : Array (Option U128) 5#usize)
    (pico index : Nat) : Nat → core.result.Result Nat Error
  | 0 => pricingFinish pico
  | remaining + 1 =>
    match pricingBucket tokens.val[index]!.val (rates.val[index]!.map UScalar.val) pico with
    | .Ok next => pricingFold tokens rates next (index + 1) remaining
    | .Err error => .Err error

theorem pricing_finish_post (pico : Nat) (result : core.result.Result U128 Error)
    (post : pricingPost pico result) :
    pricingResultNat result = pricingFinish pico := by
  cases result with
  | Ok value =>
    rcases post with ⟨bounded, exact, admitted⟩
    simp [pricingResultNat, pricingFinish, exact, Nat.not_lt.mpr bounded,
      Nat.not_lt.mpr (exact ▸ admitted)]
  | Err error =>
    rcases post with ⟨rfl, overflow⟩ | ⟨rfl, bounded, refused⟩
    · simp [pricingResultNat, pricingFinish, overflow]
    · simp [pricingResultNat, pricingFinish, Nat.not_lt.mpr bounded, refused]

theorem pricing_body_exact
    (tokens : Array U128 5#usize) (rates : Array (Option U128) 5#usize)
    (pico : U128) (index : Usize) (upper : index.val < 5) :
    arithmetic.price_microusd_loop.body tokens rates pico index ⦃ flow =>
      match flow with
      | .cont (next, nextIndex) => nextIndex.val = index.val + 1 ∧
          pricingBucket tokens.val[index.val]!.val
            (rates.val[index.val]!.map UScalar.val) pico.val = .Ok next.val
      | .done result => ∃ error, result = .Err error ∧
          pricingBucket tokens.val[index.val]!.val
            (rates.val[index.val]!.map UScalar.val) pico.val = .Err error ⦄ := by
  have indexBound : index < 5#usize := by scalar_tac
  have tokenBound : index.val < tokens.val.length := by simpa using upper
  have rateBound : index.val < rates.val.length := by simpa using upper
  simp only [arithmetic.price_microusd_loop.body, indexBound, if_true]
  step
  simp only [getElem!_pos tokens.val index.val tokenBound, ← token_count_post]
  clear token_count_post
  split
  · step
    simp only [getElem!_pos rates.val index.val rateBound, ← o_post]
    clear o_post
    cases o with
    | none => simp_all [core.option.Option.ok_or, core.result.Result.Insts.CoreOpsTry.branch,
        core.result.Result.Insts.CoreOpsTry_traitFromResidualResult.from_residual,
        pricingBucket]
    | some rate =>
      simp only [core.option.Option.ok_or, bind_tc_ok,
        core.result.Result.Insts.CoreOpsTry.branch]
      step
      split
      · step
        cases r1 with
        | Ok added =>
          have addedBound := U128.le_max added
          simp only [bind_tc_ok]
          step
          simp_all [pricingBucket]
          simpa [U128.max, U128.numBits] using addedBound
        | Err error =>
          simp_all [core.result.Result.Insts.CoreOpsTry_traitFromResidualResult.from_residual,
            pricingBucket]
      · simp_all [core.result.Result.Insts.CoreOpsTry_traitFromResidualResult.from_residual,
          pricingBucket]
        omega
  · step
    simp_all [pricingBucket]

theorem pricing_loop_exact
    (tokens : Array U128 5#usize) (rates : Array (Option U128) 5#usize)
    (remaining : Nat) (pico : U128) (index : Usize)
    (window : index.val + remaining = 5) :
    arithmetic.price_microusd_loop tokens rates pico index ⦃ result =>
      pricingResultNat result = pricingFold tokens rates pico.val index.val remaining ⦄ := by
  induction remaining generalizing pico index with
  | zero =>
    have terminal : index = 5#usize := by
      apply UScalar.val_eq_imp
      simp
      omega
    subst index
    apply WP.spec_mono (pricing_terminal_exact tokens rates pico)
    intro result post
    simpa [pricingFold] using pricing_finish_post pico.val result post
  | succ remaining ih =>
    have upper : index.val < 5 := by omega
    unfold arithmetic.price_microusd_loop
    rw [loop.eq_def]
    apply WP.spec_bind (pricing_body_exact tokens rates pico index upper)
    intro flow post
    cases flow with
    | cont state =>
      rcases state with ⟨next, nextIndex⟩
      rcases post with ⟨advanced, bucket⟩
      simp only [pricingFold, bucket]
      have nextWindow : nextIndex.val + remaining = 5 := by omega
      simpa [arithmetic.price_microusd_loop, advanced] using ih next nextIndex nextWindow
    | done result =>
      rcases post with ⟨error, rfl, bucket⟩
      simp only [pricingFold, bucket, pricingResultNat]
      simp

/-- Complete actual five-bucket pricing, with every full-width token and optional
    full-width rate. The independent Nat fold preserves the first refusal. -/
theorem pricing_all_rates_exact
    (tokens : Array U128 5#usize) (rates : Array (Option U128) 5#usize) :
    arithmetic.price_microusd tokens rates ⦃ result =>
      pricingResultNat result = pricingFold tokens rates 0 0 5 ⦄ := by
  simpa [arithmetic.price_microusd] using
    pricing_loop_exact tokens rates 5 0#u128 0#usize (by simp)

/-- Every nonzero bucket has a rate; absent rates on zero buckets stay absent. -/
def pricingKnown (tokens : Array U128 5#usize) (rates : Array (Option U128) 5#usize)
    (index : Nat) : Nat → Prop
  | 0 => True
  | remaining + 1 =>
      (tokens.val[index]!.val = 0 ∨ ∃ rate, rates.val[index]! = some rate) ∧
      pricingKnown tokens rates (index + 1) remaining

/-- Natural-number dot product. The success theorem separately requires
    `pricingKnown`, so this total's absent-rate default never invents a price. -/
def pricingTotal (tokens : Array U128 5#usize) (rates : Array (Option U128) 5#usize)
    (index : Nat) : Nat → Nat
  | 0 => 0
  | remaining + 1 => tokens.val[index]!.val *
      (rates.val[index]!.map UScalar.val).getD 0 + pricingTotal tokens rates (index + 1) remaining

theorem pricing_finish_success_iff (pico value : Nat) :
    pricingFinish pico = .Ok value ↔
      pico + 500000 ≤ U128.max ∧ value = (pico + 500000) / 1000000 ∧
      value ≤ 999999999999999999999999 := by
  unfold pricingFinish
  split
  · simp_all
  · split <;> simp_all
    omega

theorem pricing_fold_success_iff
    (tokens : Array U128 5#usize) (rates : Array (Option U128) 5#usize)
    (remaining pico index value : Nat) :
    pricingFold tokens rates pico index remaining = .Ok value ↔
      pricingKnown tokens rates index remaining ∧
      pico + pricingTotal tokens rates index remaining + 500000 ≤ U128.max ∧
      value = (pico + pricingTotal tokens rates index remaining + 500000) / 1000000 ∧
      value ≤ 999999999999999999999999 := by
  induction remaining generalizing pico index with
  | zero => simpa [pricingFold, pricingKnown, pricingTotal] using pricing_finish_success_iff pico value
  | succ remaining ih =>
    by_cases zero : tokens.val[index]!.val = 0
    · simpa only [pricingFold, pricingKnown, pricingTotal, pricingBucket, zero,
        if_true, zero_mul, Nat.add_zero, Nat.zero_add, true_or, true_and] using
        ih pico (index + 1)
    · cases rate : rates.val[index]! with
      | none => simp only [pricingFold, pricingKnown, pricingTotal, pricingBucket,
          zero, rate, if_false, Option.map_none, Option.getD_none, false_or,
          reduceCtorEq, exists_false, false_and]
      | some rateValue =>
        by_cases bounded : pico + tokens.val[index]!.val * rateValue.val ≤ U128.max
        · simpa only [pricingFold, pricingKnown, pricingTotal, pricingBucket, zero, rate,
            if_false, Option.map_some, Option.getD_some, bounded, if_true, false_or,
            Option.some.injEq, exists_eq', true_and, Nat.add_assoc] using
            ih (pico + tokens.val[index]!.val * rateValue.val) (index + 1)
        · simp only [pricingFold, pricingKnown, pricingTotal, pricingBucket, zero, rate,
            if_false, Option.map_some, Option.getD_some, bounded, false_or,
            Option.some.injEq, exists_eq', true_and, reduceCtorEq, false_iff]
          intro conditions
          rcases conditions with ⟨_, totalBound, _, _⟩
          omega

/-- A successful record is exactly the natural-number dot product, rounded once.
    Missing rates may be ignored only on zero-token buckets. -/
theorem pricing_all_rates_success_formula
    (tokens : Array U128 5#usize) (rates : Array (Option U128) 5#usize) :
    arithmetic.price_microusd tokens rates ⦃ result => match result with
      | .Ok value => pricingKnown tokens rates 0 5 ∧
          pricingTotal tokens rates 0 5 + 500000 ≤ U128.max ∧
          value.val = (pricingTotal tokens rates 0 5 + 500000) / 1000000 ∧
          value.val ≤ 999999999999999999999999
      | .Err _ => True ⦄ := by
  apply WP.spec_mono (pricing_all_rates_exact tokens rates)
  intro result post
  cases result with
  | Ok value =>
    have exact := (pricing_fold_success_iff tokens rates 5 0 0 value.val).mp post.symm
    simpa using exact
  | Err _ => trivial

/-- Turn exact Nat-model evidence into equality of the actual typed result. -/
theorem pricing_expected_result_exact
    (tokens : Array U128 5#usize) (rates : Array (Option U128) 5#usize)
    (expected : core.result.Result U128 Error)
    (model : pricingFold tokens rates 0 0 5 = pricingResultNat expected) :
    arithmetic.price_microusd tokens rates = ok expected := by
  obtain ⟨result, evaluates, post⟩ := WP.spec_imp_exists (pricing_all_rates_exact tokens rates)
  have sameNat := post.trans model
  cases result with
  | Ok value =>
    cases expected with
    | Ok desired =>
      have same : value = desired := by
        apply UScalar.val_eq_imp
        simpa [pricingResultNat] using sameNat
      simpa [same] using evaluates
    | Err _ => simp [pricingResultNat] at sameNat
  | Err error =>
    cases expected with
    | Ok _ => simp [pricingResultNat] at sameNat
    | Err desired =>
      have same : error = desired := by simpa [pricingResultNat] using sameNat
      simpa [same] using evaluates

theorem pricing_five_bucket_success_witness :
    arithmetic.price_microusd
      (Array.make 5#usize [1#u128, 2#u128, 3#u128, 4#u128, 5#u128])
      (Array.make 5#usize [some 1000000#u128, some 2000000#u128,
        some 3000000#u128, some 4000000#u128, some 5000000#u128]) = ok (.Ok 55#u128) := by
  exact pricing_expected_result_exact
      (Array.make 5#usize [1#u128, 2#u128, 3#u128, 4#u128, 5#u128])
      (Array.make 5#usize [some 1000000#u128, some 2000000#u128,
        some 3000000#u128, some 4000000#u128, some 5000000#u128])
      (.Ok 55#u128) (by
    simp only [pricingResultNat]
    rw [pricing_fold_success_iff]
    norm_num [pricingKnown, pricingTotal, U128.max, U128.numBits])

#print axioms pricing_finish_post
#print axioms pricing_body_exact
#print axioms pricing_loop_exact
#print axioms pricing_all_rates_exact
#print axioms pricing_finish_success_iff
#print axioms pricing_fold_success_iff
#print axioms pricing_all_rates_success_formula
#print axioms pricing_expected_result_exact
#print axioms pricing_five_bucket_success_witness
end aicharts_metrics
