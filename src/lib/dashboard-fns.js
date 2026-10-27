import { createServerFn } from "@tanstack/react-start";
import { requireUser } from "@/lib/auth-middleware";
import { asArray, requireCompanyContext } from "@/lib/tenant.server";

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const session = await requireCompanyContext(context);
    const companyId = session.activeCompany.id;
    const { Client, Quotation, Job, Invoice } = context.getBase44().entities;

    const [clients, openQuotations, activeJobs, issuedInvoices, accepted, recentQuotations, recentJobs] = await Promise.all([
      Client.count({ company_id: companyId }),
      Quotation.count({ company_id: companyId, status: { $in: ["draft", "sent"] } }),
      Job.count({ company_id: companyId, status: { $in: ["scheduled", "in_progress"] } }),
      // Issued invoices are the ones still outstanding: an issued invoice is frozen and payable,
      // and the invoice carries no separate "paid" state to subtract.
      Invoice.count({ company_id: companyId, status: "issued" }),
      Quotation.aggregate({ query: { company_id: companyId, status: "accepted" }, sum: ["total"] }),
      Quotation.filter({ company_id: companyId }, { sort: "-created_date", limit: 5 }),
      Job.filter({ company_id: companyId }, { sort: "-created_date", limit: 5 }),
    ]);

    return {
      counts: {
        clients,
        openQuotations,
        activeJobs,
        issuedInvoices,
        acceptedValue: Number(accepted?.rows?.[0]?.sum_total || 0),
      },
      recentQuotations: asArray(recentQuotations).map((quotation) => ({
        id: quotation.id,
        number: quotation.number,
        client_name: quotation.client_name,
        status: quotation.status,
        total: quotation.total,
        currency: quotation.currency,
        created_date: quotation.created_date,
      })),
      recentJobs: asArray(recentJobs).map((job) => ({
        id: job.id,
        title: job.title,
        client_name: job.client_name,
        status: job.status,
        priority: job.priority,
        scheduled_date: job.scheduled_date,
      })),
    };
  });