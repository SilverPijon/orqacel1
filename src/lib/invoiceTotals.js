// Invoice money is handled in whole cents, so a long invoice cannot drift by a cent: every amount
// is rounded once, at the moment it appears, and the sums stay exact.

export const toCents = (value) => Math.round(Number(value || 0) * 100);
export const fromCents = (cents) => Math.round(Number(cents || 0)) / 100;

function normalizeLine(item, index) {
  const quantity = Math.max(0, Number(item?.quantity || 0));
  const unitPriceCents = toCents(item?.unit_price);
  // A fractional quantity (1.5 hours) times an exact unit price, rounded once to whole cents.
  const lineCents = Math.round(quantity * unitPriceCents);
  return {
    position: index,
    description: String(item?.description || "").trim(),
    quantity,
    unit_price: fromCents(unitPriceCents),
    vat_rate: Math.max(0, Number(item?.vat_rate || 0)),
    line_total: fromCents(lineCents),
    line_cents: lineCents,
  };
}

// Net and VAT amounts for a set of lines. VAT is charged on the net base of each rate, which is
// what a VAT summary is expected to show, and each line may carry a different rate: one invoice
// can mix 22% and 9% lines, and the amounts still add up to the total exactly.
export function computeInvoiceTotals(lineItems) {
  const lines = (lineItems || []).map(normalizeLine);
  const subtotalCents = lines.reduce((sum, line) => sum + line.line_cents, 0);

  const baseByRate = new Map();
  lines.forEach((line) => {
    baseByRate.set(line.vat_rate, (baseByRate.get(line.vat_rate) || 0) + line.line_cents);
  });

  const vat_summary = [...baseByRate.entries()]
    .sort((first, second) => first[0] - second[0])
    .map(([rate, baseCents]) => ({
      rate,
      base: fromCents(baseCents),
      amount: fromCents(Math.round((baseCents * rate) / 100)),
    }));

  const vatCents = vat_summary.reduce((sum, row) => sum + toCents(row.amount), 0);

  return {
    // Only the amounts that belong on the stored line are kept; line_cents stays internal.
    line_items: lines.map((line) => ({
      position: line.position,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      vat_rate: line.vat_rate,
      line_total: line.line_total,
    })),
    subtotal: fromCents(subtotalCents),
    vat_amount: fromCents(vatCents),
    vat_summary,
    total: fromCents(subtotalCents + vatCents),
  };
}

// Whether an invoice actually carries a configured VAT rate, following the same rule quotations
// use: a rate above zero is proof on its own, and zero only counts when it was entered
// deliberately — so a rate nobody ever set is never presented as "0%".
export function hasConfiguredInvoiceVat(invoice) {
  if (!invoice) return false;
  if (invoice.vat_rate_set === true) return true;
  if (Number(invoice.vat_amount || 0) > 0) return true;
  return (invoice.line_items || []).some((line) => Number(line?.vat_rate || 0) > 0);
}