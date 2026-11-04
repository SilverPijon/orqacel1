/**
 * Country name / code resolution.
 *
 * Accounting providers require ISO 3166-1 alpha-2 codes, while Orqacel stores a free-text
 * country on clients. No guessing happens here: an unrecognised value resolves to null and
 * the caller treats that as a blocking validation issue.
 */

const ISO_CODES = new Set([
  "AT", "AU", "BE", "BG", "BR", "CA", "CH", "CN", "CY", "CZ", "DE", "DK", "EE", "EG", "ES",
  "FI", "FR", "GB", "GR", "HR", "HU", "IE", "IL", "IN", "IS", "IT", "JP", "KR", "LT", "LU",
  "LV", "MT", "MX", "NL", "NO", "NZ", "PL", "PT", "RO", "RS", "RU", "SE", "SG", "SI", "SK",
  "TR", "UA", "US", "ZA",
]);

const NAMES = {
  austria: "AT", australia: "AU", belgium: "BE", bulgaria: "BG", brazil: "BR",
  canada: "CA", switzerland: "CH", china: "CN", cyprus: "CY", czechia: "CZ",
  "czech republic": "CZ", germany: "DE", deutschland: "DE", denmark: "DK",
  estonia: "EE", eesti: "EE", egypt: "EG", spain: "ES", españa: "ES", finland: "FI",
  suomi: "FI", france: "FR", "united kingdom": "GB", uk: "GB", "great britain": "GB",
  england: "GB", greece: "GR", croatia: "HR", hungary: "HU", ireland: "IE",
  israel: "IL", india: "IN", iceland: "IS", italy: "IT", italia: "IT", japan: "JP",
  "south korea": "KR", korea: "KR", lithuania: "LT", lietuva: "LT", luxembourg: "LU",
  latvia: "LV", latvija: "LV", malta: "MT", mexico: "MX", netherlands: "NL",
  holland: "NL", norway: "NO", "new zealand": "NZ", poland: "PL", polska: "PL",
  portugal: "PT", romania: "RO", serbia: "RS", russia: "RU", sweden: "SE",
  sverige: "SE", singapore: "SG", slovenia: "SI", slovakia: "SK", turkey: "TR",
  türkiye: "TR", ukraine: "UA", "united states": "US", usa: "US",
  "united states of america": "US", "south africa": "ZA",
};

/** Resolve a free-text country or a code to ISO-2, or null when it cannot be resolved. */
export function toIso2(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (raw.length === 2) {
    const code = raw.toUpperCase();
    return ISO_CODES.has(code) ? code : null;
  }

  const key = raw
    .toLowerCase()
    .replace(/[._-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return NAMES[key] || null;
}

export function isKnownIso2(code) {
  return typeof code === "string" && ISO_CODES.has(code.toUpperCase());
}