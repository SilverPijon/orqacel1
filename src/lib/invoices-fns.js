import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import { asArray, httpError, requireCompanyContext } from "@/lib/tenant.server";
import { addDaysISO, todayISO } from "@/lib/format";
import { escapeRegex } from "@/lib/search";
import { computeInvoiceTotals } from "@/lib/invoiceTotals";
import { INVOICE_STATUSES, canTransition, isDraft } from "@/lib/invoiceLifecycle";
import { claimInvoiceNumber } from "@/lib/invoiceNumber.server";
import { buildBuyerSnapshot, buildPaymentSnapshot, buildSellerSnapshot } from "@/lib/invoiceSnapshot.server";
import { writeInvoiceIfStatus } from "@/lib/invoiceWrites.server";
import { invoicePaymentValues } from "@/lib/bankAccounts";
import { buildInvoiceReference, normalizeReference, referenceProblem } from "@/lib/paymentReference";

// How far ahead a new invoice is due unless the user says otherwise.
const DUE_DAYS = 14;

const InvoiceLine = z.object({
  description: z.string().max(200).optional(),
  quantity: z.number().min(0).max(100000).optional(),
  unit_price: z.number().min(0).max(10000000).optional(),
  vat_rate: z.number().min(0).max(100).optional(),
});

const InvoiceInput = z.object({
  client_id: z.string().min(1).max(64),
  issue_date: z.string().max(30).optional(),
  due_date: z.string().max(30).optional(),
  notes: z.string().max(2000).optional(),
  vat_rate_set: z.boolean().optional(),
  line_items: z.array(InvoiceLine).max(50).optional(),
  // Payment details. The bank account is named only by id and is always resolved inside the caller's
  // own company; every value the invoice displays about it is read from that record on the server.
  bank_account_id: z.string().max(64).optional(),
  payment_reference: z.string().max(40).optional(),
  payment_description: z.string().max(200).optional(),
  payment_terms: z.string().max(500).optional(),
  service_date: z.string().max(30).optional(),
  service_period_start: z.string().max(30).optional(),
  service_period_end: z.string().max(30).optional(),
});

// A customer of another company is indistinguishable from one that does not exist.
async function findClient(context, companyId, clientId) {
  if (!clientId) return null;
  const client = await context
    .getBase44()
    .entities.Client.get(clientId)
    .catch((error) => {
      if (error?.status === 404) return null;
      throw error;
    });
  return client && client.company_id === companyId ? client : null;
}

async function resolveClient(context, companyId, clientId) {
  const client = await findClient(context, companyId, clientId);
  if (!client) {
    throw httpError(400, "That customer doesn't belong to this company", "BAD_CLIENT");
  }
  return client;
}

// The bank account an invoice's own record points at. Company-scoped even when the id comes from the
// invoice rather than the browser, and never an error: a deleted account simply resolves to nothing.
async function findBankAccount(service, companyId, accountId) {
  if (!accountId) return null;
  const account = await service.entities.CompanyBankAccount.get(accountId).catch(() => null);
  return account && account.company_id === companyId ? account : null;
}

// The bank account a caller selected. An account of another company is refused outright, so a
// browser-supplied id can never be used to read or copy details across tenants.
async function resolveBankAccount(service, companyId, accountId) {
  if (!accountId) return null;
  const account = await findBankAccount(service, companyId, accountId);
  if (!account) {
    throw httpError(400, "That bank account doesn't belong to this company", "BAD_BANK_ACCOUNT");
  }
  return account;
}

// The payment reference an invoice keeps: the one entered by hand when there is one, otherwise the
// one this invoice's own number produces. It is derived from the number, so it is the same value
// every time it is asked for — and it is never recomputed for an invoice that has been issued,
// because only drafts can be written at all. It is not the invoice number and never becomes one.
// Why a reference was refused, in words the person can act on. A domestic scheme judges its own
// check digit; a country without one is judged on shape alone, so an international reference is
// never measured against Estonian rules.
const REFERENCE_ERRORS = {
  DIGITS_ONLY: "A payment reference for this country is made of digits only",
  BAD_CHECK_DIGIT: "That payment reference does not pass its country's check digit",
  CHARSET: "A payment reference may only contain letters, digits, - and /",
  TOO_LONG: "That payment reference is too long",
};

function assertReference(reference, country) {
  const problem = referenceProblem({ reference, country });
  if (!problem) return;
  throw httpError(400, REFERENCE_ERRORS[problem] || "That payment reference is not valid", problem);
}

function decideReference({ entered, invoiceNumber, country }) {
  const manual = normalizeReference(entered || "");
  if (manual) {
    assertReference(manual, country);
    return manual;
  }
  return buildInvoiceReference({ invoiceNumber, country }) || "";
}

const PAYMENT_FIELDS = [
  "bank_account_id",
  "payment_reference",
  "payment_description",
  "payment_terms",
  "service_date",
  "service_period_start",
  "service_period_end",
];

// Loads an invoice only if it belongs to the caller's active company, so another company's invoice
// is indistinguishable from one that doesn't exist.
async function findInvoice(service, companyId, id) {
  const invoice = await service.entities.Invoice.get(id).catch(() => null);
  if (!invoice || invoice.company_id !== companyId) {
    throw httpError(404, "Invoice not found", "NOT_FOUND");
  }
  return invoice;
}

function assertDraft(invoice) {
  if (!isDraft(invoice)) {
    throw httpError(409, "An issued or cancelled invoice can no longer be changed", "LOCKED_INVOICE");
  }
}

// Every draft write increases the invoice's revision, and issue/cancel require the revision the
// caller read as part of the write condition. A payment snapshot is therefore never built from one
// version of the invoice and written onto another: the stale transition loses and is reported.
function revisionOf(invoice) {
  return Number.isInteger(invoice?.revision) ? invoice.revision : null;
}

function revisionCondition(invoice) {
  const revision = revisionOf(invoice);
  return revision === null ? { revision: { $exists: false } } : { revision };
}

function nextRevision(invoice) {
  return (revisionOf(invoice) || 0) + 1;
}

// Read back after a conditional write lost its race, so an error can name the state the invoice is
// actually in. A record that vanished in between reads as missing.
async function rereadInvoice(service, companyId, id) {
  const invoice = await service.entities.Invoice.get(id).catch(() => null);
  return invoice && invoice.company_id === companyId ? invoice : null;
}

// The message for a write that did not apply because the invoice had already moved on. It describes
// what the invoice is now, which is what the person needs to know, rather than the state that was
// hoped for.
function conflictError(action, invoice) {
  if (!invoice) return httpError(404, "Invoice not found", "NOT_FOUND");
  const issued = invoice.status === "issued";
  const cancelled = invoice.status === "cancelled";

  if (action === "edit" && (issued || cancelled)) {
    return httpError(
      409,
      `This invoice was ${issued ? "issued" : "cancelled"} a moment ago and can no longer be changed`,
      "LOCKED_INVOICE",
    );
  }
  if (action === "delete") {
    if (issued) {
      return httpError(409, "This invoice was issued a moment ago and can no longer be deleted", "LOCKED_INVOICE");
    }
    if (cancelled) {
      return httpError(409, "This invoice was cancelled a moment ago and can no longer be deleted", "LOCKED_INVOICE");
    }
  }
  if (action === "issue") {
    if (issued) return httpError(409, "This invoice was already issued", "ALREADY_ISSUED");
    if (cancelled) return httpError(409, "This invoice was cancelled and can no longer be issued", "BAD_TRANSITION");
  }
  if (action === "cancel") {
    if (cancelled) return httpError(409, "This invoice was already cancelled", "ALREADY_CANCELLED");
    if (issued) {
      return httpError(409, "This invoice was issued a moment ago, so the cancellation did not apply", "RACE_ISSUED");
    }
  }
  return httpError(409, "This invoice changed while you were working on it, please try again", "CONFLICT");
}

export const listInvoices = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(
    z.object({
      search: z.string().max(80).optional(),
      status: z.enum(INVOICE_STATUSES).optional(),
      cursor: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context);
    const query = { company_id: session.activeCompany.id };
    if (data.status) query.status = data.status;
    if (data.search) {
      const term = escapeRegex(data.search);
      query.$or = [
        { number: { $regex: term, $options: "i" } },
        { client_name: { $regex: term, $options: "i" } },
      ];
    }
    const page = await context.getBase44().entities.Invoice.filter(query, {
      sort: "-created_date",
      limit: data.limit || 20,
      ...(data.cursor ? { cursor: data.cursor } : {}),
    });
    return { items: asArray(page), nextCursor: page?.next_cursor || null };
  });

export const getInvoice = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(z.object({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context);
    const invoice = await context
      .getBase44()
      .entities.Invoice.get(data.id)
      .catch((error) => {
        if (error?.status === 404) return null;
        throw error;
      });
    if (!invoice || invoice.company_id !== session.activeCompany.id) return null;

    // What the invoice shows comes from its own frozen snapshots. The live customer record is
    // returned only so a link to it can be offered while the customer still exists.
    const client = await findClient(context, session.activeCompany.id, invoice.client_id);

    // The payment details issuing would freeze, built by the same function the issue write uses and
    // from the same account: the live one when it is still there, otherwise what the invoice already
    // carries. The page decides whether issuing needs a warning from this object, so its verdict is
    // the content of the invoice that will exist rather than the draft's own older snapshot.
    const account = await findBankAccount(context.getBase44(), session.activeCompany.id, invoice.bank_account_id);

    return { invoice, client, payment: buildPaymentSnapshot({ invoice, account }) };
  });

// Creating, editing, issuing, cancelling and deleting are owner/admin work: members read.
export const createInvoice = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(InvoiceInput)
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;
    const companyId = session.activeCompany.id;
    const client = await resolveClient(context, companyId, data.client_id);

    // The number is claimed before the invoice is written, exclusively, and is never looked up or
    // corrected afterwards: two invoices can never share a number and none is ever renumbered.
    const number = await claimInvoiceNumber(service, companyId);

    // The bank account is resolved inside this company and the details it holds at this moment are
    // copied onto the invoice. The reference follows from the number this invoice has just received,
    // unless the user entered one. A company with no account saved simply produces no bank details:
    // nothing is ever invented to fill the gap.
    const account = await resolveBankAccount(service, companyId, data.bank_account_id);
    const payment = {
      ...invoicePaymentValues({ account, existing: null, input: data }),
      payment_reference: decideReference({
        entered: data.payment_reference,
        invoiceNumber: number,
        country: session.activeCompany.country,
      }),
    };

    const draft = await service.entities.Invoice.create({
      company_id: companyId,
      client_id: client.id,
      client_name: client.name,
      number,
      status: "draft",
      revision: 1,
      issue_date: data.issue_date || todayISO(),
      due_date: data.due_date || addDaysISO(DUE_DAYS),
      currency: session.activeCompany.currency || "EUR",
      notes: (data.notes || "").trim(),
      vat_rate_set: data.vat_rate_set === true,
      ...payment,
      // Both identities and the payment details are captured now and frozen again at issue.
      seller_snapshot: buildSellerSnapshot(session.activeCompany),
      buyer_snapshot: buildBuyerSnapshot(client),
      payment_snapshot: buildPaymentSnapshot({ invoice: payment, account }),
      ...computeInvoiceTotals(data.line_items),
    });

    return { id: draft.id, number: draft.number };
  });

export const updateInvoice = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(InvoiceInput.partial().extend({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;
    const companyId = session.activeCompany.id;
    const existing = await findInvoice(service, companyId, data.id);
    assertDraft(existing);

    const patch = {};
    if (data.issue_date !== undefined) patch.issue_date = data.issue_date;
    if (data.due_date !== undefined) patch.due_date = data.due_date;
    if (data.notes !== undefined) patch.notes = data.notes.trim();
    if (data.vat_rate_set !== undefined) patch.vat_rate_set = data.vat_rate_set === true;

    if (data.client_id && data.client_id !== existing.client_id) {
      const client = await resolveClient(context, companyId, data.client_id);
      patch.client_id = client.id;
      patch.client_name = client.name;
      patch.buyer_snapshot = buildBuyerSnapshot(client);
    }
    if (data.line_items !== undefined) Object.assign(patch, computeInvoiceTotals(data.line_items));

    if (PAYMENT_FIELDS.some((field) => data[field] !== undefined)) {
      // A newly chosen account must belong to this company; an id that does not is refused. An id the
      // draft already carries is its own choice rather than a new one, so it is looked up without
      // being refused: a draft whose account has since been deleted still saves, keeping the details
      // frozen into it. An empty id is someone clearing the account on purpose.
      const requested = data.bank_account_id;
      const clearing = requested === "";
      const switched = requested !== undefined && requested !== (existing.bank_account_id || "");
      const account = switched
        ? clearing
          ? null
          : await resolveBankAccount(service, companyId, requested)
        : await findBankAccount(service, companyId, existing.bank_account_id);

      const input = { ...data };
      if (data.payment_reference !== undefined) {
        input.payment_reference = decideReference({
          entered: data.payment_reference,
          invoiceNumber: existing.number,
          country: session.activeCompany.country,
        });
      }

      const values = invoicePaymentValues({ account, existing, input, dropBankDetails: clearing });
      Object.assign(patch, values);
      // The details are stored on the invoice itself rather than looked up at display time, so what
      // it shows stays fixed from here on even if the company's bank settings change again. Built
      // from the values just written, so clearing the account really clears it.
      patch.payment_snapshot = buildPaymentSnapshot({ invoice: values, account });
    }

    // The number is assigned once, at creation, and is never part of an update.
    if (!Object.keys(patch).length) return { id: data.id, number: existing.number };

    // Written only while the invoice is still the draft that was read: if it was issued in the
    // meantime the write does not apply, so an issued invoice can never be edited by a race.
    patch.revision = nextRevision(existing);
    const written = await writeInvoiceIfStatus(
      service,
      { id: data.id, companyId, expectedStatus: "draft", conditions: revisionCondition(existing) },
      { $set: patch },
    );
    if (written !== 1) throw conflictError("edit", await rereadInvoice(service, companyId, data.id));

    return { id: data.id, number: existing.number };
  });

export const setInvoiceStatus = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(
    z.object({
      id: z.string().min(1).max(64),
      status: z.enum(INVOICE_STATUSES),
    }),
  )
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;
    const companyId = session.activeCompany.id;
    const existing = await findInvoice(service, companyId, data.id);

    if (!canTransition(existing.status, data.status)) {
      throw httpError(409, `An invoice can't be moved from ${existing.status} to ${data.status}`, "BAD_TRANSITION");
    }

    let patch;
    if (data.status === "issued") {
      // Issuing freezes the invoice. Both snapshots are refreshed from the records that are current
      // at this moment and stored in the same write as the status and the timestamp, so the frozen
      // values and the issued state can never disagree.
      // A domestic reference has to be valid at the moment the invoice becomes final, whatever the
      // draft carried before. A country without a scheme is judged on shape only.
      assertReference(existing.payment_reference, session.activeCompany.country);
      const client = await findClient(context, companyId, existing.client_id);
      const account = await findBankAccount(service, companyId, existing.bank_account_id);
      patch = {
        status: "issued",
        issued_at: new Date().toISOString(),
        revision: nextRevision(existing),
        seller_snapshot: buildSellerSnapshot(session.activeCompany),
        buyer_snapshot: client
          ? buildBuyerSnapshot(client)
          : existing.buyer_snapshot || { name: existing.client_name || "" },
        // The payment details are frozen in the same write as the status and the timestamp, so an
        // issued invoice can never show details other than the ones it was issued with. The payment
        // reference is carried over untouched: it is never regenerated after issue.
        payment_snapshot: buildPaymentSnapshot({ invoice: existing, account }),
      };
    } else {
      // Cancelling voids the invoice but changes nothing about what it recorded.
      patch = { status: "cancelled", cancelled_at: new Date().toISOString(), revision: nextRevision(existing) };
    }

    // The status that was read is part of the condition, so only one of two racing transitions can
    // apply and the record can never end in a pair of states at once.
    const written = await writeInvoiceIfStatus(
      service,
      { id: data.id, companyId, expectedStatus: existing.status, conditions: revisionCondition(existing) },
      { $set: patch },
    );
    if (written !== 1) {
      throw conflictError(data.status === "issued" ? "issue" : "cancel", await rereadInvoice(service, companyId, data.id));
    }

    return { id: data.id, status: data.status };
  });

export const deleteInvoice = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;
    const companyId = session.activeCompany.id;
    const existing = await findInvoice(service, companyId, data.id);
    // An issued invoice is a financial record: it is cancelled, never deleted.
    assertDraft(existing);

    // Deleting is taken in two ordered steps because Base44 has no transactions. A conditional
    // delete alone could remove an invoice that was issued a moment earlier, which would destroy a
    // financial record. Instead the draft is first moved to cancelled, which is terminal: once that
    // write applies, no concurrent issue can apply any more, and no second caller can reach the
    // delete below, so exactly one caller can ever delete, and only a draft that is still a draft.
    const claimed = await writeInvoiceIfStatus(
      service,
      { id: data.id, companyId, expectedStatus: "draft" },
      { $set: { status: "cancelled", cancelled_at: new Date().toISOString() } },
    );
    if (claimed !== 1) throw conflictError("delete", await rereadInvoice(service, companyId, data.id));

    try {
      await service.entities.Invoice.delete(data.id);
    } catch (error) {
      // The delete failed after the draft had been claimed. Put the draft back the way it was, so
      // the caller can simply try again instead of being left with a cancelled invoice nobody asked
      // for — and if even that fails, say plainly what state the invoice is in.
      const restored = await writeInvoiceIfStatus(
        service,
        { id: data.id, companyId, expectedStatus: "cancelled" },
        { $set: { status: "draft" }, $unset: { cancelled_at: "" } },
      ).catch(() => 0);
      throw httpError(
        500,
        restored === 1
          ? "The invoice could not be deleted, please try again"
          : "The invoice could not be deleted and is now shown as cancelled",
        "DELETE_FAILED",
      );
    }

    return { id: data.id };
  });