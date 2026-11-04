/**
 * In-memory store implementing the export persistence port.
 *
 * Test-only. `cas` compares and writes without awaiting anything in between, so concurrent
 * callers cannot both win — the same guarantee the future database write must provide.
 */

export function createMemoryStore(seed = {}) {
  const records = new Map(Object.entries(seed));
  const audit = [];
  const operations = [];

  async function get(key) {
    const record = records.get(key);
    return record ? { ...record } : null;
  }

  async function cas(key, expectedVersion, next) {
    const current = records.get(key) || null;
    const currentVersion = current ? current.version : 0;

    if (Number(expectedVersion) !== currentVersion) {
      operations.push({ op: "cas-rejected", key, expectedVersion, currentVersion });
      return { ok: false, current: current ? { ...current } : null };
    }

    records.set(key, { ...next });
    operations.push({ op: "cas", key, expectedVersion });
    return { ok: true, current: { ...next } };
  }

  async function appendAudit(event) {
    audit.push(event);
    return event;
  }

  return {
    records,
    audit,
    operations,
    get,
    cas,
    appendAudit,
    peek(key) {
      const record = records.get(key);
      return record ? { ...record } : null;
    },
  };
}