/**
 * Test fixtures shaped like real Orqacel records. Test-only.
 *
 * The invoice deliberately mixes VAT rates (24 % and 9 %) and is already `issued` with frozen
 * snapshots, mirroring what the invoice lifecycle produces today.
 */

export const VAT_24 = "11111111-1111-4111-8111-111111111111";
export const VAT_9 = "22222222-2222-4222-8222-222222222222";

export function makeInvoice(overrides = {}) {
  const base = {
    id: "inv_1",
    company_id: "co_1",
    client_id: "cl_1",
    client_name: "Acme OÜ",
    number: "INV-1001",
    status: "issued",
    revision: 1,
    issue_date: "2026-02-01",
    due_date: "2026-02-15",
    currency: "EUR",
    line_items: [
      { position: 0, description: "Consulting", quantity: 10, unit_price: 100, vat_rate: 24, line_total: 1000 },
      { position: 1, description: "Support", quantity: 5, unit_price: 100, vat_rate: 9, line_total: 500 },
    ],
    vat_rate_set: true,
    vat_summary: [
      { rate: 24, base: 1000, amount: 240 },
      { rate: 9, base: 500, amount: 45 },
    ],
    subtotal: 1500,
    vat_amount: 285,
    total: 1785,
    payment_reference: "12345",
    payment_description: "Invoice INV-1001",
    payment_terms: "14 days",
    seller_snapshot: {
      name: "Orqacel OÜ",
      legal_name: "Orqacel OÜ",
      registration_number: "12345678",
      tax_number: "EE123456789",
      email: "billing@orqacel.com",
      phone: "+372 5555 0000",
      address: "Narva mnt 5",
      city: "Tallinn",
      postal_code: "10117",
      country: "EE",
    },
    buyer_snapshot: {
      name: "Acme OÜ",
      contact_name: "Mari Mets",
      email: "mari@acme.example",
      phone: "+372 5555 1111",
      address: "Pärnu mnt 10",
      city: "Tallinn",
      postal_code: "10148",
      country: "Estonia",
      tax_id: "EE987654321",
    },
    payment_snapshot: {
      account_holder: "Orqacel OÜ",
      iban: "EE382200221020145685",
      bank_name: "Swedbank",
      bic: "HABAEE2X",
      reference: "12345",
      description: "Invoice INV-1001",
      terms: "14 days",
    },
    issued_at: "2026-02-01T09:00:00.000Z",
  };

  return { ...base, ...overrides };
}

export function makeConnection(overrides = {}) {
  const base = {
    id: "conn_1",
    company_id: "co_1",
    provider: "merit",
    status: "connected",
    export_mode: "manual",
    provider_customer_id: null,
    vat_status_map: { cl_1: true },
    vat_mappings: [
      { rate: 24, tax_id: VAT_24, tax_code: "EE24", name: "Standard 24%" },
      { rate: 9, tax_id: VAT_9, tax_code: "EE9", name: "Reduced 9%" },
    ],
    item_codes: { 24: "ORQ-SVC-24", 9: "ORQ-SVC-9" },
    defaults: { item_type: 2, invoice_language: "EN" },
  };

  return { ...base, ...overrides };
}

export function makeActor(overrides = {}) {
  return { userId: "u_1", role: "admin", companyId: "co_1", ...overrides };
}

/** A frozen copy, used to prove the exporter never mutates the invoice it was given. */
export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}