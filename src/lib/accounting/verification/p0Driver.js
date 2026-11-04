/** Prepared worker transport. LIVE bootstrap is intentionally absent/hard-blocked. */
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { p0Plan, p0Report, shapeOf, ackShape } from "./p0Package.js";

const entities = new Set(["Invoice","AccountingConnection","AccountingExport","AccountingExportEvent"].map(n=>`P0Capability${n}`));
const fields = new Set(["id","company_id","number","status","revision","accounting_revision","accounting_pending_event",
  "provider","environment","configuration_revision","destination_binding","destination_verified_at","invoice_id","export_key","kind","binding","source_revision","action","event_key",
  ...["ref","at","connection_id","recovered_at","binding","state","attempt_token","attempt_number","lease_expires_at","send_authorized_at","provider_document_id","error_code"].map(n=>`claim_merit_sendinvoice_${n}`)]);
const fail = () => { throw new Error("P0_EXECUTION_BLOCKED_SEPARATE_REVIEW_REQUIRED"); };
const syntheticClients = new WeakMap();

export function createSyntheticP0Client(fixtures) {
  // Fixed implementation, no injectable transport/function/module/credential.
  // Invoked inside each child; maps are intentionally NOT a shared backend.
  const rows=new Map(fixtures.records.map(r=>[r.id,structuredClone(r.data)]));
  let sequence=0,calls=0;
  const handler=Object.freeze({
    async get(id){calls++;return structuredClone(rows.get(id)??null);},
    async create(data){calls++;const row={...structuredClone(data),id:`p0-generated-${process.pid}-${++sequence}`};rows.set(row.id,row);return row;},
    async updateMany(query,update){
      calls++;const row=rows.get(query.id);
      const matches=row&&Object.entries(query).every(([k,v])=>v?.$exists===false ? !Object.hasOwn(row,k) : isDeepStrictEqual(row[k]??null,v));
      if(!matches)return {success:true,updated:0,has_more:false};
      const next={...row,...structuredClone(update.$set??{})};
      for(const k of Object.keys(update.$unset??{}))delete next[k];rows.set(row.id,next);
      return {success:true,updated:1,has_more:false};
    },
  });
  const client=Object.freeze({entities:Object.freeze(Object.fromEntries([...entities].map(name=>[name,handler]))),get calls(){return calls;}});
  syntheticClients.set(client,randomUUID());return client;
}

export function openP0Backend() {
  // No flag, approval JSON, app name, test report or ambient CLI login can open it.
  // A later reviewed boundary must authenticate app creation/identity, scope and
  // explicit execution approval BEFORE credential bootstrap in every process.
  fail();
}

export function validateTask(task, registry) {
  if (!task || Object.keys(task).some(k=>!["operation","identity","entity","id","companyId","query","update","data","dropAcknowledgement","samples","pauseBefore","expected","shape","predicate","expectedUpdated"].includes(k)) ||
      !entities.has(task.entity) || !["service","adminA","memberA","userB","anonymous"].includes(task.identity) ||
      !["read","write","create","sample"].includes(task.operation)) throw new Error("invalid_p0_task");
  if (task.operation === "create") {
    if (!task.data || Object.hasOwn(task.data,"id") || !Object.keys(task.data).every(k=>fields.has(k)) || !registry.companyIds.includes(task.data.company_id)) throw new Error("unregistered_create");
  } else {
    const id = task.operation === "write" ? task.query?.id : task.id;
    const companyId = task.operation === "write" ? task.query?.company_id : task.companyId;
    if (typeof id !== "string" || !registry.records.some(r=>r.id===id && r.companyId===companyId && r.entity===task.entity)) throw new Error("unregistered_record");
    if (task.operation === "write" && (!Object.keys(task.query).every(k=>fields.has(k)) ||
        Object.entries(task.query).some(([k,v])=>v!==null && !["string","number","boolean"].includes(typeof v) &&
          !(k==="claim_merit_sendinvoice_attempt_token" && v?.$exists===false && Object.keys(v).length===1)) ||
        !task.update || Object.keys(task.update).some(k=>!["$set","$unset"].includes(k)) ||
        Object.values(task.update).some(p=>!p || Object.keys(p).some(k=>!fields.has(k) || ["id","company_id"].includes(k))))) throw new Error("unsafe_p0_write");
  }
  if (task.dropAcknowledgement !== undefined && !["before","after"].includes(task.dropAcknowledgement)) throw new Error("invalid_drop_control");
  if (task.pauseBefore !== undefined && typeof task.pauseBefore !== "boolean") throw new Error("invalid_pause_control");
  if (task.operation === "sample" && (!Number.isSafeInteger(task.samples) || task.samples < 2 || task.samples > 100)) throw new Error("invalid_sample_bound");
}

/** SDK-shaped operations; reachable only with a trusted injected test client now.
 * Future worker bootstrap must create a separate approved client per child.
 * No service-role fallback; identity alias must already select the correct client.
 */
export async function executeP0Task(client, task, registry) {
  if (!syntheticClients.has(client)) fail(); // No caller-supplied SDK can bypass bootstrap.
  validateTask(task,registry);
  const handler = client.entities[task.entity];
  const frame = { pid:process.pid,clientId:syntheticClients.get(client),identity:task.identity,entity:task.entity,requestShape:shapeOf(task) };
  if (task.dropAcknowledgement === "before") return {...frame,callerOutcome:"unknown",attempted:false,retryCount:0};
  try {
    let value;
    if (task.operation === "create") value=await handler.create(task.data);
    else if (task.operation === "write") value=await handler.updateMany(task.query,task.update);
    else if (task.operation === "sample") {
      value=[];
      for (let i=0;i<task.samples;i++) value.push(await handler.get(task.id));
    } else value=await handler.get(task.id);
    return {...frame,attempted:true,retryCount:0,callerOutcome:task.dropAcknowledgement === "after" ? "unknown" : "observed",
      ...(task.operation === "write" ? {acknowledgement:value,rawAcknowledgementShape:ackShape(value)} : {value})};
  } catch (error) {
    // Never return error messages, headers, SDK config, URLs or provider bodies.
    return {...frame,attempted:true,retryCount:0,callerOutcome:"unknown",errorStatus:Number.isInteger(error?.status) ? error.status : null,errorShape:shapeOf(error?.data)};
  }
}

/** Actual task execution occurs in each child, never an IPC write callback. */
export function runSyntheticP0Workers(tasks, fixtures, {timeoutMs=10000,hold=false,onPaused=async()=>{}}={}) {
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 16 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error("invalid_worker_batch");
  // This exported runner is deliberately synthetic-only; no module path, URL,
  // app ID, client factory, inherited environment or credential can be supplied.
  const allowed = new Set(["records","companyIds"]);
  if (!fixtures || Object.keys(fixtures).some(k=>!allowed.has(k))) throw new Error("synthetic_fixtures_only");
  return new Promise((resolve,reject)=>{
    const children=[],ready=new Set(),paused=new Set(),results=new Map(); let ended=false;
    const finish=error=>{
      if (ended) return; ended=true; clearTimeout(timer);
      for (const c of children) { if(c.connected)c.disconnect(); c.kill(); }
      if(error)reject(error); else resolve(tasks.map((_,i)=>results.get(i)));
    };
    const timer=setTimeout(()=>finish(new Error("p0_workers_inconclusive_timeout")),timeoutMs);
    tasks.forEach((task,index)=>{
      const child=fork(new URL("./p0Worker.js",import.meta.url),[],{stdio:["ignore","ignore","ignore","ipc"],env:{},execArgv:[]});
      children.push(child);
      child.on("error",()=>finish(new Error("p0_worker_inconclusive_start")));
      child.on("exit",()=>{if(!ended&&!results.has(index))finish(new Error("p0_worker_inconclusive_exit"));});
      child.on("message",async message=>{
        if(ended)return;
        if(message?.type === "ready"&&!ready.has(index)) {
          ready.add(index);
          if(ready.size===tasks.length&&!hold) children.forEach((c,i)=>c.send({type:"start",mode:"synthetic",task:tasks[i],fixtures}));
        } else if(message?.type === "paused"&&task.pauseBefore===true&&!paused.has(index)) {
          paused.add(index);
          try {await onPaused(index);if(!ended)child.send({type:"release"});}
          catch {finish(new Error("p0_barrier_inconclusive"));}
        } else if(message?.type === "result"&&!results.has(index)&&message.result?.pid===child.pid) {
          results.set(index,message.result); if(results.size===tasks.length)finish();
        } else finish(new Error("p0_worker_inconclusive_protocol"));
      });
    });
  });
}

export async function p0LocalHarness() {
  const fixture={id:"p0-local-invoice",company_id:"p0-local-company",revision:0,accounting_revision:0};
  const fixtures={companyIds:[fixture.company_id],records:[{entity:"P0CapabilityInvoice",id:fixture.id,companyId:fixture.company_id,data:fixture}]};
  const task={operation:"read",entity:"P0CapabilityInvoice",identity:"service",id:fixture.id,companyId:fixture.company_id};
  const workers=await runSyntheticP0Workers([task,task],fixtures);
  return {status:"PREPARED",mode:"SYNTHETIC ONLY",backendChecksExecuted:0,activationAllowed:false,
    localWorkerCheck:new Set(workers.map(w=>w.pid)).size===2 && new Set(workers.map(w=>w.clientId)).size===2 ? "PASS" : "FAIL",
    workers:workers.map(({pid,clientId,requestShape})=>({pid,clientId,requestShape})),
    probeReport:p0Report(),liveExecution:p0Plan().execution};
}
