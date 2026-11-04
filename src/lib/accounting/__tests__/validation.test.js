import test from "node:test";
import assert from "node:assert/strict";

import { buildCanonicalInvoice } from "../canonicalInvoice.js";
import { VALIDATION_CODES, resolveVatRegistered, validateBuyerInformation, validateCountryCode } from "../validation.js";
import { buildMeritPayload } from "../merit/mapper.js";
import { toIso2 } from "../countries.js";
import { makeConnection, makeInvoice } from "../testing/fixtures.js";

function dtoOf(overrides) {
  const { dto } = buildCanonicalInvoice(makeInvoice(overrides));
  return JSON.parse(JSON.stringify(dto));
}

function codes(issues) {
  return issues.map((issue) => issue.code);
}

test("3. blocks when a VAT rate has no mapping", () => {
  const mapped = buildMeritPayload(dtoOf(), makeConnection({ vat_mappings: [{ rate: 24, tax_id: "11111111-1111-4111-8111-111111111111" }] }));

  assert.equal(mapped.ok, false);
  assert.ok(codes(mapped.issues).includes(VALIDATION_CODES.VAT_MAPPING_MISSING));
  assert.equal(mapped.payload, null);
});

test("3. rejects a duplicated or invalid VAT mapping", () => {
  const duplicated = buildMeritPayload(
    dtoOf(),
    makeConnection({
      vat_mappings: [
        { rate: 24, tax_id: "11111111-1111-4111-8111-111111111111" },
        { rate: 24, tax_id: "11111111-1111-4111-8111-111111111111" },
        { rate: 9, tax_id: "22222222-2222-4222-8222-222222222222" },
      ],
    }),
  );
  assert.ok(codes(duplicated.issues).includes(VALIDATION_CODES.VAT_MAPPING_DUPLICATE));

  const invalidTaxId = buildMeritPayload(
    dtoOf(),
    makeConnection({
      vat_mappings: [
        { rate: 24, tax_id: "not-a-guid" },
        { rate: 9, tax_id: "22222222-2222-4222-8222-222222222222" },
      ],
    }),
  );
  assert.ok(codes(invalidTaxId.issues).includes(VALIDATION_CODES.VAT_MAPPING_INVALID_TAX_ID));
});

test("4. never infers VAT registration status from the VAT number", () => {
  const dto = dtoOf();
  assert.equal(dto.buyer.vat_no, "EE987654321");

  // A VAT number is present, yet the status is undeclared: the export must be blocked.
  const undeclared = buildMeritPayload(dto, makeConnection({ vat_status_map: {} }));
  assert.equal(undeclared.ok, false);
  assert.ok(codes(undeclared.issues).includes(VALIDATION_CODES.VAT_STATUS_REQUIRED));

  // Explicit declarations are honoured in both directions.
  assert.equal(resolveVatRegistered({ cl_1: true }, "cl_1"), true);
  assert.equal(resolveVatRegistered({ cl_1: false }, "cl_1"), false);
  assert.equal(resolveVatRegistered({}, "cl_1"), null);
});

test("4. blocks when mandatory buyer information is missing", () => {
  const dto = dtoOf();
  dto.buyer.name = "";
  dto.buyer.contact_name = "X".repeat(60);

  const issues = validateBuyerInformation(dto, { vatStatusMap: { cl_1: true } });
  assert.ok(codes(issues).includes(VALIDATION_CODES.BUYER_NAME_MISSING));
  assert.ok(codes(issues).includes(VALIDATION_CODES.BUYER_CONTACT_TOO_LONG));
});

test("5. blocks when a service item code is missing", () => {
  const mapped = buildMeritPayload(dtoOf(), makeConnection({ item_codes: { 24: "ORQ-SVC-24" } }));

  assert.equal(mapped.ok, false);
  assert.ok(codes(mapped.issues).includes(VALIDATION_CODES.ITEM_CODE_MISSING));
});

test("5. requires a distinct item code per VAT rate", () => {
  const mapped = buildMeritPayload(dtoOf(), makeConnection({ item_codes: { 24: "SAME", 9: "SAME" } }));

  assert.equal(mapped.ok, false);
  assert.ok(codes(mapped.issues).includes(VALIDATION_CODES.ITEM_CODE_NOT_DISTINCT));
});

test("6. blocks an unknown or missing country instead of guessing", () => {
  assert.equal(toIso2("Estonia"), "EE");
  assert.equal(toIso2("ee"), "EE");
  assert.equal(toIso2("Eesti"), "EE");
  assert.equal(toIso2("Finland"), "FI");
  assert.equal(toIso2("Atlantis"), null);

  const unknown = buildMeritPayload(dtoOf({ buyer_snapshot: { ...makeInvoice().buyer_snapshot, country: "Atlantis" } }), makeConnection());
  assert.equal(unknown.ok, false);
  assert.ok(codes(unknown.issues).includes(VALIDATION_CODES.BUYER_COUNTRY_UNKNOWN));

  const missing = validateCountryCode({ buyer: { country: "" } });
  assert.ok(codes(missing).includes(VALIDATION_CODES.BUYER_COUNTRY_MISSING));
});

test("accepts a fully configured connection", () => {
  const mapped = buildMeritPayload(dtoOf(), makeConnection());

  assert.equal(mapped.ok, true, JSON.stringify(mapped.issues));
  assert.deepEqual(mapped.issues, []);
});