import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import { asArray, httpError, requireCompanyContext } from "@/lib/tenant.server";
import { escapeRegex } from "@/lib/search";

const TEXT_FIELDS = [
  "name", "contact_name", "email", "phone", "address",
  "city", "postal_code", "country", "tax_id", "notes",
];

const ClientInput = z.object({
  name: z.string().min(1).max(160),
  contact_name: z.string().max(160).optional(),
  email: z.string().max(160).optional(),
  phone: z.string().max(40).optional(),
  address: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  postal_code: z.string().max(20).optional(),
  country: z.string().max(8).optional(),
  tax_id: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

function clean(input) {
  const patch = {};
  TEXT_FIELDS.forEach((field) => {
    if (typeof input[field] === "string") patch[field] = input[field].trim();
  });
  if (input.status) patch.status = input.status;
  return patch;
}

export const listClients = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(
    z.object({
      search: z.string().max(80).optional(),
      status: z.enum(["active", "archived"]).optional(),
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
        { name: { $regex: term, $options: "i" } },
        { contact_name: { $regex: term, $options: "i" } },
        { email: { $regex: term, $options: "i" } },
      ];
    }
    const page = await context.getBase44().entities.Client.filter(query, {
      sort: "-created_date",
      limit: data.limit || 20,
      ...(data.cursor ? { cursor: data.cursor } : {}),
    });
    return { items: asArray(page), nextCursor: page?.next_cursor || null };
  });

export const getClient = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(z.object({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context);
    const client = await context
      .getBase44()
      .entities.Client.get(data.id)
      .catch((error) => {
        if (error?.status === 404) return null;
        throw error;
      });
    if (!client || client.company_id !== session.activeCompany.id) return null;
    return client;
  });

export const createClient = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(ClientInput)
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context);
    const created = await context.getBase44().asServiceRole.entities.Client.create({
      company_id: session.activeCompany.id,
      status: "active",
      ...clean(data),
    });
    return { id: created.id };
  });

export const updateClient = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(ClientInput.partial().extend({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context);
    const service = context.getBase44().asServiceRole;
    const existing = await service.entities.Client.get(data.id).catch(() => null);
    if (!existing || existing.company_id !== session.activeCompany.id) {
      throw httpError(404, "Client not found", "NOT_FOUND");
    }
    await service.entities.Client.update(data.id, clean(data));
    return { id: data.id };
  });

export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;
    const existing = await service.entities.Client.get(data.id).catch(() => null);
    if (!existing || existing.company_id !== session.activeCompany.id) {
      throw httpError(404, "Client not found", "NOT_FOUND");
    }
    await service.entities.Client.delete(data.id);
    return { id: data.id };
  });