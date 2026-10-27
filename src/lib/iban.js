// IBAN and BIC checks, shared by the browser (immediate feedback while typing) and the server (the
// authority that decides what is stored). Nothing here restricts an account to any one country: an
// IBAN is accepted on its country length and its own check digits, so Estonian, German, Polish or
// any other account is treated the same way.

// Published IBAN lengths, for the countries Orqacel is used in and their main trading partners.
// A country that is missing from this table is still accepted on its check digits alone.
const IBAN_LENGTHS = {
  AD: 24, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20,
  ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, HR: 21, HU: 28, IE: 22,
  IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MT: 31, NL: 18,
  NO: 15, PL: 28, PT: 25, RO: 24, RS: 22, SE: 24, SI: 19, SK: 24, SM: 27, TR: 26, UA: 29, VA: 22,
  XK: 20,
};

const IBAN_PATTERN = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;
const BIC_PATTERN = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

// As an IBAN is stored: upper case, without the spaces people type it with.
export function normalizeIban(value) {
  return String(value || "").replace(/[\s-]/g, "").toUpperCase();
}

// As an IBAN is read: groups of four.
export function formatIban(value) {
  return normalizeIban(value).replace(/(.{4})/g, "$1 ").trim();
}

export function ibanCountry(value) {
  const iban = normalizeIban(value);
  return /^[A-Z]{2}/.test(iban) ? iban.slice(0, 2) : null;
}

export function isKnownIbanCountry(country) {
  return Boolean(IBAN_LENGTHS[String(country || "").toUpperCase()]);
}

// The ISO 13616 check: move the first four characters to the end, turn the letters into numbers
// (A = 10 … Z = 35) and the result must be congruent to 1 modulo 97. BigInt keeps the arithmetic
// exact — the number is far too long for a JavaScript float.
function checksumRemainder(iban) {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  return Number(BigInt(digits) % 97n);
}

export function isValidIban(value) {
  const iban = normalizeIban(value);
  if (!IBAN_PATTERN.test(iban)) return false;
  const expected = IBAN_LENGTHS[ibanCountry(iban)];
  if (expected && iban.length !== expected) return false;
  try {
    return checksumRemainder(iban) === 1;
  } catch {
    return false;
  }
}

export function normalizeBic(value) {
  return String(value || "").replace(/[\s-]/g, "").toUpperCase();
}

// A BIC is optional. A blank one is fine; a wrong one is not.
export function isValidBic(value) {
  const bic = normalizeBic(value);
  return bic === "" || BIC_PATTERN.test(bic);
}