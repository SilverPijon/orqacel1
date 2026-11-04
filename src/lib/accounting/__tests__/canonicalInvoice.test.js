import test from "node:test";
import assert from "node:assert/strict";

import { ISSUE_CODES, buildCanonicalInvoice, usedVatRates } from "../canonicalInvoice.js";
import { buildMeritPayload } from "../merit/mapper.js";
import { deepFreeze, makeConnection, makeInvoice } from "../testing/fixtures.js";

test("1. converts a valid issued invoice into the canonical DTO", () => {
  const result = buildCanonicalInvoice(makeInvoice());

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.dto.document.number, "INV-1001");
  assert.equal(result.dto.document.kind, "invoice");
  assert.equal(result.dto.document.currency, "EUR");
  assert.equal(result.dto.seller.name, "Orqacel OÜ");
  assert.equal(result.dto.buyer.name, "Acme OÜ");
  assert.equal(result.dto.lines.length, 2);
  assert.equal(result.dto.vat.length, 2);
});

test("2. keeps mixed VAT rates separate", () => {
  const { dto } = buildCanonicalInvoice(makeInvoice());

  assert.deepEqual(usedVatRates(dto), [24, 9]);
  assert.deepEqual(
    dto.vat.map((row) => row.rate),
    [24, 9],
  );
  assert.equal(dto.vat[0].amount, 240);
  assert.equal(dto.vat[1].amount, 45);
});

test("16. never alters the stored amounts or the invoice number", () => {
  const invoice = makeInvoice();
  const original = JSON.parse(JSON.stringify(invoice));

  const { dto } = buildCanonicalInvoice(invoice);

  assert.equal(dto.totals.subtotal, 1500);
  assert.equal(dto.totals.vat_amount, 285);
  assert.equal(dto.totals.total, 1785);
  assert.equal(dto.document.number, "INV-1001");
  assert.equal(dto.lines[0].line_total, 1000);
  assert.equal(dto.lines[0].unit_price, 100);

  // The invoice given to the exporter is untouched.
  assert.deepEqual(invoice, original);
});

test("16. refuses to export when the stored figures disagree, instead of recalculating", () => {
  const brokenLines = buildCanonicalInvoice(
    makeInvoice({
      line_items: [
        { position: 0, description: "Consulting", quantity: 10, unit_price: 100, vat_rate: 24, line_total: 999 },
        { position: 1, description: "Support", quantity: 5, unit_price: 100, vat_rate: 9, line_total: 500 },
      ],
    }),
  );

  assert.equal(brokenLines.ok, false);
  assert.ok(brokenLines.issues.some((issue) => issue.code === ISSUE_CODES.LINES_TOTAL_MISMATCH));

  const brokenVat = buildCanonicalInvoice(makeInvoice({ vat_amount: 300, total: 1800 }));
  assert.equal(brokenVat.ok, false);
  assert.ok(brokenVat.issues.some((issue) => issue.code === ISSUE_CODES.VAT_SUMMARY_MISMATCH));

  const brokenTotals = buildCanonicalInvoice(makeInvoice({ total: 1790 }));
  assert.equal(brokenTotals.ok, false);
  assert.ok(brokenTotals.issues.some((issue) => issue.code === ISSUE_CODES.TOTALS_MISMATCH));
});

test("refuses anything that is not an issued invoice", () => {
  const draft = buildCanonicalInvoice(makeInvoice({ status: "draft" }));

  assert.equal(draft.ok, false);
  assert.ok(draft.issues.some((issue) => issue.code === ISSUE_CODES.NOT_ISSUED));
  assert.equal(draft.dto, null);
});

test("maps to a Merit payload with net totals carried across verbatim", () => {
  const { dto } = buildCanonicalInvoice(makeInvoice());
  const mapped = buildMeritPayload(dto, makeConnection());

  assert.equal(mapped.ok, true, JSON.stringify(mapped.issues));
  assert.equal(mapped.payload.InvoiceNo, "INV-1001");
  assert.equal(mapped.payload.TotalAmount, 1500);
  assert.equal(mapped.payload.CurrencyCode, "EUR");
  assert.equal(mapped.payload.DocDate, "20260201000000");
  assert.equal(mapped.payload.DueDate, "20260215000000");
  assert.equal(mapped.payload.InvoiceRow.length, 2);
  assert.equal(mapped.payload.InvoiceRow[0].Price, 100);
  assert.equal(mapped.payload.InvoiceRow[0].Item.Code, "ORQ-SVC-24");
  assert.equal(mapped.payload.InvoiceRow[1].Item.Code, "ORQ-SVC-9");

  const taxTotal = mapped.payload.TaxAmount.reduce((sum, row) => sum + row.Amount, 0);
  assert.equal(taxTotal, 285);
  assert.equal(mapped.payload.Customer.CountryCode, "EE");
  assert.equal(mapped.payload.Customer.NotTDCustomer, "false");
});

test("works with a deeply frozen invoice and performs no writes", () => {
  const invoice = deepFreeze(makeInvoice());
  const { dto } = buildCanonicalInvoice(invoice);
  const mapped = buildMeritPayload(dto, makeConnection());

  assert.equal(mapped.ok, true);
  assert.equal(mapped.payload.InvoiceNo, "INV-1001");
});