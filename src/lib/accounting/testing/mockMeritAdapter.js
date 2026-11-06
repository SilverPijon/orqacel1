/**
 * Mock Merit adapter.
 *
 * Test-only: scripted acknowledgements/errors plus explicit synthetic document/search
 * evidence for safety tests. Expanded evidence is an internal mock contract, not a claim
 * about Merit API guarantees. No network access or credentials.
 */

import { MOCK_LOOKUP_CONTRACT, MOCK_DOCUMENT_CONTRACT } from "../export/reconciliation.js";

const GUID = {
  tax24: "11111111-1111-4111-8111-111111111111",
  tax9: "22222222-2222-4222-8222-222222222222",
};

function grossOf(payload) {
  const tax = (payload.TaxAmount || []).reduce((sum, row) => sum + Number(row.Amount || 0), 0);
  return Number(payload.TotalAmount || 0) + tax;
}

function documentFrom(payload, index) {
  return {
    SIHId: `sih-${index}`,
    InvoiceNo: payload.InvoiceNo,
    CurrencyCode: payload.CurrencyCode,
    VatAmount: (payload.TaxAmount || []).reduce((sum, row) => sum + Number(row.Amount || 0), 0),
    TotalSum: grossOf(payload),
    TotalAmount: Number(payload.TotalAmount || 0),
    CustomerId: "cust-1",
  };
}

export function createMockMeritAdapter(options = {}) {
  const behaviour = options.behaviour || options;
  const delayMs = Number(options.delayMs || 0);
  const calls = [];
  const stored = [];
  let sendCount = 0;
  let lookupCount = 0;

  const wait = () => (delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve());

  function timeoutError() {
    const error = new Error("The operation was aborted due to timeout");
    error.name = "TimeoutError";
    error.code = "ETIMEDOUT";
    return error;
  }

  async function sendInvoice(payload) {
    calls.push({ op: "sendInvoice", payload });
    sendCount += 1;
    const current = sendCount;
    await wait();

    const mode = behaviour.send || "ok";

    if (mode === "timeout") throw timeoutError();

    if (mode === "timeoutAfterCommit") {
      // Committed at the provider, response lost: the classic ambiguous outcome.
      stored.push(documentFrom(payload, stored.length + 1));
      throw timeoutError();
    }

    if (mode === "stacktrace200") {
      return { status: 200, bodyText: "System.ArgumentException: Invoice has no rows\n   at Merit..." };
    }

    if (mode === "invalidJson200") {
      return { status: 200, bodyText: "<html><body>Service unavailable</body></html>" };
    }

    if (mode === "empty200") {
      return { status: 200, bodyText: "" };
    }

    if (mode === "unauthorized401") {
      return { status: 401, bodyText: JSON.stringify({ errors: ["ApiId or signature is invalid"] }) };
    }

    if (mode === "licence401") {
      return { status: 401, bodyText: "api-wronglicense" };
    }

    if (mode === "badRequest400") {
      return { status: 400, bodyText: JSON.stringify({ errors: ["Customer.CountryCode is required"] }) };
    }

    if (mode === "rateLimit429") {
      return { status: 429, bodyText: "", headers: { "retry-after": "2" } };
    }

    if (mode === "serverError500") {
      return { status: 500, bodyText: "Internal Server Error" };
    }

    const doc = documentFrom(payload, current);
    stored.push(doc);

    return {
      status: 200,
      documentEvidence: { contract: MOCK_DOCUMENT_CONTRACT },
      // Expanded synthetic evidence for strict matching, NOT a Merit response guarantee.
      bodyText: JSON.stringify({ ...doc, InvoiceId: doc.SIHId, RefNo: payload.RefNo ?? null }),
    };
  }

  async function lookupByInvoiceNo(number, { currency } = {}) {
    calls.push({ op: "lookupByInvoiceNo", number });
    lookupCount += 1;
    await wait();

    // This mock owns the entire in-memory ledger and can assert exhaustive exact searches.
    // A future real adapter must not copy these guarantees without verifying its contract.
    const response = (matches) => ({
      status: 200,
      bodyText: JSON.stringify(matches),
      lookupEvidence: { contract: MOCK_LOOKUP_CONTRACT, complete: true, authoritative: true, invoiceNo: number, currency, nextCursor: null },
    });
    const mode = behaviour.lookup || "stored";

    if (mode === "error") throw new Error("lookup failed");

    if (mode === "none") return response([]);

    if (mode === "multiple") {
      const matches = [documentFrom({ InvoiceNo: number, CurrencyCode: currency, TotalAmount: 1500, TaxAmount: [] }, 1), documentFrom({ InvoiceNo: number, CurrencyCode: currency, TotalAmount: 1500, TaxAmount: [] }, 2)];
      return response(matches);
    }

    if (mode === "mismatch") {
      return response([{ SIHId: "sih-x", InvoiceNo: number, CurrencyCode: currency, TotalAmount: 1500, VatAmount: 285, TotalSum: 999 }]);
    }

    const matches = stored.filter((doc) => doc.InvoiceNo === number && doc.CurrencyCode === currency);
    return response(matches);
  }

  return {
    calls,
    stored,
    get sendCount() {
      return sendCount;
    },
    get lookupCount() {
      return lookupCount;
    },
    sendInvoice,
    lookupByInvoiceNo,
    taxIds: GUID,
  };
}