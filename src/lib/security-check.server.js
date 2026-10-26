// TEMPORARY security-test logic (Phase 2). Server-only. Removed once the run is recorded.
// Reads are made as the caller (entity rules apply); fixture setup, read-back and every
// restore use the service role. Caller identity always comes from the session.

import { httpError } from "@/lib/tenant.server";

const a = (result) => (Array.isArray(result) ? result : result?.items || []);
export const B_NAME = "ORQACEL SECURITY TEST — DELETE ME";
const TEST_MEMBER_EMAIL = "security-test-member@orqacel.test";
const BOGUS_ID = "TEST-bogus-company-id";
const TEST_RUNNER_EMAIL = "sillu_231@hotmail.com";
const short = (error) => String(error?.status || error?.message || "error").slice(0, 60);

// The audit reads other-company data and writes with the service role, so it runs only for its
// designated test account: every other signed-in member is refused before any probing starts.
export function assertAuditCaller(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  if (email !== TEST_RUNNER_EMAIL) {
    throw httpError(403, "This temporary audit runs only for its designated test account.", "AUDIT_LOCKED");
  }
}

export async function loadContext(context) {
  const caller = context.getBase44();
  const service = caller.asServiceRole;
  const me = context.user;

  const userRow = a(await service.entities.User.filter({ id: me.id }))[0] || {};
  const memberships = a(await service.entities.CompanyMembership.filter({ user_id: me.id }));
  const companyB = a(await service.entities.Company.filter({ name: B_NAME }))[0] || null;
  const real = memberships.filter((row) => row.company_id !== companyB?.id);
  const activeReal = real.filter((row) => row.status === "active");
  const mine = activeReal[0] || null;
  const myCompany = mine ? a(await service.entities.Company.filter({ id: mine.company_id }))[0] || null : null;
  const fixtureCounts = companyB
    ? {
        clients: a(await service.entities.Client.filter({ company_id: companyB.id })).length,
        quotations: a(await service.entities.Quotation.filter({ company_id: companyB.id })).length,
        jobs: a(await service.entities.Job.filter({ company_id: companyB.id })).length,
        memberships: a(await service.entities.CompanyMembership.filter({ company_id: companyB.id })).length,
      }
    : null;

  return {
    caller,
    service,
    me,
    userRow,
    memberships,
    companyB,
    mine,
    myCompany,
    preflight: {
      email: userRow.email || me.email || "",
      appRole: userRow.role || null,
      companyCount: (userRow.company_ids || []).length,
      memberships: memberships.map((row) => `${row.role}:${row.status}`).join(" | ") || "none",
      realCompany: myCompany?.name || null,
      realCompanyRole: mine?.role || null,
      realCompanyStatus: mine?.status || null,
      fixtureReady: Boolean(companyB),
      fixtureCounts,
    },
  };
}

export function blockedReason(preflight) {
  if (!preflight.fixtureReady) return "The temporary test company is missing, so cross-company tests cannot run.";
  if (!preflight.realCompany) return "This account has no company membership yet, so the tests cannot run.";
  if (preflight.realCompanyStatus !== "active") return "This account's company membership is not active yet, so the tests cannot run.";
  if (preflight.realCompanyRole !== "member") {
    return `This account's company role is "${preflight.realCompanyRole}", not "Member" — the tests need an ordinary member account.`;
  }
  return null;
}

export async function preflightCore(context) {
  assertAuditCaller(context.user);
  const { preflight } = await loadContext(context);
  return { preflight, blockedReason: blockedReason(preflight) };
}

export async function runSecurityCore(context, options = {}) {
  assertAuditCaller(context.user);
  const { caller, service, me, userRow, companyB, mine, myCompany, preflight } = await loadContext(context);

  const stop = preflight.fixtureReady ? (options.skipRoleGuard ? null : blockedReason(preflight)) : blockedReason(preflight);
  if (stop) return { status: "cannot-run", reason: stop, preflight, groups: [], verdicts: null, integrity: null };

  const groups = [];
  const originalIds = Array.isArray(userRow.company_ids) ? userRow.company_ids : [];
  const originalActive = userRow.active_company_id || null;
  const originalRole = userRow.role || null;
  const restoreLog = [];
  // Restores go through the caller's own session first — the write path that provably
  // works for this account — with the service role as a fallback. A refused restore is
  // never swallowed: it is recorded and surfaces in the integrity section.
  const writeBack = async (entity, id, patch) => {
    try {
      await caller.entities[entity].update(id, patch);
      return "";
    } catch (error) {
      const first = short(error);
      try {
        await service.entities[entity].update(id, patch);
        return first;
      } catch (serviceError) {
        return `${first} / ${short(serviceError)}`;
      }
    }
  };

  try {
    // ---- fixture: exactly one of each test record in the other company ------
    const ensure = async (entity, query, payload) => {
      const found = a(await service.entities[entity].filter(query));
      return found.length ? found[0] : await service.entities[entity].create(payload);
    };
    const clientB = await ensure("Client", { company_id: companyB.id }, { company_id: companyB.id, name: "TEST foreign client (delete me)", email: "foreign@orqacel.test" });
    const quotationB = await ensure("Quotation", { company_id: companyB.id }, { company_id: companyB.id, number: "TEST-0001", subject: "TEST foreign quotation (delete me)", status: "draft", currency: "EUR" });
    const jobB = await ensure("Job", { company_id: companyB.id }, { company_id: companyB.id, title: "TEST foreign job (delete me)", status: "scheduled", currency: "EUR" });
    const memberB = await ensure("CompanyMembership", { company_id: companyB.id, user_email: TEST_MEMBER_EMAIL }, { company_id: companyB.id, company_name: companyB.name, user_email: TEST_MEMBER_EMAIL, full_name: "TEST member", role: "member", status: "active" });

    const specs = [
      { name: "Client", label: "clients", id: clientB.id, filter: { company_id: companyB.id }, create: { company_id: companyB.id, name: "ATTACK client" }, update: { name: "ATTACK renamed" } },
      { name: "Quotation", label: "quotations", id: quotationB.id, filter: { company_id: companyB.id }, create: { company_id: companyB.id, number: "ATTACK-1" }, update: { number: "ATTACK-RENAMED" } },
      { name: "Job", label: "jobs", id: jobB.id, filter: { company_id: companyB.id }, create: { company_id: companyB.id, title: "ATTACK job" }, update: { title: "ATTACK renamed" } },
      { name: "Company", label: "companies", id: companyB.id, filter: { id: companyB.id }, create: { name: "ATTACK company" }, update: { name: "ATTACK renamed company" } },
      {
        name: "CompanyMembership",
        label: "memberships",
        id: memberB.id,
        filter: { company_id: companyB.id },
        create: { company_id: companyB.id, company_name: companyB.name, user_id: me.id, user_email: userRow.email || me.email || "", role: "owner", status: "active" },
        update: { role: "owner" },
      },
    ];
    const leftoverIds = { Client: [], Quotation: [], Job: [], Company: [], CompanyMembership: [] };

    // ---- test 3: cross-company reads ----------------------------------------
    const readChecks = [];
    for (const spec of specs) {
      const entity = caller.entities[spec.name];
      try {
        const rows = a(await entity.filter(spec.filter, { limit: 20 }));
        readChecks.push({ label: `List ${spec.label} of the other company`, actual: `${rows.length} row(s) returned`, pass: rows.length === 0 });
      } catch (error) {
        readChecks.push({ label: `List ${spec.label} of the other company`, actual: `refused (${short(error)})`, pass: true });
      }
      try {
        await entity.get(spec.id);
        readChecks.push({ label: `Open one ${spec.label} record by its id`, actual: "record returned", pass: false });
      } catch (error) {
        readChecks.push({ label: `Open one ${spec.label} record by its id`, actual: `refused (${short(error)})`, pass: true });
      }
    }

    // ---- test 4: cross-company create / update / delete ---------------------
    const writeChecks = [];
    for (const spec of specs) {
      const entity = caller.entities[spec.name];
      try {
        const created = await entity.create(spec.create);
        if (created?.id) leftoverIds[spec.name].push(created.id);
        writeChecks.push({ label: `Create ${spec.label} in the other company`, actual: "ALLOWED", pass: false });
      } catch (error) {
        writeChecks.push({ label: `Create ${spec.labels || spec.label} in the other company`, actual: `refused (${short(error)})`, pass: true });
      }
      try {
        await entity.update(spec.id, spec.update);
        writeChecks.push({ label: `Edit ${spec.label} of the other company`, actual: "ALLOWED", pass: false });
      } catch (error) {
        writeChecks.push({ label: `Edit ${spec.label} of the other company`, actual: `refused (${short(error)})`, pass: true });
      }
      try {
        await entity.delete(spec.id);
        writeChecks.push({ label: `Delete ${spec.label} of the other company`, actual: "ALLOWED", pass: false });
      } catch (error) {
        writeChecks.push({ label: `Delete ${spec.label} of the other company`, actual: `refused (${short(error)})`, pass: true });
      }
    }

    // ---- test 1: protected user fields (company list, active company, platform role) --
    // Writing back the value the account already holds is a no-op, so on its own it
    // cannot show a vulnerability: it is kept as a control proving the write path is
    // live. The security question is whether a CHANGED value can be written, so each
    // field is probed twice — same value, then a changed value — on both write paths.
    const probeSameValue = async (fn) => {
      try {
        await fn();
        return "accepted (no-op)";
      } catch (error) {
        return `refused (${short(error)})`;
      }
    };

    const protectedFields = [
      {
        key: "company_ids",
        original: originalIds,
        canary: [...originalIds, BOGUS_ID],
        landed: (row) => (row.company_ids || []).includes(BOGUS_ID),
        restored: (row) => JSON.stringify(row.company_ids || []) === JSON.stringify(originalIds),
        checkLabel: "Change the account's own company list",
      },
      {
        key: "active_company_id",
        original: originalActive,
        canary: BOGUS_ID,
        landed: (row) => row.active_company_id === BOGUS_ID,
        restored: (row) => (row.active_company_id || null) === (originalActive || null),
        checkLabel: "Change the account's own active company",
      },
      {
        key: "role",
        original: originalRole,
        // Only ever attempted on an account below the highest platform role: the
        // platform refuses role writes on the app owner, so it is never downgraded.
        skip: originalRole === "admin",
        skipNote: `not probed — this account already holds the highest platform role (${originalRole})`,
        canary: "admin",
        landed: (row) => row.role === "admin" && row.role !== originalRole,
        restored: (row) => (row.role || null) === (originalRole || null),
        checkLabel: "Change the account's own platform role",
      },
    ];

    const attemptChange = async (spec, path, write) => {
      const entry = { wrote: false, landed: false, restored: true };
      try {
        await write();
        entry.wrote = true;
      } catch (error) {
        entry.note = short(error);
        return entry;
      }
      const after = a(await service.entities.User.filter({ id: me.id }))[0] || {};
      entry.landed = Boolean(spec.landed(after));
      if (entry.landed) {
        const note = await writeBack("User", me.id, { [spec.key]: spec.original });
        const back = a(await service.entities.User.filter({ id: me.id }))[0] || {};
        entry.restored = Boolean(spec.restored(back));
        if (!entry.restored) restoreLog.push(`protected restore failed: ${spec.key} (${path}) — ${note || "unknown"}`);
      }
      return entry;
    };

    const canary = { performed: true, fields: {} };
    const protectedChecks = [];
    for (const spec of protectedFields) {
      if (spec.skip) {
        protectedChecks.push({ label: spec.checkLabel, actual: spec.skipNote, pass: true });
        continue;
      }
      const sameValue = await probeSameValue(() => caller.entities.User.update(me.id, { [spec.key]: spec.original }));
      const sameValueMe = await probeSameValue(() => caller.auth.updateMe({ [spec.key]: spec.original }));
      const viaEntities = await attemptChange(spec, "record update", () => caller.entities.User.update(me.id, { [spec.key]: spec.canary }));
      const viaUpdateMe = await attemptChange(spec, "profile save", () => caller.auth.updateMe({ [spec.key]: spec.canary }));
      canary.fields[spec.key] = { sameValue, sameValueMe, viaEntities, viaUpdateMe };
      const describe = (entry) =>
        entry.landed
          ? `LANDED${entry.restored ? " (restored)" : " (restore FAILED)"}`
          : entry.wrote
            ? "accepted, did not land"
            : `refused (${entry.note})`;
      protectedChecks.push({
        label: spec.checkLabel,
        actual: `changed value — ${describe(viaEntities)} via record update, ${describe(viaUpdateMe)} via profile save (same-value control: ${sameValue} / ${sameValueMe})`,
        pass: !viaEntities.landed && !viaUpdateMe.landed,
      });
    }

    // ---- test 2: raising this account's own company role -------------------
    const roleChecks = [];
    const targetRole = mine.role === "owner" ? "member" : "owner";
    const ownRoleSameValue = await probeSameValue(() => caller.entities.CompanyMembership.update(mine.id, { role: mine.role }));
    const escalation = { attempted: true, target: targetRole };
    try {
      await caller.entities.CompanyMembership.update(mine.id, { role: targetRole });
      escalation.wrote = true;
    } catch (error) {
      escalation.wrote = false;
      escalation.note = short(error);
    }
    if (escalation.wrote) {
      const after = a(await service.entities.CompanyMembership.filter({ id: mine.id }))[0] || {};
      escalation.landed = after.role === targetRole && after.role !== mine.role;
      if (escalation.landed) {
        const note = await writeBack("CompanyMembership", mine.id, { role: mine.role });
        escalation.restored = (a(await service.entities.CompanyMembership.filter({ id: mine.id }))[0] || {}).role === mine.role;
        if (!escalation.restored) restoreLog.push(`own membership role restore failed — ${note || "unknown"}`);
      }
    }
    roleChecks.push({
      label: `Raise own company role (to ${targetRole})`,
      actual: escalation.landed
        ? `ALLOWED — role changed${escalation.restored ? ", then restored" : ", restore FAILED"}`
        : escalation.wrote
          ? "accepted, did not land"
          : `refused (${escalation.note}) (same-value control: ${ownRoleSameValue})`,
      pass: !escalation.landed,
    });

    let duplicateSelf = null;
    try {
      duplicateSelf = await caller.entities.CompanyMembership.create({
        company_id: mine.company_id,
        company_name: mine.company_name,
        user_id: me.id,
        user_email: preflight.email,
        role: "owner",
        status: "active",
      });
      roleChecks.push({ label: "Create a second membership for itself with Owner role", actual: "ALLOWED", pass: false });
    } catch (error) {
      roleChecks.push({ label: "Create a second membership for itself with Owner role", actual: `refused (${short(error)})`, pass: true });
    } finally {
      if (duplicateSelf?.id) await service.entities.CompanyMembership.delete(duplicateSelf.id);
    }

    // ---- integrity: nothing real changed, nothing left behind --------------
    const finalUser = a(await service.entities.User.filter({ id: me.id }))[0] || {};
    const surviving = {
      client: a(await service.entities.Client.filter({ id: clientB.id }))[0],
      quotation: a(await service.entities.Quotation.filter({ id: quotationB.id }))[0],
      job: a(await service.entities.Job.filter({ id: jobB.id }))[0],
      company: a(await service.entities.Company.filter({ id: companyB.id }))[0],
      member: a(await service.entities.CompanyMembership.filter({ id: memberB.id }))[0],
    };
    const attackRows =
      a(await service.entities.Client.filter({ company_id: companyB.id })).filter((row) => /ATTACK/.test(row.name || "")).length +
      a(await service.entities.Quotation.filter({ company_id: companyB.id })).filter((row) => /ATTACK/.test(row.number || "")).length +
      a(await service.entities.Job.filter({ company_id: companyB.id })).filter((row) => /ATTACK/.test(row.title || "")).length +
      a(await service.entities.CompanyMembership.filter({ company_id: companyB.id })).filter((row) => row.user_id === me.id).length;

    for (const [entity, ids] of Object.entries(leftoverIds)) {
      for (const id of ids) await service.entities[entity].delete(id);
    }
    if (attackRows) {
      await service.entities.Client.deleteMany({ company_id: companyB.id, name: { $regex: "ATTACK" } });
      await service.entities.Job.deleteMany({ company_id: companyB.id, title: { $regex: "ATTACK" } });
      await service.entities.CompanyMembership.deleteMany({ company_id: companyB.id, user_id: me.id });
    }

    // Final unconditional restore of this account's protected fields.
    const nowUser = a(await service.entities.User.filter({ id: me.id }))[0] || {};
    const drift = {};
    if (JSON.stringify(nowUser.company_ids || []) !== JSON.stringify(originalIds)) drift.company_ids = originalIds;
    if ((nowUser.active_company_id || null) !== originalActive) drift.active_company_id = originalActive;
    if ((nowUser.role || null) !== originalRole) drift.role = originalRole;
    if (Object.keys(drift).length) {
      const note = await writeBack("User", me.id, drift);
      restoreLog.push(`final restore of: ${Object.keys(drift).join(", ")}${note ? ` (${note})` : ""}`);
    }

    const restoredUser = a(await service.entities.User.filter({ id: me.id }))[0] || {};
    const myMembershipAfter = a(await service.entities.CompanyMembership.filter({ company_id: mine.company_id, user_id: me.id }));
    const integrity = {
      myCompanyListUnchanged: JSON.stringify(restoredUser.company_ids || []) === JSON.stringify(originalIds),
      myActiveCompanyUnchanged: (restoredUser.active_company_id || null) === originalActive,
      myPlatformRoleUnchanged: (restoredUser.role || null) === originalRole,
      myCompanyRoleUnchanged: myMembershipAfter[0]?.role === mine.role,
      myMembershipCountInRealCompany: myMembershipAfter.length,
      realCompanyNameUnchanged: (a(await service.entities.Company.filter({ id: mine.company_id }))[0] || {}).name === myCompany?.name,
      foreignFixtureIntact: Boolean(surviving.client && surviving.quotation && surviving.job && surviving.company && surviving.member && surviving.member.role === "member"),
      attackerRowsLeftBehind: attackRows,
      leftoverRecordsCleaned: Object.values(leftoverIds).flat().length,
      restoresPerformed: restoreLog,
    };
    const integrityOk =
      integrity.myCompanyListUnchanged && integrity.myActiveCompanyUnchanged &&
      integrity.myPlatformRoleUnchanged && integrity.myCompanyRoleUnchanged &&
      integrity.myMembershipCountInRealCompany === 1 && integrity.realCompanyNameUnchanged &&
      integrity.foreignFixtureIntact && integrity.attackerRowsLeftBehind === 0;

    groups.push(
      { key: "protected", title: "Protected user fields (company list, active company, platform role)", checks: protectedChecks },
      { key: "elevation", title: "Raising its own company role", checks: roleChecks },
      { key: "reads", title: "Reading the other company's data", checks: readChecks },
      { key: "writes", title: "Creating, editing and deleting in the other company", checks: writeChecks },
      {
        key: "integrity",
        title: "Nothing real changed, nothing left behind",
        checks: [{ label: "This account's own records are unchanged", actual: JSON.stringify(integrity), pass: integrityOk }],
      },
    );

    const verdicts = {
      protectedFields: protectedChecks.every((check) => check.pass),
      selfElevation: roleChecks.every((check) => check.pass),
      crossCompanyReads: readChecks.every((check) => check.pass),
      crossCompanyWrites: writeChecks.every((check) => check.pass),
      noSideEffects: integrityOk,
    };
    const overall = Object.values(verdicts).every(Boolean);
    const report = { preflight, verdicts, canary, escalation, integrity, groups };

    try {
      await service.entities.SecurityTestRun.create({
        run_by_email: preflight.email,
        run_by_role: preflight.appRole || "",
        outcome: overall ? "PASS" : "FAIL",
        report: JSON.stringify(report),
      });
    } catch (error) {
      return { status: "done", stored: false, storeError: short(error), overall, verdicts, integrity, canary, escalation, groups, preflight };
    }

    return { status: "done", stored: true, overall, verdicts, integrity, canary, escalation, groups, preflight };
  } catch (error) {
    // Never leave a protected field modified if anything unexpected happens.
    try {
      const current = a(await service.entities.User.filter({ id: me.id }))[0] || {};
      const patch = {};
      if (JSON.stringify(current.company_ids || []) !== JSON.stringify(originalIds)) patch.company_ids = originalIds;
      if ((current.active_company_id || null) !== originalActive) patch.active_company_id = originalActive;
      if ((current.role || null) !== originalRole) patch.role = originalRole;
      if (Object.keys(patch).length) await writeBack("User", me.id, patch);
    } catch (restoreError) {
      // surfaced below
    }
    return {
      status: "error",
      reason: short(error),
      detail: String(error?.message || error),
      stack: String(error?.stack || "").split("\n").slice(0, 8).join(" | "),
      preflight,
      groups,
      verdicts: null,
      integrity: null,
    };
  }
}