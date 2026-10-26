import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import { asArray, httpError, requireCompanyContext } from "@/lib/tenant.server";
import { round2, todayISO } from "@/lib/format";

const LineItem = z.object({
  description: z.string().max(200).optional(),
  quantity: z.number().min(0).max(100000).optional(),
  unit_price: z.number().min(0).max(10000000).optional(),
});

const QuotationInput = z.object({
  client_id: z.string().min(1).max(64),
  subject: z.string().max(160).optional(),
  issue_date: z.string().max(30).optional(),
  valid_until: z.string().max(30).optional(),
  tax_rate: z.number().min(0).max(100).optional(),
  notes: z.string().max(2000).optional(),
  line_items: z.array(LineItem).max(50).optional(),
});

function computeTotals(lineItems, taxRate) {
  const items = (lineItems || []).map((item) => ({
    description: (item.description || "").trim(),
    quantity: Number(item.quantity || 0),
    unit_price: Number(item.unit_price || 0),
  }));
  const subtotal = round2(items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0));
  const rate = Number(taxRate || 0);
  const tax_amount = round2((subtotal * rate) / 100);
  return { line_items: items, subtotal, tax_rate: rate, tax_amount, total: round2(subtotal + tax_amount) };
}

async function resolveClient(context, companyId, clientId) {
  const client = await context
    .getBase44()
    .entities.Client.get(clientId)
    .catch((error) => {
      if (error?.status === 404) return null;
      throw error;
    });
  if (!client || client.company_id !== companyId) {
    throw httpError(400, "That client doesn't belong to this company", "BAD_CLIENT");
  }
  return client;
}

export const listQuotations = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(
    z.object({
      search: z.string().max(80).optional(),
      status: z.enum(["draft", "sent", "accepted", "declined", "expired"]).optional(),
      client_id: z.string().max(64).optional(),
      cursor: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context);
    const query = { company_id: session.activeCompany.id };
    if (data.status) query.status = data.status;
    if (data.client_id) query.client_id = data.client_id;
    if (data.search) {
      query.$or = [
        { number: { $regex: data.search, $options: "i" } },
        { client_name: { $regex: data.search, $options: "i" } },
        { subject: { $regex: data.search, $options: "i" } },
      ];
    }
    const page = await context.getBase44().entities.Quotation.filter(query, {
      sort: "-created_date",
      limit: data.limit || 20,
      ...(data.cursor ? { cursor: data.cursor } : {}),
    });
    return { items: asArray(page), nextCursor: page?.next_cursor || null };
  });

export const getQuotation = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(z.object({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context);
    const quotation = await context
      .getBase44()
      .entities.Quotation.get(data.id)
      .catch((error) => {
        if (error?.status === 404) return null;
        throw error;
      });
    if (!quotation || quotation.company_id !== session.activeCompany.id) return null;

    const client = quotation.client_id
      ? await context
          .getBase44()
          .entities.Client.get(quotation.client_id)
          .catch(() => null)
      : null;

    return { quotation, client: client && client.company_id === session.activeCompany.id ? client : null };
  });

export const createQuotation = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(QuotationInput)
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context);
    const service = context.getBase44().asServiceRole;
    const companyId = session.activeCompany.id;
    const client = await resolveClient(context, companyId, data.client_id);

    const count = await service.entities.Quotation.count({ company_id: companyId });
    const totals = computeTotals(data.line_items, data.tax_rate);

    const created = await service.entities.Quotation.create({
      company_id: companyId,
      client_id: client.id,
      client_name: client.name,
      number: `QT-${1001 + count}`,
      subject: (data.subject || "").trim(),
      status: "draft",
      issue_date: data.issue_date || todayISO(),
      valid_until: data.valid_until || "",
      currency: session.activeCompany.currency || "EUR",
      notes: (data.notes || "").trim(),
      ...totals,
    });
    return { id: created.id };
  });

export const updateQuotation = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(QuotationInput.partial().extend({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context);
    const service = context.getBase44().asServiceRole;
    const existing = await service.entities.Quotation.get(data.id).catch(() => null);
    if (!existing || existing.company_id !== session.activeCompany.id) {
      throw httpError(404, "Quotation not found", "NOT_FOUND");
    }

    const patch = {};
    if (data.subject !== undefined) patch.subject = data.subject.trim();
    if (data.issue_date !== undefined) patch.issue_date = data.issue_date;
    if (data.valid_until !== undefined) patch.valid_until = data.valid_until;
    if (data.notes !== undefined) patch.notes = data.notes.trim();

    if (data.client_id && data.client_id !== existing.client_id) {
      const client = await resolveClient(context, session.activeCompany.id, data.client_id);
      patch.client_id = client.id;
      patch.client_name = client.name;
    }
    if (data.line_items !== undefined || data.tax_rate !== undefined) {
      Object.assign(
        patch,
        computeTotals(data.line_items ?? existing.line_items, data.tax_rate ?? existing.tax_rate),
      );
    }

    await service.entities.Quotation.update(data.id, patch);
    return { id: data.id };
  });

export const updateQuotationStatus = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(
    z.object({
      id: z.string().min(1).max(64),
      status: z.enum(["draft", "sent", "accepted", "declined", "expired"]),
    }),
  )
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context);
    const service = context.getBase44().asServiceRole;
    const existing = await service.entities.Quotation.get(data.id).catch(() => null);
    if (!existing || existing.company_id !== session.activeCompany.id) {
      throw httpError(404, "Quotation not found", "NOT_FOUND");
    }
    await service.entities.Quotation.update(data.id, { status: data.status });
    return { id: data.id, status: data.status };
  });

export const deleteQuotation = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;
    const existing = await service.entities.Quotation.get(data.id).catch(() => null);
    if (!existing || existing.company_id !== session.activeCompany.id) {
      throw httpError(404, "Quotation not found", "NOT_FOUND");
    }
    await service.entities.Quotation.delete(data.id);
    return { id: data.id };
  });

export const createJobFromQuotation = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context);
    const service = context.getBase44().asServiceRole;
    const quotation = await service.entities.Quotation.get(data.id).catch(() => null);
    if (!quotation || quotation.company_id !== session.activeCompany.id) {
      throw httpError(404, "Quotation not found", "NOT_FOUND");
    }

    const job = await service.entities.Job.create({
      company_id: session.activeCompany.id,
      client_id: quotation.client_id,
      client_name: quotation.client_name,
      quotation_id: quotation.id,
      title: quotation.subject || `${quotation.number} — ${quotation.client_name}`,
      description: "",
      status: "scheduled",
      priority: "medium",
      scheduled_date: todayISO(),
      price: Number(quotation.total || 0),
      currency: quotation.currency || session.activeCompany.currency || "EUR",
    });

    await service.entities.Quotation.update(quotation.id, { job_id: job.id });
    return { id: job.id };
  });