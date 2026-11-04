/**
 * Merit Aktiva payload mapper.
 *
 * Pure mapping: canonical DTO in, documented Merit payload out. No HTTP, no clock beyond a
 * supplied timestamp, no arithmetic on invoice amounts beyond grouping the stored VAT rows
 * by tax identifier (which is what the provider's TaxAmount array is).
 *
 * Field names, types and lengths follow the Merit dokumentatsioon as recorded in the P0 audit.
 * Everything not documented there is absent rather than invented.
 */

import { validateBuyerInformation, validateCountryCode, validateVatMapping, resolveItemCodes, validateLineDescriptions, resolveVatRegistered } from "../validation.js";
import { toIso2 } from "../countries.js";

export const MERIT_BASE_URLS = Object.freeze({
  ee: "https://aktiva.merit.ee/api/v1/",
  eeV2: "https://aktiva.merit.ee/api/v2/",
});

export const MERIT_LIMITS = Object.freeze({
  invoiceNo: 35,
  description: 150,
  itemCode: 20,
  itemName: 150,
  contact: 35,
  regNo: 30,
  vatRegNo: 30,
  refNo: 36,
  comment: 4000,
  maxRows: 500,
});

export const DEFAULT_ITEM_TYPE_SERVICE = 2;

function problem(code, field, detail) {
  return { code, field, detail };
}

/** Orqacel dates (YYYY-MM-DD) → Merit request dates (yyyyMMddHHmmss). */
export function toMeritDateTime(value) {
  if (!value) return null;
  const raw = String(value).trim();

  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return `${dateOnly[1]}${dateOnly[2]}${dateOnly[3]}000000`;

  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{6})?$/);
  if (compact) return `${compact[1]}${compact[2]}${compact[3]}${compact[4] || "000000"}`;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}${iso[4]}${iso[5]}${iso[6]}`;

  return null;
}

/** Merit's payment reference is numeric; anything else is omitted rather than coerced. */
export function toMeritRefNo(reference) {
  if (!reference) return null;
  const digits = String(reference).replace(/\s+/g, "");
  if (!/^\d{1,36}$/.test(digits)) return null;
  return digits;
}

function buildCustomer(dto, connection) {
  const buyer = dto.buyer;
  const vatRegistered = resolveVatRegistered(connection.vat_status_map, buyer.client_id);

  const customer = {
    Name: buyer.name,
    // NotTDCustomer is required when the provider has to create the customer.
    // It is the direct inverse of an explicitly declared status, never an inference.
    NotTDCustomer: vatRegistered === true ? "false" : "true",
    CountryCode: toIso2(buyer.country),
  };

  if (connection.provider_customer_id) customer.Id = connection.provider_customer_id;
  if (buyer.reg_no) customer.RegNo = String(buyer.reg_no).slice(0, MERIT_LIMITS.regNo);
  if (buyer.vat_no) customer.VatRegNo = String(buyer.vat_no).slice(0, MERIT_LIMITS.vatRegNo);
  if (buyer.contact_name) customer.Contact = String(buyer.contact_name).slice(0, MERIT_LIMITS.contact);
  if (buyer.email) customer.Email = buyer.email;
  if (buyer.phone) customer.PhoneNo = buyer.phone;
  if (buyer.address) customer.Address = buyer.address;
  if (buyer.city) customer.City = buyer.city;
  if (buyer.postal_code) customer.PostalCode = buyer.postal_code;

  return customer;
}

/**
 * Map a validated canonical DTO to a Merit `sendinvoice` payload.
 *
 * @returns {{ok: boolean, payload: object|null, issues: Array}}
 */
export function buildMeritPayload(dto, connection = {}) {
  const issues = [];

  const itemCodesResult = resolveItemCodes(dto, connection.item_codes || {});
  issues.push(
    ...validateBuyerInformation(dto, { vatStatusMap: connection.vat_status_map || {} }),
    ...validateCountryCode(dto),
    ...validateVatMapping(dto, connection.vat_mappings || []),
    ...validateLineDescriptions(dto),
    ...itemCodesResult.issues,
  );

  if (String(dto.document.number || "").length > MERIT_LIMITS.invoiceNo) {
    issues.push(problem("invoice_number_too_long", "document.number", `the invoice number must be at most ${MERIT_LIMITS.invoiceNo} characters`));
  }
  if (dto.lines.length > MERIT_LIMITS.maxRows) {
    issues.push(problem("too_many_rows", "lines", `at most ${MERIT_LIMITS.maxRows} lines can be exported at once`));
  }

  const docDate = toMeritDateTime(dto.document.issue_date);
  const dueDate = toMeritDateTime(dto.document.due_date);
  if (!docDate) issues.push(problem("invalid_document_date", "document.issue_date", "the issue date is not a valid date"));
  if (!dueDate) issues.push(problem("invalid_due_date", "document.due_date", "the due date is not a valid date"));

  if (issues.length > 0) return { ok: false, payload: null, issues };

  const taxIdByRate = new Map();
  for (const mapping of connection.vat_mappings || []) {
    taxIdByRate.set(Number(mapping.rate), mapping.tax_id);
  }

  const itemType = connection.defaults?.item_type ?? DEFAULT_ITEM_TYPE_SERVICE;
  const uom = connection.defaults?.unit_of_measure || null;

  const invoicesRows = dto.lines.map((line) => {
    const row = {
      Item: {
        Code: itemCodesResult.codes[Number(line.vat_rate)],
        Description: String(line.description).slice(0, MERIT_LIMITS.description),
        Type: itemType,
      },
      Quantity: Number(line.quantity),
      Price: Number(line.unit_price),
      TaxId: taxIdByRate.get(Number(line.vat_rate)),
    };
    if (uom) row.Item.UOMName = uom;
    if (connection.defaults?.income_account) row.GLAccountCode = connection.defaults.income_account;
    return row;
  });

  // Group the stored VAT rows by tax id. Amounts are summed from vat_summary, never recomputed
  // from the lines: the canonical builder has already proven they equal the stored vat_amount.
  const taxTotals = new Map();
  for (const row of dto.vat) {
    const taxId = taxIdByRate.get(Number(row.rate));
    taxTotals.set(taxId, (taxTotals.get(taxId) || 0) + Number(row.amount));
  }

  const payload = {
    InvoiceNo: dto.document.number,
    DocDate: docDate,
    DueDate: dueDate,
    CurrencyCode: dto.document.currency,
    Customer: buildCustomer(dto, connection),
    InvoiceRow: invoicesRows,
    TaxAmount: [...taxTotals.entries()].map(([TaxId, Amount]) => ({ TaxId, Amount })),
    TotalAmount: Number(dto.totals.subtotal),
  };

  const refNo = toMeritRefNo(dto.payment.reference);
  if (refNo) payload.RefNo = refNo;

  if (dto.payment.description) payload.Hcomment = String(dto.payment.description).slice(0, MERIT_LIMITS.comment);
  if (dto.payment.terms) payload.Fcomment = String(dto.payment.terms).slice(0, MERIT_LIMITS.comment);

  if (connection.defaults?.invoice_language) {
    payload.Customer.SalesInvLang = connection.defaults.invoice_language;
  }

  return { ok: true, payload, issues: [] };
}