import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import { asArray, httpError, requireCompanyContext } from "@/lib/tenant.server";
import { addDaysISO, todayISO } from "@/lib/format";
import { escapeRegex } from "@/lib/search";
import { computeInvoiceTotals } from "@/lib/invoiceTotals";
import { INVOICE_STATUSES, canTransition } from "@/lib/invoiceLifecycle";
import { claimInvoiceNumber, settleInvoiceNumber } from "@/lib/invoiceNumber.server";

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

// The customer must belong to the company the caller is acting in. A company id or customer id
// sent by the browser is never trusted on its own.
async function resolveClient(context, companyId, clientId) {
  const client = await context
    .getBase44()
    .entities.Client.get(clientId)
    .catch((error) => {
      if (error?.status === 404) return null;
      throw error;
    });
  if (!client || client.company_id !== companyId) {
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
  if (invoice.status !== "draft") {
    throw httpError(409, "An issued or cancelled invoice can no longer be changed", "LOCKED_INVOICE");
  }
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

    const client = invoice.client_id
      ? await context
          .getBase44()
          .entities.Client.get(invoice.client_id)
          .catch(() => null)
      : null;

    return { invoice, client: client && client.company_id === session.activeCompany.id ? client : null };
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

    const draft = await service.entities.Invoice.create({
      company_id: companyId,
      client_id: client.id,
      client_name: client.name,
      number: await claimInvoiceNumber(service, companyId),
      status: "draft",
      issue_date: data.issue_date || todayISO(),
      due_date: data.due_date || addDaysISO(DUE_DAYS),
      currency: session.activeCompany.currency || "EUR",
      notes: (data.notes || "").trim(),
      vat_rate_set: data.vat_rate_set === true,
      ...computeInvoiceTotals(data.line_items),
    });

    const settled = await settleInvoiceNumber(service, companyId, draft);
    return { id: settled.id, number: settled.number };
  });

export const updateInvoice = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(InvoiceInput.partial().extend({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;
    const existing = await findInvoice(service, session.activeCompany.id, data.id);
    assertDraft(existing);

    const patch = {};
    if (data.issue_date !== undefined) patch.issue_date = data.issue_date;
    if (data.due_date !== undefined) patch.due_date = data.due_date;
    if (data.notes !== undefined) patch.notes = data.notes.trim();
    if (data.vat_rate_set !== undefined) patch.vat_rate_set = data.vat_rate_set === true;

    if (data.client_id && data.client_id !== existing.client_id) {
      const client = await resolveClient(context, session.activeCompany.id, data.client_id);
      patch.client_id = client.id;
      patch.client_name = client.name;
    }
    if (data.line_items !== undefined) Object.assign(patch, computeInvoiceTotals(data.line_items));

    // The number is assigned once, at creation, and is never part of an update.
    await service.entities.Invoice.update(data.id, patch);
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
    const existing = await findInvoice(service, session.activeCompany.id, data.id);

    if (!canTransition(existing.status, data.status)) {
      throw httpError(409, `An invoice can't be moved from ${existing.status} to ${data.status}`, "BAD_TRANSITION");
    }

    const stamp =
      data.status === "issued"
        ? { issued_at: new Date().toISOString() }
        : { cancelled_at: new Date().toISOString() };
    await service.entities.Invoice.update(data.id, { status: data.status, ...stamp });
    return { id: data.id, status: data.status };
  });

export const deleteInvoice = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;
    const existing = await findInvoice(service, session.activeCompany.id, data.id);
    // An issued invoice is a financial record: it is cancelled, never deleted.
    assertDraft(existing);

    await service.entities.Invoice.delete(data.id);
    return { id: data.id };
  });