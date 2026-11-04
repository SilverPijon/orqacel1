/** Local IPC barrier with independent Node processes. NOT independent Base44 clients. */
import { fork } from "node:child_process";

export function independentRace(commands, write, { timeoutMs = 10000 } = {}) {
  if (!Array.isArray(commands) || commands.length < 2) throw new Error("at_least_two_workers_required");
  return new Promise((resolve, reject) => {
    const children = [], ready = new Set(), requested = new Set(), results = new Map();
    let ended = false;
    const timer = setTimeout(() => finish(new Error("worker_timeout")), timeoutMs);
    function finish(failure) {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      for (const child of children) { if (child.connected) child.disconnect(); child.kill(); }
      if (failure) reject(failure);
      else resolve(commands.map((_, index) => results.get(index)));
    }
    commands.forEach((command, index) => {
      if (ended) return;
      let child;
      try {
        child = fork(new URL("./raceWorker.js", import.meta.url), [], {
          stdio: ["ignore", "ignore", "ignore", "ipc"], env: {}, execArgv: [],
        });
      } catch { finish(new Error("worker_start_failed")); return; }
      children.push(child);
      child.on("error", () => finish(new Error("worker_start_failed")));
      child.on("exit", () => { if (!ended && !results.has(index)) finish(new Error("worker_exited_early")); });
      child.on("message", async (message) => {
        try {
          if (ended) return;
          if (message.type === "ready") {
            ready.add(index);
            if (ready.size === commands.length) children.forEach((worker, i) => worker.send({ type: "start", command: commands[i] }));
          } else if (message.type === "write" && !requested.has(index)) {
            requested.add(index);
            const acknowledgement = await write(message.command, index);
            results.set(index, { pid: child.pid, acknowledgement });
            if (results.size === commands.length) finish();
          } else finish(new Error("invalid_worker_protocol"));
        } catch { finish(new Error("worker_write_failed")); }
      });
    });
  });
}
