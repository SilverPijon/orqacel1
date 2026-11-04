import React from "react";

// One badge for every module's statuses, so the same state always looks the same wherever it
// appears. The tones map onto the Stage 1 semantic tokens only.
// `primary` is kept as an alias of `info`: callers used it for an active or informational state,
// so it reads exactly as before, but there is now a single blue family instead of two names for it.
const TONES = {
  muted: "bg-muted text-muted-foreground ring-border",
  info: "bg-info-muted text-info ring-info/25",
  primary: "bg-info-muted text-info ring-info/25",
  success: "bg-success-muted text-success ring-success/25",
  warning: "bg-warning-muted text-warning ring-warning/25",
  danger: "bg-destructive/10 text-destructive ring-destructive/25",
};

export default function StatusBadge({ label, tone = "muted", className = "" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-5 ring-1 ring-inset ${TONES[tone] || TONES.muted} ${className}`}
    >
      {label}
    </span>
  );
}