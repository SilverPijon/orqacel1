import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import { asArray, httpError, requireCompanyContext } from "@/lib/tenant.server";

const JobInput = z.object({
  title: z.string().min(1).max(160),
  client_id: z.string().max(64).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  scheduled_date: z.string().max(30).optional(),
  completed_date: z.string().max(30).optional(),
  assigned_to_id: z.string().max(64).optional(),
  address: z.string().max(200).optional(),
  price: z.number().min(0).max(10000000).optional(),
});

async function resolveClient(context, companyId, clientId) {
  if (!clientId) return null;
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

// The assignee must be a member of this company; the display name is resolved server-side.
async function resolveAssignee(service, companyId, userId) {
  if (!userId) return "";
  const rows = asArray(
    await service.entities.CompanyMembership.filter({ company_id: companyId, user_id: userId }),
  );
  const membership = rows[0];
  return membership ? membership.full_name || membership.user_email : "";
}

export const listJobs = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(
    z.object({
      search: z.string().max(80).optional(),
      status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]).optional(),
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
        { title: { $regex: data.search, $options: "i" } },
        { client_name: { $regex: data.search, $options: "i" } },
      ];
    }
    const page = await context.getBase44().entities.Job.filter(query, {
      sort: "-created_date",
      limit: data.limit || 20,
      ...(data.cursor ? { cursor: data.cursor } : {}),
    });
    return { items: asArray(page), nextCursor: page?.next_cursor || null };
  });

export const getJob = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(z.object({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context);
    const job = await context
      .getBase44()
      .entities.Job.get(data.id)
      .catch((error) => {
        if (error?.status === 404) return null;
        throw error;
      });
    if (!job || job.company_id !== session.activeCompany.id) return null;

    const client = job.client_id
      ? await context
          .getBase44()
          .entities.Client.get(job.client_id)
          .catch(() => null)
      : null;

    return { job, client: client && client.company_id === session.activeCompany.id ? client : null };
  });

export const createJob = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(JobInput)
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context);
    const service = context.getBase44().asServiceRole;
    const companyId = session.activeCompany.id;
    const client = await resolveClient(context, companyId, data.client_id);

    const created = await service.entities.Job.create({
      company_id: companyId,
      client_id: client?.id || "",
      client_name: client?.name || "",
      title: data.title.trim(),
      description: (data.description || "").trim(),
      status: data.status || "scheduled",
      priority: data.priority || "medium",
      scheduled_date: data.scheduled_date || "",
      completed_date: data.completed_date || "",
      assigned_to_id: data.assigned_to_id || "",
      assigned_to_name: await resolveAssignee(service, companyId, data.assigned_to_id),
      address: (data.address || "").trim(),
      price: Number(data.price || 0),
      currency: session.activeCompany.currency || "EUR",
    });
    return { id: created.id };
  });

export const updateJob = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(JobInput.partial().extend({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context);
    const service = context.getBase44().asServiceRole;
    const existing = await service.entities.Job.get(data.id).catch(() => null);
    if (!existing || existing.company_id !== session.activeCompany.id) {
      throw httpError(404, "Job not found", "NOT_FOUND");
    }

    const patch = {};
    ["title", "description", "address"].forEach((field) => {
      if (typeof data[field] === "string") patch[field] = data[field].trim();
    });
    ["status", "priority"].forEach((field) => {
      if (data[field] !== undefined) patch[field] = data[field];
    });
    ["scheduled_date", "completed_date"].forEach((field) => {
      if (data[field] !== undefined) patch[field] = data[field];
    });
    if (data.assigned_to_id !== undefined) {
      patch.assigned_to_id = data.assigned_to_id;
      patch.assigned_to_name = await resolveAssignee(service, session.activeCompany.id, data.assigned_to_id);
    }
    if (data.price !== undefined) patch.price = Number(data.price || 0);
    if (data.client_id !== undefined) {
      const client = await resolveClient(context, session.activeCompany.id, data.client_id);
      patch.client_id = client?.id || "";
      patch.client_name = client?.name || "";
    }

    await service.entities.Job.update(data.id, patch);
    return { id: data.id };
  });

export const updateJobStatus = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(
    z.object({
      id: z.string().min(1).max(64),
      status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]),
    }),
  )
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context);
    const service = context.getBase44().asServiceRole;
    const existing = await service.entities.Job.get(data.id).catch(() => null);
    if (!existing || existing.company_id !== session.activeCompany.id) {
      throw httpError(404, "Job not found", "NOT_FOUND");
    }
    const patch = { status: data.status };
    if (data.status === "completed") patch.completed_date = new Date().toISOString().slice(0, 10);
    await service.entities.Job.update(data.id, patch);
    return { id: data.id, status: data.status };
  });

export const deleteJob = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;
    const existing = await service.entities.Job.get(data.id).catch(() => null);
    if (!existing || existing.company_id !== session.activeCompany.id) {
      throw httpError(404, "Job not found", "NOT_FOUND");
    }
    await service.entities.Job.delete(data.id);
    return { id: data.id };
  });