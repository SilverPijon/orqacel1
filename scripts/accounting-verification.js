#!/usr/bin/env node
import { verificationPlan, EXECUTION_STATUS } from "../src/lib/accounting/verification/plan.js";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--plan") {
  process.stdout.write(`${JSON.stringify(verificationPlan(), null, 2)}\n`);
} else if (args.length === 1 && args[0] === "--local") {
  const { runLocalVerification } = await import("../src/lib/accounting/verification/localHarness.js");
  const report = await runLocalVerification();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "local-passed" ? 0 : 1;
} else {
  // No backend flag, app ID, credential, approval-file loader or driver import is
  // accepted. A later separately reviewed disposable-app launch is required.
  process.stderr.write(`${EXECUTION_STATUS}\nUsage: node scripts/accounting-verification.js --plan | --local\n`);
  process.exitCode = 2;
}
