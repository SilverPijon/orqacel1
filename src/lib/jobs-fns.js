import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import { asArray, httpError, requireCompanyContext } from "@/lib/tenant.server";
import { escapeRegex } from "@/lib/search";
import { JOB_STATUS_VALUES, PAUSE_REASONS, canTransition, statusPatch } from "@/lib/jobStatus";
import { currentRevision, nextRevision, writeJobConditionally } from "@/lib/jobWrites.server";

const JobInput = z.object({
  title: z.string().min(1).max(160),
  client_id: z.string().max(64).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(JOB_STATUS_VALUES).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  scheduled_date: z.string().max(30).optional(),
  completed_date: z.string().max(30).optional(),
  assigned_to_id: z.string().max(64).optional(),
  address: z.string().max(200).optional(),
  price: z.number().min(0).max(10000000).optional(),
  // Only meaningful when the form's status is paused; both stay optional, so paused can be saved
  // without a reason. An empty string means "no reason given".
  pause_reason: z.union([z.enum(PAUSE_REASONS), z.literal("")]).optional(),
  pause_note: z.string().max(500).optional(),
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
      status: z.enum(JOB_STATUS_VALUES).optional(),
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
      const term = escapeRegex(data.search);
      query.$or = [
        { title: { $regex: term, $options: "i" } },
        { client_name: { $regex: term, $options: "i" } },
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
      revision: 0,
      priority: data.priority || "medium",
      scheduled_date: data.scheduled_date || "",
      completed_date: data.completed_date || "",
      assigned_to_id: data.assigned_to_id || "",
      assigned_to_name: await resolveAssignee(service, companyId, data.assigned_to_id),
      address: (data.address || "").trim(),
      price: Number(data.price || 0),
      currency: session.activeCompany.currency || "EUR",
      // Created straight away as paused: record the same pause details the form collected.
      ...(data.status === "paused"
        ? statusPatch("scheduled", "paused", { reason: data.pause_reason, note: data.pause_note })
        : {}),
    });
    return { id: created.id };
  });

export const updateJob = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(
    JobInput.partial().extend({
      id: z.string().min(1).max(64),
      // The revision the form was opened on. A job that moved since is reported, never overwritten.
      expected_revision: z.number().int().min(0),
    }),
  )
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
    if (data.priority !== undefined) patch.priority = data.priority;
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

    // Status editing from the form keeps working as it always did. A status change only adds
    // the bookkeeping the new paused state needs: the pause details, and the completion date
    // that a move into or out of completed has to set or clear.
    if (data.status && data.status !== existing.status) {
      // The one rule the paused status adds to this form: a job that is already finished or
      // cancelled cannot be paused. Every pre-existing status move is left exactly as it was.
      if (data.status === "paused" && !canTransition(existing.status, "paused")) {
        throw httpError(409, "A finished or cancelled job can't be paused", "PAUSE_NOT_ALLOWED");
      }
      // Pausing through the form keeps the optional reason and note, and records the status the
      // job came from so Resume returns it to Scheduled or In progress.
      Object.assign(
        patch,
        statusPatch(existing.status, data.status, {
          reason: data.pause_reason,
          note: data.pause_note,
        }),
      );
    } else if (existing.status === "paused" && data.status === "paused") {
      // Already paused: saving the form edits the pause details and nothing else.
      patch.pause_reason = PAUSE_REASONS.includes(data.pause_reason) ? data.pause_reason : "";
      if (data.pause_note !== undefined) {
        patch.pause_note = String(data.pause_note).trim().slice(0, 500);
      }
    }

    if (!Object.keys(patch).length) return { id: data.id, revision: currentRevision(existing) };
    // The revision the caller read must still be the stored one. The check below gives the honest
    // answer early; the conditional write is what makes it hold when a write lands in between — a
    // plain read followed by an unconditional update could still overwrite the newer version.
    if (data.expected_revision !== currentRevision(existing)) {
      throw httpError(409, "This job changed in the meantime", "STALE_JOB");
    }
    const written = await writeJobConditionally(
      service,
      existing,
      { companyId: session.activeCompany.id },
      patch,
    );
    if (written === 0) {
      throw httpError(409, "This job changed in the meantime", "STALE_JOB");
    }
    return { id: data.id, revision: nextRevision(existing) };
  });

export const updateJobStatus = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(
    z.object({
      id: z.string().min(1).max(64),
      status: z.enum(JOB_STATUS_VALUES),
      // Only meaningful when pausing; both stay optional so a pause can be recorded without them.
      reason: z.enum(PAUSE_REASONS).optional(),
      note: z.string().max(500).optional(),
      // The status the caller saw. A job that moved meanwhile is reported, not overwritten.
      expected_status: z.enum(JOB_STATUS_VALUES),
    }),
  )
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context);
    const service = context.getBase44().asServiceRole;
    const existing = await service.entities.Job.get(data.id).catch(() => null);
    // The company always comes from the caller's own session, so a job of another company is
    // indistinguishable from one that doesn't exist.
    if (!existing || existing.company_id !== session.activeCompany.id) {
      throw httpError(404, "Job not found", "NOT_FOUND");
    }
    // The status the caller saw must still be the stored one: a job that moved — by a status change
    // or by an edit that raised its revision — is reported instead of overwritten.
    if (data.expected_status !== existing.status) {
      throw httpError(409, "This job changed in the meantime", "STALE_STATUS");
    }
    if (existing.status === data.status) {
      return { id: data.id, status: existing.status, unchanged: true };
    }
    if (!canTransition(existing.status, data.status)) {
      throw httpError(409, "That status change isn't allowed for this job", "INVALID_TRANSITION");
    }

    // Only the status, its pause details and the completion date are written: client, quotation
    // link, scheduled date, assignment and price are never touched by a status change.
    const patch = statusPatch(existing.status, data.status, { reason: data.reason, note: data.note });
    const written = await writeJobConditionally(
      service,
      existing,
      { companyId: session.activeCompany.id, expectedStatus: existing.status },
      patch,
    );
    if (written === 0) {
      throw httpError(409, "This job changed in the meantime", "STALE_STATUS");
    }
    return { id: data.id, status: data.status, pause_reason: patch.pause_reason || "" };
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