import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { P0_CATALOGUE, P0_REPORT_SCHEMA, p0Plan, claimRecipe, clearRecipe, predicateRecipes, controlRecipes,
  classifyP0, p0Report, ackShape } from "../verification/p0Package.js";
import { openP0Backend, executeP0Task, runSyntheticP0Workers, p0LocalHarness, validateTask, createSyntheticP0Client } from "../verification/p0Driver.js";
import { MERIT_FIELDS as f } from "../export/claimProtocol.js";

const invoice={id:"p0-invoice",company_id:"p0-company",number:"p0-number",status:"issued",revision:0,accounting_revision:0};
const writer={pid:1001,clientId:"client-1"},reader={pid:1002,clientId:"client-2"};
const ack=updated=>({success:true,updated,has_more:false});
const fixtures={companyIds:[invoice.company_id],records:[{entity:"P0CapabilityInvoice",id:invoice.id,companyId:invoice.company_id,data:invoice}]};
const request={operation:"read",identity:"service",entity:"P0CapabilityInvoice",id:invoice.id,companyId:invoice.company_id};
function observations() {
  const a=claimRecipe(invoice,"p0-worker-a"), b=claimRecipe(invoice,"p0-worker-b"),persisted=a.expected;
  const cases=predicateRecipes(Object.fromEntries(["missing","null","empty"].flatMap(s=>["missing","null","empty"].map(p=>[`${s}:${p}`,{...invoice,id:`p0-${s}-${p}`}]))))
    .map(c=>({...c,writer,reader,acknowledgement:ack(c.expectedUpdated),expected:{accounting_revision:c.expectedUpdated},persisted:{accounting_revision:c.expectedUpdated}}));
  const controls=identity=>({identity,writer,reader,identityVerified:true,positiveControlVerified:true,denialStatus:403,
    readStatus:["adminA","memberA"].includes(identity)?200:403,ownReadMatches:true,before:invoice,persisted:invoice});
  return {
    A:{workers:[{...writer,token:"p0-worker-a",query:a.query,expected:a.expected,acknowledgement:ack(1)},
      {pid:1003,clientId:"client-3",token:"p0-worker-b",query:b.query,expected:b.expected,acknowledgement:ack(0)}],reader,persisted},
    B:{writer,reader,before:invoice,expected:persisted,persisted,acknowledgement:ack(1),samples:[invoice,persisted],overlapped:true},
    C:{cases},D:{writer,reader,expected:invoice,persisted:invoice,acknowledgement:ack(1)},
    E:{cases:["positive","conflict"].map(control=>({control,writer,reader,acknowledgement:ack(control === "positive" ? 1:0),expected:invoice,persisted:invoice}))},
    F:{provisioningReceiptVerified:true,cases:p0Plan().schemas.map(s=>({entity:s.entity,writer,reader,requestData:{accounting_revision:null},created:{id:"p0-created",accounting_revision:null},persisted:{id:"p0-created",accounting_revision:null},schemaErrorVerified:true,invalidBindingAccepted:false}))},
    G:{cases:["adminA","memberA"].map(controls)},H:{cases:["userB","anonymous"].map(controls)},
    I:{writer,reader,barrierVerified:true,newerUpdated:1,staleUpdated:0,callerOutcome:"unknown",retryCount:0,persisted:invoice,expected:invoice,dropBeforeVerified:true,dropAfterVerified:true},
    J:null,
  };
}
for(const p of P0_CATALOGUE) {
  test(`${p.id}: absent evidence is INCONCLUSIVE, never a pass`,()=>assert.equal(classifyP0(p.id).classification,"INCONCLUSIVE"));
  test(`${p.id}: specified SYNTHETIC observations classify without backend promotion`,()=>{
    const o=observations();o.J=o.A;assert.equal(classifyP0(p.id,o[p.id]).classification,"PASS");
    const report=p0Report(o);assert.equal(report.activationAllowed,false);assert.equal(report.backendChecksExecuted,0);assert.equal(report.appId,null);
  });
  test(`${p.id}: interrupted observation is INCONCLUSIVE`,()=>assert.equal(classifyP0(p.id,{timedOut:true}).classification,"INCONCLUSIVE"));
}
for(const id of ["A","J"])test(`${id}: two winners or same reader process fail the probe`,()=>{
  const o=observations().A;o.workers[1].acknowledgement=ack(1);assert.equal(classifyP0(id,o).classification,"FAIL");
  o.reader=writer;assert.equal(classifyP0(id,o).classification,"INCONCLUSIVE");
});
test("torn atomic image fails B",()=>{const o=observations().B;o.samples.push({...invoice,accounting_revision:1});assert.equal(classifyP0("B",o).classification,"FAIL");});
test("predicate mismatch and duplicate controls do not pass C",()=>{
  const o=observations().C;o.cases[0].acknowledgement=ack(1-o.cases[0].expectedUpdated);assert.equal(classifyP0("C",o).classification,"FAIL");
  o.cases=Array(9).fill(o.cases[0]);assert.equal(classifyP0("C",o).classification,"INCONCLUSIVE");
});
test("null replacement is not whole-field unset",()=>{const o=observations().D;o.persisted={...invoice,accounting_pending_event:null};assert.equal(classifyP0("D",o).classification,"FAIL");});
test("coerced or contradictory raw acknowledgements fail E",()=>{
  for(const response of [{success:true,updated:"1",has_more:false},{success:false,updated:1,has_more:false},{success:true,updated:1}]) {
    const o=observations().E;o.cases[0].acknowledgement=response;assert.equal(classifyP0("E",o).classification,"FAIL");
  }
});
test("loss of explicitly null field or accepted invalid binding fails F",()=>{
  const o=observations().F;delete o.cases[0].created.accounting_revision;assert.equal(classifyP0("F",o).classification,"FAIL");
  const p=observations().F;p.cases[0].invalidBindingAccepted=true;assert.equal(classifyP0("F",p).classification,"FAIL");
});
for(const id of ["G","H"])test(`${id}: unauthorized mutation fails, an outage is not a denial`,()=>{
  const o=observations()[id];o.cases[0].persisted={...invoice,accounting_revision:99};assert.equal(classifyP0(id,o).classification,"FAIL");
  o.cases[0].persisted=invoice;o.cases[0].denialStatus=503;assert.equal(classifyP0(id,o).classification,"INCONCLUSIVE");
});
test("stale completion, retry and fabricated applied outcome fail I",()=>{
  for(const patch of [{staleUpdated:1},{retryCount:1},{callerOutcome:"applied"}])assert.equal(classifyP0("I",{...observations().I,...patch}).classification,"FAIL");
});
test("plan clones four dedicated schema definitions without changing source names",()=>{
  const plan=p0Plan();assert.equal(plan.schemas.length,4);assert.ok(plan.schemas.every(s=>s.entity.startsWith("P0Capability")&&s.schema.name===s.entity));
  assert.match(plan.adapterHash,/^[a-f0-9]{64}$/);assert.match(plan.driverHash,/^[a-f0-9]{64}$/);assert.equal(plan.activationAllowed,false);
});
test("reuse Stage-A/D/E command builders for claim and whole-field clear",()=>{
  const claim=claimRecipe(invoice,"p0-token"),clear=clearRecipe(claim.expected);
  assert.equal(claim.query.id,invoice.id);assert.ok(claim.update.$set.accounting_pending_event);
  assert.deepEqual(clear.update.$unset,{accounting_pending_event:""});assert.equal(clear.expected.accounting_revision,2);
});
test("schema, permission, acknowledgement and interruption controls have executable SDK tasks",()=>{
  const recipes=controlRecipes(invoice);assert.equal(recipes.F.length,8);
  for(const task of [...recipes.F,...recipes.E,...recipes.G.flatMap(c=>[c.read,c.write]),...recipes.H.flatMap(c=>[c.read,c.write])])validateTask(task,fixtures);
  assert.equal(recipes.I.dropAfter.dropAcknowledgement,"after");assert.equal(recipes.J.operation,"read");
});
test("no supplied flag, app ID, approval JSON or synthetic proof opens live boundary",()=>{
  for(const input of [{},{approved:true},{appId:"disposable",approval:{signed:true}},{syntheticOnly:true,platformProof:true}])assert.throws(()=>openP0Backend(input),/BLOCKED/);
});
test("unknown CLI options and live options remain blocked before any bootstrap",()=>{
  for(const args of [["--backend"],["--p0-live"],["--p0-plan","--app-id","production"]]) {
    assert.throws(()=>execFileSync(process.execPath,["scripts/accounting-verification.js",...args],{stdio:"pipe"}),e=>e.status===2);
  }
});
test("driver rejects production entity names, unregistered IDs and broad IDs",()=>{
  for(const task of [{...request,entity:"Invoice"},{...request,id:"not-registered"},{operation:"write",entity:request.entity,identity:"service",query:{id:{$in:[invoice.id]},company_id:invoice.company_id},update:{$set:{accounting_revision:1}}}])assert.throws(()=>validateTask(task,fixtures));
});
test("driver has no financial rewrite/delete or arbitrary transport task",()=>{
  for(const task of [{...request,operation:"delete"},{...request,url:"https://example.invalid"},{operation:"write",entity:request.entity,identity:"service",query:{id:invoice.id,company_id:invoice.company_id},update:{$set:{total:3}}}])assert.throws(()=>validateTask(task,fixtures));
});
test("dropped responses are unknown with zero automatic retries",async()=>{
  const client=createSyntheticP0Client(fixtures);
  for(const dropAcknowledgement of ["before","after"]) {
    const result=await executeP0Task(client,{...claimRecipe(invoice,"p0-token"),dropAcknowledgement},fixtures);
    assert.equal(result.callerOutcome,"unknown");assert.equal(result.retryCount,0);
  }
  assert.equal(client.calls,1);
});
test("direct SDK injection and wrapping cannot bypass execution boundary",async()=>{
  const client=createSyntheticP0Client(fixtures);
  for(const fake of [{entities:client.entities},{entities:{P0CapabilityInvoice:{get(){throw Error("must never call");}}}}])await assert.rejects(executeP0Task(fake,request,fixtures),/BLOCKED/);
  assert.ok(Object.isFrozen(client.entities.P0CapabilityInvoice));
});
test("evidence output omits credentials, personal values and error bodies",()=>{
  const o=observations();o.A.workers[0].acknowledgement.secret="DO_NOT_LOG_SECRET";
  o.A.persisted={...o.A.persisted,customer_email:"DO_NOT_LOG_EMAIL"};
  const report=p0Report(o),json=JSON.stringify(report);
  assert.doesNotMatch(json,/DO_NOT_LOG/);assert.equal(report.mode,"SYNTHETIC ONLY");
  for(const key of P0_REPORT_SCHEMA.required)assert.ok(Object.hasOwn(report,key));
  assert.equal(ackShape({updated:"1"}).shape.updated,"string");
});
test("workers execute their own tasks in separate processes/clients, not parent write callbacks",async()=>{
  const result=await p0LocalHarness();assert.equal(result.localWorkerCheck,"PASS");assert.equal(result.backendChecksExecuted,0);
  assert.equal(new Set(result.workers.map(w=>w.pid)).size,2);
});
test("synthetic pause barrier is released only after the controller's independent step",async()=>{
  let paused=false;
  const result=await runSyntheticP0Workers([{...request,pauseBefore:true}],fixtures,{onPaused:async()=>{paused=true;}});
  assert.ok(paused);assert.equal(result[0].value.id,invoice.id);assert.equal(result[0].mode,"SYNTHETIC ONLY");
});
test("worker timeout is INCONCLUSIVE and never retried",async()=>{
  await assert.rejects(runSyntheticP0Workers([request],fixtures,{hold:true,timeoutMs:100}),/inconclusive_timeout/);
});
test("SDK update timestamp is ignored but unrelated source mutation fails",()=>{
  const o=observations().B;o.persisted={...o.expected,updated_date:"p0-new-sdk-time"};assert.equal(classifyP0("B",o).classification,"PASS");
  o.persisted.total=999;assert.equal(classifyP0("B",o).classification,"FAIL");
});
test("missing permission preimage or positive read cannot pass",()=>{
  const o=observations().G;delete o.cases[0].before;assert.equal(classifyP0("G",o).classification,"INCONCLUSIVE");
  const h=observations().H;delete h.cases[0].readStatus;assert.equal(classifyP0("H",h).classification,"INCONCLUSIVE");
});
test("predicate execution requires nine distinct records",()=>assert.throws(()=>predicateRecipes({a:invoice}),/nine_fresh/));
