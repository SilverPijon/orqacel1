import { createFileRoute } from "@tanstack/react-router";
import { requireUserRoute } from "@/lib/auth-middleware";
import { preflightCore, runSecurityCore } from "@/lib/security-check.server";

// TEMPORARY smoke route for the corrected harness — deleted right after this one run.
export const Route = createFileRoute("/api/security-smoke")({
  server: {
    middleware: [requireUserRoute],
    handlers: {
      GET: async ({ context }) => {
        const pre = await preflightCore(context);
        const run = await runSecurityCore(context, { skipRoleGuard: true });
        return Response.json({ preflight: pre.preflight, blocked: pre.blockedReason, run });
      },
    },
  },
});