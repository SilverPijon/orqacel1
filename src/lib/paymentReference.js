// Payment references (viitenumber, viitenumero, Zahlungsreferenz …). Shared by the browser and the
// server, so what the form shows is what gets stored.
//
// A payment reference is not the invoice number. It is the number the customer quotes when paying,
// and it is derived from the invoice number, which makes it deterministic: the same invoice always
// yields the same reference, and it is never regenerated once the invoice has been issued. A
// reference may also be entered by hand when a customer's own scheme requires it.
//
// Standards live in a registry rather than in the callers, so another country's scheme can be added
// by adding one entry: each standard knows how to build a reference from a base and how to check one.

// The repeating 7-3-1 weighting, read from the right — the Estonian and Finnish creditor reference.
const WEIGHTS_731 = [7, 3, 1];

function checkDigit731(digits) {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    sum += Number(digits[digits.length - 1 - index]) * WEIGHTS_731[index % 3];
  }
  // Ten minus the last digit of the sum; a sum that ends in zero gives a check digit of zero.
  return (10 - (sum % 10)) % 10;
}

export const REFERENCE_STANDARDS = {
  ee_fi_731: {
    id: "ee_fi_731",
    label: "7-3-1 (Estonia, Finland)",
    build(base) {
      const digits = String(base || "").replace(/\D/g, "");
      if (!digits) return null;
      return `${digits}${checkDigit731(digits)}`;
    },
    verify(reference) {
      const digits = String(reference || "").trim();
      if (!/^\d{2,}$/.test(digits)) return false;
      return checkDigit731(digits.slice(0, -1)) === Number(digits.slice(-1));
    },
  },
};

// Which standard a company's country uses. A country with no entry has no automatic scheme, so its
// invoices carry a reference entered by hand or none at all.
const COUNTRY_STANDARDS = { EE: "ee_fi_731", FI: "ee_fi_731" };

export function referenceStandardIdForCountry(country) {
  return COUNTRY_STANDARDS[String(country || "").trim().toUpperCase()] || null;
}

export function referenceStandardForCountry(country) {
  return REFERENCE_STANDARDS[referenceStandardIdForCountry(country)] || null;
}

// The digits of an invoice number: INV-1001 is built into a reference from 1001.
export function referenceBaseFromInvoiceNumber(number) {
  return String(number || "").replace(/\D/g, "");
}

// The reference for an invoice, or null when this company's country has no automatic scheme.
export function buildInvoiceReference({ invoiceNumber, country }) {
  const standard = referenceStandardForCountry(country);
  if (!standard) return null;
  return standard.build(referenceBaseFromInvoiceNumber(invoiceNumber));
}

// A hand-entered reference, as stored: without the spaces people paste them with.
export function normalizeReference(value) {
  return String(value || "").replace(/\s/g, "");
}

// References in every scheme in use here are digits. Long enough to be a reference, short enough to
// fit the field a bank expects.
export function isValidReference(value) {
  return /^\d{1,25}$/.test(normalizeReference(value));
}

// True when a hand-entered reference carries the check digit its own country's scheme expects. A
// country without a scheme is never judged.
export function matchesCountryReferenceScheme({ reference, country }) {
  const standard = referenceStandardForCountry(country);
  return standard ? standard.verify(normalizeReference(reference)) : true;
}