/**
 * Canonical, provider-independent export model.
 *
 * Built ONLY from the frozen issued invoice record. This module performs NO arithmetic
 * of its own: every amount is copied verbatim from the stored invoice. Its only numeric
 * work is cross-checking that the stored figures agree with each other — and when they do
 * not, it reports an issue and refuses to export. It never repairs or recalculates.
 */

export const EPSILON = 0.005;

export const DOCUMENT_KINDS = Object.freeze({
  INVOICE: "invoice",
  CREDIT_NOTE: "credit_note",
});

export const ISSUE_CODES = Object.freeze({
  INVOICE_MISSING: "invoice_missing",
  NOT_ISSUED: "not_issued",
  MISSING_FIELD: "missing_field",
  NO_LINES: "no_lines",
  LINES_TOTAL_MISMATCH: "lines_total_mismatch",
  VAT_SUMMARY_MISMATCH: "vat_summary_mismatch",
  TOTALS_MISMATCH: "totals_mismatch",
  SELLER_MISSING: "seller_missing",
  BUYER_MISSING: "buyer_missing",
});

export function issue(code, field, detail) {
  return { code, field, detail };
}

export function nearlyEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < EPSILON;
}

const REQUIRED_DOCUMENT_FIELDS = ["company_id", "number", "currency", "issue_date", "due_date"];

/**
 * Build the canonical export DTO.
 *
 * @param {object} invoice  An Orqacel Invoice record (must be `issued`).
 * @returns {{ok: boolean, issues: Array, dto: object|null}}
 */
export function buildCanonicalInvoice(invoice) {
  if (!invoice || typeof invoice !== "object") {
    return { ok: false, issues: [issue(ISSUE_CODES.INVOICE_MISSING, "invoice", "an invoice is required")], dto: null };
  }

  const issues = [];

  if (invoice.status !== "issued") {
    issues.push(
      issue(ISSUE_CODES.NOT_ISSUED, "status", `only issued invoices can be exported (received "${invoice.status}")`),
    );
  }

  for (const field of REQUIRED_DOCUMENT_FIELDS) {
    if (invoice[field] === undefined || invoice[field] === null || invoice[field] === "") {
      issues.push(issue(ISSUE_CODES.MISSING_FIELD, field, `${field} is required`));
    }
  }

  const seller = invoice.seller_snapshot || {};
  if (!seller.name) {
    issues.push(issue(ISSUE_CODES.SELLER_MISSING, "seller_snapshot.name", "the seller name is required"));
  }

  const buyer = invoice.buyer_snapshot || {};
  if (!buyer.name) {
    issues.push(issue(ISSUE_CODES.BUYER_MISSING, "buyer_snapshot.name", "the buyer name is required"));
  }

  const lines = Array.isArray(invoice.line_items) ? invoice.line_items : [];
  if (lines.length === 0) {
    issues.push(issue(ISSUE_CODES.NO_LINES, "line_items", "at least one invoice line is required"));
  }

  const vatRows = Array.isArray(invoice.vat_summary) ? invoice.vat_summary : [];

  // Integrity checks only — a mismatch is reported, never corrected.
  if (lines.length > 0) {
    const linesTotal = lines.reduce((sum, line) => sum + Number(line.line_total || 0), 0);
    if (!nearlyEqual(linesTotal, invoice.subtotal)) {
      issues.push(
        issue(
          ISSUE_CODES.LINES_TOTAL_MISMATCH,
          "subtotal",
          `line totals (${linesTotal}) do not match the stored subtotal (${invoice.subtotal})`,
        ),
      );
    }
  }

  const vatTotal = vatRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  if (!nearlyEqual(vatTotal, invoice.vat_amount)) {
    issues.push(
      issue(
        ISSUE_CODES.VAT_SUMMARY_MISMATCH,
        "vat_amount",
        `vat summary total (${vatTotal}) does not match the stored vat amount (${invoice.vat_amount})`,
      ),
    );
  }

  if (!nearlyEqual(Number(invoice.subtotal) + Number(invoice.vat_amount), invoice.total)) {
    issues.push(
      issue(
        ISSUE_CODES.TOTALS_MISMATCH,
        "total",
        `subtotal + vat (${Number(invoice.subtotal) + Number(invoice.vat_amount)}) does not match the stored total (${invoice.total})`,
      ),
    );
  }

  if (issues.length > 0) {
    return { ok: false, issues, dto: null };
  }

  const payment = invoice.payment_snapshot || {};

  const dto = {
    document: {
      kind: DOCUMENT_KINDS.INVOICE,
      number: invoice.number,
      issue_date: invoice.issue_date,
      due_date: invoice.due_date,
      transaction_date: invoice.service_date || invoice.issue_date,
      currency: invoice.currency,
      company_id: invoice.company_id,
      invoice_id: invoice.id || null,
      revision: invoice.revision ?? null,
      source_invoice_id: null,
    },
    seller: {
      name: seller.name,
      legal_name: seller.legal_name || "",
      reg_no: seller.registration_number || "",
      vat_no: seller.tax_number || "",
      address: seller.address || "",
      city: seller.city || "",
      postal_code: seller.postal_code || "",
      country: seller.country || "",
      email: seller.email || "",
      phone: seller.phone || "",
    },
    buyer: {
      client_id: invoice.client_id || null,
      name: buyer.name,
      contact_name: buyer.contact_name || "",
      reg_no: buyer.registration_number || "",
      vat_no: buyer.tax_id || "",
      address: buyer.address || "",
      city: buyer.city || "",
      postal_code: buyer.postal_code || "",
      country: buyer.country || "",
      email: buyer.email || "",
      phone: buyer.phone || "",
    },
    lines: lines.map((line, index) => ({
      position: line.position ?? index,
      description: line.description || "",
      quantity: line.quantity,
      unit_price: line.unit_price,
      line_total: line.line_total,
      vat_rate: line.vat_rate,
    })),
    vat: vatRows.map((row) => ({ rate: row.rate, base: row.base, amount: row.amount })),
    totals: {
      subtotal: invoice.subtotal,
      vat_amount: invoice.vat_amount,
      total: invoice.total,
    },
    payment: {
      reference: invoice.payment_reference || payment.reference || "",
      description: invoice.payment_description || payment.description || "",
      terms: invoice.payment_terms || payment.terms || "",
      account_holder: payment.account_holder || "",
      iban: payment.iban || "",
      bank_name: payment.bank_name || "",
      bic: payment.bic || "",
    },
  };

  return { ok: true, issues: [], dto };
}

/** Distinct VAT rates used by the invoice, in first-seen order. */
export function usedVatRates(dto) {
  const seen = [];
  for (const line of dto.lines) {
    const rate = Number(line.vat_rate);
    if (!seen.includes(rate)) seen.push(rate);
  }
  return seen;
}