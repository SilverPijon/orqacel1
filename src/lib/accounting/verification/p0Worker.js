/** Fixed synthetic bootstrap. Real SDK/app/identity bootstrap remains blocked. */
import { executeP0Task, openP0Backend, createSyntheticP0Client } from "./p0Driver.js";

if (typeof process.send === "function") {
  let started=false;
  process.on("message",async message=>{
    if(started || message?.type!=="start")return;
    started=true;
    try {
      if(message.mode!=="synthetic")openP0Backend();
      // Separate local map/client in EACH child. This tests worker ownership only,
      // deliberately NOT shared-backend concurrency or database atomicity.
      const {fixtures,task}=message,client=createSyntheticP0Client(fixtures);
      if(task.pauseBefore===true)await new Promise(resolve=>{
        const release=m=>{if(m?.type==="release"){process.off("message",release);resolve();}};
        process.on("message",release);process.send({type:"paused"});
      });
      const result=await executeP0Task(client,task,fixtures);
      process.send({type:"result",result:{...result,mode:"SYNTHETIC ONLY",backendChecksExecuted:0}});
    } catch {process.send({type:"result",result:{pid:process.pid,mode:"SYNTHETIC ONLY",error:"p0_worker_blocked",backendChecksExecuted:0}});}
  });
  process.send({type:"ready"});
}
