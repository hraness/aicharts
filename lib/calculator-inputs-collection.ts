import calculatorInputsData from "@/data/calculator-inputs.json";
import {
  calculatorInputsModifiedAt,
  parseCalculatorInputsSnapshot,
} from "./calculator-inputs-data";

const checkedInput: unknown = calculatorInputsData;
const checkedInputs = parseCalculatorInputsSnapshot(checkedInput);
if (!checkedInputs.ok) {
  throw new Error(
    `Checked calculator inputs are invalid: ${checkedInputs.error.message}`,
    { cause: checkedInputs.error },
  );
}

export const CALCULATOR_INPUTS = checkedInputs.value;
export const CALCULATOR_INPUTS_MODIFIED_AT = calculatorInputsModifiedAt(CALCULATOR_INPUTS);
