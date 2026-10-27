// Whether a quotation actually carries a configured VAT rate.
//
// A rate above zero is proof on its own: quotations saved before the explicit flag existed can
// still carry a real rate, and hiding their VAT line would be wrong. Zero only counts when the
// flag says the rate was entered deliberately, so a rate nobody ever configured is never
// presented as "0%" anywhere.
export function hasConfiguredVat(quotation) {
  if (!quotation) return false;
  if (quotation.tax_rate_set === true) return true;
  return Number(quotation.tax_rate || 0) > 0;
}

// The flag to store for a form submission: an empty rate field means VAT treatment is
// unspecified, and any entered value (including zero) is an explicit choice.
export function taxFlagForInput(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}