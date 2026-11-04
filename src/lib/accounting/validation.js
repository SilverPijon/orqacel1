/**
 * Pre-flight validation for a canonical export DTO.
 *
 * Every function returns a list of issues. An empty list means the invoice may be exported.
 * Nothing here mutates the invoice, the DTO, or any amount.
 */

import { usedVatRates } from "./canonicalInvoice.js";
import { toIso2 } from "./countries.js";

export const VALIDATION_CODES = Object.freeze({
  BUYER_NAME_MISSING: "buyer_name_missing",
  BUYER_COUNTRY_MISSING: "buyer_country_missing",
  BUYER_COUNTRY_UNKNOWN: "buyer_country_unknown",
  BUYER_CONTACT_TOO_LONG: "buyer_contact_too_long",
  VAT_STATUS_REQUIRED: "vat_status_required",
  VAT_MAPPING_MISSING: "vat_mapping_missing",
  VAT_MAPPING_DUPLICATE: "vat_mapping_duplicate",
  VAT_MAPPING_INVALID_TAX_ID: "vat_mapping_invalid_tax_id",
  ITEM_CODE_MISSING: "item_code_missing",
  ITEM_CODE_TOO_LONG: "item_code_too_long",
  ITEM_CODE_NOT_DISTINCT: "item_code_not_distinct",
  LINE_DESCRIPTION_MISSING: "line_description_missing",
});

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_CONTACT_LENGTH = 35;
export const MAX_ITEM_CODE_LENGTH = 20;

function problem(code, field, detail) {
  return { code, field, detail };
}

/**
 * Buyer information the provider cannot create a customer without.
 *
 * VAT registration status is deliberately NOT inferred from the VAT number: the approved
 * rule is that absence of a VAT number says nothing about a company's registration status.
 * An explicit value must be supplied per client; when it is missing the export is blocked.
 */
export function validateBuyerInformation(dto, { vatStatusMap = {} } = {}) {
  const issues = [];
  const buyer = dto.buyer || {};

  if (!buyer.name) {
    issues.push(problem(VALIDATION_CODES.BUYER_NAME_MISSING, "buyer.name", "the buyer name is required"));
  }

  if (buyer.contact_name && String(buyer.contact_name).length > MAX_CONTACT_LENGTH) {
    issues.push(
      problem(
        VALIDATION_CODES.BUYER_CONTACT_TOO_LONG,
        "buyer.contact_name",
        `the contact name must be at most ${MAX_CONTACT_LENGTH} characters`,
      ),
    );
  }

  const key = buyer.client_id;
  const declared = key ? vatStatusMap[key] : undefined;
  if (declared !== true && declared !== false) {
    issues.push(
      problem(
        VALIDATION_CODES.VAT_STATUS_REQUIRED,
        "buyer.vat_registered",
        "the client's VAT registration status must be set explicitly before exporting",
      ),
    );
  }

  return issues;
}

/** Buyer country must resolve to ISO 3166-1 alpha-2. */
export function validateCountryCode(dto, { countryResolver = toIso2 } = {}) {
  const issues = [];
  const country = dto.buyer?.country;

  if (!country) {
    issues.push(problem(VALIDATION_CODES.BUYER_COUNTRY_MISSING, "buyer.country", "the buyer country is required"));
    return issues;
  }

  if (!countryResolver(country)) {
    issues.push(
      problem(
        VALIDATION_CODES.BUYER_COUNTRY_UNKNOWN,
        "buyer.country",
        `the buyer country "${country}" is not a recognised country`,
      ),
    );
  }

  return issues;
}

/**
 * Every VAT rate used on the invoice must map to exactly one provider tax identifier.
 * An unmapped rate blocks the export — it never falls back to 0 % or a neighbouring rate.
 */
export function validateVatMapping(dto, vatMappings = []) {
  const issues = [];
  const byRate = new Map();

  for (const mapping of vatMappings || []) {
    const rate = Number(mapping.rate);
    if (!Number.isFinite(rate)) continue;
    if (!byRate.has(rate)) byRate.set(rate, []);
    byRate.get(rate).push(mapping);
  }

  for (const rate of usedVatRates(dto)) {
    const candidates = byRate.get(rate) || [];

    if (candidates.length === 0) {
      issues.push(
        problem(
          VALIDATION_CODES.VAT_MAPPING_MISSING,
          `vat.${rate}`,
          `VAT ${rate}% is not mapped to an accounting tax rate`,
        ),
      );
      continue;
    }

    if (candidates.length > 1) {
      issues.push(
        problem(
          VALIDATION_CODES.VAT_MAPPING_DUPLICATE,
          `vat.${rate}`,
          `VAT ${rate}% is mapped more than once`,
        ),
      );
      continue;
    }

    if (!GUID.test(String(candidates[0].tax_id || ""))) {
      issues.push(
        problem(
          VALIDATION_CODES.VAT_MAPPING_INVALID_TAX_ID,
          `vat.${rate}`,
          `VAT ${rate}% has no valid tax identifier`,
        ),
      );
    }
  }

  return issues;
}

/**
 * Service item codes, one per VAT rate.
 *
 * The provider requires a distinct item code per VAT rate, so this both checks presence and
 * rejects configurations that would give two rates the same code.
 */
export function resolveItemCodes(dto, itemCodesByRate = {}) {
  const issues = [];
  const codes = new Map();

  for (const rate of usedVatRates(dto)) {
    const code = itemCodesByRate[String(rate)] ?? itemCodesByRate[rate];

    if (!code) {
      issues.push(
        problem(
          VALIDATION_CODES.ITEM_CODE_MISSING,
          `item_code.${rate}`,
          `no service item code is configured for VAT ${rate}%`,
        ),
      );
      continue;
    }

    if (String(code).length > MAX_ITEM_CODE_LENGTH) {
      issues.push(
        problem(
          VALIDATION_CODES.ITEM_CODE_TOO_LONG,
          `item_code.${rate}`,
          `an item code must be at most ${MAX_ITEM_CODE_LENGTH} characters`,
        ),
      );
      continue;
    }

    if (codes.has(String(code))) {
      issues.push(
        problem(
          VALIDATION_CODES.ITEM_CODE_NOT_DISTINCT,
          `item_code.${rate}`,
          `VAT ${rate}% and VAT ${codes.get(String(code))}% share the item code "${code}"`,
        ),
      );
      continue;
    }

    codes.set(String(code), rate);
  }

  return { issues, codes: Object.fromEntries([...codes.entries()].map(([code, rate]) => [rate, code])) };
}

/** Line descriptions are part of the document; empty ones block the export. */
export function validateLineDescriptions(dto, { maxLength = 150 } = {}) {
  const issues = [];

  dto.lines.forEach((line, index) => {
    if (!line.description || !String(line.description).trim()) {
      issues.push(
        problem(VALIDATION_CODES.LINE_DESCRIPTION_MISSING, `lines[${index}].description`, "a line description is required"),
      );
    } else if (String(line.description).length > maxLength) {
      issues.push(
        problem(
          "line_description_too_long",
          `lines[${index}].description`,
          `a line description must be at most ${maxLength} characters`,
        ),
      );
    }
  });

  return issues;
}

/** The registration status the provider expects, derived from the explicit value only. */
export function resolveVatRegistered(vatStatusMap, clientId) {
  const value = vatStatusMap?.[clientId];
  return value === true ? true : value === false ? false : null;
}