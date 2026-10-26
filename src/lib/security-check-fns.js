import { createServerFn } from "@tanstack/react-start";
import { requireUser } from "@/lib/auth-middleware";
import { preflightCore, runSecurityCore } from "@/lib/security-check.server";

// TEMPORARY security-test server functions (Phase 2). Removed once the run is recorded.
export const preflightSecurityCheck = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(({ context }) => preflightCore(context));

export const runSecurityCheck = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .handler(({ context }) => runSecurityCore(context));