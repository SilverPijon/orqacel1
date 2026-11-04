import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { connectionTransition, CONNECTION_TRANSITIONS, connectionFenceReadiness,
  captureAuthorizationFence, evaluateAuthorizationFence } from "../export/connectionLifecycle.js";
import { createConnectionFenceModel } from "../testing/connectionFenceModel.js";
import { makeInvoice, makeActor } from "../testing/fixtures.js";
import { createExportCandidate, MERIT_FIELDS as f } from "../export/claimProtocol.js";
import { MOCK_LOOKUP_CONTRACT } from "../export/reconciliation.js";

function seeds() {
  const invoice = makeInvoice(), actor = makeActor();
  const binding = { companyId: invoice.company_id, provider: "merit", connectionId: "connection-1", connectionRevision: 1,
    environment: "test", region: "ee", ledgerId: "synthetic-ledger", bindingId: "synthetic-binding" };
  const connection = { id: binding.connectionId, companyId: invoice.company_id, state: "active", generation: 0, binding, verifiedAt: "2026-01-01" };
  const candidate = createExportCandidate({ invoice, actor, binding, exportId: "export-1" }).row;
  const users = [{ id: actor.userId, activeCompanyId: actor.companyId, generation: 0 },
    { id: "other-admin", activeCompanyId: actor.companyId, generation: 0 },
    { id: "foreign-admin", activeCompanyId: "foreign-company", generation: 0 }];
  const memberships = users.map(u => ({ userId: u.id, companyId: u.activeCompanyId, role: "admin", status: "active", generation: 0 }));
  memberships.push({userId:actor.userId,companyId:"foreign-company",role:"admin",status:"active",generation:0});
  return { invoice, actor, connection, candidate, users, memberships };
}
function setup(change = () => {}) {
  const data = seeds(); change(data);
  let now = 1000, tokens = 0, evidence;
  const model = createConnectionFenceModel({ invoices: [data.invoice], candidates: [data.candidate], users: data.users,
    memberships: data.memberships, connections: [data.connection], clock: () => now, newToken: () => `worker-${++tokens}`,
    lookupEvidence: () => evidence });
  const c = model.forUser(data.actor.userId), other = model.forUser("other-admin"), input = {invoiceId:data.invoice.id};
  return { ...data, model, c, other, input, control:model.control,
    plan:(op,extra={})=>c.prepare(op,{...input,...extra}), drain:()=>c.projectAudit(input),
    read:async()=> (await model.control.snapshot()).invoices[0],
    connectionRead:async()=> (await model.control.snapshot()).connections[0],
    change:(nextState,expectedGeneration=0)=>c.changeConnection({connectionId:data.connection.id,nextState,expectedGeneration}),
    member:(role="admin",status="revoked")=>model.control.changeMembership({userId:data.actor.userId,companyId:data.actor.companyId,role,status}),
    setTime:value=>{now=value;}, setEvidence:value=>{evidence=value;} };
}
async function acquired() {
  const s=setup(); s.claim=await s.plan("acquire",{exportId:s.candidate.id});
  assert.equal((await s.c.commit(s.claim)).outcome,"applied"); return s;
}
async function prepared() { const s=await acquired(); assert.equal((await s.drain()).outcome,"projected"); return s; }
async function sending() {
  const s=await prepared(); const send=await s.plan("authorize_send",{worker:s.claim.worker});
  s.permit=(await s.c.commit(send)).sendPermit; assert.ok(s.permit); return s;
}

for (const from of ["active","draining","disabled","revoked"]) {
  for (const to of ["active","draining","disabled","revoked"]) test(`lifecycle ${from} -> ${to}`,()=>{
    const s=seeds(), connection={...s.connection,state:from};
    const result=connectionTransition({connection,actor:s.actor,nextState:to,expectedGeneration:0,now:1000});
    assert.equal(result.ok,CONNECTION_TRANSITIONS[from].includes(to));
    if (result.ok) { assert.equal(result.next.generation,1); assert.deepEqual(result.next.binding,connection.binding); assert.equal(result.event.generation,1); }
  });
}
for (const role of ["owner","admin"]) test(`${role} may change same-tenant lifecycle`,()=>{
  const s=seeds(); assert.equal(connectionTransition({connection:s.connection,actor:{...s.actor,role},nextState:"disabled",expectedGeneration:0,now:1000}).ok,true);
});
for (const role of ["member",null,"root"]) test(`${role} cannot change lifecycle`,()=>{
  const s=seeds(); assert.equal(connectionTransition({connection:s.connection,actor:{...s.actor,role},nextState:"disabled",expectedGeneration:0,now:1000}).code,"forbidden_role");
});
test("generation and company are exact, without coercion",()=>{
  const s=seeds();
  for (const expectedGeneration of [null,undefined,"0",-1,1]) assert.equal(connectionTransition({connection:s.connection,actor:s.actor,nextState:"revoked",expectedGeneration,now:1000}).ok,false);
  assert.equal(connectionTransition({connection:s.connection,actor:{...s.actor,companyId:"foreign"},nextState:"revoked",expectedGeneration:0,now:1000}).code,"forbidden_company");
});
test("platform readiness always blocks, including supplied synthetic proof",()=>{
  assert.equal(connectionFenceReadiness({platformProof:true,atomic:true}).activationAllowed,false);
  assert.equal(setup().model.readiness.status,"BLOCKED");
});
test("malformed authority and legacy status cannot stand in for a verified fence",()=>{
  const s=seeds();
  for (const connection of [{...s.connection,state:"error"},{...s.connection,generation:null},{...s.connection,generation:"0"},{...s.connection,binding:{...s.connection.binding,ledgerId:""}}]) {
    assert.equal(captureAuthorizationFence({actor:s.actor,principalGeneration:0,membershipGeneration:0,connection}).ok,false);
  }
  assert.equal(evaluateAuthorizationFence({operation:"recover",captured:{},current:{}}).ok,false);
});
for (const state of ["draining","disabled","revoked"]) test(`${state} blocks new admission`,async()=>{
  const s=setup(); assert.equal((await s.change(state)).outcome,"applied");
  const p=await s.plan("acquire",{exportId:s.candidate.id}); assert.equal(p.decision.code,"connection_not_active");
  assert.equal((await s.c.commit(p)).sendPermit,null); assert.equal((await s.read())[f.ref],undefined);
});
for (const winner of ["disable","acquire"]) test(`disable/admission linearizes ${winner} first`,async()=>{
  const s=setup(); const claim=await s.plan("acquire",{exportId:s.candidate.id});
  const results=await Promise.all(winner === "disable" ? [s.change("disabled"),s.c.commit(claim)] : [s.c.commit(claim),s.change("disabled")]);
  assert.equal(results[0].outcome,"applied"); assert.equal(results[1].outcome,winner === "disable" ? "blocked" : "applied");
  assert.equal(Boolean((await s.read())[f.ref]),winner === "acquire");
});
for (const winner of ["revoke","send"]) test(`revocation/send linearizes ${winner} first`,async()=>{
  const s=await prepared(), send=await s.plan("authorize_send",{worker:s.claim.worker});
  const results=await Promise.all(winner === "revoke" ? [s.change("revoked"),s.c.commit(send)] : [s.c.commit(send),s.change("revoked")]);
  assert.equal(results.filter(r=>r.sendPermit).length,winner === "send" ? 1 : 0);
  assert.equal((await s.connectionRead()).state,"revoked");
  assert.equal(Boolean((await s.read())[f.send_authorized_at]),winner === "send");
  assert.equal((await s.c.commit(send)).sendPermit,null);
});
test("reenabling advances generation without reviving an old worker",async()=>{
  const s=await prepared(); await s.change("disabled"); await s.change("active",1);
  const send=await s.plan("authorize_send",{worker:s.claim.worker}); assert.equal(send.decision.code,"stale_connection_fence");
  assert.equal((await s.c.commit(send)).sendPermit,null);
  s.setTime((await s.read())[f.lease_expires_at]+1);
  const recover=await s.plan("recover"); assert.equal((await s.c.commit(recover)).outcome,"applied"); await s.drain();
  const resume=await s.plan("resume_preparation",{retryApproved:true}); assert.equal((await s.c.commit(resume)).outcome,"applied"); await s.drain();
  const newSend=await s.plan("authorize_send",{worker:resume.worker}); assert.ok((await s.c.commit(newSend)).sendPermit);
  assert.equal((await s.read())[f.ref],s.candidate.id);
});
test("stale connection admin generation cannot overwrite a newer fence",async()=>{
  const s=setup(); await s.change("draining");
  assert.equal((await s.change("active",0)).code,"stale_connection_generation"); assert.equal((await s.connectionRead()).state,"draining");
});
test("client cannot supply lifecycle authority or change destination",async()=>{
  const s=setup(); for (const extra of [{actor:{role:"owner"}},{binding:{}},{generation:8},{companyId:"foreign"}]) {
    assert.equal((await s.c.changeConnection({connectionId:s.connection.id,nextState:"revoked",expectedGeneration:0,...extra})).code,"invalid_intent");
  }
  assert.equal((await s.connectionRead()).state,"active");
});
test("cross-company lifecycle and invoice access fail closed",async()=>{
  const s=setup(), foreign=s.model.forUser("foreign-admin");
  assert.equal((await foreign.changeConnection({connectionId:s.connection.id,nextState:"revoked",expectedGeneration:0})).code,"forbidden_company");
  await assert.rejects(foreign.prepare("acquire",{invoiceId:s.invoice.id,exportId:s.candidate.id}),/invoice_not_found/);
});
for (const kind of ["revoked","demoted","company_changed"]) test(`authority ${kind} between prepare and commit blocks send`,async()=>{
  const s=await prepared(), send=await s.plan("authorize_send",{worker:s.claim.worker});
  if (kind === "company_changed") await s.control.switchCompany(s.actor.userId,"foreign-company");
  else await s.member(kind === "demoted" ? "member" : "admin",kind === "demoted" ? "active" : "revoked");
  assert.notEqual((await s.c.commit(send)).outcome,"applied"); assert.equal((await s.read())[f.send_authorized_at],null);
});
test("membership remove/regrant cannot resurrect old process-local worker",async()=>{
  const s=await prepared(); await s.member(); await s.member("admin","active");
  const p=await s.plan("authorize_send",{worker:s.claim.worker}); assert.equal(p.decision.code,"stale_membership_fence");
});
test("company switch away and back invalidates old principal generation",async()=>{
  const s=await prepared(); await s.control.switchCompany(s.actor.userId,"foreign-company"); await s.control.switchCompany(s.actor.userId,s.actor.companyId);
  const p=await s.plan("authorize_send",{worker:s.claim.worker}); assert.equal(p.decision.code,"stale_membership_fence");
});
test("Owner revocation from an authoritative source also invalidates a plan",async()=>{
  const s=setup(d=>{d.memberships[0].role="owner";}); const p=await s.plan("acquire",{exportId:s.candidate.id});
  await s.member("owner","revoked"); assert.notEqual((await s.c.commit(p)).outcome,"applied");
});
test("demoted member cannot change connection lifecycle",async()=>{
  const s=setup(); await s.member("member","active"); assert.equal((await s.change("revoked")).outcome,"blocked");
});
test("membership revocation queued during Invoice CAS orders after the original authorization",async()=>{
  const s=await prepared(), send=await s.plan("authorize_send",{worker:s.claim.worker});
  let release,entered; const wait=new Promise(r=>{release=r;}), inside=new Promise(r=>{entered=r;});
  s.control.injectInvoiceFault({operation:"invoice_cas",mode:"pause_before",wait,entered});
  const writing=s.c.commit(send); await inside;
  let revoked=false; const revoking=s.member().then(()=>{revoked=true;});
  await Promise.resolve(); assert.equal(revoked,false,"same domain prevents interleaved revocation commit");
  release(); const result=await writing; await revoking;
  assert.ok(result.sendPermit,"original authorization linearizes before membership fence");
  assert.equal((await s.c.commit(send)).sendPermit,null);
  await assert.rejects(s.plan("authorize_send",{worker:s.claim.worker}),/forbidden_role/);
});
test("delayed acknowledgement cannot become a new authorization after revocation",async()=>{
  const s=await prepared(), send=await s.plan("authorize_send",{worker:s.claim.worker});
  let release,entered; const wait=new Promise(r=>{release=r;}), inside=new Promise(r=>{entered=r;});
  s.control.injectInvoiceFault({operation:"invoice_cas",mode:"pause_after",wait,entered});
  const writing=s.c.commit(send); await inside; const revoke=s.change("revoked"); release();
  const original=await writing; assert.ok(original.sendPermit); assert.equal((await revoke).outcome,"applied");
  assert.equal((await s.c.commit(send)).sendPermit,null);
});
for (const mode of ["reject","unknown_before","unknown_after","throw_before","throw_after"]) test(`send CAS ${mode} never returns a replacement permission`,async()=>{
  const s=await prepared(), send=await s.plan("authorize_send",{worker:s.claim.worker});
  s.control.injectInvoiceFault({operation:"invoice_cas",mode}); const result=await s.c.commit(send);
  assert.notEqual(result.outcome,"applied"); assert.equal(result.sendPermit,null); assert.equal((await s.c.commit(send)).sendPermit,null);
  await s.change("revoked"); assert.equal((await s.plan("authorize_send",{worker:s.claim.worker})).decision.ok,false);
});
for (const mode of ["unknown_before","unknown_after"]) test(`connection ${mode} is not reported as committed revocation`,async()=>{
  const s=await prepared(); s.control.injectConnectionFault(mode); assert.equal((await s.change("revoked")).outcome,"unknown");
  const connection=await s.connectionRead(); assert.equal(connection.state,mode === "unknown_after" ? "revoked" : "active");
  if (connection.state === "revoked") assert.equal((await s.plan("authorize_send",{worker:s.claim.worker})).decision.ok,false);
});
test("expired preparation lease rejects retained worker",async()=>{
  const s=await prepared(); s.setTime((await s.read())[f.lease_expires_at]);
  const send=await s.plan("authorize_send",{worker:s.claim.worker}); assert.equal(send.decision.code,"preparation_expired");
});
for (const state of ["draining","disabled","revoked"]) test(`recover expired preparation with original ${state} connection without new send`,async()=>{
  const s=await prepared(); await s.change(state); s.setTime((await s.read())[f.lease_expires_at]+1);
  const recover=await s.plan("recover"); assert.equal((await s.c.commit(recover)).outcome,"applied");
  assert.equal((await s.read())[f.state],"preparation_failed"); assert.equal((await s.drain()).outcome,"projected");
  const retry=await s.plan("resume_preparation",{retryApproved:true}); assert.equal(retry.decision.code,"connection_not_active");
});
test("revoked sending recovers without erasing authorization, marker or financial data",async()=>{
  const s=await sending(), before=await s.read(); await s.drain(); await s.change("revoked");
  s.setTime(before[f.lease_expires_at]+1); const recover=await s.plan("recover"); assert.equal((await s.c.commit(recover)).outcome,"applied");
  const after=await s.read(); assert.equal(after[f.state],"needs_reconciliation"); assert.equal(after[f.send_authorized_at],before[f.send_authorized_at]);
  assert.deepEqual(after[f.binding],before[f.binding]);
  for (const field of ["revision","seller_snapshot","buyer_snapshot","payment_snapshot","line_items","vat_summary","total"]) assert.deepEqual(after[field],before[field]);
  await s.drain(); assert.equal((await s.plan("resume_preparation",{retryApproved:true})).decision.ok,false);
});
test("another current admin can project and recover after original admin loses membership",async()=>{
  const s=await sending(); await s.member(); await s.other.changeConnection({connectionId:s.connection.id,nextState:"revoked",expectedGeneration:0});
  assert.equal((await s.other.projectAudit(s.input)).outcome,"projected"); s.setTime((await s.read())[f.lease_expires_at]+1);
  const recover=await s.other.prepare("recover",s.input); assert.equal((await s.other.commit(recover)).outcome,"applied");
  assert.equal((await s.read())[f.state],"needs_reconciliation");
});
test("audit interruption after revoke preserves pending event and blocks recovery",async()=>{
  const s=await sending(), before=await s.read(); await s.change("revoked"); s.setTime(before[f.lease_expires_at]+1);
  s.control.injectInvoiceFault({operation:"event_read",mode:"missing"}); assert.notEqual((await s.drain()).outcome,"projected");
  const recovery=await s.plan("recover"); assert.equal(recovery.decision.code,"audit_pending_or_invalid");
  assert.deepEqual((await s.read()).accounting_pending_event,before.accounting_pending_event);
  assert.equal((await s.drain()).outcome,"projected");
});
test("reconciliation after revocation cannot use client evidence or rearm absence",async()=>{
  const s=await sending(); await s.drain(); await s.change("revoked"); s.setTime((await s.read())[f.lease_expires_at]+1);
  await s.c.commit(await s.plan("recover")); await s.drain();
  await assert.rejects(s.plan("reconcile",{response:{found:true}}),/invalid_intent/);
  s.setEvidence({status:200,bodyText:"[]",lookupEvidence:{contract:MOCK_LOOKUP_CONTRACT,complete:true,authoritative:true,
    invoiceNo:s.invoice.number,currency:s.invoice.currency,nextCursor:null}});
  const plan=await s.plan("reconcile"); assert.equal(plan.decision.code,"sender_quiescence_unproven"); assert.equal((await s.read())[f.state],"needs_reconciliation");
});
test("completion is separate from minting send permission and remains unwired",()=>{
  assert.equal(evaluateAuthorizationFence({operation:"complete_authorized"}).code,"trusted_completion_protocol_unimplemented");
});
test("connection lifecycle audit is append-only and does not overwrite Invoice pending event",async()=>{
  const s=await acquired(), before=await s.read(); await s.change("draining"); await s.change("revoked",1);
  const snapshot=await s.control.snapshot(); assert.deepEqual(snapshot.invoices[0].accounting_pending_event,before.accounting_pending_event);
  assert.deepEqual(snapshot.fenceLog.filter(e=>e.kind === "connection").map(e=>e.generation),[1,2]);
  snapshot.connections[0].binding.ledgerId="tampered"; assert.equal((await s.connectionRead()).binding.ledgerId,s.connection.binding.ledgerId);
});
test("prepared binding change is never accepted as a generation-only fence",()=>{
  const s=seeds(); const current=captureAuthorizationFence({actor:s.actor,principalGeneration:0,membershipGeneration:0,connection:s.connection}).stamp;
  const forged={...current,binding:{...current.binding,ledgerId:"replacement"},connectionState:"active"};
  assert.equal(evaluateAuthorizationFence({operation:"authorize_send",captured:current,current:forged}).code,"stale_connection_fence");
});
test("schemas and active writers still have no prepared revocation protocol",()=>{
  const schema=JSON.parse(readFileSync(new URL("../../../../base44/entities/AccountingConnection.jsonc",import.meta.url),"utf8"));
  assert.deepEqual(schema.properties.status.enum,["active","disabled","error"]);
  const handler=readFileSync(new URL("../../invoices-fns.js",import.meta.url),"utf8");
  const membership=readFileSync(new URL("../../tenant-fns.js",import.meta.url),"utf8");
  assert.doesNotMatch(handler,/connectionFenceModel|connectionLifecycle/);
  assert.match(membership,/CompanyMembership\.update/); assert.match(membership,/CompanyMembership\.delete/);
  assert.doesNotMatch(membership,/connectionFenceModel|connectionLifecycle/);
});
test("strict trusted found evidence can reconcile original revoked destination without sending",async()=>{
  const s=await sending(); await s.drain(); await s.change("revoked"); s.setTime((await s.read())[f.lease_expires_at]+1);
  await s.c.commit(await s.plan("recover")); await s.drain();
  s.setEvidence({status:200,bodyText:JSON.stringify([{SIHId:"synthetic-document",InvoiceNo:s.invoice.number,CurrencyCode:s.invoice.currency,
    TotalAmount:s.invoice.subtotal,VatAmount:s.invoice.vat_amount,TotalSum:s.invoice.total}]),
  lookupEvidence:{contract:MOCK_LOOKUP_CONTRACT,complete:true,authoritative:true,invoiceNo:s.invoice.number,currency:s.invoice.currency,nextCursor:null}});
  const p=await s.plan("reconcile"); const result=await s.c.commit(p);
  assert.equal(result.outcome,"applied"); assert.equal(result.sendPermit,null); assert.equal((await s.read())[f.state],"exported");
  assert.equal((await s.read())[f.provider_document_id],"synthetic-document");
});
test("lease expires between preparation of authorization and its commit",async()=>{
  const s=await prepared(), p=await s.plan("authorize_send",{worker:s.claim.worker});
  s.setTime((await s.read())[f.lease_expires_at]+1);
  assert.equal((await s.c.commit(p)).sendPermit,null); assert.equal((await s.read())[f.send_authorized_at],null);
});
test("new user facade or JSON clone cannot reuse another worker or plan",async()=>{
  const s=await prepared();
  assert.equal((await s.other.prepare("authorize_send",{...s.input,worker:s.claim.worker})).decision.ok,false);
  assert.equal((await s.plan("authorize_send",{worker:{}})).decision.ok,false);
  assert.equal((await s.c.commit(structuredClone(s.claim))).sendPermit,null);
});
test("connection generation change between send prepare and commit blocks the old plan",async()=>{
  const s=await prepared(), p=await s.plan("authorize_send",{worker:s.claim.worker});
  await s.change("draining"); await s.change("active",1);
  assert.equal((await s.c.commit(p)).code,"stale_connection_fence"); assert.equal((await s.read())[f.send_authorized_at],null);
});
test("duplicate or replacement synthetic destinations fail construction or admission",async()=>{
  const data=seeds();
  assert.throws(()=>createConnectionFenceModel({connections:[data.connection,data.connection]}),/invalid_synthetic_connection/);
  const s=setup(d=>{d.connection.binding={...d.connection.binding,ledgerId:"replacement"};});
  await assert.rejects(s.plan("acquire",{exportId:s.candidate.id}),/original_destination_unverified/);
});
test("revoked connection permits safe pre-send cancellation but never cancels an authorized export",async()=>{
  const s=await prepared(); await s.change("revoked");
  const cancel=await s.plan("cancel"); assert.equal((await s.c.commit(cancel)).outcome,"applied");
  assert.equal((await s.read()).status,"cancelled"); assert.equal((await s.read())[f.state],"aborted_before_send");
  const sent=await sending(); await sent.drain(); await sent.change("revoked");
  const unsafe=await sent.plan("cancel"); assert.equal(unsafe.decision.code,"accounting_outcome_unresolved");
  assert.equal((await sent.read()).status,"issued");
});
test("generation exhaustion, incomplete membership envelope and empty identity fail closed",()=>{
  const s=seeds();
  for (const generation of [Number.MAX_SAFE_INTEGER,Infinity,NaN,-1]) assert.equal(connectionTransition({connection:{...s.connection,generation},actor:s.actor,nextState:"revoked",expectedGeneration:generation,now:1000}).ok,false);
  assert.equal(captureAuthorizationFence({actor:s.actor,principalGeneration:0,connection:s.connection}).ok,false);
  assert.equal(connectionTransition({connection:{...s.connection,id:""},actor:s.actor,nextState:"revoked",expectedGeneration:0,now:1000}).ok,false);
  const connection={...s.connection,generation:Number.MAX_SAFE_INTEGER};
  const captured=captureAuthorizationFence({actor:s.actor,principalGeneration:0,membershipGeneration:0,connection}).stamp;
  const current={...captured,connectionState:"active"};
  assert.equal(evaluateAuthorizationFence({operation:"authorize_send",captured,current}).code,"generation_exhausted");
  assert.equal(evaluateAuthorizationFence({operation:"recover",captured,current}).ok,true,"exhaustion must preserve recovery");
});
