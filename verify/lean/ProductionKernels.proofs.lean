
namespace aicharts_metrics
open Aeneas Aeneas.Std Result

@[step]
theorem checked_add_exact (x y : U128) :
    arithmetic.checked_add x y ⦃ result => match result with
      | .Ok v => v.val = x.val + y.val
      | .Err e => e = Error.Overflow ∧ U128.max < x.val + y.val ⦄ := by
  unfold arithmetic.checked_add
  step
  split <;> simp_all

@[step]
theorem checked_add_bounded_exact (x y limit : U128) :
    arithmetic.checked_add_bounded x y limit ⦃ result => match result with
      | .Ok v => v.val = x.val + y.val ∧ v.val ≤ limit.val
      | .Err _ => U128.max < x.val + y.val ∨ limit.val < x.val + y.val ⦄ := by
  unfold arithmetic.checked_add_bounded
  step
  split
  · split <;> simp_all
  · simp_all

@[step]
theorem checked_replace_exact (total previous replacement : U128) :
    arithmetic.checked_replace total previous replacement ⦃ result => match result with
      | .Ok v => previous.val ≤ total.val ∧ v.val = total.val - previous.val + replacement.val
      | .Err _ => total.val < previous.val ∨ U128.max < total.val - previous.val + replacement.val ⦄ := by
  unfold arithmetic.checked_replace
  step
  split
  · simp_all
  · step
    split <;> simp_all

#print axioms checked_add_exact
#print axioms checked_add_bounded_exact
#print axioms checked_replace_exact

@[step]
theorem array_u8_eq_spec (left right : Array U8 16#usize) :
    core.array.equality.PartialEqArray.eq core.cmp.PartialEqU8 left right
      ⦃ b => b ↔ left = right ⦄ := by
  have h := core.slice.cmp.PartialEqSlice.eq_homo_spec
    core.cmp.PartialEqU8 left.to_slice right.to_slice (by
      intro x y
      simp [core.cmp.impls.PartialEqU8.ne, liftFun2])
  simpa [core.array.equality.PartialEqArray.eq, core.slice.cmp.PartialEqSlice.eq,
    Array.eq_iff, Slice.eq_iff] using h

@[step]
theorem merge_owner_exact (left right : Array U8 16#usize) (allow : Bool) :
    revision.merge_owner left right allow ⦃ result => match result with
      | .Ok value => (left = right ∧ value = left) ∨
          (allow ∧ ((left = Array.repeat 16#usize 0#u8 ∧ value = right) ∨
            (right = Array.repeat 16#usize 0#u8 ∧ value = left)))
      | .Err error => error = Error.OwnerConflict ∧ left ≠ right ∧
          (¬allow ∨ (left ≠ Array.repeat 16#usize 0#u8 ∧ right ≠ Array.repeat 16#usize 0#u8)) ⦄ := by
  unfold revision.merge_owner
  step
  split
  · simp_all
  · split
    · step
      split
      · simp_all
      · step
        split <;> simp_all
    · simp_all

#print axioms array_u8_eq_spec
#print axioms merge_owner_exact

end aicharts_metrics
