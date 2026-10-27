// Historical identity snapshots for an invoice. Server-only.
//
// An invoice is a financial record: what the seller and the customer were when it was issued has to
// stay readable exactly that way, however the company or customer profiles are edited afterwards.
// These builders read a company or a customer record and return the plain values an invoice keeps
// forever. They are captured when the invoice is created and frozen again in the same write that
// issues it; nothing reads the live profiles when an invoice is displayed.
//
// The logo image is not copied per invoice: only the version marker of the logo that was current at
// the time is kept, so a document can tell whether the mark it would draw is still the one it was
// issued with without storing a file per invoice.

const SELLER_FIELDS = [
  "name",
  "legal_name",
  "registration_number",
  "tax_number",
  "email",
  "phone",
  "website",
  "address",
  "city",
  "postal_code",
  "country",
];

const BUYER_FIELDS = [
  "name",
  "contact_name",
  "email",
  "phone",
  "address",
  "city",
  "postal_code",
  "country",
  "tax_id",
];

// Only fields that actually hold something are kept, so a snapshot never carries empty values that
// could later be mistaken for "this detail was blank at the time".
function pick(record, fields) {
  const picked = {};
  fields.forEach((field) => {
    const value = record?.[field];
    if (typeof value === "string" && value.trim()) picked[field] = value.trim();
  });
  return picked;
}

export function buildSellerSnapshot(company) {
  const snapshot = pick(company, SELLER_FIELDS);
  if (company?.logo_updated_at) snapshot.logo_updated_at = company.logo_updated_at;
  return snapshot;
}

export function buildBuyerSnapshot(client) {
  return pick(client, BUYER_FIELDS);
}

// The fields that make up the payment details of an invoice.
const PAYMENT_FIELDS = [
  "account_holder",
  "iban",
  "bank_name",
  "bic",
  "reference",
  "description",
  "terms",
  "service_date",
  "service_period_start",
  "service_period_end",
];

// How an invoice is paid, as the invoice itself keeps it. Called when the invoice is created and when
// a draft is edited, and again in the same write that issues it.
//
// `account` is the live company bank account when one is still there: the values it holds at that
// moment are what gets captured. When it has since been deleted, the details the invoice already
// carries are kept instead, so an invoice that showed where to pay never ends up with nothing.
export function buildPaymentSnapshot({ invoice, account }) {
  const identity = account
    ? {
        account_holder: account.account_holder,
        iban: account.iban,
        bank_name: account.bank_name,
        bic: account.bic,
      }
    : {
        account_holder: invoice?.account_holder || invoice?.payment_snapshot?.account_holder || "",
        iban: invoice?.iban || invoice?.payment_snapshot?.iban || "",
        bank_name: invoice?.bank_name || invoice?.payment_snapshot?.bank_name || "",
        bic: invoice?.bic || invoice?.payment_snapshot?.bic || "",
      };

  return pick(
    {
      ...identity,
      reference: invoice?.payment_reference || "",
      description: invoice?.payment_description || "",
      terms: invoice?.payment_terms || "",
      service_date: invoice?.service_date || "",
      service_period_start: invoice?.service_period_start || "",
      service_period_end: invoice?.service_period_end || "",
    },
    PAYMENT_FIELDS,
  );
}