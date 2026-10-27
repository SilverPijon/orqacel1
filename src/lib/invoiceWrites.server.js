// Conditional invoice writes. Server-only.
//
// Base44 locks no records and runs no transactions, so an invoice is never changed with a plain
// update: every state change is written as one conditional update that applies only while the
// invoice still reads exactly as the caller saw it ("compare and set"). Base44 rechecks those
// conditions at the moment of the write, so of two racing callers at most one succeeds and the
// other is told what the invoice actually is. This is what keeps an issued invoice unchangeable and
// undeletable even when an edit, an issue, a cancel and a delete arrive at the same instant.
//
// The write is not a substitute for authorization: callers still resolve the company and the role
// first, and the company id stays in the condition as well.

// Returns how many records the write changed: 1 means this caller won, 0 means the invoice had
// already moved on (or was never in the expected state) and nothing was written.
export async function writeInvoiceIfStatus(service, { id, companyId, expectedStatus }, update) {
  const result = await service.entities.Invoice.updateMany(
    { id, company_id: companyId, status: expectedStatus },
    update,
  );
  return Number(result?.updated || 0);
}