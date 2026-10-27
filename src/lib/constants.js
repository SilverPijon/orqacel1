export const CURRENCIES = [
  "EUR", "USD", "GBP", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON",
  "BGN", "CHF", "TRY", "UAH", "CAD", "AUD", "NZD", "JPY", "INR", "BRL",
];

export const COUNTRY_CODES = [
  "EE", "LV", "LT", "FI", "SE", "NO", "DK", "DE", "PL", "RU",
  "GB", "IE", "FR", "ES", "PT", "IT", "NL", "BE", "AT", "CH",
  "CZ", "SK", "HU", "RO", "BG", "GR", "HR", "SI", "UA", "IS",
  "LU", "MT", "CY", "TR", "US", "CA", "AU", "NZ",
];

export const TIMEZONES = [
  "Europe/Tallinn", "Europe/Riga", "Europe/Vilnius", "Europe/Helsinki", "Europe/Stockholm",
  "Europe/Oslo", "Europe/Copenhagen", "Europe/Berlin", "Europe/Warsaw", "Europe/Prague",
  "Europe/Vienna", "Europe/Zurich", "Europe/Amsterdam", "Europe/Brussels", "Europe/Paris",
  "Europe/Madrid", "Europe/Lisbon", "Europe/Rome", "Europe/Dublin", "Europe/London",
  "Europe/Kyiv", "Europe/Moscow", "Europe/Bucharest", "Europe/Sofia", "Europe/Budapest",
  "Europe/Athens", "Europe/Zagreb", "Europe/Istanbul", "UTC", "America/New_York",
  "America/Chicago", "America/Los_Angeles", "America/Toronto", "Australia/Sydney",
];

export const QUOTATION_STATUSES = ["draft", "sent", "accepted", "declined", "expired"];

export const JOB_STATUSES = ["scheduled", "in_progress", "paused", "completed", "cancelled"];

export const JOB_PRIORITIES = ["low", "medium", "high", "urgent"];

export const PLANS = [
  { id: "free", price: "€0" },
  { id: "pro", price: "€7.90" },
  { id: "team", price: "€14.90" },
];

export function countryLabel(code, locale = "en") {
  if (!code) return "—";
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}