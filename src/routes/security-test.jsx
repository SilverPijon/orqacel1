import React, { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Loader2, PlayCircle, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { preflightSecurityCheck, runSecurityCheck } from "@/lib/security-check-fns";

// TEMPORARY security-test page (Phase 2). Removed once the run is recorded.
export const Route = createFileRoute("/security-test")({
  ssr: false,
  head: () => ({ meta: [{ title: "Orqacel — Security test" }] }),
  component: SecurityTestPage,
});

function Badge({ pass, children }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${pass ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
      {pass ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {children}
    </span>
  );
}

function CheckRow({ check }) {
  return (
    <li className="flex items-start gap-2 py-1.5 text-sm">
      {check.pass ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
      )}
      <span className="min-w-0">
        <span className="font-medium">{check.label}</span>
        <span className="block text-xs text-muted-foreground">{check.actual}</span>
      </span>
    </li>
  );
}

function Group({ group }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-heading text-sm font-semibold">{group.title}</h3>
        <Badge pass={group.checks.every((check) => check.pass)}>{group.checks.every((check) => check.pass) ? "PASS" : "FAIL"}</Badge>
      </div>
      <ul className="mt-2 divide-y divide-border">
        {group.checks.map((check, index) => (
          <CheckRow key={index} check={check} />
        ))}
      </ul>
    </section>
  );
}

function SecurityTestPage() {
  const preflightFn = useServerFn(preflightSecurityCheck);
  const runFn = useServerFn(runSecurityCheck);
  const [preflight, setPreflight] = useState(null);
  const [blockedReason, setBlockedReason] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [result, setResult] = useState(null);
  const [runError, setRunError] = useState(null);

  const loadPreflight = useCallback(async () => {
    try {
      const res = await preflightFn();
      setPreflight(res.preflight);
      setBlockedReason(res.blockedReason);
    } catch (error) {
      setLoadError(
        error?.status === 401
          ? "Not signed in. Open this page in the window where the test account is signed in."
          : String(error?.message || error),
      );
    }
  }, [preflightFn]);

  useEffect(() => {
    loadPreflight();
  }, [loadPreflight]);

  const runTests = async () => {
    setPhase("running");
    setRunError(null);
    try {
      const res = await runFn();
      setResult(res);
      if (res.status === "cannot-run") {
        setBlockedReason(res.reason);
        setPhase("idle");
      } else {
        setPhase("done");
      }
    } catch (error) {
      setRunError(String(error?.message || error));
      setPhase("idle");
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5" />
        <h1 className="font-heading text-xl font-bold">Temporary security test</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        This page runs only when you press the button. It is removed after testing. No passwords, codes or tokens are used or shown.
      </p>

      {loadError ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{loadError}</div>
      ) : null}

      {preflight ? (
        <section className="mt-6 rounded-2xl border border-border bg-card p-4 text-sm">
          <h2 className="font-heading text-sm font-semibold">Signed-in account</h2>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="font-medium">{preflight.email || "—"}</dd>
            </div>
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-muted-foreground">Platform role</dt>
              <dd className="font-medium">{preflight.appRole || "—"}</dd>
            </div>
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-muted-foreground">Company</dt>
              <dd className="font-medium">{preflight.realCompany || "none"}</dd>
            </div>
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-muted-foreground">Company role</dt>
              <dd className="font-medium">{preflight.realCompanyRole || "—"} ({preflight.realCompanyStatus || "—"})</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {blockedReason ? (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{blockedReason}</span>
        </div>
      ) : preflight ? (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Ready: an ordinary company member account, and the temporary test company is in place.
        </div>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        <Button onClick={runTests} disabled={phase === "running" || Boolean(loadError)}>
          {phase === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          {phase === "running" ? "Running tests…" : "Run security tests"}
        </Button>
        <Button variant="outline" onClick={loadPreflight} disabled={phase === "running"}>
          Re-check
        </Button>
      </div>

      {runError ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{runError}</div>
      ) : null}

      {result?.status === "done" ? (
        <div className="mt-8 space-y-3">
          <div className={`flex items-center gap-2 rounded-2xl border p-4 ${result.overall ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}>
            {result.overall ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
            <strong className="text-sm">
              {result.overall ? "All tests passed" : "One or more tests failed — do not treat the app as secure yet."}
            </strong>
          </div>
          {result.groups.map((group) => (
            <Group key={group.key} group={group} />
          ))}
          {result.canary?.performed ? (
            <p className="text-xs text-muted-foreground">
              Because a protected-field write was accepted, one harmless changed value per field was written, read back and restored.
            </p>
          ) : null}
          {result.stored === false ? (
            <p className="text-xs text-amber-700">The run record could not be stored: {result.storeError}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}