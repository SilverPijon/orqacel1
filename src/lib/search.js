// Search boxes are matched literally: whatever the caller types is escaped before it reaches
// the database, so it can never be compiled as a pattern (no regex backtracking blow-ups).
export function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}