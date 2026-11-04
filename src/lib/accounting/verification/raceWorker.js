// Fixed local IPC worker: no SDK, network, credentials, shell, or dynamic imports.
if (typeof process.send === "function") {
  let started = false;
  process.on("message", (message) => {
    if (message?.type !== "start" || started) return;
    started = true;
    process.send({ type: "write", command: message.command });
  });
  process.send({ type: "ready" });
}
