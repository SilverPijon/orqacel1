// The invoice lifecycle for this phase: a draft can be edited freely, issuing it freezes the
// financial data, and cancelling keeps the record for history. Issue and cancel are one-way, and
// these rules are enforced on the server — the UI only uses them to decide what to offer.

export const INVOICE_STATUSES = ["draft", "issued", "cancelled"];

export const INVOICE_TRANSITIONS = {
  draft: ["issued", "cancelled"],
  issued: ["cancelled"],
  cancelled: [],
};

export function canTransition(from, to) {
  return (INVOICE_TRANSITIONS[from] || []).includes(to);
}

// A draft is the only state whose content may change, and the only state that may be deleted.
export function isDraft(invoice) {
  return Boolean(invoice) && invoice.status === "draft";
}