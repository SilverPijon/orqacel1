import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import { asArray, httpError, requireCompanyContext } from "@/lib/tenant.server";
import { addDaysISO, todayISO } from "@/lib/format";
import { escapeRegex } from "@/lib/search";
import { computeInvoiceTotals } from "@/lib/invoiceTotals";
import { INVOICE_STATUSES, canTransition, isDraft } from "@/lib/invoiceLifecycle";
import { claimInvoiceNumber } from "@/lib/invoiceNumber.server";
import { buildBuyerSnapshot, buildSellerSnapshot } from "@/lib/invoiceSnapshot.server";
import { writeInvoiceIfStatus } from "@/lib/invoiceWrites.server";

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

    return { invoice, client };
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

    const draft = await service.entities.Invoice.create({
      company_id: companyId,
      client_id: client.id,
      client_name: client.name,
      number,
      status: "draft",
      issue_date: data.issue_date || todayISO(),
      due_date: data.due_date || addDaysISO(DUE_DAYS),
      currency: session.activeCompany.currency || "EUR",
      notes: (data.notes || "").trim(),
      vat_rate_set: data.vat_rate_set === true,
      // Both identities are captured now and frozen again in the write that issues the invoice.
      seller_snapshot: buildSellerSnapshot(session.activeCompany),
      buyer_snapshot: buildBuyerSnapshot(client),
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

    // The number is assigned once, at creation, and is never part of an update.
    if (!Object.keys(patch).length) return { id: data.id, number: existing.number };

    // Written only while the invoice is still the draft that was read: if it was issued in the
    // meantime the write does not apply, so an issued invoice can never be edited by a race.
    const written = await writeInvoiceIfStatus(
      service,
      { id: data.id, companyId, expectedStatus: "draft" },
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
      const client = await findClient(context, companyId, existing.client_id);
      patch = {
        status: "issued",
        issued_at: new Date().toISOString(),
        seller_snapshot: buildSellerSnapshot(session.activeCompany),
        buyer_snapshot: client
          ? buildBuyerSnapshot(client)
          : existing.buyer_snapshot || { name: existing.client_name || "" },
      };
    } else {
      // Cancelling voids the invoice but changes nothing about what it recorded.
      patch = { status: "cancelled", cancelled_at: new Date().toISOString() };
    }

    // The status that was read is part of the condition, so only one of two racing transitions can
    // apply and the record can never end in a pair of states at once.
    const written = await writeInvoiceIfStatus(
      service,
      { id: data.id, companyId, expectedStatus: existing.status },
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