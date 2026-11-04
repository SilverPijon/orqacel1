import React from "react";

// Placeholder rows while a table's first page loads: the page keeps its shape and the content
// settles into place, instead of the whole screen collapsing into a spinner. Columns share the row
// by proportion, so the placeholder fits a phone as well as a desktop without overflowing it.
const COLUMNS = "grid grid-cols-[2fr_1.2fr_1fr_0.8fr] gap-3 sm:gap-4";

export default function TableSkeleton({ rows = 6, label, className = "" }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={`overflow-hidden rounded-xl border border-border bg-card shadow-card ${className}`}
    >
      {label ? <span className="sr-only">{label}</span> : null}
      <div aria-hidden="true" className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className={`${COLUMNS} animate-pulse items-center px-4 py-3`}>
            {[0, 1, 2, 3].map((cellIndex) => (
              <div
                key={cellIndex}
                className={`h-4 w-full rounded ${cellIndex === 0 ? "bg-muted" : "bg-muted/60"}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}